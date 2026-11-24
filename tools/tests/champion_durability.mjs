import assert from 'node:assert/strict';
import { DUNGEON_AFFIX_BY_ID, applyDungeonAffix } from '../../src/data/dungeonaffixes.js';
import { depthLevel } from '../../src/data/depth.js';
import { HERESIES } from '../../src/data/heresies.js';
import { heresyMonster } from '../../src/game/heresies.js';
import { makeElite, makeMonster } from '../../src/game/monster.js';
import { applyTrait } from '../../src/game/mayhem.js';
import { enemyDamageReduction } from '../../src/game/enemyvariety.js';
import {
  HULKING_HEALTH_MULTIPLIER, HULKING_CHAMPION_HEALTH_MULTIPLIER,
  TOUGH_HEALTH_MULTIPLIER, TOUGH_CHAMPION_HEALTH_MULTIPLIER,
  WAR_CAPTAIN_GUARD_DAMAGE_REDUCTION, WAR_CAPTAIN_GUARD_RESIST,
  adjustHulkingChampionHealth, adjustHulkingWarCaptainHealth,
} from '../../src/game/championBalance.mjs';

const depths = [25, 50, 75, 100, 133, 200, 476, 750, 1000];
const art = { art: 'charcoal_boulder', swap: null };
const sampleWorld = (depth) => ({ kind: 'dungeon', depth, biome: { id: 'test', el: 'phys' }, dungeonAffixes: [] });
let randomState = 1;
const seededRandom = () => ((randomState = (randomState * 48271) % 2147483647) - 1) / 2147483646;
const withSeed = (seed, fn) => {
  const prior = Math.random; randomState = seed; Math.random = seededRandom;
  try { return fn(); } finally { Math.random = prior; }
};

assert.equal(HULKING_HEALTH_MULTIPLIER, 4.5, 'ordinary Hulking health remains unchanged');
assert.equal(TOUGH_HEALTH_MULTIPLIER, 1.5, 'non-champion Tough health, including unique balance, remains unchanged');
assert.equal(HULKING_CHAMPION_HEALTH_MULTIPLIER / HULKING_HEALTH_MULTIPLIER, 5 / 6);
assert.equal(TOUGH_CHAMPION_HEALTH_MULTIPLIER / TOUGH_HEALTH_MULTIPLIER, 0.9);
assert.ok(Math.abs(HULKING_CHAMPION_HEALTH_MULTIPLIER / HULKING_HEALTH_MULTIPLIER * TOUGH_CHAMPION_HEALTH_MULTIPLIER / TOUGH_HEALTH_MULTIPLIER - 0.75) < 1e-12,
  'Hulking plus Tough champion health is reduced by exactly 25%');
assert.equal(WAR_CAPTAIN_GUARD_DAMAGE_REDUCTION, 0.10);
assert.equal(WAR_CAPTAIN_GUARD_RESIST, 0.05);

console.log('Depth | Champion Hulking old HP | revised HP | reduction | Hulk + Tough old HP | revised HP | EHP old → new');
for (const depth of depths) {
  const world = sampleWorld(depth);
  // Real spawn ordering applies a trait to a normal monster before elite promotion.
  const promoted = withSeed(depth + 500, () => makeMonster(world, 'slime', world.biome, depthLevel(depth), 'normal', 0, 0, 1, art));
  const untraitedHp = promoted.maxHp;
  applyTrait(promoted, 'tank');
  assert.ok(Math.abs(promoted.maxHp / untraitedHp - HULKING_HEALTH_MULTIPLIER) < 1e-12,
    `depth ${depth}: ordinary Hulking health is unchanged before promotion`);
  const hulkingHp = promoted.maxHp;
  makeElite(promoted, 'champion', depth, world);
  const promotedTough = promoted.affixes.includes('tough');
  const priorPromotedHp = hulkingHp * 3.5 * (promotedTough ? TOUGH_HEALTH_MULTIPLIER : 1);
  const expectedPromotedRatio = promotedTough ? 0.75 : 5 / 6;
  assert.ok(Math.abs(promoted.maxHp / priorPromotedHp - expectedPromotedRatio) < 1e-12,
    `depth ${depth}: normal-to-champion promotion corrects pre-applied Hulking health exactly once`);

  const champion = withSeed(depth, () => makeMonster(world, 'slime', world.biome, depthLevel(depth), 'champion', 0, 0, 1, art));
  const hasTough = champion.affixes.includes('tough');
  const championDamage = champion.dmg, championXp = champion.xp;
  applyTrait(champion, 'tank');
  assert.ok(Math.abs(champion.dmg / championDamage - 1.3) < 1e-12, `depth ${depth}: Hulking's offensive bonus is preserved`);
  assert.ok(Math.abs(champion.xp / championXp - 3.5) < 1e-12, `depth ${depth}: Hulking's XP reward is preserved`);
  const oldHp = champion.maxHp * (HULKING_HEALTH_MULTIPLIER / HULKING_CHAMPION_HEALTH_MULTIPLIER) *
    (hasTough ? TOUGH_HEALTH_MULTIPLIER / TOUGH_CHAMPION_HEALTH_MULTIPLIER : 1);
  assert.ok(Math.abs(champion.maxHp / oldHp - (hasTough ? 0.75 : 5 / 6)) < 1e-12, `depth ${depth}: champion Hulk/Tough reduction is targeted`);

  // Calculate the explicit Hulk+Tough upper tank profile, retaining the real depth, variant,
  // Greed health affixes and max-rank Heresy health/mitigation mechanics.
  const stress = withSeed(depth + 1000, () => makeMonster(sampleWorld(depth), 'slime', world.biome, depthLevel(depth), 'champion', 0, 0, 1, art));
  applyTrait(stress, 'tank');
  stress.affixes ||= [];
  if (!stress.affixes.includes('tough')) {
    stress.affixes.push('tough'); stress.maxHp *= TOUGH_CHAMPION_HEALTH_MULTIPLIER; stress.hp = stress.maxHp;
    for (const e of ['phys', 'fire', 'cold', 'light', 'poison']) stress.res[e] = (stress.res[e] || 0) + 0.15;
  }
  const greed = ['fortified', 'bloodmoon', 'elite_empowerment', 'champions_bounty', 'fire_walls'];
  assert.equal(new Set(greed.map((id) => DUNGEON_AFFIX_BY_ID[id].category)).size, 5, 'stress uses five distinct Greed categories');
  for (const id of greed) applyDungeonAffix(stress, id);
  heresyMonster(stress, HERESIES.map(({ id }) => id));
  const stressOldHp = stress.maxHp * (HULKING_HEALTH_MULTIPLIER / HULKING_CHAMPION_HEALTH_MULTIPLIER) *
    (stress.affixes.includes('tough') ? TOUGH_HEALTH_MULTIPLIER / TOUGH_CHAMPION_HEALTH_MULTIPLIER : 1);
  const res = Math.min(0.9, Math.max(-1, stress.res.phys || 0));
  const effectiveNew = stress.maxHp / ((1 - res) * (1 - (stress.heresyDamageReduction || 0)));
  const effectiveOld = stressOldHp / ((1 - res) * (1 - (stress.heresyDamageReduction || 0)));
  assert.ok(Math.abs(stress.maxHp / stressOldHp - 0.75) < 1e-10, `depth ${depth}: max Greed/Heresy does not bypass the combined 25% targeted reduction`);
  console.log(`${String(depth).padStart(4)} | ${Math.round(oldHp).toLocaleString().padStart(22)} | ${Math.round(champion.maxHp).toLocaleString().padStart(10)} | ${((1 - champion.maxHp / oldHp) * 100).toFixed(1).padStart(6)}% | ${Math.round(stressOldHp).toLocaleString().padStart(19)} | ${Math.round(stress.maxHp).toLocaleString().padStart(10)} | ${Math.round(effectiveOld).toLocaleString()} → ${Math.round(effectiveNew).toLocaleString()}`);
}

const captainWorld = sampleWorld(133);
captainWorld.time = 0;
const captain = withSeed(133, () => makeMonster(captainWorld, 'slime', captainWorld.biome, depthLevel(133), 'normal', 0, 0, 1, art));
const captainBaseHp = captain.maxHp;
applyTrait(captain, 'tank');
const captainOldHp = captainBaseHp * HULKING_HEALTH_MULTIPLIER * 1.16;
captain.maxHp *= 1.16; captain.hp = captain.maxHp;
captain.packLeaderType = 'war_captain';
captain.enemyBehaviors = [];
captain.world = captainWorld;
assert.equal(adjustHulkingWarCaptainHealth(captain), true);
assert.ok(Math.abs(captain.maxHp / captainOldHp - 5 / 6) < 1e-12, 'War Captain Hulk receives the same 16.7% health correction');
assert.equal(adjustHulkingWarCaptainHealth(captain), false, 'War Captain migration is idempotent');
const oldCaptainFire = { ...captain, maxHp: captainOldHp, enemyLeaderBuff: { until: 1, damageReduction: 0.15, resist: 0.1 } };
const newCaptainFire = { ...captain, enemyLeaderBuff: { until: 1, damageReduction: WAR_CAPTAIN_GUARD_DAMAGE_REDUCTION, resist: WAR_CAPTAIN_GUARD_RESIST } };
const oldFireDamage = enemyDamageReduction(oldCaptainFire, { x: 1, y: 0 }, 100, 'fire');
const newFireDamage = enemyDamageReduction(newCaptainFire, { x: 1, y: 0 }, 100, 'fire');
const oldCaptainFireEhp = captainOldHp * 100 / oldFireDamage;
const newCaptainFireEhp = captain.maxHp * 100 / newFireDamage;
assert.ok(Math.abs(newFireDamage / 100 - 0.855) < 1e-12, 'War Captain fire reduction follows the real combat mitigation path');
console.log(`Depth 133 War Captain Hulking fire EHP: ${Math.round(oldCaptainFireEhp).toLocaleString()} -> ${Math.round(newCaptainFireEhp).toLocaleString()} (${((1 - newCaptainFireEhp / oldCaptainFireEhp) * 100).toFixed(1)}% lower)`);
const ordinaryTank = { rank: 'normal', trait: 'tank', maxHp: 1000, hp: 1000 };
assert.equal(adjustHulkingChampionHealth(ordinaryTank), false, 'ordinary Hulking enemies are unaffected');
assert.equal(adjustHulkingChampionHealth({ rank: 'unique', trait: 'tank', maxHp: 1000, hp: 1000 }), false, 'unique enemies keep their separate balance');

console.log('Passed targeted champion durability across campaign/endgame depths, max Greed + max Heresy, and War Captain/Hulking idempotence.');
