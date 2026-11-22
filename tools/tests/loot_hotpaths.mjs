// Non-browser regression and microbenchmark for large ground-loot collections.
// Run from the repository root: node tools/tests/loot_hotpaths.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'src/game/loot.js'), 'utf8');
const update = source.slice(source.indexOf('  update(dt, world) {'), source.indexOf('\n  icon() {'));
assert.match(update, /const dx = p\.x - this\.x, dy = p\.y - this\.y, d2 = dx \* dx \+ dy \* dy;/);
assert.doesNotMatch(update, /Math\.hypot/);
assert.match(update, /d2 < magnet \* magnet/);
assert.match(update, /d2 < pickupRadius \* pickupRadius/);
assert.match(update, /d2 < targetPickupRadius \* targetPickupRadius/);

// The optimized strict-radius predicate must match the former hypot comparison,
// including exact-boundary behavior, for loot magnet and pickup ranges.
let seed = 0x51f15e;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
for (let i = 0; i < 100_000; i++) {
  const dx = (random() - 0.5) * 12, dy = (random() - 0.5) * 12;
  const radius = [0.55, 1.2, 2.2, 3.2, random() * 8][i % 5];
  assert.equal(Math.hypot(dx, dy) < radius, dx * dx + dy * dy < radius * radius);
}

// Synthetic workload models per-frame magnet and pickup tests for many drops.
// It intentionally isolates the distance predicate, not rendering or browser FPS.
const drops = Array.from({ length: 20_000 }, (_, i) => ({
  x: (i % 200) * 0.19 - 19,
  y: Math.floor(i / 200) * 0.19 - 19,
  radius: [2.2, 3.2, 0.55, 1.2][i % 4],
}));
function legacy() {
  let hits = 0;
  for (const item of drops) if (Math.hypot(item.x, item.y) < item.radius) hits++;
  return hits;
}
function squared() {
  let hits = 0;
  for (const item of drops) if (item.x * item.x + item.y * item.y < item.radius * item.radius) hits++;
  return hits;
}
assert.equal(legacy(), squared());
const sample = fn => {
  const times = [];
  let checksum = 0;
  for (let n = 0; n < 35; n++) {
    const start = performance.now();
    for (let pass = 0; pass < 8; pass++) checksum += fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { p50: times[17], p95: times[33], worst: times.at(-1), checksum };
};
const before = sample(legacy), after = sample(squared);
const pct = (a, b) => ((a - b) / a * 100).toFixed(1);
console.log(`Loot distance checks: ${drops.length.toLocaleString()} drops x 8 passes x 35 samples`);
console.log(`Math.hypot p50 ${before.p50.toFixed(3)}ms, p95 ${before.p95.toFixed(3)}ms, worst ${before.worst.toFixed(3)}ms`);
console.log(`Squared distance p50 ${after.p50.toFixed(3)}ms, p95 ${after.p95.toFixed(3)}ms, worst ${after.worst.toFixed(3)}ms`);
console.log(`p50 improvement ${pct(before.p50, after.p50)}%; p95 improvement ${pct(before.p95, after.p95)}%`);
console.log('Loot radius equivalence and source regression checks passed (100,000 randomized comparisons).');
