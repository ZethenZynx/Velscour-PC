// Ground gear and gem drops cannot exceed the current character's level.
//   node tools/tests/drop_item_level.mjs
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { rollItem, RARITY } from '../../src/data/items.js';
import { groundDropRarityCap, rollGroundGem, rollGroundItem } from '../../src/game/loot.js';
import { riftQualityRange } from '../../src/data/rifts.js';

G.char = { level: 3 };
const gear = rollGroundItem(12, { slot: 'ring', rarity: 0 });
assert.equal(gear.ilvl, 3);
assert.equal(gear.req, 3);
assert.equal(gear.slot, 'ring');

const gem = rollGroundGem(12);
assert.ok(gem.ilvl <= G.char.level, `gem level ${gem.ilvl} exceeds character level ${G.char.level}`);

const qualityDepths = Array.from({ length: 20 }, (_, i) => 1 + i * 25);
assert.deepEqual(RARITY.map((r) => r.minDepth), qualityDepths, 'all gear quality depth unlocks match the design');
assert.deepEqual(RARITY.map((r) => r.name), Array.from({ length: 20 }, (_, i) => `Tier ${i + 1}`));
const rarityThresholds = Array.from({ length: 20 }, (_, tier) => {
  const depth = 1 + tier * 25;
  return [[depth, tier], ...(tier ? [[depth - 1, tier - 1]] : [])];
}).flat().sort((a, b) => a[0] - b[0]);
for (const [depth, expected] of rarityThresholds) {
  G.world = { depth };
  assert.equal(groundDropRarityCap(depth), expected, `depth ${depth} rarity cap`);
  const capped = rollGroundItem(12, { rarity: 19 });
  assert.equal(capped.rarity, expected, `depth ${depth} explicit rarity cap`);
  for (let i = 0; i < 20; i++) assert.ok(rollGroundItem(12).rarity <= expected, `random rarity exceeded cap at depth ${depth}`);
}

G.char = { level: 100, depth: 25 };
G.world = { kind: 'town', depth: 0 };
assert.equal(rollGroundItem(100, { rarity: 19 }).rarity, 0, 'town rewards use the saved campaign depth below depth 26');
G.char.depth = 26;
assert.equal(rollGroundItem(100, { rarity: 19 }).rarity, 1, 'town rewards unlock Light Blue at depth 26');

// Virtual Infernal Mark levels do not replace campaign depth for ordinary drops.
G.char = { level: 100, depth: 503, deepest: 502, experienceMarks: { earned: 1000, xp: 0 } };
G.world = { kind: 'dungeon', depth: 503 };
assert.equal(groundDropRarityCap(G.world.depth), 19, 'campaign Depth 503 permits Tier 20 quality');
assert.equal(rollGroundItem(100, { rarity: 19 }).rarity, 19, 'campaign Depth 503 does not inherit a low Rift tier cap');

// Rift equipment has its own explicit tier ceiling, independent of campaign depth and Mark XP rank.
G.world = { kind: 'rift', depth: 100, rift: { tier: 2 } };
assert.deepEqual(riftQualityRange(2, G.char), { min: 1, max: 5, progressionMax: 20, normalDepth: 503 });
for (let i = 0; i < 100; i++) {
  assert.ok(rollGroundItem(100, { rarity: 19 }).rarity <= 4, 'Tier 2 Rift remains capped at Tier 5 despite Depth 503 / virtual Mark levels');
}

assert.equal(rollItem(12, { rarity: 19 }).rarity, 19, 'non-ground item rolls remain outside the depth gate');

G.char = null;
G.world = null;
assert.equal(rollGroundItem(12, { rarity: 0 }).ilvl, 12, 'non-game reward rolls retain their requested level');
console.log('Ground drop item level tests passed.');
