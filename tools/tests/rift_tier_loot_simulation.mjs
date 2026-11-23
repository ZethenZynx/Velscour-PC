// Large non-browser loot simulation: verify final gear creation against each Rift tier's
// progression cap, including repeatable Covenant conversion at every eligible tier.
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { qualityAtDepth, RARITY, rollSigil, sigilCap } from '../../src/data/items.js';
import { depthLevel, FINAL_DEPTH } from '../../src/data/depth.js';
import { riftLootDepth } from '../../src/data/rifts.js';
import { groundRewardDepth, rollGroundGem, rollGroundItem } from '../../src/game/loot.js';
import { makeCovenant, maybeRelic } from '../../src/data/relics.js';

const originalChar = G.char, originalWorld = G.world;
const char = { level: 100, depth: 2500 };
const simulatedDropsPerTier = 10_000;
const checkDropsPerTier = 1_000;
const results = [];

try {
  G.char = char;
  for (let tier = 1; tier <= 100; tier++) {
    const lootDepth = riftLootDepth(tier);
    const expectedCap = qualityAtDepth(lootDepth);
    G.world = { kind: 'dungeon', depth: FINAL_DEPTH, rift: { tier } };
    assert.equal(groundRewardDepth(G.world, FINAL_DEPTH), lootDepth, `tier ${tier}: effective reward depth`);
    assert.equal(rollGroundItem(100, { rarity: 19, maxRarity: 19 }).rarity, expectedCap,
      `tier ${tier}: forced maximum-quality request is clamped to eligible tier`);

    let minimum = Infinity, maximum = -Infinity, tier20Count = 0;
    for (let n = 0; n < simulatedDropsPerTier; n++) {
      const rolled = rollGroundItem(100);
      const item = maybeRelic(rolled, 100, []);
      assert.ok(item.rarity <= expectedCap,
        `tier ${tier}: final ${RARITY[item.rarity]?.name} exceeded ${RARITY[expectedCap]?.name}`);
      assert.ok(!item.cset || item.rarity <= rolled.rarity, `tier ${tier}: Covenant quality exceeded its source drop`);
      assert.ok(!item.cset || item.ilvl === rolled.ilvl, `tier ${tier}: Covenant item level differs from its source drop`);
      minimum = Math.min(minimum, item.rarity);
      maximum = Math.max(maximum, item.rarity);
      if (item.rarity === 19) tier20Count++;
    }

    const gemLevelCap = Math.min(char.level, depthLevel(lootDepth) + 4);
    const maxDirectGemTier = Math.min(7, Math.floor(gemLevelCap / 16));
    const maxSigilTier = sigilCap(lootDepth);
    for (let n = 0; n < checkDropsPerTier; n++) {
      const gem = rollGroundGem(200);
      assert.ok(gem.ilvl <= gemLevelCap, `tier ${tier}: gem item level exceeded progression`);
      assert.ok(gem.tier <= maxDirectGemTier,
        `tier ${tier}: gem tier ${gem.tier} exceeded ${maxDirectGemTier}`);
      const sigil = rollSigil(lootDepth, 99);
      assert.ok(sigil.tier <= maxSigilTier,
        `tier ${tier}: sigil rank ${sigil.tier} exceeded ${maxSigilTier}`);
    }

    const covenant = makeCovenant(100, { maxRarity: expectedCap });
    assert.ok(covenant, `tier ${tier}: repeatable Covenant items are available`);
    assert.ok(covenant.rarity <= expectedCap, `tier ${tier}: Covenant quality exceeded its progression cap`);
    if (tier < 16) {
      assert.ok(maximum < 19, `tier ${tier}: Tier 20 must remain unavailable`);
      assert.equal(tier20Count, 0, `tier ${tier}: simulation generated Tier 20 gear`);
    }
    results.push({ tier, effectiveDepth: lootDepth, cap: RARITY[expectedCap].name, min: RARITY[minimum].name, max: RARITY[maximum].name, tier20Count });
  }
} finally {
  G.char = originalChar;
  G.world = originalWorld;
}

console.log(`Simulated ${simulatedDropsPerTier.toLocaleString()} equipment drops and checked ${checkDropsPerTier.toLocaleString()} gems plus sigils for each of 100 Rift tiers.`);
console.log(`Total equipment drops: ${(simulatedDropsPerTier * results.length).toLocaleString()}.`);
console.log('Tier | Effective depth | Eligible max | Simulated min-max | Tier 20 drops');
for (const row of results) console.log(`${row.tier} | ${row.effectiveDepth} | ${row.cap} | ${row.min}–${row.max} | ${row.tier20Count}`);
