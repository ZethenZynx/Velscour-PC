import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOME_BY_ID, biomesForDepth, biomeChoices, drawBiome, takeBiome } from '../../src/data/biomes.js';
import { WINGS, placeLayout } from '../../src/data/phobos.js';
import { REGIONS } from '../../src/game/regions.js';
import { castleFloorAtDepth } from '../../src/game/regions/castle_velscour.js';
import { WING_RAIDS, VELSCOUR_RAIDS } from '../../src/game/phobosraids.js';
import { SIGS, SIG_NAMES, PASSIVES } from '../../src/game/raidsigs.js';
import { ART_BY_ID } from '../../src/data/bestiary.js';
import { MECHS } from '../../src/game/phobosbosses.js';

const pack = JSON.parse(readFileSync(new URL('../../assets/tiles/ph_keep/pack.json', import.meta.url), 'utf8'));
const families = Object.keys(pack.walls);
const tileset = {
  floors: pack.floors.map((f) => ({ ...f })), bases: [0], features: [], families,
  walls: Object.fromEntries(families.map((family) => [family, Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, [[]]]))])),
  scatter: [], k: 1, arches: pack.arches, archSpan: pack.archSpan, doors: pack.doors, pack: 'ph_keep',
};
const depth = 101, biome = BIOME_BY_ID.castle_velscour, region = REGIONS.castle_velscour;
assert.ok(region, 'Castle Velscour is registered in the production region registry');
assert.equal(castleFloorAtDepth(101), 1);
assert.equal(castleFloorAtDepth(200), 100);
assert.equal(castleFloorAtDepth(201), 1, 'Castle configurations cycle on Infinite Endgame depth without adding a new progression track');
assert.ok(biomesForDepth(depth).includes(biome.id), 'Castle Velscour is in the actual Infinite Endgame destination pool');
assert.ok(!biomesForDepth(100).includes(biome.id), 'Castle Velscour is not in campaign progression');

function reachableWithLinks(gen) {
  const map = gen.map;
  const links = (gen.leaps || []).filter((l) => map.circleFree(l.x, l.y, 0.24) && map.circleFree(l.tx, l.ty, 0.24));
  const reach = map.movementReachable(gen.start, 0.24);
  let changed = true;
  for (let pass = 0; pass <= links.length && changed; pass++) {
    changed = false;
    for (const link of links) {
      const from = map.tileIdx(link.x, link.y), to = map.tileIdx(link.tx, link.ty);
      if (reach[from] && !reach[to]) {
        const next = map.movementReachable([link.tx, link.ty], 0.24);
        for (let i = 0; i < reach.length; i++) if (next[i] && !reach[i]) { reach[i] = 1; changed = true; }
      }
    }
  }
  return reach;
}

const layouts = new Set(), wings = new Set(), generated = [];
for (let floor = 1; floor <= 100; floor++) {
  const gen = region.generate(depth + floor - 1, biome, (floor * 0x9e3779b1) >>> 0, tileset);
  assert.equal(gen.castleFloor, floor, `floor ${floor} retains its authored configuration identity`);
  assert.ok(gen.castleWing && WINGS.some((w) => w.id === gen.castleWing), `floor ${floor} maps to a registered wing`);
  const bosses = gen.spawns.filter((s) => s.rank === 'boss' || s.rank === 'raid');
  assert.equal(bosses.length, 1, `floor ${floor} has one completion boss`);
  assert.equal(gen.accessibility?.validated, true, `floor ${floor} passed the runtime movement validator`);
  assert.ok(gen.map.movementCanReach(gen.start, gen.exit, 0.24, reachableWithLinks(gen)), `floor ${floor} exit is reachable by its walk/leap routes`);
  const boss = bosses[0];
  const bossPosition = boss.rank === 'raid' ? [boss.x + 4, boss.y] : [boss.x, boss.y];
  assert.ok(gen.map.movementCanReach(gen.start, bossPosition, 0.24, reachableWithLinks(gen)), `floor ${floor} boss is reachable by its walk/leap routes`);
  if (boss.rank === 'raid') {
    assert.ok(gen.castleRaidTemplate?.phases?.length === 4, `floor ${floor} raid has four configured phases`);
    assert.ok(gen.castleRaidTemplate.art.every((id) => ART_BY_ID[id]), `floor ${floor} raid artwork is registered`);
    assert.ok(gen.castleRaidTemplate.phases.every((p) => Object.keys(p.pool).every((key) => key === 'adds' || SIGS[key] || gen.castleRaidTemplate.mech.includes(key))), `floor ${floor} raid attack pool is registered`);
  }
  assert.ok(Array.isArray(gen.castleFloorEntries) && gen.castleFloorEntries.length > 0, `floor ${floor} supplies local floor artwork indices`);
  assert.ok(gen.castleFloorEntries.length < 256, `floor ${floor} keeps floor material IDs byte-safe`);
  layouts.add(gen.castleLayout); wings.add(gen.castleWing); generated.push(gen);
}
assert.equal(wings.size, 10, 'all ten Castle wings are represented');
assert.equal(generated.filter((g) => g.spawns.some((s) => s.rank === 'raid')).length, 10, 'all ten authored raid floor slots use a raid boss');
assert.equal(generated.filter((g) => g.spawns.some((s) => s.rank === 'boss')).length, 90, 'the other 90 floors retain a single normal guardian');
assert.ok(layouts.size >= 20, `authored layouts retain room identity (found ${layouts.size})`);
assert.ok(generated.some((g) => g.castleLayout === 'spires' && g.leaps.length), 'Broken Spires layouts retain traversable crossings');
assert.ok(generated.some((g) => g.raid), 'authored raid arena layouts remain represented');
assert.equal(Object.keys(WING_RAIDS).length, 9, 'nine wing lords have raid templates');
assert.equal(Object.keys(VELSCOUR_RAIDS).length, 3, 'three Velscour finale variants exist');
for (const [id, template] of Object.entries({ ...WING_RAIDS, ...VELSCOUR_RAIDS })) {
  assert.equal(template.phases.length, 4, `${id} has four phases`);
  assert.ok(template.art.length && template.art.every((art) => ART_BY_ID[art]), `${id} has registered artwork`);
  if (template.passive) assert.equal(typeof PASSIVES[template.passive], 'function', `${id} passive is registered`);
  for (const phase of template.phases) for (const key of Object.keys(phase.pool)) {
    if (key === 'adds' || template.mech.includes(key)) continue;
    assert.equal(typeof SIGS[key], 'function', `${id} ability ${key} is executable (${SIG_NAMES[key] || key})`);
  }
}
let castleWins = 0;
const castleRun = region.createRun({ player: null, map: { circleFree: () => true } }, generated[0], biome, depth, () => castleWins++);
castleRun.bossDefeated(); castleRun.bossDefeated();
assert.equal(castleWins, 1, 'Castle boss completion advances Infinite Endgame exactly once');
assert.equal(castleRun.completed, true);

// Exercise both actual endgame destination methods and confirm that a stored castle choice resolves to this region.
const originalRandom = Math.random;
let seed = 0x4c415354;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
try {
  const pool = biomesForDepth(depth), total = 10_000;
  let townHits = 0, exitCards = 0, exitSelections = 0;
  const town = { biomeBag: [], lastBiome: null }, exits = { biomeBag: [], lastBiome: null };
  for (let i = 0; i < total; i++) {
    const id = drawBiome(town, depth);
    assert.ok(pool.includes(id));
    if (id === biome.id) townHits++;
    const choices = biomeChoices(exits, depth, 3);
    if (choices.includes(biome.id)) exitCards++;
    const chosen = choices[Math.floor(Math.random() * choices.length)];
    if (chosen === biome.id) exitSelections++;
    takeBiome(exits, chosen, depth);
  }
  assert.ok(townHits > 0, 'Castle Velscour is selectable from town');
  assert.ok(exitCards > 0, 'Castle Velscour appears in exit destination choices');
  assert.ok(exitSelections > 0, 'Castle Velscour can be selected from exit destination choices');
  console.log(`PASS: 100/100 Castle floors; ${wings.size} wings; ${layouts.size} authored layouts; seeded movement and floor-art checks. 10,000 town draws: ${townHits}; 10,000 exit windows: ${exitCards} card appearances, ${exitSelections} selections.`);
} finally { Math.random = originalRandom; }
