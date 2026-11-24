// Verify real Rift boss and chest reward paths use their owning Rift's quality cap,
// even if G.world temporarily points at a different (higher-depth) environment.
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { depthLevel } from '../../src/data/depth.js';
import { riftRewardProgressionDepth, riftQualityRange } from '../../src/data/rifts.js';
import { dropChest, dropLoot, rollGroundGem } from '../../src/game/loot.js';

const original = { char: G.char, world: G.world, player: G.player };
const storage = new Map();
globalThis.localStorage ||= {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  get length() { return storage.size; },
  key: (i) => [...storage.keys()][i] ?? null,
};

try {
  G.char = { level: 100, depth: 2576, classId: 'paladin', bag: [], relicCodex: {} };
  G.player = { char: G.char, hp: 100, maxHp: 100, st: {
    magicFind: 0, goldFind: 0, markGold: 0, markCollector: 0, markSigilChance: 0,
    markGemChance: 0, markAbundance: 0, markBreachRewards: 0, drops: 0,
    legendary: {},
  } };
  // Deliberately mispoint the global world to a late endgame depth. Reward
  // functions must use the Rift argument they receive, not this ambient state.
  G.world = { depth: 2576 };

  for (let tier = 1; tier <= 100; tier++) {
    const rewardDepth = riftRewardProgressionDepth(tier, G.char);
    const expected = riftQualityRange(tier, G.char).max - 1;
    const rewards = [];
    const world = { depth: 100, rift: { tier, done: true }, addLoot: (drop) => rewards.push(drop) };
    const gem = rollGroundGem(200, world);
    const gemLevelCap = Math.min(G.char.level, depthLevel(rewardDepth) + 4);
    assert.ok(gem.ilvl <= gemLevelCap, `Rift Tier ${tier}: gem reward uses its owning Rift progression`);
    dropChest(world, { x: 2, y: 2, rare: true }, world.depth);
    dropLoot(world, { x: 4, y: 4, level: 100, rank: 'boss', isRaid: false });
    const gear = rewards.filter((drop) => drop.kind === 'item' && drop.item?.type === 'gear');
    assert.ok(gear.length >= 4, `Rift Tier ${tier}: boss and chest generate equipment for validation`);
    for (const drop of gear) assert.ok(drop.item.rarity <= expected,
      `Rift Tier ${tier}: ${drop.item.name || drop.item.uname || 'equipment'} quality ${drop.item.rarity + 1} exceeds ${expected + 1}`);
  }
} finally {
  G.char = original.char; G.world = original.world; G.player = original.player;
}

console.log('Rift boss and chest equipment sources respect the owning Rift tier across all 100 tiers.');
