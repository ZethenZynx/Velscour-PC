// Large non-browser loot simulation: verify final gear creation against each Rift tier's
// progression cap, including repeatable Covenant conversion at every eligible tier.
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { qualityAtDepth, RARITY, rollSigil, sigilCap } from '../../src/data/items.js';
import { depthLevel, FINAL_DEPTH } from '../../src/data/depth.js';
import { riftLootDepth, riftQualityRange, riftRewardProgressionDepth, riftMaxQuality, riftMinQuality } from '../../src/data/rifts.js';
import { groundRewardDepth, rollGroundGem, rollGroundItem } from '../../src/game/loot.js';
import { makeCovenant, maybeRelic } from '../../src/data/relics.js';

const originalChar = G.char, originalWorld = G.world;
const char = { level: 100, depth: 2501, deepest: 2500 };
const simulatedDropsPerTier = 10_000;
const checkDropsPerTier = 1_000;
const representativeTiers = new Set([1, 6, 26, 51, 76, 81, 91, 96]);
const results = [];

try {
  G.char = char;
  for (let tier = 1; tier <= 100; tier++) {
    const lootDepth = riftLootDepth(tier);
    const range = riftQualityRange(tier, char), expectedCap = range.max - 1;
    const rewardDepth = riftRewardProgressionDepth(tier, char);
    assert.equal(range.min, Math.min(riftMinQuality(tier), range.max), `tier ${tier}: minimum quality formula`);
    assert.equal(range.max, Math.min(riftMaxQuality(tier), qualityAtDepth(rewardDepth) + 1), `tier ${tier}: both progression caps apply`);
    G.world = { kind: 'dungeon', depth: FINAL_DEPTH, rift: { tier } };
    assert.equal(groundRewardDepth(G.world, FINAL_DEPTH), rewardDepth, `tier ${tier}: effective reward depth`);
    const forced = rollGroundItem(100, { rarity: 19, maxRarity: 19 });
    assert.ok(forced.rarity >= range.min - 1 && forced.rarity <= expectedCap,
      `tier ${tier}: an ineligible forced maximum request is replaced by a weighted roll inside the eligible band`);
    const forcedCovenant = makeCovenant(100, { world: G.world, rarity: 19, maxRarity: 19, depth: 2576 });
    assert.ok(forcedCovenant.rarity >= range.min - 1 && forcedCovenant.rarity <= expectedCap,
      `tier ${tier}: Covenant conversion cannot bypass the Rift cap with a high requested depth`);

    let minimum = Infinity, maximum = -Infinity, tier20Count = 0;
    const distribution = Array(20).fill(0);
    for (let n = 0; n < simulatedDropsPerTier; n++) {
      const rolled = rollGroundItem(100);
      const item = maybeRelic(rolled, 100, []);
      assert.ok(item.rarity >= range.min - 1 && item.rarity <= expectedCap,
        `tier ${tier}: final ${RARITY[item.rarity]?.name} fell outside quality Tier ${range.min}–${range.max}`);
      assert.ok(!item.cset || item.rarity <= rolled.rarity, `tier ${tier}: Covenant quality exceeded its source drop`);
      assert.ok(!item.cset || item.ilvl === rolled.ilvl, `tier ${tier}: Covenant item level differs from its source drop`);
      minimum = Math.min(minimum, item.rarity);
      maximum = Math.max(maximum, item.rarity);
      if (item.rarity === 19) tier20Count++;
      if (representativeTiers.has(tier)) distribution[item.rarity]++;
    }

    const gemLevelCap = Math.min(char.level, depthLevel(rewardDepth) + 4);
    const maxDirectGemTier = Math.min(7, Math.floor(gemLevelCap / 16));
    const maxSigilTier = sigilCap(rewardDepth);
    for (let n = 0; n < checkDropsPerTier; n++) {
      const gem = rollGroundGem(200);
      assert.ok(gem.ilvl <= gemLevelCap, `tier ${tier}: gem item level exceeded progression`);
      assert.ok(gem.tier <= maxDirectGemTier,
        `tier ${tier}: gem tier ${gem.tier} exceeded ${maxDirectGemTier}`);
      const sigil = rollSigil(lootDepth, 99);
      assert.ok(sigil.tier <= maxSigilTier,
        `tier ${tier}: sigil rank ${sigil.tier} exceeded ${maxSigilTier}`);
    }

    const covenant = makeCovenant(100, { maxRarity: expectedCap, world: G.world });
    assert.ok(covenant, `tier ${tier}: repeatable Covenant items are available`);
    assert.ok(covenant.rarity <= expectedCap, `tier ${tier}: Covenant quality exceeded its progression cap`);
    if (range.max < 20) {
      assert.ok(maximum < 19, `tier ${tier}: Tier 20 must remain unavailable`);
      assert.equal(tier20Count, 0, `tier ${tier}: simulation generated Tier 20 gear`);
    }
    results.push({ tier, effectiveDepth: rewardDepth, minEligible: range.min, maxEligible: range.max, min: minimum + 1, max: maximum + 1, tier20Count, distribution });
  }

  // High Magic Find must change weights only inside the legal Rift band; a new
  // character level/progression cap must remain authoritative at all tiers.
  for (const level of [1, 50, 100]) {
    G.char = { level, depth: 101, deepest: 100 };
    for (const mf of [0, 100_000]) {
      for (const tier of [1, 6, 76, 96, 1_000]) {
        G.world = { kind: 'dungeon', depth: FINAL_DEPTH, rift: { tier } };
        const range = riftQualityRange(tier, G.char);
        for (let n = 0; n < 2_000; n++) {
          const rolled = rollGroundItem(100, { mf });
          const item = maybeRelic(rolled, 100, []);
          assert.ok(item.rarity >= range.min - 1 && item.rarity <= range.max - 1,
            `level ${level}, MF ${mf}, Rift ${tier}: item quality respects both progression and Rift bounds`);
        }
      }
    }
  }
} finally {
  G.char = originalChar;
  G.world = originalWorld;
}

console.log(`Simulated ${simulatedDropsPerTier.toLocaleString()} equipment drops and checked ${checkDropsPerTier.toLocaleString()} gems plus sigils for each of 100 Rift tiers.`);
console.log(`Total equipment drops: ${(simulatedDropsPerTier * results.length).toLocaleString()}.`);
console.log('Tier | Effective depth | Eligible quality band | Simulated min-max | Tier 20 drops');
for (const row of results) console.log(`${row.tier} | ${row.effectiveDepth} | ${row.minEligible}-${row.maxEligible} | ${row.min}-${row.max} | ${row.tier20Count}`);
console.log('Representative final equipment quality distribution (10,000 drops each; post-Covenant conversion):');
for (const row of results.filter((r) => representativeTiers.has(r.tier))) {
  const counts = row.distribution.map((count, id) => count ? `T${id + 1}: ${(count / simulatedDropsPerTier * 100).toFixed(1)}%` : null).filter(Boolean);
  console.log(`Rift ${row.tier} (${row.minEligible}-${row.maxEligible}): ${counts.join(', ')}`);
}
console.log('Low-depth progression, character levels 1/50/100 and Magic Find 0/100,000 checks passed at Rift tiers 1, 6, 76, 96 and 1,000.');
