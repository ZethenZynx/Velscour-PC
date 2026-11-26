import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { ANIMALS } from '../../src/data/townsfolk.js';
import { startAct2AmbientCritters } from '../../src/game/townanimals.js';
import { generateAct2Town } from '../../src/world/act2town.js';

G.player = null;
const variants = new Map(ANIMALS.filter((a) => ['scorpion', 'scarab', 'snake'].includes(a.species)).map((a) => [a.species, a]));
assert.equal(variants.size, 3, 'all desert critter species are registered');
assert.deepEqual([...variants.values()].map(({ id, name }) => [id, name]), [
  ['desert_scorpion_01', 'Scorpion'], ['desert_scarab_01', 'Scarab'], ['desert_snake_01', 'Desert Snake'],
], 'Act II critter labels omit articles without changing their sprite identifiers');

function town(seed, act = 'act2_town') {
  const map = {
    w: 52, h: 52, v: new Uint8Array(52 * 52),
    walkable: (x, y) => x >= 1 && y >= 1 && x < 51 && y < 51,
    circleFree: (x, y) => x >= 1 && y >= 1 && x < 51 && y < 51,
    findPath: (_sx, _sy, x, y) => [[x, y]],
  };
  // Sandy ground with a small paved section, plus nearby rocks and palms for species-specific habitats.
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) map.v[y * map.w + x] = x < 40 ? 0 : 31;
  const world = {
    townId: act, map,
    npcs: [{ name: 'merchant', x: 26, y: 26 }, { name: 'Reliquary', x: 30, y: 29 }],
    portals: [{ x: 28, y: 26 }],
    props: [
      { x: 12, y: 12, spr: { name: 'wind_carved_boulder' } },
      { x: 38, y: 38, spr: { name: 'umbrella_acacia' } },
    ],
  };
  return { world, data: { seed } };
}

for (let seed = 1; seed <= 100; seed++) {
  const { world, data } = town(seed);
  const spawned = startAct2AmbientCritters(world, data);
  const groups = Object.groupBy(world.npcs.filter((n) => n.townCritter), (n) => n.species);
  assert.equal(spawned, (groups.scorpion?.length || 0) + (groups.scarab?.length || 0) + (groups.snake?.length || 0));
  assert.ok(groups.scorpion?.length >= 2 && groups.scorpion.length <= 3, '2-3 scorpions spawn');
  assert.ok(groups.scarab?.length >= 4 && groups.scarab.length <= 6, '4-6 scarabs spawn');
  assert.ok(groups.snake?.length >= 1 && groups.snake.length <= 2, '1-2 snakes spawn');
  for (const critter of world.npcs.filter((n) => n.townCritter)) {
    assert.equal(critter.hostile, false);
    assert.equal(critter.targetable, false);
    assert.equal(critter.passive, true);
    assert.ok(mapSafe(world.map, critter.x, critter.y), 'spawn point is safe and walkable');
    assert.ok(world.npcs.filter((n) => !n.townCritter && Number.isFinite(n.x)).every((n) => Math.hypot(n.x - critter.x, n.y - critter.y) >= 1.45), 'critter avoids town services');
    if (critter.species === 'scorpion') assert.ok(Math.hypot(critter.x - 12, critter.y - 12) < 2.8, 'scorpions stay near rocky habitat');
    if (critter.species === 'snake') assert.ok(Math.hypot(critter.x - 38, critter.y - 38) < 3.2, 'snakes stay near shaded habitat');
    if (critter.species === 'scarab') assert.ok(world.map.v[Math.floor(critter.y) * world.map.w + Math.floor(critter.x)] < 30, 'scarabs spawn on sand');
  }
  const count = world.npcs.length;
  assert.equal(startAct2AmbientCritters(world, data), 0, 'initialization is idempotent per world');
  assert.equal(world.npcs.length, count, 'repeated initialization cannot accumulate critters');
  for (let step = 0; step < 80; step++) for (const critter of world.npcs.filter((n) => n.townCritter)) {
    critter.update(0.1);
    assert.ok(mapSafe(world.map, critter.x, critter.y), 'movement remains walkable');
  }
  const nextVisit = town(seed);
  assert.equal(startAct2AmbientCritters(nextVisit.world, nextVisit.data), spawned, 'new visits get a fresh bounded population');
}

const other = town(1, 'town');
assert.equal(startAct2AmbientCritters(other.world, other.data), 0, 'Act I is excluded');
assert.equal(other.world.npcs.length, 2, 'Act I population is untouched by the Act II director');
for (let seed = 1; seed <= 20; seed++) {
  const layout = generateAct2Town({}, seed);
  const world = { townId: 'act2_town', map: layout.map, props: layout.props, npcs: layout.npcs.map((n) => ({ ...n })), portals: [{ x: layout.portal.x, y: layout.portal.y }] };
  const count = startAct2AmbientCritters(world, layout);
  assert.equal(count, world.npcs.filter((n) => n.townCritter).length, `generated Act II layout ${seed} receives only one population`);
  const totals = Object.fromEntries(['scorpion', 'scarab', 'snake'].map((s) => [s, world.npcs.filter((n) => n.species === s).length]));
  assert.ok(totals.scorpion >= 2 && totals.scorpion <= 3 && totals.scarab >= 4 && totals.scarab <= 6 && totals.snake >= 1 && totals.snake <= 2,
    `generated Act II layout ${seed} receives the requested species counts`);
  for (let frame = 0; frame < 100; frame++) for (const critter of world.npcs.filter((n) => n.townCritter)) {
    critter.update(0.1);
    assert.ok(world.map.walkable(critter.x, critter.y) && world.map.circleFree(critter.x, critter.y, 0.14), `layout ${seed} keeps moving critters on clear ground`);
  }
}
console.log('Act II desert wildlife counts, safe movement, habitat registration, and per-visit lifecycle passed.');

function mapSafe(map, x, y) { return map.walkable(x, y) && map.circleFree(x, y, 0.14); }
