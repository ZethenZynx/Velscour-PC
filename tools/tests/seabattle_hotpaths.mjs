// Node-only checks and microbenchmarks for the Pirate Seas frame-loop allocation fix.
// Run: node tools/tests/seabattle_hotpaths.mjs
import assert from 'node:assert/strict';
import { hasLivingEnemy, waveEnemyStatus } from '../../src/game/seabattleperf.js';

function legacyStatus(live) {
  const left = [...live].filter((m) => !m.dead && !(m.wave >= 90));
  return { count: left.length, settled: left.every((m) => !m.entering) };
}
function makeLive(n) {
  return new Set(Array.from({ length: n }, (_, i) => ({
    dead: i % 7 === 0,
    wave: i % 13 === 0 ? 90 : i % 4,
    entering: i % 11 === 0,
  })));
}
function summary(live, out) {
  waveEnemyStatus(live, out);
  return out;
}
function stats(fn, rounds = 18) {
  const samples = [];
  for (let warm = 0; warm < 4; warm++) fn();
  for (let i = 0; i < rounds; i++) { const t = performance.now(); fn(); samples.push(performance.now() - t); }
  samples.sort((a, b) => a - b);
  const at = (p) => +samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))].toFixed(3);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: +samples.at(-1).toFixed(3) };
}

const benchmark = {};
for (const size of [16, 48, 128, 512]) {
  const live = makeLive(size), out = { count: 0, settled: true };
  assert.deepEqual(summary(live, out), legacyStatus(live), `wave status matches original for ${size} entities`);
  assert.equal(hasLivingEnemy(live), [...live].some((m) => !m.dead), `living-enemy check matches for ${size} entities`);
  const iterations = 1500;
  benchmark[size] = {
    copiedFilter: stats(() => { for (let i = 0; i < iterations; i++) legacyStatus(live); }),
    allocationFree: stats(() => { for (let i = 0; i < iterations; i++) summary(live, out); }),
  };
}
assert.equal(waveEnemyStatus(new Set(), { count: 9, settled: false }).count, 0, 'empty wave resets reusable state');
assert.equal(waveEnemyStatus(new Set(), { count: 9, settled: false }).settled, true, 'empty wave is settled');
console.log(JSON.stringify({ benchmarkMsPer1500FrameChecks: benchmark }, null, 2));
console.log('Pirate Seas hot-path checks passed. Timings are Node microbenchmarks, not full-game frame measurements.');
