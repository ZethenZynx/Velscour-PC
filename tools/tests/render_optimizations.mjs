import assert from 'node:assert/strict';
import { RectGrid } from '../../src/game/rectgrid.mjs';
import { effectOutsideView } from '../../src/gfx/effectvisibility.mjs';
import { insertCappedParticle } from '../../src/gfx/particlecap.mjs';

const projectX = (x, y) => (x - y) * 32;
const projectY = (x, y) => (x + y) * 16;
const grid = new RectGrid(16, 12);
const flat = [];
const prior = [];
let state = 1337;
const random = () => ((state = (state * 48271) % 2147483647) - 1) / 2147483646;
for (let i = 0; i < 1200; i++) {
  const x = Math.floor(random() * 1920), y = Math.floor(random() * 1080);
  const rect = [x, y, x + 24 + random() * 40, y + 32 + random() * 48];
  prior.push(rect); flat.push(...rect);
}
grid.reset(1920, 1080);
for (let i = 0; i < prior.length; i++) grid.insert(i, flat, i * 4);

// Verify indexed overlap agrees with the exact rectangle predicate for deterministic probes.
for (let i = 0; i < 500; i++) {
  const x = Math.floor(random() * 1920), y = Math.floor(random() * 1080);
  const probe = [x, y, x + 45, y + 60];
  const expected = prior.some((r) => probe[0] < r[2] && probe[2] > r[0] && probe[1] < r[3] && probe[3] > r[1]);
  assert.equal(grid.overlapsAny(probe, flat), expected);
}
grid.reset(1920, 1080);
assert.equal(grid.overlapsAny([100, 100, 120, 120], flat), false, 'reset clears the previous frame index');

assert.equal(effectOutsideView({ x: 0, y: 0 }, -500, -500, 500, 500, projectX, projectY), false, 'visible positioned effects remain drawn');
assert.equal(effectOutsideView({ x: 100, y: 100, r: 2 }, 2000, 2000, 2200, 2200, projectX, projectY), true, 'distant localized effects are culled');
assert.equal(effectOutsideView({ x0: -50, y0: 0, x1: 50, y1: 0, width: 1 }, -20, -20, 20, 20, projectX, projectY), false, 'a beam crossing the viewport remains visible');
assert.equal(effectOutsideView({ bolts: [], x: 100, y: 100 }, 2000, 2000, 2200, 2200, projectX, projectY), false, 'screen-reaching fork effects are conservatively retained');
assert.equal(effectOutsideView({ draw() {} }, 2000, 2000, 2200, 2200, projectX, projectY), false, 'unknown custom effects are never incorrectly culled');

const capped = [], cursor = { index: 0 }, particleLimit = 3000;
for (let i = 0; i < 10000; i++) insertCappedParticle(capped, { id: i }, particleLimit, cursor);
assert.equal(capped.length, particleLimit, 'large same-frame bursts do not grow the backing array beyond the cap');
assert.deepEqual(capped.map(({ id }) => id).sort((a, b) => a - b), Array.from({ length: particleLimit }, (_, i) => i + 7000),
  'the oldest particles are displaced first');

console.log('Screen-rectangle indexing matches exact overlap checks; offscreen effect culling preserves crossing and unknown effects; 10,000-particle bursts keep storage capped at 3,000.');
