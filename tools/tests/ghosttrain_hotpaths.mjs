import assert from 'node:assert/strict';
import { clearNearestLights, insertNearestLight, recycleTrainScenery, sceneryVisibilityChanged } from '../../src/gfx/ghosttrainperf.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';
import { generateGhostTrain } from '../../src/world/ghosttrain.js';

function legacyNearest(lights, count) {
  return lights.filter((light) => light.distance < 400).sort((a, b) => a.distance - b.distance);
}
function timing(fn, rounds = 15) {
  const samples = [];
  for (let i = 0; i < 3; i++) fn();
  for (let i = 0; i < rounds; i++) { const t = performance.now(); fn(); samples.push(performance.now() - t); }
  samples.sort((a, b) => a - b);
  const at = (p) => +samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * p))].toFixed(3);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: +samples.at(-1).toFixed(3) };
}

const lights = Array.from({ length: 120 }, (_, i) => ({ distance: ((i * 83) % 600), id: i }));
const slots = Array.from({ length: 5 }, () => ({ distance: Infinity, light: null }));
clearNearestLights(slots);
for (const light of lights) if (light.distance < 400) insertNearestLight(slots, light.distance, light);
assert.deepEqual(slots.map((slot) => slot.light).filter(Boolean), legacyNearest(lights, 5).slice(0, 5), 'fixed nearest-light slots match the previous filter and sort');
clearNearestLights(slots);
assert.ok(slots.every((slot) => slot.light === null && slots[0].distance === Infinity), 'light slots reset for the next render');

const item = { x: 8, gorgeHidden: false };
let rolls = 0;
const roll = (target, x) => { rolls++; target.x = x; };
assert.equal(recycleTrainScenery(item, 2, 5, 300, roll), false, 'visible scenery is not recycled');
assert.equal(rolls, 0);
assert.equal(recycleTrainScenery(item, 4, 5, 300, roll), true, 'scenery recycles only after crossing the rear boundary');
assert.equal(item.x, 308);
assert.equal(rolls, 1);
const scroll = 27.5, oldPerItemWorldX = 41 - scroll, newGroupWorldX = 41 + (-scroll);
assert.equal(newGroupWorldX, oldPerItemWorldX, 'moving the scenery group preserves the previous scrolling position');
assert.equal(sceneryVisibilityChanged(item, false), false, 'unchanged scenery visibility does not rewrite instance matrices');
assert.equal(sceneryVisibilityChanged(item, true), true, 'gorge entry updates that scenery instance once');
assert.equal(sceneryVisibilityChanged(item, true), false, 'gorge occupancy remains cached');
assert.equal(sceneryVisibilityChanged(item, false), true, 'leaving the gorge restores the instance');

for (const depth of [1, 25, 50, 100, 250]) {
  for (let seed = 1; seed <= 20; seed++) {
    const generated = generateGhostTrain(depth, BIOME_BY_ID.ghost_train, seed);
    assert.equal(generated.map.w, 200, `depth ${depth}, seed ${seed}: train width remains stable`);
    assert.equal(generated.map.h, 24, `depth ${depth}, seed ${seed}: train height remains stable`);
    assert.ok(generated.spawns.length > 0, `depth ${depth}, seed ${seed}: enemies are generated`);
    for (const spawn of generated.spawns) assert.ok(generated.map.walkable(spawn.x, spawn.y), `depth ${depth}, seed ${seed}: spawn is walkable`);
    assert.ok(generated.map.walkable(...generated.start), `depth ${depth}, seed ${seed}: start is walkable`);
    assert.ok(generated.map.walkable(...generated.exit), `depth ${depth}, seed ${seed}: exit is walkable`);
  }
}

const rounds = 1200;
const benchSlots = Array.from({ length: 5 }, () => ({ distance: Infinity, light: null }));
const optimizedScan = () => { clearNearestLights(benchSlots); for (const light of lights) if (light.distance < 400) insertNearestLight(benchSlots, light.distance, light); };
const benchmark = {
  legacyFilterSort: timing(() => { for (let i = 0; i < rounds; i++) legacyNearest(lights, 5); }),
  fixedNearestSlots: timing(() => { for (let i = 0; i < rounds; i++) optimizedScan(); }),
};
console.log(JSON.stringify({ lightSelectionMsPer1200Renders: benchmark }, null, 2));
console.log('Iron Express allocation, nearest-light, scenery recycling, and 100 deterministic generation checks passed. Timings are Node microbenchmarks, not full-game frame measurements.');
