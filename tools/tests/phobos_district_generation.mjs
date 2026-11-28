import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { A } from '../../src/core/assets.js';
import { BIOME_BY_ID, biomesForDepth, campaignActForBiome, drawBiome, DEPTH_BIOME_RANGES } from '../../src/data/biomes.js';
import { PHOBOS_VARIANTS, PHOBOS_ENVIRONMENTS, PHOBOS_DISTRICTS, PHOBOS_SELECTION_TOKEN, phobosToken } from '../../src/data/phobosfamily.js';
import { generatePhobosDistrict } from '../../src/world/phobosdistrict.js';
import '../../src/game/regions/phobos.js';
import { REGIONS } from '../../src/game/regions.js';
import { ambushTick } from '../../src/game/mayhem.js';

const root = new URL('../../', import.meta.url);
const packFor = (pack) => new URL(`assets/tiles/${pack}/pack.json`, root);
const packToTileset = (meta) => {
  const floors = meta.floors.map((floor) => ({ ...floor }));
  const families = Object.keys(meta.walls);
  const walls = Object.fromEntries(families.map((family) => [family, Object.fromEntries(Array.from({ length: 15 }, (_, i) => {
    const mask = i + 1;
    const arms = [];
    if (mask & 1) arms.push({ arm: 'NE' });
    if (mask & 2) arms.push({ arm: 'SE' });
    if (mask & 4) arms.push({ arm: 'SW' });
    if (mask & 8) arms.push({ arm: 'NW' });
    return [mask, [arms]];
  }))]));
  return { floors, bases: floors.map((f, i) => f.seamless ? i : -1).filter((i) => i >= 0), features: floors.map((f, i) => !f.seamless ? i : -1).filter((i) => i >= 0), families, walls };
};

assert.equal(PHOBOS_VARIANTS.length, 38, 'exactly 38 district/environment combinations');
assert.deepEqual(PHOBOS_ENVIRONMENTS.map((env) => PHOBOS_VARIANTS.filter((variant) => variant.phobosAct === env.act).length), [10, 9, 9, 10]);
assert.equal(new Set(PHOBOS_VARIANTS.map((variant) => variant.id)).size, 38, 'all combination IDs unique');
for (const variant of PHOBOS_VARIANTS) {
  assert.equal(BIOME_BY_ID[variant.id]?.id, variant.id, `registered ${variant.id}`);
  assert.equal(campaignActForBiome(({ 1: 15, 2: 40, 3: 65, 4: 90 })[variant.phobosAct], variant.id), variant.phobosAct);
  assert.ok(biomesForDepth(({ 1: 15, 2: 40, 3: 65, 4: 90 })[variant.phobosAct]).includes(variant.id), `${variant.id} campaign eligible`);
  assert.ok(biomesForDepth(101).includes(variant.id), `${variant.id} Infinite Endgame eligible`);
  assert.ok(variant.name.includes(variant.phobosDistrictName) && variant.name.includes('Phobos'), `readable level label: ${variant.name}`);
}
for (const invalid of ['phobos_sunscorched_wharf', 'phobos_frostbound_cinder', 'phobos_sunscorched_cinder', 'phobos_frostbound_tanners', 'phobos_hellfallen_wharf']) {
  assert.equal(BIOME_BY_ID[invalid], undefined, `prohibited combination ${invalid} absent`);
}

A.town = { meta: { tile: [64, 32], objects: {} }, objects: { width: 1, height: 1 } };
const tested = new Set();
const layoutSignatures = new Map();
for (const variant of PHOBOS_VARIANTS) {
  const meta = JSON.parse(await readFile(await packFor(variant.pack), 'utf8'));
  const tileset = packToTileset(meta);
  for (let seed = 1; seed <= 4; seed++) {
    const gen = generatePhobosDistrict(variant.phobosAct * 25, variant, tileset, (seed * 0x9e3779b1) >>> 0);
    assert.ok(gen.map.w >= 80 && gen.map.w <= 112 && gen.map.h >= 64 && gen.map.h <= 96, `${variant.id} dimensions ${gen.map.w}x${gen.map.h}`);
    assert.equal(gen.district, variant.phobosDistrict);
    assert.ok(gen.map.movementCanReach(gen.start, gen.exit, 0.24), `${variant.id} exit accessible seed ${seed}`);
    assert.ok(gen.map.movementCanReach(gen.start, gen.boss, 0.24), `${variant.id} Ward Lord accessible seed ${seed}`);
    assert.equal(gen.spawns.length, 6, `${variant.id} district encounter packs`);
    assert.ok(gen.chests.length <= 1, `${variant.id} at most one city cache`);
    assert.ok(gen.buildings.every((building) => Number.isFinite(building.cx) && Number.isFinite(building.cy) && building.spr), `${variant.id} building sprites valid`);
    const signature = `${gen.map.w}x${gen.map.h}:${Buffer.from(gen.map.block).toString('base64').slice(0, 100)}:${Buffer.from(gen.map.v).toString('base64').slice(0, 100)}`;
    const key = `${variant.phobosEnvironment}:${variant.phobosDistrict}`;
    if (!layoutSignatures.has(key)) layoutSignatures.set(key, new Set());
    layoutSignatures.get(key).add(signature);
  }
  tested.add(variant.id);
}
assert.equal(tested.size, 38);
for (const [variant, signatures] of layoutSignatures) assert.ok(signatures.size >= 2, `${variant} layout varies by seed`);

// Family selection is one bag entry regardless of its 38 rendered combinations.
const endgame = biomesForDepth(101), tokens = [...new Set(endgame.map(phobosToken))];
assert.equal(tokens.filter((token) => token === PHOBOS_SELECTION_TOKEN).length, 1);
assert.equal(endgame.filter((id) => BIOME_BY_ID[id].phobos).length, 38);
let phobosCampaignRolls = 0;
const originalRandom = Math.random;
try {
  Math.random = () => 0.01;
  for (const act of [1, 2, 3, 4]) {
    const low = { 1: 10, 2: 35, 3: 60, 4: 85 }[act];
    const chosen = drawBiome({ lastPhobosDistrict: null }, low);
    assert.ok(BIOME_BY_ID[chosen]?.phobos && BIOME_BY_ID[chosen].phobosAct === act, `campaign Act ${act} can roll Phobos`);
    phobosCampaignRolls++;
  }
} finally { Math.random = originalRandom; }
assert.equal(phobosCampaignRolls, 4);
const districtBiome = BIOME_BY_ID[PHOBOS_VARIANTS[0].id];
const world = { creatures: [], player: { dead: false, x: 50, y: 50 }, roster: ['knight'], kind: 'dungeon' };
let wins = 0;
const run = REGIONS.phobos_city_family.createRun(world, {}, districtBiome, 110, () => wins++);
assert.equal(world.noAmbushRespawn, true, 'Phobos disables the general AFK ambush respawn scheduler');
assert.equal(world.ambushT, Infinity, 'no delayed ambush remains pending after entering the district');
ambushTick(world, 1200);
assert.equal(world.creatures.length, 0, 'cleared Phobos populations cannot respawn through the ordinary ambush system');
run.bossDefeated(); run.bossDefeated();
assert.equal(wins, 1, 'the district Ward Lord completes the existing floor exactly once');
assert.equal(DEPTH_BIOME_RANGES[24].ids.includes('castle_keep'), true, 'Act I finale unchanged');
assert.equal(DEPTH_BIOME_RANGES[49].ids.includes('scorpion_king_pyramid'), true, 'Act II finale unchanged');
assert.equal(DEPTH_BIOME_RANGES[74].ids.includes('snowy_summit'), true, 'Act III finale unchanged');
assert.equal(DEPTH_BIOME_RANGES[99].ids.includes('throne'), true, 'Act IV finale unchanged');

console.log(`PASS: ${tested.size} Phobos combinations; 152 seeded layouts; dimensions, route/boss reachability, district IDs, Act gates, finale preservation, and one-family selection weight verified.`);
