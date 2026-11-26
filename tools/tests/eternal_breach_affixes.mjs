import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getEndgameDungeonAffixes, setGreed } from '../../src/game/greed.js';
import { G } from '../../src/state.js';
import { accountHeresySelection, campaignVictoryRecorded, resetEndgameCache, saveAccountHeresySelection, unlockEndgame } from '../../src/game/endgame.js';
import { heresyBegin, heresyWorld, setHeresy } from '../../src/game/heresies.js';
import { HERESIES } from '../../src/data/heresies.js';
import { applyDungeonAffix, DUNGEON_AFFIX_BY_ID, normalizeDungeonAffixIds } from '../../src/data/dungeonaffixes.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

test('Eternal Breach gets no random dungeon affixes before Infinite Endgame eligibility', () => {
  const locked = { greedLevel: 5 };
  assert.deepEqual(getEndgameDungeonAffixes(locked, 110, 'eternal_breach'), []);
  const unlocked = { greedLevel: 5, cleared: { 100: true } };
  assert.deepEqual(getEndgameDungeonAffixes(unlocked, 100, 'eternal_breach'), []);
});

test('Eternal Breach affixes reuse the saved Infinite Endgame Greed roll and count', () => {
  const character = { cleared: { 100: true }, greedAffixPreviews: {} };
  for (let level = 0; level <= 5; level++) {
    setGreed(level, character);
    const first = getEndgameDungeonAffixes(character, 130, 'eternal_breach');
    const reopened = getEndgameDungeonAffixes(character, 130, 'eternal_breach');
    assert.equal(first.length, level, `Greed ${level} affix count`);
    assert.deepEqual(reopened, first, `Greed ${level} reuses its selected floor affixes`);
    assert.deepEqual(normalizeDungeonAffixIds(first), first);
    assert.ok(first.every((id) => DUNGEON_AFFIX_BY_ID[id]?.implemented), 'all selected affixes are implemented');
  }
});

test('Breach Heresy respects account unlock and provides the account selection to a new hero', () => {
  globalThis.localStorage = new MemoryStorage();
  resetEndgameCache();
  assert.equal(campaignVictoryRecorded(), false);
  const preUnlock = { heresy: { on: ['iron'] } };
  const lockedWorld = { kind: 'dungeon' };
  assert.deepEqual(heresyBegin(lockedWorld, preUnlock, { accountWide: true }), []);
  assert.deepEqual(lockedWorld.heresy.ids, []);

  assert.equal(unlockEndgame(), true);
  const veteran = { heresy: { on: [] } };
  assert.equal(setHeresy('twins', true, veteran), true);
  assert.deepEqual(accountHeresySelection(), ['twins']);
  const newHero = { heresy: { on: [] } };
  const breach = { kind: 'dungeon' };
  assert.deepEqual(heresyBegin(breach, newHero, { accountWide: true }), ['twins']);
  assert.equal(breach.heresy.rank, 3);
});

test('a hero can retain a personal selection or explicitly renounce the account default', () => {
  globalThis.localStorage = new MemoryStorage();
  resetEndgameCache();
  unlockEndgame();
  saveAccountHeresySelection(['twins']);
  const personal = { heresy: { on: ['iron'], configured: true } };
  assert.deepEqual(heresyBegin({ kind: 'dungeon' }, personal, { accountWide: true }), ['iron']);
  const renounced = { heresy: { on: [], configured: true } };
  assert.deepEqual(heresyBegin({ kind: 'dungeon' }, renounced, { accountWide: true }), []);
  G.char = null;
});

test('legacy altar selections migrate from a saved veteran for a newly created hero', () => {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  resetEndgameCache();
  unlockEndgame();
  storage.setItem('velscour_saves_v1', JSON.stringify([
    { id: 'veteran', lastPlayed: 10, heresy: { on: ['iron', 'twins'] } },
    { id: 'new-hero', lastPlayed: 20, heresy: { on: [] } },
  ]));
  const world = { kind: 'dungeon' };
  assert.deepEqual(heresyBegin(world, { id: 'new-hero', heresy: { on: [] } }, { accountWide: true }), ['iron', 'twins']);
  assert.deepEqual(accountHeresySelection(), ['iron', 'twins']);
});

test('maximum account Heresy applies difficulty and all reward dials once in a Breach world', () => {
  globalThis.localStorage = new MemoryStorage();
  resetEndgameCache();
  unlockEndgame();
  saveAccountHeresySelection(HERESIES.map((entry) => entry.id));
  const hero = { heresy: { on: [] } };
  const world = { kind: 'dungeon', addLoot() {} };
  heresyBegin(world, hero, { accountWide: true });
  heresyWorld(world, hero);
  const first = { xp: world.xpBonusPct, mf: world.mfAdd, loot: world.heresyLootPct, gold: world.heresyGoldPct, sigil: world.sigilMul, relic: world.relicMul };
  assert.equal(world.heresy.rank, 75);
  assert.ok(first.xp > 0 && first.mf > 0 && first.loot > 0 && first.gold > 0 && first.sigil > 1 && first.relic > 1);
  heresyWorld(world, hero);
  assert.deepEqual({ xp: world.xpBonusPct, mf: world.mfAdd, loot: world.heresyLootPct, gold: world.heresyGoldPct, sigil: world.sigilMul, relic: world.relicMul }, first, 'reward dials are not applied twice');
});

test('the installed dungeon affix path modifies enemies and is wired into Breach setup and presentation', () => {
  const enemy = { team: 'enemy', dead: false, rank: 'normal', maxHp: 100, hp: 100, dmg: 10, speed: 1, affixes: [], res: {} };
  assert.equal(applyDungeonAffix(enemy, 'fortified'), true);
  assert.equal(applyDungeonAffix(enemy, 'fortified'), false, 'the same affix cannot be applied twice');
  assert.equal(enemy.maxHp, 130);
  assert.ok(enemy.dungeonAffixIds.includes('fortified'));
  const source = readFileSync(new URL('../../src/game/game.js', import.meta.url), 'utf8');
  const breach = source.slice(source.indexOf('  buildBreach('), source.indexOf('  /** A cleared Breach floor exits'));
  assert.match(breach, /getEndgameDungeonAffixes\(c, depth, B\.id\)/);
  assert.match(breach, /applyDungeonAffixWorldEffects\(world\)/);
  assert.match(breach, /heresyBegin\(world, c, \{ accountWide: true \}\)/);
  assert.match(breach, /announceDungeonAffixes\(world\)/);
  assert.match(breach, /HUD\.setArea\([^\n]+world\.dungeonAffixes/);
  assert.match(readFileSync(new URL('../../src/game/world.js', import.meta.url), 'utf8'), /if \(Array\.isArray\(this\.dungeonAffixes\)\) for \(const id of this\.dungeonAffixes\) applyDungeonAffix\(c, id\)/);
});
