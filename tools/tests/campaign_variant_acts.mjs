import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CAMPAIGN_BOSS_ENVIRONMENTS, CAMPAIGN_ENVIRONMENT_ROTATIONS,
  CAMPAIGN_VARIANT_ACTS, DEPTH_DUNGEON_RANGES,
  BIOME_BY_ID, campaignActForBiome, campaignBiomeForDepth, chooseCampaignVariant,
  eligibleCampaignVariants,
} from '../../src/data/biomes.js';
import { ACTS } from '../../src/data/depth.js';
import { CASTLE_VARIANTS } from '../../src/data/castles.js';
import { HUNT_LANDS } from '../../src/data/huntlands.js';
import { SIEGE_VARIANTS } from '../../src/world/siege.js';
import { SHEER_BY_ID } from '../../src/data/sheer.js';
import { G } from '../../src/state.js';
import { registerRegion, rollRegionVariant, regionVariant } from '../../src/game/regions.js';

const families = { castle: CASTLE_VARIANTS, great_hunt: HUNT_LANDS, endless_siege: SIEGE_VARIANTS };
const assignments = CAMPAIGN_VARIANT_ACTS;
const expected = {
  castle: { sunscar: 2, hoarfrost: 3 },
  great_hunt: { wood: 1, fen: 1, badlands: 2, tundra: 3, crags: 3 },
  endless_siege: { keep: 1, mire: 1, frost: 3, river: 3, pass: 3 },
};
assert.deepEqual(assignments, {
  castle: { ironcrown: 1, blackfen: 1, solenne: 1, sunscar: 2, hoarfrost: 3, cinderhold: 1, mourncross: 1, goldspire: 1, bloodmoat: 1, hexenmere: 1, thornwick: 1 },
  great_hunt: { wood: 1, badlands: 2, tundra: 3, fen: 1, crags: 3 },
  endless_siege: { keep: 1, frost: 3, river: 3, pass: 3, mire: 1 },
});
for (const [family, variants] of Object.entries(families)) {
  assert.deepEqual(Object.keys(assignments[family]).sort(), variants.map((v) => v.id).sort(), `${family} assignments cover every variant exactly once`);
  for (const [id, act] of Object.entries(expected[family])) {
    assert.equal(assignments[family][id], act, `${family}/${id} destination assignment`);
    assert.ok(eligibleCampaignVariants(family, act, variants).some((v) => v.id === id));
    for (const priorAct of ACTS.map((a) => a.act).filter((a) => a !== act)) {
      assert.ok(!eligibleCampaignVariants(family, priorAct, variants).some((v) => v.id === id), `${family}/${id} excluded from Act ${priorAct}`);
    }
  }
  assert.equal(eligibleCampaignVariants(family, null, variants).length, variants.length, `${family} remains unrestricted outside campaign Act selection`);
}

// The production region selector honors the centralized eligibility registry, including invalid old-Act requests.
for (const family of ['great_hunt', 'endless_siege']) {
  const variants = families[family].map(({ id, name }) => ({ id, name }));
  registerRegion({ id: family, variants });
  for (const act of [1, 2, 3]) {
    const allowed = new Set(eligibleCampaignVariants(family, act, variants).map((v) => v.id));
    if (!allowed.size) continue;
    G.char = { lastRegionVariant: { [family]: '' } };
    G.regionNext = {};
    G.regionWant = { [family]: variants.find((v) => !allowed.has(v.id))?.id || '' };
    const chosen = rollRegionVariant({ id: family, variants }, act);
    assert.ok(allowed.has(chosen.id), `${family} production selector returned ${chosen.id} outside Act ${act}`);
    G.regionNext[family] = variants.find((v) => !allowed.has(v.id)) || chosen;
    assert.ok(allowed.has(regionVariant({ id: family, variants }, act).id), `${family} generation fallback respects Act ${act}`);
  }
}
G.char = null; G.regionNext = {}; G.regionWant = {};

// The campaign rotation retains every original family and adds only the approved family entries.
assert.deepEqual(CAMPAIGN_ENVIRONMENT_ROTATIONS[1], ['overworld', 'dark_forest', 'castle', 'castle_keep', 'great_hunt', 'endless_siege']);
assert.deepEqual(CAMPAIGN_ENVIRONMENT_ROTATIONS[2], ['sea_of_sand', 'great_hunt', 'serpentine_tower', 'castle', 'scorpion_king_pyramid']);
assert.deepEqual(CAMPAIGN_ENVIRONMENT_ROTATIONS[3], ['mountainside', 'depths_edge', 'snowy_summit', 'endless_siege', 'castle', 'great_hunt']);
assert.deepEqual(CAMPAIGN_ENVIRONMENT_ROTATIONS[4], ['pirate_seas', 'skyship', 'ghost_train', 'deep_mines']);
assert.deepEqual(CAMPAIGN_BOSS_ENVIRONMENTS, { 25: 'castle_keep', 50: 'scorpion_king_pyramid', 75: 'snowy_summit', 100: 'throne' });
for (const [depth, id] of [[25, 'castle_keep'], [50, 'scorpion_king_pyramid'], [75, 'snowy_summit'], [100, 'throne']]) {
  assert.equal(campaignBiomeForDepth(depth), id, `Depth ${depth} finale remains unchanged`);
}
assert.equal(campaignActForBiome(5, 'great_hunt'), 1);
assert.equal(campaignActForBiome(29, 'castle'), 2);
assert.equal(campaignActForBiome(54, 'endless_siege'), 3);
assert.equal(campaignActForBiome(1, 'castle'), null, 'an unscheduled region portal entry remains unrestricted');
assert.equal(campaignActForBiome(101, 'great_hunt'), null, 'endgame selection remains unrestricted');

// Stable-seed selection simulation: 10,000 actual scheduled depths per Act, with variants
// selected through the same helper used by campaign loading and the region generator.
let seed = 0x7a11ce55;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };
const report = {};
for (const act of ACTS) {
  const familyCounts = Object.fromEntries(CAMPAIGN_ENVIRONMENT_ROTATIONS[act.act].map((id) => [id, 0]));
  const variantCounts = Object.fromEntries(Object.entries(families).map(([family, list]) => [family, Object.fromEntries(list.map((v) => [v.id, 0]))]));
  const last = {};
  for (let n = 0; n < 10_000; n++) {
    const depth = act.start + Math.floor(random() * (act.end - act.start + 1));
    const biome = campaignBiomeForDepth(depth);
    if (!(biome in familyCounts)) continue; // fixed Act finales are excluded from ordinary rotation sampling
    familyCounts[biome]++;
    if (!families[biome]) continue;
    const variant = chooseCampaignVariant(biome, act.act, families[biome], { lastId: last[biome], random });
    assert.ok(variant, `${biome} must have an eligible variant in Act ${act.act}`);
    assert.equal(assignments[biome][variant.id], act.act, `${biome}/${variant.id} simulation eligibility`);
    variantCounts[biome][variant.id]++;
    last[biome] = variant.id;
  }
  for (const [family, variants] of Object.entries(families)) {
    if (!CAMPAIGN_ENVIRONMENT_ROTATIONS[act.act].includes(family)) continue;
    assert.ok(familyCounts[family] > 0, `${family} must appear in Act ${act.act}`);
    for (const variant of eligibleCampaignVariants(family, act.act, variants)) {
      assert.ok(variantCounts[family][variant.id] > 0, `${family}/${variant.id} must be reachable in Act ${act.act}`);
    }
  }
  report[act.act] = { families: familyCounts, variants: variantCounts };
}

// Campaign variant restrictions do not mutate the shared endgame pool; every Sheer Drop remains endgame-only.
const endgame = DEPTH_DUNGEON_RANGES[0].ids;
for (const id of Object.keys(SHEER_BY_ID)) {
  assert.ok(endgame.includes(id), `${id} remains in the Infinite Endgame pool`);
  assert.ok(!BIOME_BY_ID[id].overworld, `${id} remains a dungeon environment`);
}
for (let depth = 1; depth <= 100; depth++) assert.ok(!campaignBiomeForDepth(depth).startsWith('sheer_'));

const gameSource = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
assert.match(gameSource, /const campaignAct = campaignActForBiome\(depth, biome\.id\)/,
  'only scheduled campaign entries pass an Act to variant selection');
assert.match(gameSource, /const eligibleAct = campaignAct;/,
  'endgame and other non-campaign loadLevelArt calls remain unrestricted');
assert.match(gameSource, /loadLevelArt\(biome, mix, \{ campaignAct: campaignActForBiome\(depth, biome\.id\) \}\)/,
  'direct campaign entry passes its scheduled Act explicitly');
assert.match(gameSource, /biome\.id === 'castle' \? G\.castleNext : null/,
  'Castle generation uses the validated selection and cannot bypass its Act filter');
console.log(JSON.stringify({ message: 'Act-aware campaign selection passed', simulationsPerAct: 10_000, report }, null, 2));
