// Non-browser Storm Tether diagnosis and regression benchmark.
// Run from the repository root: node tools/tests/storm_tether_fourth_attempt.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { World } from '../../src/game/world.js';
import { visitStormTetherTargets } from '../../src/game/stormtether.mjs';
import { hit } from '../../src/game/combat.js';
import { G } from '../../src/state.js';
import { clearVfx, effects } from '../../src/gfx/vfx.js';

const median = (v) => v.sort((a, b) => a - b)[v.length >> 1];
const augmentsSource = await readFile(new URL('../../src/game/augments.js', import.meta.url), 'utf8');
const combatSource = await readFile(new URL('../../src/game/combat.js', import.meta.url), 'utf8');
const skillSource = await readFile(new URL('../../src/game/skillrun.js', import.meta.url), 'utf8');

assert.match(augmentsSource, /visitStormTetherTargets\(/, 'live Storm Tether routes damage through the tested local segment query');
assert.match(augmentsSource, /silent: true, lightFx: true, noClassHitFx: true, noHitFx: true/, 'live tethers suppress per-hit UI, sound, class splashes and particles');
assert.match(augmentsSource, /h\.onTetherTarget \|\| \(h\.onTetherTarget =/, 'tether damage reuses its hit callback instead of allocating one for every beam and tick');
assert.match(await readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8'), /hostilesInBounds\(team, minX, minY, maxX, maxY, out = \[\]\)/, 'tether candidate search uses spatially bounded world queries');
assert.doesNotMatch(augmentsSource.slice(augmentsSource.indexOf('function tether(')), /pts\.length > 2/, 'tether makes no extra adjacent-hammer ring connections');
assert.match(augmentsSource, /h\.tetherT = 0\.25/, 'damage cadence remains four pulses per second');
assert.match(augmentsSource, /\* 0\.3 \* pow/, 'damage per retained connection uses the existing multiplier');
const liveTether = augmentsSource.slice(augmentsSource.indexOf('function tether('));
assert.doesNotMatch(liveTether, /Bolt\(|tetherVisualT|showTether|addEffect\(/, 'Storm Tether damage path creates no lightning visuals');
assert.doesNotMatch(augmentsSource.slice(augmentsSource.indexOf("case 'tether':"), augmentsSource.indexOf("case 'detonate':")), /Bolt\(|addEffect\(/, 'non-hazard Tether damage proc has no lightning visual');
assert.match(combatSource, /!o\.noClassHitFx/, 'shared combat honors the tether-specific class-effects opt-out');
assert.match(combatSource, /showFx && !o\.noHitFx/, 'shared combat honors the tether-specific hit-particle opt-out');
assert.match(skillSource, /sfx\('swing'\);/, 'Blessed Hammer cast sound remains in the cast path');

// Construct a real World grid (same 2-tile buckets and hostiles method used by play).
const world = Object.create(World.prototype);
Object.assign(world, { grid: new Map(), gridPool: [], creatures: [], teams: new Map(), taunters: 0, dungeonAffixes: [], depth: 100 });
for (let id = 1; id <= 400; id++) {
  const angle = id * 2.399963229728653;
  const radius = 0.18 + (id % 108) / 10;
  world.creatures.push({ id, team: 'enemy', targetable: true, dead: false, x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius, r: 0.22 + (id % 5) * 0.13 });
}
world.rebuildGrid();

function makeSegments(count) {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI * 2 * i / count;
    return [0, 0, Math.cos(angle) * 1.6, Math.sin(angle) * 1.6];
  });
}
function oldWidePulse(segments, out, counters) {
  world.hostiles('player', 0, 0, 11, out);
  counters.searches++;
  for (const [x0, y0, x1, y1] of segments) {
    const dx = x1 - x0, dy = y1 - y0, lenSq = dx * dx + dy * dy;
    for (const e of out) {
      counters.candidates++;
      if (e.dead) continue;
      counters.collisionChecks++;
      const u = Math.max(0, Math.min(1, ((e.x - x0) * dx + (e.y - y0) * dy) / lenSq));
      const ex = x0 + dx * u - e.x, ey = y0 + dy * u - e.y, r = 0.35 + e.r;
      if (ex * ex + ey * ey <= r * r) { counters.damageEvents++; counters.targets.push(e.id); }
    }
  }
}
function localPulse(segments, out, counters, mode = {}) {
  const enabled = { search: true, collision: true, damage: true, ...mode };
  if (!enabled.search) return;
  for (const [x0, y0, x1, y1] of segments) {
    if (!enabled.collision) {
      world.hostilesInBounds('player', Math.min(x0, x1) - 0.35, Math.min(y0, y1) - 0.35,
        Math.max(x0, x1) + 0.35, Math.max(y0, y1) + 0.35, out);
      counters.searches++; counters.candidates += out.length;
      continue;
    }
    visitStormTetherTargets(world, 'player', x0, y0, x1, y1, out, (e) => {
      if (enabled.damage) { counters.damageEvents++; counters.targets.push(e.id); }
    }, counters);
  }
}
const cases = [];
for (const hammerCount of [1, 10, 25, 50, 100]) {
  const segments = makeSegments(hammerCount);
  const previousConnections = segments.slice();
  // The old path linked adjacent hammers as well as linking each hammer back
  // to the player. Keep that historical link set for the before measurement.
  if (hammerCount > 2) {
    const points = segments.map((s) => [s[2], s[3]]);
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      previousConnections.push([a[0], a[1], b[0], b[1]]);
    }
  }
  const oldRadial = { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] };
  const old = { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] };
  const current = { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] };
  const outA = [], outB = [];
  oldWidePulse(segments, outA, oldRadial);
  oldWidePulse(previousConnections, outA, old);
  localPulse(segments, outB, current);
  assert.deepEqual([...current.targets].sort((a, b) => a - b), [...oldRadial.targets].sort((a, b) => a - b),
    `${hammerCount} retained player-to-hammer connections preserve exact target hits`);

  const oldTimes = [], oldRadialTimes = [], newTimes = [];
  for (let round = 0; round < 5; round++) {
    let start = performance.now();
    for (let pulse = 0; pulse < 120; pulse++) oldWidePulse(previousConnections, outA, { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] });
    oldTimes.push(performance.now() - start);
    start = performance.now();
    for (let pulse = 0; pulse < 120; pulse++) oldWidePulse(segments, outA, { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] });
    oldRadialTimes.push(performance.now() - start);
    start = performance.now();
    for (let pulse = 0; pulse < 120; pulse++) localPulse(segments, outB, { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] });
    newTimes.push(performance.now() - start);
  }
  cases.push({ hammerCount, priorLinks: previousConnections.length,
    localLinks: hammerCount, old, oldRadial, current, oldMs: median(oldTimes), oldRadialMs: median(oldRadialTimes), newMs: median(newTimes) });
}

// Exercise the actual shared hit() path in Node to verify the source of secondary work.
const player = {
  isPlayer: true, team: 'player', classId: 'paladin', x: 0, y: 0, hp: 1000, maxHp: 1000, mana: 100, maxMana: 100,
  st: { addedDamage: {}, critChance: 0, markPenetration: 0, markEliteDamage: 0, markFullHealthDamage: 0,
    markExecution: 0, markRiftDamage: 0, markUnboundDamage: 0, markImpDamage: 0, bossDmg: 0,
    lifeSteal: 0, markLifeSteal: 0, manaSteal: 0, legend: {}, legendary: {}, procs: [] },
  char: { skills: {} }, curses: {}, onHit() {}, heal() {},
};
const target = () => ({ id: 9001, team: 'enemy', x: 1, y: 0, hp: 1e9, maxHp: 1e9, r: 0.35, res: {},
  curses: {}, status: {}, world, level: 100, rank: 'boss', scale: 1, hpShow: 0, dead: false });
Object.assign(G, { world, char: { madT: 0 }, settings: { reduceFlashing: true, shake: false, lifeBars: false }, ui: null, godMode: false });
const normalTarget = target(), tetherTarget = target();
const normalDamage = hit(player, normalTarget, 10, 'light', { sk: 'paladin.0.0', crit: false, noVariance: true });
const tetherDamage = hit(player, tetherTarget, 10, 'light', {
  proc: true, noArc: true, crit: false, noVariance: true, sk: 'paladin.0.0',
  silent: true, lightFx: true, noClassHitFx: true, noHitFx: true,
});
assert.equal(tetherDamage, normalDamage, 'quiet tether hit preserves the shared combat damage result');
assert.equal(tetherTarget.hp, normalTarget.hp, 'feedback suppression does not alter target health');
let fullFeedbackHitMs = 0, particleOnlyHitMs = 0, quietHitMs = 0;
const hitIterations = 1200;
for (let round = 0; round < 4; round++) {
  clearVfx();
  let start = performance.now();
  for (let i = 0; i < hitIterations; i++) hit(player, target(), 10, 'light', { sk: 'paladin.0.0' });
  fullFeedbackHitMs += performance.now() - start;
  clearVfx();
  start = performance.now();
  for (let i = 0; i < hitIterations; i++) hit(player, target(), 10, 'light', {
    proc: true, noArc: true, crit: false, sk: 'paladin.0.0', silent: true, noClassHitFx: true,
  });
  particleOnlyHitMs += performance.now() - start;
  clearVfx();
  start = performance.now();
  for (let i = 0; i < hitIterations; i++) hit(player, target(), 10, 'light', {
    proc: true, noArc: true, crit: false, sk: 'paladin.0.0', silent: true, lightFx: true, noClassHitFx: true, noHitFx: true,
  });
  quietHitMs += performance.now() - start;
}
clearVfx();
const feedbackSaved = Math.round((1 - quietHitMs / fullFeedbackHitMs) * 100);
effects.length = 0;

console.log('Storm Tether before/after CPU benchmark: one pulse = 250 ms of game time; 400 synthetic enemies in the real World spatial grid.');
console.log('Hammers | old links (spokes + ring) | new links | old searches/pulse | new searches/pulse | old candidates/pulse | new candidates/pulse | old collision checks/pulse | new checks/pulse | old -> new ms/120 pulses');
for (const c of cases) console.log(`${c.hammerCount} | ${c.priorLinks} | ${c.localLinks} | ${c.old.searches} | ${c.current.searches} | ${c.old.candidates} | ${c.current.candidates} | ${c.old.collisionChecks} | ${c.current.collisionChecks} | ${c.oldMs.toFixed(2)} -> ${c.newMs.toFixed(2)}`);
console.log(`At the live 4 Hz damage interval, ${cases.at(-1).localLinks} connections produce up to ${cases.at(-1).current.searches * 4} localized enemy searches/s, ${cases.at(-1).current.collisionChecks * 4} exact segment checks/s, ${cases.at(-1).current.damageEvents * 4} hit events/s in this fixture.`);
const c100 = cases.at(-1);
const oldExtra = c100.old.damageEvents - c100.oldRadial.damageEvents;
const oldNewCandidateCut = Math.round((1 - c100.current.candidates / c100.oldRadial.candidates) * 100);
console.log(`At 100 hammers the old adjacent ring added ${oldExtra} extra hit events per pulse in this fixture; the retained spokes alone matched the new target list exactly.`);
console.log(`For the same 100 retained spokes, the old wide query tested ${c100.oldRadial.candidates.toLocaleString()} candidates/pulse; local queries test ${c100.current.candidates.toLocaleString()} (${oldNewCandidateCut}% fewer). CPU/120 pulses: ${c100.oldRadialMs.toFixed(2)} -> ${c100.newMs.toFixed(2)} ms.`);
console.log(`Actual shared hit() path benchmark (${hitIterations * 4} total hits per mode): full per-hit feedback ${fullFeedbackHitMs.toFixed(2)} ms; silent/lightweight tether feedback ${quietHitMs.toFixed(2)} ms (${feedbackSaved}% lower CPU in this Node run).`);
console.log(`Particle isolation (same silent hit calculation, no class splash): particles on ${particleOnlyHitMs.toFixed(2)} ms; particles off ${quietHitMs.toFixed(2)} ms.`);

// Independently isolate query, collision and damage dispatch on 100 connections.
const isolate = [];
const isolationSegments = makeSegments(100);
const isolationOut = [];
for (const [name, mode] of [
  ['damage active', { search: true, collision: true, damage: true }],
  ['damage disabled', { search: true, collision: true, damage: false }],
  ['collision disabled', { search: true, collision: false, damage: true }],
  ['enemy search disabled', { search: false, collision: true, damage: true }],
]) {
  const counters = { searches: 0, candidates: 0, collisionChecks: 0, damageEvents: 0, targets: [] };
  const repeats = 120, times = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < repeats; i++) localPulse(isolationSegments, isolationOut, counters, mode);
    times.push(performance.now() - start);
  }
  isolate.push({ name, ms: median(times) });
}
console.log('Subsystem isolation at 100 connections (120 pulses, exact production query/collision helper):');
for (const row of isolate) console.log(`  ${row.name}: ${row.ms.toFixed(2)} ms`);
console.log('  Storm Tether lightning, particles, glow, animation and geometry: disabled; no cosmetic effect work is scheduled.');
console.log(`  hit particles, combat numbers/log and hit audio disabled: ${quietHitMs.toFixed(2)} ms; full hit feedback: ${fullFeedbackHitMs.toFixed(2)} ms.`);
console.log('  audio backend is intentionally not initialized in this non-browser test; Storm Tether now invokes no per-hit sound call.');
console.log('No browser or game UI was launched.');
