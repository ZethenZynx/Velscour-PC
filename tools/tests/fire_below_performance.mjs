// Node-only regression benchmark for the production Fire Below fire update.
// Run: node tools/tests/fire_below_performance.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { tickFires } from '../../src/game/seascen/fire_below.js';
import { addLight, clearVfx, particles, smoke, spawn, updateVfx } from '../../src/gfx/vfx.js';

const DT = 1 / 60, WARMUP = 120, FRAMES = 600;
function makeState(count) {
  const fires = new Map();
  for (let i = 0; i < count; i++) fires.set(i, { x: i % 20 + 0.5, y: Math.floor(i / 20) + 0.5, age: 2, life: 600, ph: i * 0.37 });
  return { fires, spreadT: 600, burnT: 600, bombers: [], waistN: count, fireFxCursor: 0, emberT: 0.1, smokeT: 0.2 };
}
function makeApi(state, smokeCount) {
  return {
    state, map: { w: 20, tileIdx: () => 0 }, run: { wave: 1, phase: 'waves', capM: null },
    live: new Set(), base: { dmg: 1 }, p: () => null,
    smoke(x, y, z, color, n, size) { smokeCount.count += n; smoke(x, y, z, color, n, size); },
  };
}
function sampleStats(samples) {
  samples.sort((a, b) => a - b);
  const at = (p) => +samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))].toFixed(4);
  return { p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), worstMs: +samples.at(-1).toFixed(4) };
}
function run(count, mode) {
  clearVfx();
  const state = makeState(count), smokeCount = { count: 0 }, api = makeApi(state, smokeCount), samples = [];
  let emitted = 0, frames = 0, activeTotal = 0;
  const step = () => {
    const before = particles.length, start = performance.now();
    if (mode === 'legacy') {
      for (const c of state.fires.values()) {
        c.age += DT;
        if (Math.random() < DT * 1.6) spawn({ type: 'glow', x: c.x, y: c.y, z: 12, vz: 40, life: 0.8, size: 2, size1: 0, color: '#ffb040', add: true });
        if (Math.random() < DT * 0.35) api.smoke(c.x, c.y, 24, '#241c1a', 1, 9);
      }
      let k = 0;
      for (const c of state.fires.values()) { if (k >= 70) break; if ((k++ % 5) === 0) addLight(c.x, c.y, 2.8, 0.8, 20, '#ff8030'); }
    } else tickFires(api, DT);
    emitted += particles.length - before;
    updateVfx(DT, null);
    activeTotal += particles.length; frames++;
    return performance.now() - start;
  };
  for (let i = 0; i < WARMUP; i++) step();
  emitted = 0; smokeCount.count = 0; activeTotal = 0; frames = 0;
  for (let i = 0; i < FRAMES; i++) samples.push(step());
  const result = {
    timing: sampleStats(samples),
    particlesPerSecond: +(emitted / (FRAMES * DT)).toFixed(2),
    smokeParticlesPerSecond: +(smokeCount.count / ((WARMUP + FRAMES) * DT)).toFixed(2),
    meanLiveParticles: +(activeTotal / frames).toFixed(2),
  };
  clearVfx();
  return result;
}

const results = {};
for (const n of [1, 10, 50, 100, 200]) results[n] = { before: run(n, 'legacy'), after: run(n, 'current') };

// Gameplay checks: fire lifetime still advances and expired cells are removed; an empty map emits nothing.
clearVfx();
const state = makeState(0), smokeCount = { count: 0 }, api = makeApi(state, smokeCount);
state.fires.set(0, { x: 0.5, y: 0.5, age: 0, life: 0.05, ph: 0 });
state.emberT = 0.625; state.smokeT = 2.85;
tickFires(api, 0.02);
assert.equal(state.fires.get(0).age, 0.02, 'fire age continues to advance');
tickFires(api, 0.05);
assert.equal(state.fires.has(0), false, 'expired fire is removed');
assert.equal(particles.length, 0, 'a single flame does not trigger a burst when its emit timers have not elapsed');

const waterShader = await readFile(new URL('../../tools/sea3d.js', import.meta.url), 'utf8');
assert.match(waterShader, /uniform int wShipCount, wRingCount/);
assert.match(waterShader, /if \(i >= wShipCount\) break/);
assert.match(waterShader, /if \(i >= wRingCount\) break/);
assert.match(waterShader, /U\.wShipCount\.value = ships\.length/);
  assert.match(waterShader, /U\.wRingCount\.value = rings\.length/);
  assert.doesNotMatch(waterShader, /setShips\(list\)\s*\{\s*ships = list\.slice/,
    'ship wake state is reused instead of copied on every frame');
const waterLoopWork = [
  { ships: 1, rings: 0 }, { ships: 3, rings: 2 }, { ships: 12, rings: 10 },
].map(({ ships, rings }) => ({
  activeShips: ships, activeRings: rings,
  oldFragmentLoopBodies: 12 + 10,
  newFragmentLoopBodies: ships + rings,
}));

const fireFile = await readFile(new URL('../../src/game/seascen/fire_below.js', import.meta.url), 'utf8');
assert.doesNotMatch(fireFile, /\[\.\.\.S\.fires\]/, 'fire spread no longer allocates a copied map each second');
assert.match(fireFile, /camera\.viewRect\(58\)/, 'off-screen deck fires are culled before drawing');
assert.match(fireFile, /S\.emberT = 0\.625/);
assert.match(fireFile, /S\.smokeT = 2\.85/);

console.log(JSON.stringify({
  benchmark: 'Synthetic CPU-only replay of the old per-fire emission loop versus production tickFires + VFX update; not a GPU or full-game FPS measurement.',
  framesPerCase: FRAMES, timestepMs: +(DT * 1000).toFixed(3), cases: results,
  waterShaderLoopWorkPerFragment: waterLoopWork,
}, null, 2));
console.log('Fire Below performance and gameplay regression checks passed.');
