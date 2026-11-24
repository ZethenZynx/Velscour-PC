import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { hasSoundDefinition } from '../../src/core/audio.js';
import { summarizeAudioDiagnosticEvents } from '../../src/core/audio-diagnostics.mjs';
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

const [audio, world, game, icons, assets, loot, combat] = await Promise.all([
  readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/icons.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/assets.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/loot.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/combat.js', import.meta.url), 'utf8'),
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

console.log('Passed potion kind-to-art mapping, footstep sound registration, diagnostic lifecycle summary, area transition markers, and icon resolution regression checks.');
