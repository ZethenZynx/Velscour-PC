// Non-browser regression coverage for the 30-modifier / 75-rank Heresy system.
// Run with: node tools/tests/heresy_expansion.mjs
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';
import { generateDungeon } from '../../src/world/dungeon.js';
import { HERESIES, HERESY_BY_ID, HERESY_MAX_RANK, HERESY_MILESTONES, heresyMods, heresyRank } from '../../src/data/heresies.js';
import {
  heresyAbilityCostMul, heresyCooldownMul, heresyHero, heresyMonster,
  heresyShrineDurationMul, heresySpawns, heresyWorld, rollHeresyEncounters,
} from '../../src/game/heresies.js';

const original = ['twins','crowned','thirst','fifth','legion','iron','cruel','ambush','omens','glass','hunger','gaze'];
assert.equal(HERESIES.length, 30);
assert.equal(HERESY_MAX_RANK, 75);
assert.equal(heresyRank(HERESIES.map((h) => h.id)), 75);
assert.deepEqual(HERESIES.slice(0, 12).map((h) => h.id), original);
assert.deepEqual(HERESY_MILESTONES.map((m) => m.rank), [10, 20, 30, 40, 50, 60, 75]);
for (const h of HERESIES) {
  assert.ok(h.name && h.desc && h.color && h.rank > 0, `complete modifier definition for ${h.id}`);
  assert.equal(HERESY_BY_ID[h.id], h, `id index for ${h.id}`);
}

const expected = [
  [0, 0, 1, 1, 1, 1, 1],
  [10, 40, 1.4, 1.2, 1.2, 1.5, 1.4],
  [20, 80, 1.8, 1.4, 1.4, 2, 1.8],
  [26, 104, 2.04, 1.52, 1.52, 2.3, 2.04],
  [30, 120, 2.2, 1.6, 1.6, 2.5, 2.2],
  [40, 160, 2.6, 1.8, 1.8, 3, 2.6],
  [50, 200, 3, 2, 2, 3.5, 3],
  [60, 240, 3.4, 2.2, 2.2, 4, 3.4],
  [75, 300, 4, 2.5, 2.5, 4.75, 4],
];
for (const [rank, mf, gold, loot, xp, sigil, relic] of expected) {
  assert.deepEqual(heresyMods(rank), { mf, gold, loot, xp, sigil, relic }, `reward formula at rank ${rank}`);
}
assert.equal(heresyMods(100).loot, heresyMods(75).loot, 'display and effects cap at the computed maximum rank');

// Verify deterministic threshold behavior and the four independent encounter odds.
const all = rollHeresyEncounters(75, () => 0.01);
assert.deepEqual(all, { bounty: true, hunt: true, sanctum: true, retribution: true });
assert.deepEqual(rollHeresyEncounters(29, () => 0), { bounty: false, hunt: false, sanctum: false, retribution: false });
let seed = 0x71c3a125;
const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const n = 100000, totals = { bounty: 0, hunt: 0, sanctum: 0, retribution: 0 };
for (let i = 0; i < n; i++) for (const [key, value] of Object.entries(rollHeresyEncounters(75, rng))) if (value) totals[key]++;
for (const [key, chance] of Object.entries({ bounty: 0.15, hunt: 0.20, sanctum: 0.10, retribution: 0.05 })) {
  assert.ok(Math.abs(totals[key] / n - chance) < 0.003, `${key} simulation is within 0.3 percentage points`);
}

// Sanctums and the Throne share the generated infernal fortress base. Check the
// actual collision graph at challenge depths and verify there are reachable,
// player-sized cells for all guardian encounters without movement skills.
const directions = ['NE', 'SE', 'SW', 'NW'], masks = {};
for (let mask = 0; mask < 16; mask++) masks[mask] = [directions.filter((_, bit) => mask & (1 << bit)).map((arm) => ({ arm, ox: 0, oy: 0 }))];
const tileset = { split: 0, bases: [0], features: [0], floors: [{ lum: 0, name: 'test floor' }],
  walls: { mock: masks }, families: ['mock'], scatter: [], pack: 'hell', k: 1, arches: {}, doors: {}, archSpan: {} };
const infernalBiome = BIOME_BY_ID.hell || BIOME_BY_ID.obsidian;
assert.ok(infernalBiome, 'infernal challenge biome exists');
for (let seed = 1; seed <= 100; seed++) {
  const gen = generateDungeon(101 + seed, infernalBiome, tileset, (seed * 0x9e3779b1) >>> 0);
  const reach = gen.map.movementReachable(gen.start, 0.24);
  assert.ok(gen.map.movementCanReach(gen.start, gen.exit, 0.24, reach), `challenge exit reachable by walking, seed ${seed}`);
  for (const spawn of gen.spawns || []) if (['boss', 'raid'].includes(spawn.rank)) {
    assert.ok(gen.map.movementCanReach(gen.start, [spawn.x, spawn.y], 0.24, reach) || gen.map.nearestReachableStand?.(reach, [spawn.x, spawn.y]), `challenge boss reachable by walking, seed ${seed}`);
  }
  const candidates = [];
  for (let i = 0; i < reach.length; i++) if (reach[i]) {
    const x = i % gen.map.w + 0.5, y = Math.floor(i / gen.map.w) + 0.5;
    if (Math.hypot(x - gen.start[0], y - gen.start[1]) >= 4 && gen.map.circleFree(x, y, 0.5)) candidates.push([x, y]);
  }
  assert.ok(candidates.length >= 4, `four walkable guardian positions available, seed ${seed}`);
}

// Population effects preserve bosses and increase only the intended pack members.
const baseSpawns = Array.from({ length: 24 }, (_, i) => ({ arch: 'demon', n: 2, rank: i === 0 ? 'boss' : i === 1 ? 'raid' : 'normal', x: i, y: i }));
const scaled = heresySpawns(baseSpawns, ['twins', 'champions_dominion', 'rare_convergence']);
assert.equal(scaled[0].n, 2, 'boss count is not doubled');
assert.equal(scaled[1].n, 2, 'raid count is not doubled');
assert.ok(scaled.slice(2, 24).every((s) => s.n === 4), 'ordinary packs double under Twinned Packs');
assert.ok(scaled.filter((s) => s.rank === 'unique').length >= 2, 'Rare Convergence adds scheduled unique packs');
assert.ok(scaled.some((s) => s.champ), 'Champion Dominion marks scheduled packs');

// Build a minimal active dungeon and check each hero/enemy modifier reaches its real dial.
const allIds = HERESIES.map((h) => h.id);
const character = { heresy: { on: allIds } };
G.char = character;
G.world = { kind: 'dungeon', depth: 120, heresy: { ids: allIds, rank: 75 } };
assert.deepEqual(heresyHero(character), { life: -25, dmg: 15, armorMul: 0.8, resPenalty: 15, healingMul: 0.6 });
assert.equal(heresyAbilityCostMul(character, G.world), 1.25);
assert.equal(heresyCooldownMul(character, G.world), 1.2);
assert.equal(heresyShrineDurationMul(character, G.world), 0.5);
const monster = { team: 'enemy', rank: 'normal', maxHp: 100, hp: 100, dmg: 10, speed: 2, atkCd: 1.2, affixes: [] };
heresyMonster(monster, allIds);
assert.equal(monster.heresyRegen, 0.01);
assert.equal(monster.heresyAttackRate, 1.25);
assert.equal(monster.speed, 2.6);
assert.equal(monster.heresyDamageReduction, 0.2);
assert.equal(monster.heresyIds, allIds);
const once = { kind: 'dungeon', depth: 120, environmentTrapSeed: 7123, xpBonusPct: 10, mfAdd: 3, sigilMul: 1.1, relicMul: 1.2,
  heresy: { ids: ['legion', 'hostile_terrain'], rank: 5 }, addLoot() {} };
heresyWorld(once, character);
const afterFirst = { xp: once.xpBonusPct, mf: once.mfAdd, sigil: once.sigilMul, relic: once.relicMul };
heresyWorld(once, character);
assert.deepEqual({ xp: once.xpBonusPct, mf: once.mfAdd, sigil: once.sigilMul, relic: once.relicMul }, afterFirst, 'reapplying world setup cannot compound reward dials');
assert.equal(once.heresyTrapIntervalMul, 0.75);

console.log('Heresy expansion: 30 modifiers, 75-rank cap, milestone reward formulas, encounter probabilities, walkable infernal challenge layouts, pack scaling, combat dials, and idempotent world setup passed.');
