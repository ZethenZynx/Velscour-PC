import test from 'node:test';
import assert from 'node:assert/strict';
import { CHEST_RARITIES } from '../../src/data/treasurechests.js';
import {
  NATURAL_SIGIL_DROP_SCALE, canDropNaturalSigil, naturalSigilDropChance,
  naturalSigilDropLevelKey, recordNaturalSigilDrop,
} from '../../src/game/sigildrops.mjs';

const ENEMY_CHANCES = { normal: 0.004, champion: 0.03, unique: 0.08, boss: 0.45 };
const CHEST_CHANCES = CHEST_RARITIES.map((rarity) => rarity.sigilChance);
function rng(seed) { return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }; }
function int(random, lo, hi) { return lo + Math.floor(random() * (hi - lo + 1)); }
function chestChance(random) {
  const total = CHEST_RARITIES.reduce((sum, row) => sum + row.weight, 0);
  let roll = random() * total;
  return CHEST_RARITIES.find((row) => (roll -= row.weight) < 0)?.sigilChance ?? CHEST_CHANCES[0];
}
function worldFor(mode, depth, index) {
  const biome = { id: ['catacombs', 'crypt', 'fungal_grotto', 'bone_desert'][index % 4] };
  if (mode === 'rift') return { kind: 'dungeon', depth: 100, biome, rift: { tier: index + 1 }, riftSeed: 50000 + index };
  if (mode === 'breach') return { kind: 'dungeon', depth, biome, breach: { floor: index + 1, seed: 70000 + index } };
  return { kind: 'dungeon', depth, biome };
}
function sourceEvents(mode, random, index) {
  if (mode === 'rift') return { enemies: [], chests: int(random, 3, 6), sigilImp: false, artisanImp: false };
  const endgame = mode === 'infinite';
  const greed = endgame ? index % 6 : 0;
  const pop = 1 + greed * 0.12;
  return {
    enemies: [
      ['normal', Math.round(int(random, 55, 80) * pop)],
      ['champion', int(random, 6, 10) + (endgame ? greed : 0)],
      ['unique', int(random, 1, 3) + (endgame && index % 4 === 3 ? 1 : 0)],
      ['boss', 1],
    ],
    chests: int(random, 2, 4),
    sigilImp: random() < 0.025,
    artisanImp: random() < 0.012,
  };
}
function statsFor(mode, index) {
  if (mode !== 'infinite') return {};
  const heresyRank = [0, 20, 40, 60, 75][index % 5];
  return { world: { sigilMul: 1 + 0.05 * heresyRank, lootMul: 1 }, stats: { markSigilChance: index % 3 === 2 ? 100 : 0 } };
}
function simulate(mode, scale = NATURAL_SIGIL_DROP_SCALE) {
  const random = rng({ campaign: 0x51a11, infinite: 0x51a12, rift: 0x51a13, breach: 0x51a14 }[mode]);
  let oldDrops = 0, adjustedDrops = 0, cappedLevels = 0;
  for (let i = 0; i < 1000; i++) {
    const depth = mode === 'campaign' ? [1, 26, 51, 76, 100][i % 5]
      : mode === 'infinite' ? [101, 150, 250, 500, 1000][i % 5]
        : mode === 'rift' ? i % 100 + 1
          : [1, 10, 25, 40, 50][i % 5] * 10;
    const world = worldFor(mode, depth, i);
    const { enemies, chests, sigilImp, artisanImp } = sourceEvents(mode, random, i);
    const { world: worldMods = {}, stats = {} } = statsFor(mode, i);
    Object.assign(world, worldMods);
    const char = { sigilDropLevels: [] };
    const hit = (base, qty = 1) => {
      const oldChance = Math.min(1, base * (world.sigilMul || 1) * (world.lootMul || 1) * (1 + (stats.markSigilChance || 0) / 100) * (world.breach ? 1 + (stats.markBreachRewards || 0) / 100 : 1));
      if (random() < oldChance) oldDrops += qty;
      if (canDropNaturalSigil(world, char) && random() < naturalSigilDropChance(base, world, stats, { includeBreachReward: true }) * (scale / NATURAL_SIGIL_DROP_SCALE)) {
        adjustedDrops += 1;
        recordNaturalSigilDrop(world, char);
      }
    };
    for (const [rank, count] of enemies) for (let j = 0; j < count; j++) hit(ENEMY_CHANCES[rank]);
    for (let j = 0; j < chests; j++) if (random() < 0.89) hit(chestChance(random));
    if (sigilImp) hit(1, 1.5);
    if (artisanImp) hit(1, 3);
    cappedLevels = adjustedDrops;
    assert.ok(char.sigilDropLevels.length <= 1, `${mode} level ${i} exceeded its one-Sigil cap`);
  }
  return { oldPer100: oldDrops / 10, newPer100: adjustedDrops / 10 };
}

test('natural drop probabilities use the final tuned 5% rate after bonuses', () => {
  for (const base of [...Object.values(ENEMY_CHANCES), ...CHEST_CHANCES]) {
    assert.equal(naturalSigilDropChance(base), base * NATURAL_SIGIL_DROP_SCALE);
  }
  assert.equal(naturalSigilDropChance(0.45, { sigilMul: 8 }), NATURAL_SIGIL_DROP_SCALE, 'bonuses cannot turn an individual roll into more than 5%');
});

test('level identifiers persist across re-entry and separate new Rift/Breach instances', () => {
  const char = { sigilDropLevels: [] };
  const first = { kind: 'dungeon', depth: 135, biome: { id: 'crypt' } };
  const reentry = { kind: 'dungeon', depth: 135, biome: { id: 'crypt' } };
  assert.equal(naturalSigilDropLevelKey(first), naturalSigilDropLevelKey(reentry));
  assert.equal(recordNaturalSigilDrop(first, char), true);
  assert.equal(canDropNaturalSigil(reentry, char), false);
  const reloadedChar = JSON.parse(JSON.stringify(char));
  assert.equal(canDropNaturalSigil(reentry, reloadedChar), false, 'the cap survives a character save/load');
  assert.equal(canDropNaturalSigil({ kind: 'dungeon', depth: 136, biome: { id: 'crypt' } }, reloadedChar), true, 'a new depth is eligible');
  assert.notEqual(naturalSigilDropLevelKey({ kind: 'dungeon', depth: 100, biome: { id: 'crypt' }, rift: { tier: 2 }, riftSeed: 10 }), naturalSigilDropLevelKey({ kind: 'dungeon', depth: 100, biome: { id: 'crypt' }, rift: { tier: 2 }, riftSeed: 11 }));
  assert.notEqual(naturalSigilDropLevelKey({ kind: 'dungeon', depth: 100, biome: { id: 'crypt' }, breach: { floor: 2, seed: 10 } }), naturalSigilDropLevelKey({ kind: 'dungeon', depth: 100, biome: { id: 'crypt' }, breach: { floor: 3, seed: 10 } }));
});

test('simulates 1,000 eligible levels per mode and enforces one random Sigil maximum per level', () => {
  const results = Object.fromEntries(['campaign', 'infinite', 'rift', 'breach'].map((mode) => [mode, simulate(mode)]));
  console.log('SIGIL_SIMULATION_PER_100_LEVELS', JSON.stringify(results));
  for (const result of Object.values(results)) assert.ok(result.newPer100 <= 100);
});

test('guaranteed quest and progression Sigils remain on their existing reward paths', async () => {
  const { readFile } = await import('node:fs/promises');
  const [commissions, rifts, velscour] = await Promise.all([
    readFile(new URL('../../src/game/commissions.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/game/rifts.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/game/velscour.js', import.meta.url), 'utf8'),
  ]);
  assert.match(commissions, /rollGroundSigil\(G\.world, depth, 1\)/);
  assert.match(rifts, /rollGroundSigil\(world, lootDepth, RW\.sigilBonus\)/);
  assert.match(velscour, /rollGroundSigil\(w, sigilDepth, 2\)/);
  assert.equal(NATURAL_SIGIL_DROP_SCALE, 0.05);
});
