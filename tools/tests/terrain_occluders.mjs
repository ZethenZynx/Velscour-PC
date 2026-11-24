import assert from 'node:assert/strict';
import { occludersFor } from '../../src/gfx/terrain.js';

const w = 3, h = 3;
const hgt = new Int16Array(w * h);
hgt[1 * w + 1] = 10; // a raised column in front of the actor
const map = {
  w, h, hgt, t: new Uint8Array(w * h).fill(1),
  tallOcclusion: true, climb: 4,
  tileIdx(x, y) { return Math.floor(y) * w + Math.floor(x); },
};
const view = { x: 0, y0: -40, y1: 40, d: 1, hw: 24, ax: 0.5, ay: 0.5 };
const out = [];

assert.doesNotThrow(() => occludersFor(map, { x0: -100, y0: -100, x1: 100, y1: 100 }, [view], out));
assert.equal(view.lv, hgt[map.tileIdx(view.ax, view.ay)], 'ground height comes from the scalar actor coordinates written by renderWorld');
assert.ok(out.length >= 2, 'raised terrain still contributes depth-sorted occluders');
assert.equal(out.length % 2, 0, 'occluders remain [depth, object] pairs');

console.log('Terrain occluder regression passed: current scalar render-view coordinates resolve ground height and preserve occlusion output.');
