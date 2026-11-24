import { performance } from 'node:perf_hooks';
import { insertCappedParticle } from '../../src/gfx/particlecap.mjs';

const limit = 3000, emissions = 10000, repetitions = 40;
function legacyBurst() {
  const particles = [];
  let dead = 0, evict = 0;
  for (let id = 0; id < emissions; id++) {
    if (particles.length - dead >= limit) {
      while (evict < particles.length && particles[evict].life <= 0) evict++;
      if (evict < particles.length) particles[evict++].life = -1, dead++;
    }
    particles.push({ id, life: 1 });
  }
  return particles.length;
}
function cappedBurst() {
  const particles = [], cursor = { index: 0 };
  for (let id = 0; id < emissions; id++) insertCappedParticle(particles, { id, life: 1 }, limit, cursor);
  return particles.length;
}
function medianRun(fn) {
  for (let i = 0; i < 5; i++) fn();
  const times = [];
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now(); fn(); times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

const oldSize = legacyBurst(), newSize = cappedBurst();
const oldMs = medianRun(legacyBurst), newMs = medianRun(cappedBurst);
console.log(`${emissions.toLocaleString()} emissions, ${limit.toLocaleString()} cap: legacy backing array ${oldSize.toLocaleString()}, slot-reuse array ${newSize.toLocaleString()} (${((1 - newSize / oldSize) * 100).toFixed(1)}% fewer retained slots in the burst)`);
console.log(`Node CPU-only burst admission median: legacy ${oldMs.toFixed(3)} ms; slot reuse ${newMs.toFixed(3)} ms (${((1 - newMs / oldMs) * 100).toFixed(1)}% faster)`);
