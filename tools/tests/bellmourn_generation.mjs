import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { A } from '../../src/core/assets.js';
import { VENDORS } from '../../src/world/town.js';
import { generateBellmourn } from '../../src/world/bellmourn.js';
import { ACT3_TOWN_BIOME, BIOME_BY_ID } from '../../src/data/biomes.js';

const root = new URL('../../', import.meta.url);
const pack = JSON.parse(await readFile(new URL('assets/tiles/ph_marches/pack.json', root), 'utf8'));
const floors = pack.floors.map((f) => ({ ...f })), families = Object.keys(pack.walls);
const walls = Object.fromEntries(families.map((family) => [family, Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, [[]]]))]));
const tileset = { floors, bases: floors.map((f, i) => f.seamless ? i : -1).filter((i) => i >= 0), features: floors.map((f, i) => !f.seamless ? i : -1).filter((i) => i >= 0), families, walls, k: 1 };
A.town = { meta: { tile: [64, 32], objects: Object.fromEntries(['b_stables', 'b_cottage', 'b_bakery', 'b_inn'].map((name, i) => [name, [i * 4, 0, 4, 4, -2, -2]])) }, objects: { width: 16, height: 4 } };

assert.equal(ACT3_TOWN_BIOME.pack, 'ph_marches', 'Town III uses the authored Frostbound masonry and floors');
assert.equal(ACT3_TOWN_BIOME.packArt, true, 'the Phobos city tile pack is loaded for the town');
for (let seed = 1; seed <= 100; seed++) {
  const t = generateBellmourn(tileset, seed * 7919);
  assert.ok(t.map.w >= 80 && t.map.w <= 112 && t.map.h >= 64 && t.map.h <= 96, `bounded urban layout seed ${seed}`);
  assert.equal(t.npcs.length, VENDORS.length, `all existing services present seed ${seed}`);
  assert.deepEqual(new Set(t.npcs.map((n) => n.vendor.id)).size, VENDORS.length, `no duplicate vendor seed ${seed}`);
  assert.equal(t.chests.length, 0, 'town does not inherit a district dungeon chest');
  assert.equal(t.spawns.length, 0, 'town does not inherit Phobos enemy spawns');
  assert.ok(t.map.movementCanReach(t.start, [t.portal.x, t.portal.y], 0.24), `north gate reachable seed ${seed}`);
  assert.ok(t.map.movementCanReach(t.start, [t.breach.x, t.breach.y], 0.24), `Act portal gate reachable seed ${seed}`);
  for (const n of t.npcs) {
    assert.ok(t.map.walkable(n.x, n.y) && t.map.circleFree(n.x, n.y, 0.32), `service ${n.vendor.id} walkable seed ${seed}`);
    assert.ok(t.map.movementCanReach(t.start, [n.x, n.y], 0.24), `service ${n.vendor.id} reachable seed ${seed}`);
  }
  assert.ok(t.buildings.every((b) => Number.isFinite(b.x0) && Number.isFinite(b.y0) && typeof b.sx === 'boolean'), 'town-life home anchors are valid');
}
console.log('PASS: 100 Bellmourn seeds; Frostbound urban pack, bounded layout, all eight services, reachable city gates, no dungeon spawns or chests.');
