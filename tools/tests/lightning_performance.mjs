import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { writeBoltGeometry } from '../../src/gfx/lightninggeometry.mjs';
import { Bolt, addEffect, drawEffects, effects } from '../../src/gfx/vfx.js';
import { camera } from '../../src/core/view.js';
import { G } from '../../src/state.js';

const [vfx, augments, hazards, world] = await Promise.all([
  readFile(new URL('../../src/gfx/vfx.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/augments.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/hazards.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8'),
]);
const skillrun = await readFile(new URL('../../src/game/skillrun.js', import.meta.url), 'utf8');

assert.match(vfx, /const MAX_POOLED_BOLTS = 256/, 'shared lightning bolts have a bounded reusable pool');
assert.match(vfx, /new Float32Array\(98\)/, 'bolt paths use a reusable flat geometry buffer');
assert.match(vfx, /this\.dur >= 0\.12 \|\| !this\.built/, 'short tether bolts build once instead of regenerating before expiry');
assert.match(augments, /const candidates = h\.tetherCandidates \|\| \(h\.tetherCandidates = \[\]\)/, 'Storm Tether reuses hit candidates per hazard');
assert.match(augments, /if \(zap && dmg > 0\) w\.hostiles\(owner\.team, owner\.x, owner\.y, 11, candidates\)/, 'Storm Tether performs one broadphase lookup per damage pulse');
assert.match(augments, /function damageTetherArc\(h, x0, y0, x1, y1, dmg, candidates\)/, 'Storm Tether reuses broadphase candidates for each arc');
assert.doesNotMatch(augments, /lineTargets\(/, 'Storm Tether no longer performs a separate world query per connection');
assert.doesNotMatch(augments, /pts\.map\(\(\[x, y\]\) => \[owner\.x, owner\.y, x, y\]\)/, 'Storm Tether does not rebuild segment arrays each frame');
assert.match(hazards, /out = \[\], candidates = \[\]/, 'line targeting accepts reusable output buffers');
assert.match(world, /hostiles\(team, x, y, r, out = \[\]\)/, 'hostile queries can fill caller-owned storage');
const beamStart = hazards.indexOf('export class BeamCh {');
const trapStart = hazards.indexOf('// ===================================================================== Trap', beamStart);
const beamCh = hazards.slice(beamStart, trapStart);
assert.match(beamCh, /this\.lightningPaths = .*new Float32Array\(\(this\.n \|\| 1\) \* 40\)/, 'lightning channels retain reusable per-beam paths');
assert.match(beamCh, /this\.lightningRegen = 0\.05/, 'beam flicker geometry refreshes at 20 Hz instead of per rendered frame');
assert.doesNotMatch(beamCh.slice(beamCh.indexOf('draw(ctx)')), /rand\(-8, 8\)/, 'beam draw reuses offsets instead of generating random geometry');
assert.match(augments, /if \(id === 'tether'\) continue;/, 'tether arcs do not duplicate themselves with additive orbit motes');
const tether = augments.slice(augments.indexOf('function tether('), augments.indexOf('function tetherArc('));
assert.doesNotMatch(tether, /sfx\(/, 'Storm Tether does not trigger hammer cast audio');
assert.match(tether, /h\.tetherT = 0\.25/, 'Storm Tether damage remains at four pulses per second');
assert.match(tether, /\* 0\.3 \* pow/, 'Storm Tether damage scaling is unchanged');
assert.match(augments, /chance\(dt \* 15\)/, 'Storm Tether cosmetic bolt emission is reduced without changing its damage pulse');
const orbitCast = skillrun.slice(skillrun.indexOf("case 'orbit':"), skillrun.indexOf("case 'cyclone':"));
assert.match(orbitCast, /sfx\('swing'\);/, 'the Blessed Hammer sound is only requested by the orbit cast path');

const buffer = new Float32Array(98);
const points = writeBoltGeometry(buffer, 0, 0, 240, 80, () => 0.5);
assert.ok(points >= 3 && points <= 49);
assert.deepEqual(Array.from(buffer.slice(0, 2)), [0, 0]);
assert.deepEqual(Array.from(buffer.slice((points - 1) * 2, points * 2)), [240, 80]);
const reusedBuffer = buffer;
writeBoltGeometry(buffer, 4, 5, 180, 80, () => 0.5);
assert.equal(buffer, reusedBuffer, 'subsequent bolt geometry writes reuse the same typed buffer');
const expiredBolt = new Bolt(0, 0, 10, 2, 2, 10, '#ffffff', 0.09, 2);
const boltBuffer = expiredBolt.seg;
assert.equal(expiredBolt.update(0.1), false, 'expired lightning connections are removed immediately');
const pooledBolt = new Bolt(1, 1, 10, 3, 3, 10, '#a8ccff', 0.09, 2);
assert.equal(pooledBolt, expiredBolt, 'expired bolt objects are reused');
assert.equal(pooledBolt.seg, boltBuffer, 'recycled bolts retain their geometry buffer');
const factoryBolt = Bolt(1, 1, 10, 3, 3, 10, '#a8ccff', 0.09, 2);
factoryBolt.update(0.1);
assert.equal(Bolt(2, 2, 10, 4, 4, 10, '#a8ccff', 0.09, 2), factoryBolt, 'hot-path factory calls reuse a pooled object without `new`');

// Renderer scaling check: canvas path submissions for the requested connection counts.
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const context = () => ({ strokes: 0, lines: 0, beginPath() {}, moveTo() {}, lineTo() { this.lines++; }, stroke() { this.strokes++; } });
G.W = 1280; G.H = 720; camera.x = 0; camera.y = 0; camera.zoom = 1;
const renderCases = [];
effects.length = 0;
addEffect(Bolt(2000, 2000, 0, 2001, 2001, 0, '#ffffff', 0.2, 2));
const offscreenCtx = context(); drawEffects(offscreenCtx, 'top');
assert.equal(offscreenCtx.strokes, 0, 'off-screen lightning is not submitted to the canvas');
for (const count of [1, 10, 25, 50, 100]) {
  effects.length = 0;
  const bolts = [];
  for (let i = 0; i < count; i++) {
    const bolt = new Bolt(0, 0, 0, 2 + i * 0.01, 1, 0, i % 2 ? '#9cc4ff' : '#ffffff', 0.09, 1.8);
    bolt.t = (i % 8) * 0.011;
    bolt.build(); bolts.push(bolt); addEffect(bolt);
  }
  const legacyCtx = context(), batchCtx = context();
  for (const bolt of bolts) bolt.draw(legacyCtx);
  drawEffects(batchCtx, 'top');
  assert.equal(legacyCtx.strokes, count * 2, `legacy renderer submits two strokes per bolt (${count})`);
  assert.ok(batchCtx.strokes <= legacyCtx.strokes, `batched renderer does not increase stroke submissions (${count})`);
  if (count > 1) assert.ok(batchCtx.strokes < legacyCtx.strokes, `batched renderer reduces stroke submissions (${count})`);
  assert.ok(batchCtx.strokes <= 32, `batch stroke count stays bounded as connections increase (${count})`);
  legacyCtx.strokes = legacyCtx.lines = batchCtx.strokes = batchCtx.lines = 0;
  const frames = 2000, legacyTimes = [], batchedTimes = [];
  for (let round = 0; round < 5; round++) {
    let start = performance.now();
    for (let frame = 0; frame < frames; frame++) for (const bolt of bolts) bolt.draw(legacyCtx);
    legacyTimes.push(performance.now() - start);
    start = performance.now();
    for (let frame = 0; frame < frames; frame++) drawEffects(batchCtx, 'top');
    batchedTimes.push(performance.now() - start);
  }
  renderCases.push({ count, legacyStrokes: legacyCtx.strokes, batchedStrokes: batchCtx.strokes, lines: batchCtx.lines,
    legacyMs: median(legacyTimes), batchedMs: median(batchedTimes) });
}
effects.length = 0;

// Compare the former nested-array geometry builder with the new in-place writer.
// This is a CPU/allocation microbenchmark, not a full-game frame-time claim.
const iterations = 50000;
function legacyBuild() {
  const ax = 0, ay = 0, bx = 240, by = 80, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  const n = Math.min(48, Math.max(3, Math.floor(len / 12))), nx = -dy / len, ny = dx / len, pts = [[ax, ay]];
  for (let i = 1; i < n; i++) { const t = i / n, off = (Math.random() * 2 - 1) * Math.min(18, len * 0.12); pts.push([ax + dx * t + nx * off, ay + dy * t + ny * off]); }
  pts.push([bx, by]); return pts;
}
let checksum = 0;
for (let i = 0; i < 1000; i++) { const path = legacyBuild(); checksum += path.length; checksum += writeBoltGeometry(buffer, 0, 0, 240, 80); }
const legacyTimes = [], reusedTimes = [];
for (let round = 0; round < 5; round++) {
  let start = performance.now();
  for (let i = 0; i < iterations; i++) { const path = legacyBuild(); checksum += path.length + path[path.length - 1][0]; }
  legacyTimes.push(performance.now() - start);
  start = performance.now();
  for (let i = 0; i < iterations; i++) { const count = writeBoltGeometry(buffer, 0, 0, 240, 80); checksum += count + buffer[(count - 1) * 2]; }
  reusedTimes.push(performance.now() - start);
}
const legacyMs = median(legacyTimes), reusedMs = median(reusedTimes);
console.log('Lightning renderer scalability (Node mock canvas; stroke calls per frame, not GPU timing):');
for (const row of renderCases) console.log(`  ${row.count} connections: ${row.legacyStrokes / 10000} -> ${row.batchedStrokes / 10000} strokes/frame; ${row.legacyMs.toFixed(2)} -> ${row.batchedMs.toFixed(2)} ms per 2,000 mock frames`);
console.log(`Lightning geometry check passed. Median of 5 × ${iterations.toLocaleString()} builds: nested arrays ${legacyMs.toFixed(1)} ms; reusable typed buffer ${reusedMs.toFixed(1)} ms (${Math.round((1 - reusedMs / legacyMs) * 100)}% faster in this Node microbenchmark; checksum ${checksum | 0}).`);
