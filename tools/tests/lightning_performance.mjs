import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { writeBoltGeometry } from '../../src/gfx/lightninggeometry.mjs';

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
assert.match(augments, /const targets = h\.tetherTargets \|\| \(h\.tetherTargets = \[\]\)/, 'Storm Tether reuses hit buffers per hazard');
assert.doesNotMatch(augments, /pts\.map\(\(\[x, y\]\) => \[owner\.x, owner\.y, x, y\]\)/, 'Storm Tether does not rebuild segment arrays each frame');
assert.match(hazards, /out = \[\], candidates = \[\]/, 'line targeting accepts reusable output buffers');
assert.match(world, /hostiles\(team, x, y, r, out = \[\]\)/, 'hostile queries can fill caller-owned storage');
assert.match(augments, /if \(id === 'tether'\) continue;/, 'tether arcs do not duplicate themselves with additive orbit motes');
const tether = augments.slice(augments.indexOf('function tether('), augments.indexOf('function tetherArc('));
assert.doesNotMatch(tether, /sfx\(/, 'Storm Tether does not trigger hammer cast audio');
assert.match(tether, /h\.tetherT = 0\.25/, 'Storm Tether damage remains at four pulses per second');
assert.match(tether, /\* 0\.3 \* pow/, 'Storm Tether damage scaling is unchanged');
assert.match(augments, /chance\(dt \* 22\)/, 'Storm Tether lightning frequency is unchanged');
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
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const legacyMs = median(legacyTimes), reusedMs = median(reusedTimes);
console.log(`Lightning geometry check passed. Median of 5 × ${iterations.toLocaleString()} builds: nested arrays ${legacyMs.toFixed(1)} ms; reusable typed buffer ${reusedMs.toFixed(1)} ms (${Math.round((1 - reusedMs / legacyMs) * 100)}% faster in this Node microbenchmark; checksum ${checksum | 0}).`);
