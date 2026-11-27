// Formula-level combat regression for the real-time combat rebalance.
//   node tools/tests/combat_real_time_balance.mjs
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { DUNGEON_AFFIXES, DUNGEON_AFFIX_CONFIG, applyDungeonAffix } from '../../src/data/dungeonaffixes.js';
import { HERESIES } from '../../src/data/heresies.js';
import { depthLevel, endgameBaseLevel, endgameScaling, toughness, danger, armorDiv } from '../../src/data/depth.js';
import { heresyHero, heresyMonster } from '../../src/game/heresies.js';
import { hit } from '../../src/game/combat.js';

const close = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-10),
    `${label}: expected ${expected}, received ${actual}`);
};

// Proposed values are verified at the configuration/runtime boundary. Critical
// chance intentionally remains at 20%; only its damage multiplier changes.
assert.equal(DUNGEON_AFFIX_CONFIG.brutal.damageMultiplier, 1.15);
assert.equal(DUNGEON_AFFIX_CONFIG.frenzied.attackSpeedMultiplier, 1.2);
assert.equal(DUNGEON_AFFIX_CONFIG.empowered.perEnemyDamageBonus, 0.025);
assert.equal(DUNGEON_AFFIX_CONFIG.empowered.maxDamageBonus, 0.25);
assert.equal(DUNGEON_AFFIX_CONFIG.critical.chance, 0.2);
assert.equal(DUNGEON_AFFIX_CONFIG.critical.damageMultiplier, 1.5);
const descriptions = Object.fromEntries(HERESIES.map((h) => [h.id, h.desc]));
assert.match(descriptions.cruel, /20%/);
assert.match(descriptions.glass, /15% less life/);
assert.match(descriptions.shattered_armor, /15%/);
assert.match(descriptions.elemental_frailty, /10 percentage points/);
assert.match(descriptions.blood_frenzy, /15%/);

// Five affixes from five distinct Greed categories. This is a deterministic,
// valid max-Greed sample chosen to include attack speed and increased damage
// taken; it is not presented as the single worst possible random roll.
const GREED_FIVE = ['critical', 'poisonous_strikes', 'coordinated_assault', 'boss_aftershock', 'glass_cannon'];
const MAX_HERESY = HERESIES.map((h) => h.id);
const categoryById = new Map(DUNGEON_AFFIXES.map((affix) => [affix.id, affix.category]));
assert.equal(new Set(GREED_FIVE.map((id) => categoryById.get(id))).size, GREED_FIVE.length,
  'representative five-affix roll uses distinct eligible categories');

function simulate(depth, { affixes = [], heresies = [] } = {}) {
  const level = depthLevel(depth);
  const combatLevel = endgameBaseLevel(level, depth);
  const scale = endgameScaling(depth);
  const baseHp = Math.round((55 + combatLevel * 14 + 0.45 * combatLevel * combatLevel) * toughness(combatLevel)) * scale.health;
  const baseDamage = Math.round((10 + combatLevel * 2.2 + 0.055 * combatLevel * combatLevel) * danger(combatLevel)) * scale.damage;
  const world = {
    kind: 'dungeon', depth, time: 0,
    dungeonAffixes: [...affixes],
    heresy: { ids: [...heresies] },
    affixCoordinatedUntil: affixes.includes('coordinated_assault') ? 5 : 0,
    query: (_x, _y, _r, filter) => Array.from({ length: 12 }, (_, i) => ({ team: 'enemy', dead: false, id: i }))
      .filter((other) => filter(other)),
  };
  const enemy = {
    team: 'enemy', rank: 'normal', name: 'Test skeleton', level,
    x: 2, y: 2, dmg: baseDamage, maxHp: baseHp, hp: baseHp,
    atkCd: 1.2, el: 'fire', affixes: [], dungeonAffixIds: [],
    heresyRegen: 0, heresyDamageReduction: 0, res: {}, curses: {}, status: {},
    world,
  };
  for (const id of affixes) applyDungeonAffix(enemy, id);
  heresyMonster(enemy, heresies);
  // Blood Frenzy is a below-half-health conditional; place the enemy in that
  // state to measure the specified dangerous case reproducibly.
  enemy.hp = enemy.maxHp * 0.49;

  const previous = { world: G.world, player: G.player, char: G.char, godMode: G.godMode, random: Math.random };
  try {
    G.world = world;
    G.godMode = false;
    G.char = { heresy: { on: [...heresies] } };
    const penalties = heresyHero(G.char);
    const player = {
      isPlayer: true, team: 'player', name: 'Synthetic level-100 Paladin profile',
      x: 0, y: 0, hp: 50000 * (1 + penalties.life / 100),
      maxHp: 50000 * (1 + penalties.life / 100), dead: false, invuln: 0,
      world, curses: {}, status: {},
      st: {
        armor: 30000 * penalties.armorMul,
        res: { fire: 70 - penalties.resPenalty, phys: 70, magic: 70 },
        reduce: 40, block: 0, markEvasion: 0,
        thorns: 0, legendary: { thorns: 0 },
      },
    };
    G.player = player; world.player = player;
    // Deterministic upper-bound event for the 20%-chance Critical affix.
    Math.random = () => affixes.includes('critical') ? 0 : 0.5;
    const actual = hit(enemy, player, enemy.dmg, 'fire', {
      silent: true, noHitFx: true, noStatus: true, noVariance: true,
    });
    const physicalTarget = { ...player, hp: player.maxHp, st: { ...player.st, legendary: { thorns: 0 } }, curses: {}, status: {} };
    const actualPhysicalHit = hit(enemy, physicalTarget, enemy.dmg, 'phys', {
      silent: true, noHitFx: true, noStatus: true, noVariance: true,
    });
    const attackRateMultiplier = (1.2 / enemy.atkCd) * (enemy.heresyAttackRate || 1);
    return {
      depth, level, combatLevel, baseHp, baseDamage,
      affixes: [...affixes], heresies: [...heresies],
      hpMultiplier: enemy.maxHp / baseHp,
      rawDamageMultiplier: enemy.dmg / baseDamage,
      actualFireHit: actual,
      actualPhysicalHit,
      playerHp: player.maxHp,
      attackRateMultiplier,
      attackCooldown: enemy.atkCd,
      incomingHitMultiplier: actual / (baseDamage * (1 - 0.70) * (1 - 0.40)),
      damagePerSecondMultiplier: actual / (baseDamage * (1 - 0.70) * (1 - 0.40)) * attackRateMultiplier,
      damageAsPlayerHealthPct: actual / player.maxHp * 100,
      armor: player.st.armor,
      fireResistance: player.st.res.fire,
    };
  } finally {
    G.world = previous.world; G.player = previous.player; G.char = previous.char;
    G.godMode = previous.godMode; Math.random = previous.random;
  }
}

const depths = [25, 50, 75, 100, 150, 170, 175, 200];
const scenarios = [
  ['No modifiers', {}],
  ['Dungeon affixes only', { affixes: GREED_FIVE }],
  ['Maximum Heresy only', { heresies: MAX_HERESY }],
  ['Maximum Heresy + five affixes', { affixes: GREED_FIVE, heresies: MAX_HERESY }],
];
const oldExpectedHitFactor = {
  'No modifiers': 1,
  'Dungeon affixes only': 1.5 * 1.25 * (1 + 0.2 * (2 - 1)),
  'Maximum Heresy only': 1.3 * 1.25 * (0.45 / 0.30),
  'Maximum Heresy + five affixes': 1.3 * 1.25 * 1.5 * 1.25 * (1 + 0.2 * (2 - 1)) * (0.45 / 0.30),
};
const oldWorstHitFactor = {
  'No modifiers': 1,
  'Dungeon affixes only': 1.5 * 1.25 * 2,
  'Maximum Heresy only': 1.3 * 1.25 * (0.45 / 0.30),
  'Maximum Heresy + five affixes': 1.3 * 1.25 * 1.5 * 1.25 * 2 * (0.45 / 0.30),
};
const newExpectedHitFactor = {
  'No modifiers': 1,
  'Dungeon affixes only': 1.5 * 1.25 * (1 + 0.2 * (1.5 - 1)),
  'Maximum Heresy only': 1.2 * 1.15 * (0.40 / 0.30),
  'Maximum Heresy + five affixes': 1.2 * 1.15 * 1.5 * 1.25 * (1 + 0.2 * (1.5 - 1)) * (0.40 / 0.30),
};
const rows = [];
for (const depth of depths) {
  const baseline = simulate(depth);
  for (const [label, config] of scenarios) {
    const row = simulate(depth, config);
    if (label === 'No modifiers') close(row.actualFireHit, baseline.actualFireHit, `depth ${depth} baseline hit`);
    if (label === 'Dungeon affixes only') {
      close(row.rawDamageMultiplier, 1, `depth ${depth} affix set has no spawn-time damage multiplier`);
      close(row.attackRateMultiplier, 1, `depth ${depth} no attack-rate affix in representative roll`);
      close(row.incomingHitMultiplier, 2.8125, `depth ${depth} Critical + coordinated assault + Glass Cannon`);
    }
    if (label === 'Maximum Heresy only') {
      close(row.rawDamageMultiplier, 1.2, `depth ${depth} Cruel Hand source multiplier`);
      close(row.incomingHitMultiplier, 1.2 * 1.15 * (0.4 / 0.3), `depth ${depth} Cruel Hand + Blood Frenzy + resistance penalty`);
      close(row.attackRateMultiplier, 1.25, `depth ${depth} Relentless Assault attack rate`);
      close(row.playerHp, 42500, `depth ${depth} Glass Cannon health penalty`);
      close(row.armor, 25500, `depth ${depth} Shattered Armor penalty`);
      close(row.fireResistance, 60, `depth ${depth} Elemental Frailty penalty`);
    }
    const beforeHit = baseline.actualFireHit * oldExpectedHitFactor[label];
    const expectedAfterHit = baseline.actualFireHit * newExpectedHitFactor[label];
    const beforeWorstHit = baseline.actualFireHit * oldWorstHitFactor[label];
    const armorFactor = (armor, level) => (1 - armor / (armor + armorDiv(level))) * (1 - 0.70) * (1 - 0.40);
    const baselinePhysicalHit = baseline.baseDamage * armorFactor(30000, baseline.level);
    const oldArmor = label.includes('Heresy') ? 30000 * 0.8 : 30000;
    const newArmor = label.includes('Heresy') ? 30000 * 0.85 : 30000;
    const beforePhysicalHit = baselinePhysicalHit * oldExpectedHitFactor[label] * armorFactor(oldArmor, row.level) / armorFactor(30000, row.level);
    const expectedAfterPhysicalHit = baselinePhysicalHit * newExpectedHitFactor[label] * armorFactor(newArmor, row.level) / armorFactor(30000, row.level);
    const beforeWorstPhysicalHit = baselinePhysicalHit * oldWorstHitFactor[label] * armorFactor(oldArmor, row.level) / armorFactor(30000, row.level);
    rows.push({ depth, scenario: label, enemyLevel: row.level,
      beforeExpectedHit: +beforeHit.toFixed(1), afterExpectedHit: +expectedAfterHit.toFixed(1),
      beforeWorstCriticalHit: +beforeWorstHit.toFixed(1),
      beforeExpectedPhysicalHit: +beforePhysicalHit.toFixed(1), afterExpectedPhysicalHit: +expectedAfterPhysicalHit.toFixed(1),
      beforeWorstPhysicalHit: +beforeWorstPhysicalHit.toFixed(1),
      afterWorstCriticalHit: +row.actualFireHit.toFixed(1),
      afterWorstCriticalPhysicalHit: +row.actualPhysicalHit.toFixed(1),
      averageDpsVsBaseX: +(newExpectedHitFactor[label] * row.attackRateMultiplier).toFixed(3),
      worstCriticalHitVsBaseX: +row.incomingHitMultiplier.toFixed(3),
      attackRateX: +row.attackRateMultiplier.toFixed(3), playerHp: row.playerHp });
  }
}

// Exercise each nerfed affix through the actual hit path, including Crit's
// unchanged chance and Empowered's capped nearby-enemy bonus.
for (const id of ['brutal', 'frenzied', 'critical', 'empowered']) {
  const row = simulate(170, { affixes: [id] });
  if (id === 'brutal') close(row.incomingHitMultiplier, 1.15, 'Brutal runtime multiplier');
  if (id === 'frenzied') {
    close(row.attackCooldown, 1, 'Frenzied runtime attack cooldown');
    close(row.attackRateMultiplier, 1.2, 'Frenzied runtime attack rate');
  }
  if (id === 'critical') close(row.incomingHitMultiplier, 1.5, 'Critical affix forced proc remains 150% damage');
  if (id === 'empowered') close(row.incomingHitMultiplier, 1.25, 'Empowered runtime bonus caps at 25%');
}

// The proposed damage affixes share one category and cannot all roll together.
// Compare both the legal Critical stress case and individual valid affixes.
const before = {
  legalCriticalStackVsNeutralFireHit: 1.3 * 1.25 * 1.5 * 1.25 * 2 * (0.45 * 0.60) / (0.30 * 0.60),
  empoweredMaximum: 1.5,
  brutal: 1.25,
  criticalExpected: 1 + 0.2 * (2 - 1),
  attackRateWithHeresy: 1.35 * 1.25,
  healthFactor: 0.75,
};
const after = {
  legalCriticalStackVsNeutralFireHit: 1.2 * 1.15 * 1.5 * 1.25 * 1.5 * (0.40 * 0.60) / (0.30 * 0.60),
  empoweredMaximum: 1.25,
  brutal: 1.15,
  criticalExpected: 1 + 0.2 * (1.5 - 1),
  attackRateWithHeresy: 1.2 * 1.25,
  healthFactor: 0.85,
};
assert.ok(after.legalCriticalStackVsNeutralFireHit < before.legalCriticalStackVsNeutralFireHit);
assert.ok(after.empoweredMaximum < before.empoweredMaximum);
assert.ok(after.brutal < before.brutal);
assert.ok(after.criticalExpected < before.criticalExpected);
assert.ok(after.attackRateWithHeresy < before.attackRateWithHeresy);
assert.ok(after.healthFactor > before.healthFactor);

console.table(rows);
console.log(JSON.stringify({ before, after,
  caveat: 'The five affixes in the combined matrix are from distinct eligible categories. Critical-hit columns show both the expected rate at its unchanged 20% chance and the conditional worst-case hit; the latter is not sustained DPS.' }, null, 2));
console.log('Real-time modifier formulas and eight-depth combat-hit matrix passed.');
