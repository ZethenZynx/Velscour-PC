// Isolated regression checks for campaign progression, endgame scaling, gear eligibility, and the one-time save reset.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTS, FINAL_DEPTH, MAX_DEPTH, MAX_LEVEL, SUPERBOSS_DEPTHS, endgameScaling } from '../../src/data/depth.js';
import { RAID_BOSSES } from '../../src/game/raid.js';
import { RARITY, TIER_20_MIN_DEPTH, qualityAtDepth, sigilCap, RARITY_TIER_20 } from '../../src/data/items.js';
import { DUNGEON_AFFIX_BY_ID } from '../../src/data/dungeonaffixes.js';
import { GREED_LEVELS, greedMods, greedWorld, rollGreedAffixes, getGreedAffixPreview, setGreed } from '../../src/game/greed.js';
import { makeCovenant } from '../../src/data/relics.js';

assert.equal(FINAL_DEPTH, 100);
assert.equal(MAX_LEVEL, 100);
assert.equal(MAX_DEPTH, Number.MAX_SAFE_INTEGER);
assert.deepEqual(ACTS.map((a) => [a.start, a.end]), [[1, 25], [26, 50], [51, 75], [76, 100]]);
assert.equal(Object.keys(SUPERBOSS_DEPTHS).length, 20);
for (const [depth, id] of Object.entries(SUPERBOSS_DEPTHS)) {
  assert.equal(Number(depth) % 5, 0, `boss milestone ${depth} is not every five campaign depths`);
  if (id !== 'velscour') assert.ok(RAID_BOSSES.some((boss) => boss.id === id), `missing assigned campaign boss ${id}`);
}
assert.deepEqual([25, 50, 75, 100].map((depth) => SUPERBOSS_DEPTHS[depth]), ['colossus', 'sekhmun', 'hollowmere', 'velscour']);
for (let tier = 0; tier < RARITY.length; tier++) {
  const depth = 1 + tier * 25;
  assert.equal(RARITY[tier].minDepth, depth);
  assert.equal(qualityAtDepth(depth), tier);
  assert.equal(sigilCap(depth), tier);
  if (tier) assert.equal(qualityAtDepth(depth - 1), tier - 1);
}
assert.equal(TIER_20_MIN_DEPTH, 476);
assert.equal(makeCovenant(100, { depth: 100 }), null);
const setPiece = makeCovenant(476, { depth: 476 });
assert.equal(setPiece?.rarity, RARITY_TIER_20);
assert.ok(setPiece?.cset, 'endgame Set gear keeps its distinct set identity');
assert.deepEqual(GREED_LEVELS.map(({ level, name, affixes, goldPct, xpPct, lootPct }) => [level, name, affixes, goldPct, xpPct, lootPct]), [
  [0, 'Disabled', 0, 0, 0, 0], [1, 'Temptation', 1, 20, 10, 10], [2, 'Desire', 2, 45, 25, 20],
  [3, 'Avarice', 3, 75, 45, 35], [4, 'Obsession', 4, 110, 70, 50], [5, 'Insatiable', 5, 150, 100, 75],
]);
const gameUiSource = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
assert.match(gameUiSource, /class="greed-inline"/, 'Greed settings are embedded in the Portal to the Depths');
assert.match(gameUiSource, /class="greed-inline-range"/, 'the portal contains the 0-5 Greed selector');
assert.doesNotMatch(gameUiSource, /openGreedConfig|greed-open-config|greed-config-dialog/, 'the separate Greed popup is removed');
for (let level = 0; level <= 5; level++) {
  const ids = rollGreedAffixes(level, () => 0.25);
  assert.equal(ids.length, level, `Greed ${level} adds exactly ${level} affixes`);
  assert.equal(new Set(ids).size, ids.length, 'affixes cannot duplicate');
  assert.equal(new Set(ids.map((id) => DUNGEON_AFFIX_BY_ID[id].category)).size, ids.length, 'affixes use distinct compatible categories');
  assert.deepEqual(greedMods(level), {
    level, affixes: level, gold: GREED_LEVELS[level].goldPct / 100, xp: GREED_LEVELS[level].xpPct / 100, loot: GREED_LEVELS[level].lootPct / 100,
    goldPct: GREED_LEVELS[level].goldPct, xpPct: GREED_LEVELS[level].xpPct, lootPct: GREED_LEVELS[level].lootPct,
  });
}
const greedCharacter = { greedLevel: 5, greed: 0 };
assert.deepEqual(rollGreedAffixes(0), []);
assert.equal(setGreed(2, greedCharacter), 2);
assert.equal(greedCharacter.greedLevel, 2);
const previewCharacter = { greedLevel: 3 };
const fixedPreview = getGreedAffixPreview(previewCharacter, 101, 'catacombs');
assert.deepEqual(getGreedAffixPreview(previewCharacter, 101, 'catacombs'), fixedPreview, 'reopening the same preview does not reroll');
const alternatePreview = getGreedAffixPreview(previewCharacter, 101, 'catacombs', 4);
assert.deepEqual(getGreedAffixPreview(previewCharacter, 101, 'catacombs', 4), alternatePreview, 'changing Greed and reopening reuses the cached affix preview');
assert.ok(previewCharacter.greedAffixPreviews['101|catacombs|4'], 'preview cache is saved per depth, environment, and Greed level');
getGreedAffixPreview(previewCharacter, 101, 'moonwell_deep');
assert.equal(previewCharacter.greedAffixPreview.environment, 'moonwell_deep', 'a changed environment receives its own preview');
assert.deepEqual(getGreedAffixPreview(previewCharacter, 100, 'throne'), [], 'campaign depths receive no Greed affixes');
for (let level = 0; level <= 5; level++) {
  const world = { kind: 'dungeon', depth: 101, goldMul: 1, lootMul: 1 };
  greedWorld(world, { greedLevel: level });
  assert.equal(world.greedGoldPct, GREED_LEVELS[level].goldPct);
  assert.equal(world.greedXpPct, GREED_LEVELS[level].xpPct);
  assert.equal(world.greedLootPct, GREED_LEVELS[level].lootPct);
  assert.equal(world.goldMul, 1, 'Greed does not multiply existing gold reward modifiers');
  const snapshot = { ...world };
  greedWorld(world, { greedLevel: level });
  assert.deepEqual(world, snapshot, 'applying Greed twice does not stack rewards');
}
const campaignWorld = { kind: 'dungeon', depth: 100, goldMul: 1 };
assert.equal(greedWorld(campaignWorld, { greedLevel: 5 }), false, 'Greed has no campaign effect');
assert.equal(campaignWorld.greed, undefined);
for (const d of [101, 125, 500, 10000, MAX_DEPTH]) {
  const s = endgameScaling(d);
  assert.ok(Number.isFinite(s.health) && s.health >= 1 && s.health <= 1e100);
  assert.ok(Number.isFinite(s.damage) && s.damage >= 1 && s.damage <= 1e20);
}
assert.ok(endgameScaling(500).health > endgameScaling(500).damage);
assert.ok(endgameScaling(MAX_DEPTH).health > endgameScaling(500).health);

class MemoryStorage {
  data = new Map();
  failKey = null;
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { if (this.failKey === key) { this.failKey = null; throw new Error('simulated storage failure'); } this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  key(index) { return [...this.data.keys()][index] ?? null; }
  get length() { return this.data.size; }
}
globalThis.localStorage = new MemoryStorage();
globalThis.dispatchEvent = () => true;
const { applyCampaignOverhaulReset, campaignOverhaulBackup, listSaves, newCharData, migrate } = await import('../../src/game/save.js?campaign-overhaul-test');
const storage = globalThis.localStorage;
const oldGreedSave = newCharData('paladin', 'Greed Migration');
oldGreedSave.depth = 500;
oldGreedSave.greed = 3;
oldGreedSave.dungeonAffixes = rollGreedAffixes(5);
oldGreedSave.affixStreak = 40;
oldGreedSave.greedAffixPreviews = { '101|catacombs|3': rollGreedAffixes(3), '100|throne|3': rollGreedAffixes(3) };
oldGreedSave.greedPortalDestinations = { 101: 'catacombs', 100: 'throne' };
delete oldGreedSave.greedSystemV1;
delete oldGreedSave.greedLevel;
migrate(oldGreedSave);
assert.equal(oldGreedSave.greedLevel, 3);
assert.equal(oldGreedSave.dungeonAffixes.length, 3, 'one-time migration converts old affix progression to selected Greed level');
assert.equal(oldGreedSave.affixStreak, undefined, 'the old automatic progression counter is retired');
assert.equal(oldGreedSave.greedAffixPreview.ids.length, 3, 'migration preserves the active affix set as a stable saved preview');
assert.equal(oldGreedSave.greedAffixPreviews['101|catacombs|3'].length, 3, 'migration preserves eligible Greed preview caches');
assert.equal(oldGreedSave.greedAffixPreviews['100|throne|3'], undefined, 'migration discards campaign Greed previews');
assert.equal(oldGreedSave.greedPortalDestinations['101'], 'catacombs', 'migration preserves the planned portal environment');
const migratedAffixes = [...oldGreedSave.dungeonAffixes];
migrate(oldGreedSave);
assert.deepEqual(oldGreedSave.dungeonAffixes, migratedAffixes, 'save loading does not reroll migrated active affixes');
const campaignGreedSave = newCharData('paladin', 'Campaign Greed Migration');
campaignGreedSave.depth = 100;
campaignGreedSave.greed = 5;
campaignGreedSave.dungeonAffixes = rollGreedAffixes(5);
delete campaignGreedSave.greedSystemV1;
delete campaignGreedSave.greedLevel;
migrate(campaignGreedSave);
assert.equal(campaignGreedSave.greedLevel, 5, 'preferred Greed setting remains saved during campaign');
assert.deepEqual(campaignGreedSave.dungeonAffixes, [], 'campaign saves cannot retain active Greed affixes');
storage.setItem('velscour_saves_v1', '[{"id":"old"}]');
storage.setItem('velscour_endgame_v1', '{"unlocked":1}');
storage.setItem('velscour_reliquary_v1', '{"items":[1]}');
storage.setItem('velscour_bard_heard', '["song"]');
storage.setItem('velscour_taunts_v1', '{"seen":1}');
storage.setItem('velscour_settings_v1', '{"volume":0.4}');
assert.equal(applyCampaignOverhaulReset(), true);
assert.deepEqual(listSaves(), []);
assert.equal(storage.getItem('velscour_endgame_v1'), null);
assert.equal(storage.getItem('velscour_reliquary_v1'), null);
assert.equal(storage.getItem('velscour_bard_heard'), null);
assert.equal(storage.getItem('velscour_taunts_v1'), null);
assert.equal(storage.getItem('velscour_settings_v1'), '{"volume":0.4}');
assert.equal(campaignOverhaulBackup().saves, '[{"id":"old"}]');
storage.setItem('velscour_saves_v1', '[{"id":"new"}]');
assert.equal(applyCampaignOverhaulReset(), true);
assert.equal(storage.getItem('velscour_saves_v1'), '[{"id":"new"}]', 'successful reset runs only once');

// A separate module instance and storage simulate a failure during clearing; the snapshot must be restored.
globalThis.localStorage = new MemoryStorage();
const rollbackStore = globalThis.localStorage;
rollbackStore.setItem('velscour_saves_v1', '[{"id":"keep"}]');
rollbackStore.failKey = 'velscour_saves_v1';
const resetModule = await import('../../src/game/save.js?campaign-overhaul-rollback-test');
assert.equal(resetModule.applyCampaignOverhaulReset(), false);
assert.equal(rollbackStore.getItem('velscour_saves_v1'), '[{"id":"keep"}]');
assert.equal(rollbackStore.getItem('velscour_campaign_overhaul_reset_v1'), null);

console.log('Campaign progression, tier eligibility, Greed levels/rewards/migrations, safe scaling, and isolated reset checks OK');
