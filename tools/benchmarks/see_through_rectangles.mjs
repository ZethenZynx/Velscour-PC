import { performance } from 'node:perf_hooks';
import { RectGrid } from '../../src/game/rectgrid.mjs';

function workload(count) {
  const rects = new Array(count), flat = new Float64Array(count * 4);
  // Sparse, visible sprite bounds: the no-overlap case exercises the previous full scan worst case.
  for (let i = 0; i < count; i++) {
    const col = i % 32, row = Math.floor(i / 32);
    const x = 8 + col * 58, y = 8 + row * 46;
    const r = rects[i] = [x, y, x + 24, y + 32];
    flat.set(r, i * 4);
  }
  const probes = rects.map(([x0, y0, x1, y1]) => [x0 + 1, y0 + 1, x1 - 1, y1 - 1]);
  return { rects, flat, probes };
}

function naive({ rects, probes }) {
  let hits = 0;
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i];
    for (let j = 0; j < i; j++) {
      const r = rects[j];
      if (p[0] < r[2] && p[2] > r[0] && p[1] < r[3] && p[3] > r[1]) { hits++; break; }
    }
  }
  return hits;
}

const grid = new RectGrid();
function indexed(data) {
  const { flat, probes } = data;
  grid.reset(1920, 1080);
  let hits = 0;
  for (let i = 0; i < probes.length; i++) {
    if (grid.overlapsAny(probes[i], flat)) hits++;
    grid.insert(i, flat, i * 4);
  }
  return hits;
}

const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const count of [70, 300, 700, 1200]) {
  const data = workload(count), expected = naive(data);
  if (indexed(data) !== expected) throw new Error(`RectGrid mismatch at ${count} entries`);
  const oldTimes = [], newTimes = [];
  for (let run = 0; run < 9; run++) {
    let t = performance.now(); naive(data); oldTimes.push(performance.now() - t);
    t = performance.now(); indexed(data); newTimes.push(performance.now() - t);
  }
  console.log(`${count} prior rectangles: naive ${median(oldTimes).toFixed(2)} ms; indexed ${median(newTimes).toFixed(2)} ms; ${((1 - median(newTimes) / median(oldTimes)) * 100).toFixed(1)}% faster (Node CPU-only simulation)`);
}
