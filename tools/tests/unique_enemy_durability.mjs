// Non-browser audit of unique durability at campaign, endgame and Rift depths.
import assert from 'node:assert/strict';
import { ARCH } from '../../src/data/enemies.js';
import { endgameBaseLevel, endgameScaling, depthLevel } from '../../src/data/depth.js';
import { applyDungeonAffix } from '../../src/data/dungeonaffixes.js';
import { riftHpMul } from '../../src/data/rifts.js';
import { heresyMonster } from '../../src/game/heresies.js';
import { rollGreedAffixes } from '../../src/game/greed.js';
import { makeElite, makeMonster, monsterBase } from '../../src/game/monster.js';
import { UNIQUE_DEFENSIVE_AFFIXES, UNIQUE_HEALTH_MULTIPLIER, UNIQUE_MAX_REGEN_PER_SECOND, UNIQUE_MIN_DAMAGE_TAKEN, rollUniqueAffixes, uniqueDamageAfterDefense, uniqueRegenPerSecond } from '../../src/game/uniqueBalance.js';

const depths = [25, 50, 75, 100, 200, 476, 750, 1000];
const sampleWorld = (depth, extra = {}) => ({ kind: 'dungeon', depth, biome: { id: 'test', el: 'phys' }, dungeonAffixes: [], ...extra });
const baseHpAtDepth = (depth) => {
  const level = depthLevel(depth);
  const baseLevel = endgameBaseLevel(level, depth);
  const scale = depth > 100 ? endgameScaling(depth).health : 1;
  return monsterBase(baseLevel).hp * ARCH.skeleton.hp * scale;
};

assert.equal(UNIQUE_HEALTH_MULTIPLIER, 3.9);
assert.equal(UNIQUE_HEALTH_MULTIPLIER / 6, 0.65);
assert.equal(UNIQUE_MIN_DAMAGE_TAKEN, 0.4);
for (const depth of depths) {
  const world = sampleWorld(depth);
  const unique = makeMonster(world, 'skeleton', world.biome, depthLevel(depth), 'unique', 0, 0, 0, null);
  const champion = makeMonster(world, 'skeleton', world.biome, depthLevel(depth), 'champion', 0, 0, 0, null);
  const boss = makeMonster(world, 'skeleton', world.biome, depthLevel(depth) + 2, 'boss', 0, 0, 0, null);
  const expected = baseHpAtDepth(depth) * UNIQUE_HEALTH_MULTIPLIER;
  const uniqueAffixHealth = unique.affixes.includes('tough') ? 1.5 : 1;
  const championAffixHealth = champion.affixes.includes('tough') ? 1.5 : 1;
  assert.ok(Math.abs(unique.maxHp / uniqueAffixHealth - expected) <= Math.max(1e-7, expected * 1e-12), `depth ${depth}: unique uses the depth baseline once and the revised rank multiplier once`);
  assert.ok(unique.maxHp / uniqueAffixHealth > champion.maxHp / championAffixHealth, `depth ${depth}: the unique retains a stronger base multiplier than a comparable champion`);
  assert.ok(boss.maxHp > unique.maxHp, `depth ${depth}: a dedicated boss remains more durable than the unique`);
  assert.equal(unique.rank, 'unique');
  assert.equal(unique.affixes.length, depth > 50 ? 3 : 2, `depth ${depth}: the existing unique affix count is preserved`);
  assert.ok(unique.affixes.filter((id) => UNIQUE_DEFENSIVE_AFFIXES.includes(id)).length <= 1, `depth ${depth}: unique elite affixes do not stack defensive types`);
  const onceHp = unique.maxHp, onceDmg = unique.dmg, onceAffixes = unique.affixes.join(',');
  makeElite(unique, 'unique', depth, world);
  assert.equal(unique.maxHp, onceHp, `depth ${depth}: repeated unique rank assignment cannot multiply health`);
  assert.equal(unique.dmg, onceDmg, `depth ${depth}: repeated unique rank assignment cannot multiply damage`);
  assert.equal(unique.affixes.join(','), onceAffixes, `depth ${depth}: repeated unique rank assignment cannot reroll or stack affixes`);
}

const oldHealthMultiplier = 6;
for (const tier of [1, 2, 5, 10, 20, 50, 100]) {
  const world = sampleWorld(100, { riftTier: tier, rift: { tier } });
  const unique = makeMonster(world, 'skeleton', world.biome, 100, 'unique', 0, 0, 0, null);
  const uniqueAffixHealth = unique.affixes.includes('tough') ? 1.5 : 1;
  assert.ok(Math.abs(unique.maxHp / uniqueAffixHealth - baseHpAtDepth(100) * riftHpMul(tier) * UNIQUE_HEALTH_MULTIPLIER) < 1e-6,
    `Rift tier ${tier}: Rift HP scaling is applied once before the unique multiplier`);
}

// Seeded deterministic affix rolls retain the configured count while admitting at most one
// of the durability-focused elite affixes, including when Crowned adds its extra affix.
for (let seed = 1; seed <= 500; seed++) {
  let state = seed;
  const random = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
  const rolled = rollUniqueAffixes(['strong', 'fast', ...UNIQUE_DEFENSIVE_AFFIXES, 'shocking', 'teleport', 'multishot', 'thorns'], 3, random);
  assert.equal(rolled.length, 3);
  assert.ok(rolled.filter((id) => UNIQUE_DEFENSIVE_AFFIXES.includes(id)).length <= 1);
  const unique = { team: 'enemy', rank: 'unique', maxHp: 600, hp: 600, dmg: 20, speed: 2, atkCd: 1, res: {}, affixes: rolled };
  heresyMonster(unique, ['iron', 'crowned', 'infernal_fortification', 'unholy_resilience']);
  assert.ok(unique.affixes.filter((id) => UNIQUE_DEFENSIVE_AFFIXES.includes(id)).length <= 1, 'Crowned does not add a second defensive unique affix');
  assert.equal(unique.maxHp >= 900, true, 'Heresy Iron Hide remains active');
  assert.equal(unique.heresyDamageReduction, 0.2, 'Heresy damage reduction remains active');
  assert.equal(unique.heresyRegen, 0.01, 'Heresy regeneration mechanics remain active');
}

assert.equal(applyDungeonAffix({ team: 'enemy', rank: 'unique', maxHp: 100, hp: 100, dmg: 10, res: {}, affixes: [] }, 'fortified'), true);
assert.equal(uniqueDamageAfterDefense('unique', 100, 1), 40, 'unique defensive layers cannot reduce incoming damage below 40%');
assert.equal(uniqueDamageAfterDefense('unique', 100, 55), 55, 'the unique mitigation floor does not reduce damage taken');
assert.equal(uniqueDamageAfterDefense('champion', 100, 1), 1, 'champion defensive behavior is unchanged');
assert.equal(uniqueDamageAfterDefense('boss', 100, 1), 1, 'boss defensive behavior is unchanged');
assert.equal(uniqueRegenPerSecond('unique', 0.021), UNIQUE_MAX_REGEN_PER_SECOND, 'stacked unique regeneration is capped at 0.5% max health per second');
assert.equal(uniqueRegenPerSecond('champion', 0.021), 0.021, 'champion regeneration is unchanged');
assert.equal(uniqueRegenPerSecond('boss', 0.021), 0.021, 'boss regeneration is unchanged');

for (let seed = 1; seed <= 100; seed++) {
  let state = seed;
  const random = () => ((state = (state * 48271) % 2147483647) - 1) / 2147483646;
  const greedAffixes = rollGreedAffixes(5, random);
  const unique = { team: 'enemy', rank: 'unique', maxHp: 1000, hp: 1000, dmg: 100, res: { fire: 0.2 }, affixes: [], dungeonAffixIds: [] };
  for (const id of greedAffixes) applyDungeonAffix(unique, id);
  heresyMonster(unique, ['iron', 'crowned', 'unholy_resilience', 'infernal_fortification']);
  assert.equal(unique._heresy, true, 'maximum Heresy applies once to the existing unique');
  const stackDamage = 100 * (1 - Math.min(0.9, Math.max(-1, unique.res.fire))) *
    (1 - Math.min(0.3, unique.affixAdaptiveRes?.fire || 0)) *
    (unique.affixLastStand ? 0.7 : 1) * (1 - (unique.heresyDamageReduction || 0)) *
    (unique.affixShieldT > 0 ? 1 - (unique.affixShield || 0) : 1);
  assert.ok(uniqueDamageAfterDefense('unique', 100, stackDamage) >= 40,
    `Greed 5 + maximum Heresy defense mix ${seed} respects the unique-only damage floor`);
}

console.log('Unique health comparison (skeleton archetype; exact depth/endgame scaling; no additional affixes):');
console.log('Depth | Base HP | Old unique HP | New unique HP | Old eHP (20% resistance) | New eHP | Change');
for (const depth of depths) {
  const baseline = baseHpAtDepth(depth);
  const oldHp = baseline * oldHealthMultiplier;
  const newHp = baseline * UNIQUE_HEALTH_MULTIPLIER;
  const oldEhp = oldHp / 0.8;
  const newEhp = newHp / 0.8;
  console.log(`${depth} | ${Math.round(baseline).toLocaleString()} | ${Math.round(oldHp).toLocaleString()} | ${Math.round(newHp).toLocaleString()} | ${Math.round(oldEhp).toLocaleString()} | ${Math.round(newEhp).toLocaleString()} | -35.0%`);
}
const oldStackScale = 0.25 * 0.7 * 0.7 * 0.8 * 0.75; // 75% resistance, adaptive, Last Stand, Heresy Fortification, shield.
const newStackScale = Math.max(oldStackScale, UNIQUE_MIN_DAMAGE_TAKEN);
console.log(`Severe-but-valid defense stack: effective damage ${Math.round(oldStackScale * 1000) / 10}% -> ${Math.round(newStackScale * 100)}%; defensive eHP multiplier ${(1 / oldStackScale).toFixed(2)}x -> ${(1 / newStackScale).toFixed(2)}x.`);
console.log('Unique durability validation passed: requested campaign/endgame depths, Rift tiers 1–100 samples, 500 Heresy/Crowned rolls, 100 Greed 5 + Heresy maximum combinations, rank isolation, and no duplicate depth/Rift multipliers.');
