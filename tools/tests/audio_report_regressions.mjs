import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { hasSoundDefinition } from '../../src/core/audio.js';
import { createAudioDiagnosticSession, summarizeAudioDiagnosticEvents } from '../../src/core/audio-diagnostics.mjs';
import { potionIconColor } from '../../src/core/potion-icon-color.mjs';
import { A, potionIcon } from '../../src/core/assets.js';

for (const [kind, color] of Object.entries({ hp: 'red', mp: 'blue', rejuv: 'purple', fury: 'orange' })) {
  assert.equal(potionIconColor(kind), color, `${kind} effects resolve to their inventory potion art`);
  assert.equal(potionIconColor(color), color, `${color} inventory keys remain supported`);
  await stat(new URL(`../../assets/ui/potion_${color}.png`, import.meta.url));
}
assert.equal(potionIconColor('missing-kind'), null, 'unknown kinds are handled as an explicit fallback case');
const priorDocument = globalThis.document;
const drawnImages = [];
globalThis.document = { createElement: () => {
  const context = new Proxy({}, { get: (_target, key) => (...args) => { if (key === 'drawImage') drawnImages.push(args[0]); } });
  return { width: 0, height: 0, getContext: () => context };
} };
try {
  A.potions = Object.fromEntries(['red', 'blue', 'purple', 'orange'].map((color) => [color, { width: 32, height: 32, color }]));
  for (const [kind, color] of Object.entries({ hp: 'red', mp: 'blue', rejuv: 'purple', fury: 'orange' })) {
    potionIcon(kind, 24);
    assert.equal(drawnImages.at(-1).color, color, `${kind} icon draws its corresponding loaded image`);
  }
  delete A.potions.orange;
  assert.doesNotThrow(() => potionIcon('fury', 24), 'a missing decoded sprite uses the fallback icon and does not read undefined.width');
} finally {
  A.potions = {};
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
}

for (const sound of ['step_stone', 'step_dirt', 'step_water', 'step_wood']) {
  assert.equal(hasSoundDefinition(sound), true, `${sound} resolves before the sample lookup`);
}

const stamp = (offset) => new Date(Date.UTC(2026, 10, 24, 23, 0, 0, offset)).toISOString();
const report = summarizeAudioDiagnosticEvents([
  { type: 'play', timeUtc: stamp(0), id: 1, sound: 'step_stone' },
  { type: 'source-scheduled', timeUtc: stamp(1), id: 1, sourceId: 1, sound: 'step_stone', category: 'playerMovement', worldId: 7 },
  { type: 'source-start', timeUtc: stamp(2), id: 1, sourceId: 1, sound: 'step_stone', category: 'playerMovement', worldId: 7 },
  { type: 'area-exit', timeUtc: stamp(3), worldId: 7, reason: 'area-transition' },
  { type: 'source-stop', timeUtc: stamp(4), id: 1, sourceId: 1, worldId: 7 },
  { type: 'stop', timeUtc: stamp(4), id: 1, reason: 'ended' },
  { type: 'play', timeUtc: stamp(5), id: 2, sound: 'step_dirt' },
  { type: 'stop', timeUtc: stamp(5), id: 2, reason: 'unknown-sound' },
  { type: 'play', timeUtc: stamp(6), id: 3, sound: 'hit' },
  { type: 'stop', timeUtc: stamp(6), id: 3, reason: 'duplicate-suppressed' },
]);
assert.equal(report.requests.requested, 3);
assert.equal(report.requests.suppressed, 2);
assert.equal(report.requests.unknownSounds, 1);
assert.equal(report.webAudioSources.scheduled, 1);
assert.equal(report.webAudioSources.started, 1);
assert.equal(report.webAudioSources.stopped, 1);
assert.equal(report.playbackAfterTransitions[0].durationAfterTransitionMs, 1);

// Session totals and source snapshots must remain complete after the retained
// detail window fills; important transitions/errors have their own bounded log.
const bounded = createAudioDiagnosticSession({ detailLimit: 3, importantLimit: 8 });
const log = (type, offset, details = {}) => bounded.record({ type, timeUtc: stamp(offset), perfMs: offset, ...details });
log('play', 0, { id: 10, sound: 'hit', category: 'weaponImpact', worldId: 4, environment: 'Crypt' });
log('stop', 1, { id: 10, reason: 'duplicate-suppressed' });
log('play', 2, { id: 11, sound: 'fire', category: 'enemySpell', worldId: 4, environment: 'Crypt' });
log('source-scheduled', 3, { id: 11, sourceId: 1, sound: 'fire', category: 'enemySpell', worldId: 4, scheduledInMs: 40 });
log('source-start', 4, { id: 11, sourceId: 1, sound: 'fire', category: 'enemySpell', worldId: 4 });
log('combat-end', 5, { worldId: 4, environment: 'Crypt', reason: 'all-enemies-dead' });
log('area-exit', 6, { worldId: 4, environment: 'Crypt', reason: 'area-transition' });
log('error', 7, { message: 'diagnostic error after detail cap' });
log('source-stop', 8, { id: 11, sourceId: 1, sound: 'fire', category: 'enemySpell', worldId: 4 });
log('stop', 9, { id: 11, reason: 'ended' });
log('source-scheduled', 10, { id: 12, sourceId: 1, sound: 'portal', category: 'portal', worldId: 8, scheduledInMs: 800 });
log('processing-spike', 11, { durationMs: 8.5, sound: 'hit', category: 'weaponImpact' });
const boundedReport = bounded.report();
assert.equal(bounded.events.length, 3);
assert.equal(boundedReport.totalEvents, 12);
assert.equal(boundedReport.detailDropped, 9);
assert.equal(boundedReport.requests.requested, 2, 'all requests are counted after detail storage is full');
assert.equal(boundedReport.requests.suppressed, 1);
assert.equal(boundedReport.webAudioSources.scheduled, 2);
assert.equal(boundedReport.webAudioSources.started, 1);
assert.equal(boundedReport.webAudioSources.stopped, 1);
assert.deepEqual(boundedReport.activeSourcesAtReport.pending.map((source) => source.sound), ['portal']);
assert.deepEqual(boundedReport.activeSourcesAtReport.active, []);
assert.ok(bounded.importantEvents.some((event) => event.type === 'combat-end'));
assert.ok(bounded.importantEvents.some((event) => event.type === 'area-exit'));
assert.ok(bounded.importantEvents.some((event) => event.type === 'error'));
assert.equal(boundedReport.processingSpikeCount, 1, 'spike summary continues after detailed-event storage is full');
assert.equal(boundedReport.processingSpikes[0].durationMs, 8.5);
assert.equal(boundedReport.playbackAfterTransitions[0].durationAfterTransitionMs, 2);
const criticalRing = createAudioDiagnosticSession({ detailLimit: 1, importantLimit: 2 });
for (let i = 0; i < 4; i++) criticalRing.record({ type: 'error', timeUtc: stamp(i), message: `error-${i}` });
assert.deepEqual(criticalRing.importantEvents.map((event) => event.message), ['error-2', 'error-3'], 'recent critical events continue to be retained after their own bounded ring wraps');
assert.equal(criticalRing.report().importantEventCounts.error, 4, 'critical event totals remain complete when older detail is evicted');

const [audio, world, game, icons, assets, loot, combat, heresies, main] = await Promise.all([
  readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/icons.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/assets.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/loot.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/combat.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/heresies.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
]);
assert.match(audio, /unknown-sound/);
assert.match(audio, /source-scheduled/);
assert.match(audio, /source-start/);
assert.match(audio, /source-stop/);
assert.match(world, /recordAudioDiagnosticMarker\(inCombat \? 'combat-start' : 'combat-end'/);
assert.match(game, /reason: 'area-transition', transitionTo: to/);
assert.match(icons, /itemIconURL\(spec\.item\)/);
assert.match(assets, /potionIconColor\(color\)/);
assert.match(assets, /if \(!img \|\| !img\.width \|\| !img\.height\)/, 'missing or undecoded potion assets use a drawable fallback instead of throwing');
assert.match(loot, /potionIcon\(item\.color \|\| item\.kind, size\)/);
assert.match(combat, /Telegraph,/, 'guardian death hazards use an imported Telegraph binding');
assert.doesNotMatch(heresies, /\bUI\./, 'Heresy runtime messages use the initialized G.ui service, not an unbound module global');
assert.match(main, /recordAudioDiagnosticMarker\('error'/, 'runtime exceptions are retained in audio diagnostics');
assert.match(audio, /createAudioDiagnosticSession/);
assert.match(audio, /importantEvents/);
assert.match(audio, /sourceSnapshotAtStop/);

console.log('Passed potion icon fallback, sound registration, combat audio classification, full-session audio aggregation, bounded detail retention, important transition/error retention, source snapshots, and icon resolution checks.');
