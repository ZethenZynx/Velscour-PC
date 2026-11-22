// Non-browser regressions for Abyssal Rift loot progression and exit placement/clicking.
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { qualityAtDepth, RARITY, rollSigil, sigilCap } from '../../src/data/items.js';
import { depthLevel, FINAL_DEPTH } from '../../src/data/depth.js';
import { riftLootDepth, riftReward } from '../../src/data/rifts.js';
import { activeExitSpriteAt, findReachableInteractableSpot } from '../../src/core/interactable-hit.js';
import { groundDropRarityCap, groundRewardDepth, rollGroundGem, rollGroundItem } from '../../src/game/loot.js';
import { makeCovenant } from '../../src/data/relics.js';

G.char = { level: 100, depth: FINAL_DEPTH };
for (let tier = 1; tier <= 40; tier++) {
  const lootDepth = riftLootDepth(tier);
  const expectedCap = qualityAtDepth(lootDepth);
  G.world = { kind: 'dungeon', depth: FINAL_DEPTH, rift: { tier } };
  assert.equal(groundRewardDepth(G.world, FINAL_DEPTH), lootDepth, `tier ${tier}: all world rewards use Rift progression`);
  assert.equal(groundDropRarityCap(lootDepth), expectedCap, `tier ${tier}: progression cap`);
  assert.equal(rollGroundItem(100, { rarity: 19, maxRarity: 19 }).rarity, expectedCap,
    `tier ${tier}: even a forced high-rarity roll respects the Rift cap`);
  for (let n = 0; n < 15; n++) assert.ok(rollGroundItem(100).rarity <= expectedCap, `tier ${tier}: random gear exceeded cap`);

  const gem = rollGroundGem(200);
  const gemLevelCap = Math.min(G.char.level, depthLevel(lootDepth) + 4);
  assert.ok(gem.ilvl <= gemLevelCap, `tier ${tier}: gem level exceeded progression`);
  assert.ok(gem.tier <= Math.min(7, Math.floor(gemLevelCap / 16)), `tier ${tier}: gem tier exceeded progression`);

  const maxSigil = sigilCap(lootDepth);
  for (let n = 0; n < 10; n++) assert.ok(rollSigil(lootDepth, 99).tier <= maxSigil, `tier ${tier}: sigil exceeded progression`);
  assert.equal(riftReward(tier, true).abyssal, 1, `tier ${tier}: first-clear premium roll remains guaranteed`);
  assert.equal(riftReward(tier, true).keys, tier >= 40 ? 2 : 1, `tier ${tier}: completion guarantees the intended key payout`);
}
assert.ok(qualityAtDepth(riftLootDepth(1)) < 19, 'first Rift cannot award Tier 20 gear');
assert.equal(riftLootDepth(16), RARITY[19].minDepth, 'Rift tier 16 reaches the existing Tier 20 unlock depth');
assert.equal(qualityAtDepth(riftLootDepth(15)), 18, 'Rift tier 15 remains below Tier 20');
assert.equal(qualityAtDepth(riftLootDepth(16)), 19, 'Tier 20 becomes eligible at Rift tier 16');
G.char.depth = FINAL_DEPTH;
G.world = { depth: FINAL_DEPTH, rift: { tier: 15 } };
assert.equal(makeCovenant(100), null, 'Covenant drops remain locked before the Rift reaches Tier 20 eligibility');
G.world.rift.tier = 16;
assert.equal(makeCovenant(100)?.rarity, 19, 'Covenant drops become eligible when Rift progression reaches the existing Tier 20 unlock');

// The generated exit anchor must be walkable for the player's full collision radius
// and connected to the start; the same helper is used by Rift generation.
const mockMap = {
  walkable: (x, y) => x >= 0.5 && x <= 2 && Math.abs(y) <= 1,
  circleFree: (x, y, r) => x - r >= 0.5 && x + r <= 2 && Math.abs(y) + r <= 1,
  findPath: (_sx, _sy, x, y, _nodes, r) => x - r >= 0.5 && x + r <= 2 && Math.abs(y) + r <= 1 ? [[x, y]] : null,
};
const exit = findReachableInteractableSpot(mockMap, [0.75, 0], 0.1, 0, 3, 0.25, 0.42);
assert.ok(exit, 'blocked portal anchor relocates to reachable walkable terrain');
assert.ok(mockMap.circleFree(...exit, 0.42), 'relocated portal respects player collision radius');
assert.ok(mockMap.findPath(0.75, 0, ...exit, 9000, 0.38), 'relocated portal remains reachable from the start');

const project = (x, y) => [x * 10, y * 10];
const completedExit = { x: 3, y: 2, type: 'exit', active: true };
assert.equal(activeExitSpriteAt([completedExit], 30, -50, 1, project), completedExit,
  'clicking the completed portal artwork selects the exit even if loot labels overlap it');
assert.equal(activeExitSpriteAt([{ ...completedExit, active: false }], 30, -50, 1, project), null,
  'sealed exits do not take priority over loot');

G.char = null;
G.world = null;
console.log('Abyssal Rift progression and exit regression tests passed.');
