// Non-browser performance regression checks and hot-path microbenchmarks.
// Run with: node tools/tests/performance_hotpaths.mjs
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { camera, isoX, isoY } from '../../src/core/view.js';
import { World } from '../../src/game/world.js';
import { addLight, clearVfx, decals, effects, lights, texts, updateVfx } from '../../src/gfx/vfx.js';

G.W = 1280; G.H = 720; G.touch = false;
camera.x = 0; camera.y = 0; camera.zoom = 1.5;

const props = [];
for (let i = 0; i < 3000; i++) {
  props.push({ x: (i % 75) - 37, y: Math.floor(i / 75) - 20, light: i % 3 === 0 ? 2 : 0, smoke: i % 11 === 0 ? 1 : 0 });
}
const world = new World('town', { props, torches: [], portals: [], biome: {} });
const expectedEmitters = props.filter((p) => p.light || p.smoke).length;
assert.equal(world.ambientProps().length, expectedEmitters, 'ambient cache contains only light/smoke props');
const cache = world.ambientProps();
assert.equal(world.ambientProps(), cache, 'ambient candidate list is reused between frames');
const added = { x: 0, y: 0, light: 2 };
props.push(added);
assert.equal(world.ambientProps().length, expectedEmitters + 1, 'props added to a live world refresh the ambient cache');

function distribution(fn, count = 240) {
  const samples = [];
  for (let i = 0; i < 20; i++) fn();
  for (let i = 0; i < count; i++) {
    const t = performance.now(); fn(); samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const at = (p) => samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))];
  return { p50: +at(0.50).toFixed(3), p95: +at(0.95).toFixed(3), p99: +at(0.99).toFixed(3), worst: +samples.at(-1).toFixed(3) };
}

function legacyAmbientLights() {
  lights.length = 0;
  const lr = camera.viewRect(280);
  const lit = (x, y) => { const px = isoX(x, y), py = isoY(x, y); return px > lr.x0 && px < lr.x1 && py > lr.y0 && py < lr.y1 + 80; };
  for (const pr of world.props) if (pr.light && lit(pr.x, pr.y)) {
    addLight(pr.x, pr.y, pr.light + Math.sin(world.time * 7 + pr.x) * 0.15, 0.8, 20 + (pr.z || 0), pr.lightColor || '#ffb050', true);
  }
}
const oldAmbient = distribution(legacyAmbientLights);
const legacyLightRecords = lights.length;
const ambient = distribution(() => { lights.length = 0; world.ambientLights(); });
const cachedLightRecords = lights.length;
assert.equal(world.ambientProps().length, expectedEmitters + 1);
assert.ok(cachedLightRecords <= 128, 'ambient prop lights respect the existing per-frame light budget');

function fillVfx(size) {
  clearVfx(); const keepDecals = [];
  for (let i = 0; i < size; i++) {
    const d = { grow: 0, life: i % 2 ? 0.01 : 10, kind: 'blood' };
    decals.push(d); if (!(i % 2)) keepDecals.push(d);
    texts.push({ life: i % 2 ? 0.01 : 10, z: 0, vz: 0, dx: 0, vx: 0 });
    effects.push({ live: !(i % 2), update() { return this.live; } });
  }
  const nested = { update() { effects.push({ update() { return true; } }); return false; } };
  effects.push(nested);
  return keepDecals;
}
function newVfxOnce(size) {
  const keepDecals = fillVfx(size), start = performance.now(); updateVfx(0.02, null); const ms = performance.now() - start;
  assert.deepEqual(decals, keepDecals, `decals compact safely at ${size} entries`);
  assert.equal(texts.length, Math.floor(size / 2), `expired texts compact at ${size} entries`);
  assert.equal(effects.length, Math.floor(size / 2) + 1, 'new effects created during an update survive for the next frame');
  return ms;
}

function legacyVfxOnce(size) {
  const items = Array.from({ length: size }, (_, i) => ({ life: i % 2 ? 0.01 : 10, grow: 0, kind: 'blood', z: 0, vz: 0, dx: 0, vx: 0 }));
  const d = items.slice(), e = items.slice(), t = items.slice();
  const start = performance.now();
  for (const v of d) { if (v.grow < 1) v.grow = Math.min(1, v.grow + 0.02 * 1.2); if (v.life < 9999) v.life -= 0.02; }
  for (let i = d.length - 1; i >= 0; i--) if (d[i].life <= 0) d.splice(i, 1);
  for (let i = e.length - 1; i >= 0; i--) if (!((e[i].live = (i % 2 === 0)))) e.splice(i, 1);
  for (let i = t.length - 1; i >= 0; i--) { t[i].life -= 0.02; t[i].z += t[i].vz * 0.02; t[i].vz *= 0.94; if (t[i].life <= 0) t.splice(i, 1); }
  return performance.now() - start;
}
const vfx = {};
for (const size of [1000, 5000, 10000]) {
  const old = [], current = [];
  for (let i = 0; i < 12; i++) { old.push(legacyVfxOnce(size)); current.push(newVfxOnce(size)); }
  const summarize = (values) => {
    values.sort((a, b) => a - b);
    return { p50: +values[6].toFixed(3), p95: +values[10].toFixed(3), worst: +values.at(-1).toFixed(3) };
  };
  vfx[`${size / 1000}k`] = { legacySplice: summarize(old), compacted: summarize(current) };
}
clearVfx();
const effectOrder = [];
effects.push(...[0, 1, 2].map((id) => ({ _id: id, update() { effectOrder.push(id); return true; } })));
updateVfx(0.01, null);
assert.deepEqual(effectOrder, [2, 1, 0], 'effect update order remains newest-first');
assert.deepEqual(effects.map((effect) => effect._id), [0, 1, 2], 'effect draw/list ordering remains oldest-first');
clearVfx();
const legacyPersistent = Array.from({ length: 282 }, (_, id) => ({ id, update() { return true; } }));
const legacyExpired = Array.from({ length: 12 }, () => ({ update() { return false; } }));
const legacyBroken = [...legacyPersistent, ...legacyExpired];
let legacyWrite = legacyBroken.length;
for (let i = legacyBroken.length - 1; i >= 0; i--) if (legacyBroken[i].update()) legacyBroken[--legacyWrite] = legacyBroken[i];
legacyBroken.length = legacyBroken.length - legacyWrite;
assert.equal(legacyBroken.length, 282);
assert.equal(new Set(legacyBroken).size, 270, 'the former reverse compaction duplicated 12 signature layers when 12 effects expired');
const signatureDraws = Array.from({ length: 282 }, (_, id) => ({
  _id: id, layer: 'top', updates: 0,
  update() { this.updates++; return true; },
  draw() {},
}));
effects.push(...signatureDraws, signatureDraws[0]); // include one repeated registration from a legacy session
for (let i = 0; i < 12; i++) effects.push({ layer: 'top', update() { return false; }, draw() {} });
for (let frame = 0; frame < 60; frame++) {
  updateVfx(1 / 60, null);
  assert.equal(effects.length, signatureDraws.length, 'expired transient effects are removed without losing persistent signature layers');
  assert.equal(new Set(effects).size, signatureDraws.length, 'persistent effects are never duplicated during compaction');
}
assert.ok(signatureDraws.every((effect) => effect.updates === 60), 'each persistent signature layer updates exactly once per frame');
clearVfx();
console.log('Historical compaction reproduced 12 duplicate/missing signature layers from 282 live + 12 expired; fixed path retains all 282 unique layers.');
console.log(JSON.stringify({ ambientProps: { count: props.length, activeEmitters: expectedEmitters + 1, legacyFullScanMs: oldAmbient, cachedCappedMs: ambient, legacyLightRecords, cachedLightRecords }, vfxCleanupMs: vfx }, null, 2));
console.log('Performance hot-path and 282 persistent-effect compaction regression checks passed. Timings are Node microbenchmarks, not full-game frame measurements.');
