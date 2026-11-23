// Non-browser regression coverage for continuous endgame enemy scaling.
//   node tools/tests/endgame_scaling.mjs
import assert from 'node:assert/strict';
import { depthLevel, endgameBaseLevel, endgameScaling, FINAL_DEPTH } from '../../src/data/depth.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';
import { ARCH } from '../../src/data/enemies.js';
import { qualityAtDepth, RARITY_TIER_20 } from '../../src/data/items.js';
import { makeMonster, monsterBase } from '../../src/game/monster.js';
import { makeRaidBoss, RAID_BOSSES } from '../../src/game/raid.js';

const close = (actual, expected, message) => {
  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-12);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
};

assert.equal(FINAL_DEPTH, 100);
let priorHealthMultiplier = endgameScaling(100).health;
let priorDamageMultiplier = endgameScaling(100).damage;
for (let depth = 101; depth <= 10000; depth++) {
  const current = endgameScaling(depth);
  assert.ok(current.health > priorHealthMultiplier, `health must rise at each endgame depth (${depth})`);
  assert.ok(current.damage > priorDamageMultiplier, `damage must rise at each endgame depth (${depth})`);
  priorHealthMultiplier = current.health;
  priorDamageMultiplier = current.damage;
}
assert.equal(qualityAtDepth(476), RARITY_TIER_20, 'Tier 20 equipment is eligible at its existing depth gate');
assert.equal(qualityAtDepth(1000), RARITY_TIER_20, 'infinite difficulty does not unlock equipment above Tier 20');
const depths = [
  ...Array.from({ length: 16 }, (_, i) => 95 + i),
  150, 200, 300, 476, 500, 750, 1000,
];
const biome = BIOME_BY_ID.catacombs;
const archetype = ARCH.skeleton;
assert.ok(biome && archetype, 'test environment and enemy are registered');
const spawn = (depth, greedLevel = 0) => makeMonster(
  { depth, greedLevel, riftHold: false, dungeonAffixes: [] },
  'skeleton', biome, depthLevel(depth), 'normal', 0, 0, 0,
  { art: '__missing_test_art__', swap: null },
);

let previousHealth = 0, previousDamage = 0;
const rows = [];
for (const depth of depths) {
  const { health, damage } = endgameScaling(depth);
  const steps = Math.max(0, (depth - 100) / 25);
  close(health, 1.17 ** steps, `depth ${depth} health multiplier`);
  close(damage, 1.023 ** steps, `depth ${depth} damage multiplier`);

  const level = depthLevel(depth);
  const baselineLevel = endgameBaseLevel(level, depth);
  const expectedBase = monsterBase(baselineLevel);
  const previousBase = monsterBase(level);
  const enemy = spawn(depth);
  close(enemy.maxHp, expectedBase.hp * archetype.hp * health, `depth ${depth} normal enemy HP`);
  close(enemy.dmg, expectedBase.dmg * archetype.dmg * damage, `depth ${depth} normal enemy damage`);
  // XP and level continue their existing progression; only combat stats use the frozen baseline.
  close(enemy.xp, monsterBase(level).xp * (archetype.xp || 1), `depth ${depth} enemy XP`);

  if (depth > FINAL_DEPTH) {
    assert.ok(enemy.maxHp > previousHealth, `enemy HP must increase at every depth (${depth})`);
    assert.ok(enemy.dmg > previousDamage, `enemy damage must increase at every depth (${depth})`);
  }
  previousHealth = enemy.maxHp;
  previousDamage = enemy.dmg;

  const sameDepthOtherGreed = spawn(depth, 5);
  close(sameDepthOtherGreed.maxHp, enemy.maxHp, `Greed must not alter depth ${depth} HP`);
  close(sameDepthOtherGreed.dmg, enemy.dmg, `Greed must not alter depth ${depth} damage`);
  rows.push({
    depth,
    baseLevel: baselineLevel,
    hpMultiplier: health,
    damageMultiplier: damage,
    enemyHp: enemy.maxHp,
    enemyDamage: enemy.dmg,
    previousHp: previousBase.hp * archetype.hp * health,
    previousDamage: previousBase.dmg * archetype.dmg * damage,
  });
}

// The campaign endpoint and first endgame depths are continuous and strictly increasing.
const nearby = rows.filter((row) => row.depth >= 95 && row.depth <= 110);
for (let i = 1; i < nearby.length; i++) {
  if (nearby[i].depth > FINAL_DEPTH) {
    assert.ok(nearby[i].enemyHp > nearby[i - 1].enemyHp, `HP discontinuity near depth ${nearby[i].depth}`);
    assert.ok(nearby[i].enemyDamage > nearby[i - 1].enemyDamage, `damage discontinuity near depth ${nearby[i].depth}`);
  }
}

// Boss-room stats use the same depth-100 baseline and continuous multiplier.
const originalRandom = Math.random;
Math.random = () => 0.5;
try {
  const tpl = RAID_BOSSES[0];
  const bossAt = (depth) => makeRaidBoss(
    { kind: 'dungeon', depth, biome, dungeonAffixes: [], heresy: { ids: [] } },
    { cx: 5, cy: 5, x: 0, y: 0, w: 10, h: 10 }, depth, depthLevel(depth) + 3,
    { tpl, art: tpl.art[0] },
  );
  const baselineBoss = bossAt(FINAL_DEPTH);
  for (const depth of [101, 106, 150, 200, 300, 476, 500, 750, 1000]) {
    const boss = bossAt(depth), scale = endgameScaling(depth);
    close(boss.maxHp, baselineBoss.maxHp * scale.health, `depth ${depth} raid boss HP`);
    close(boss.dmg, baselineBoss.dmg * scale.damage, `depth ${depth} raid boss damage`);
  }
} finally {
  Math.random = originalRandom;
}

console.table(rows.map((row) => ({
  depth: row.depth,
  baselineLevel: row.baseLevel,
  HPx: row.hpMultiplier.toFixed(4),
  damageX: row.damageMultiplier.toFixed(4),
  previousHP: Math.round(row.previousHp),
  previousDamage: row.previousDamage.toFixed(2),
  normalEnemyHP: Math.round(row.enemyHp),
  normalEnemyDamage: row.enemyDamage.toFixed(2),
})));
console.log('Continuous endgame enemy and raid-boss scaling, depth-100 baselines, and Greed independence passed.');
