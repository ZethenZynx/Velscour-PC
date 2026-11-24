import assert from 'node:assert/strict';
import { G } from '../../src/state.js';

const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => data.set(key, String(value)),
  removeItem: (key) => data.delete(key),
  key: (index) => [...data.keys()][index] ?? null,
  get length() { return data.size; },
};
data.set('velscour_campaign_overhaul_reset_v1', '1');
data.set('velscour_endgame_v1', JSON.stringify({
  marksResetVersion: 2, unlocked: 0, markXpMigrationV1: false,
  marks: { pts: 10, xp: 42, spentValue: 0, spent: {}, rewardRemainder: 0 },
}));

const { MAX_LEVEL, xpToNext, Player } = await import('../../src/game/player.js');
const Marks = await import('../../src/game/marks.js');
const Endgame = await import('../../src/game/endgame.js');
const Save = await import('../../src/game/save.js');
G.settings = {};
G.ui = { event() {}, refresh() {}, log() {} };
G.world = { kind: 'town', depth: 1 };
const hero = { id: 'progress-hero', name: 'Progress Hero', level: MAX_LEVEL, xp: 0, depth: 503, deepest: 502, experienceMarks: { earned: 0, xp: 0 } };
G.char = hero;
G.player = { x: 2, y: 3, recompute() {} };

assert.equal(Marks.markXp(0), xpToNext(MAX_LEVEL), 'the first Mark continues the level-100 XP curve');
for (let earned = 0; earned < 100; earned++) {
  assert.ok(Marks.markXp(earned + 1) > Marks.markXp(earned), `cost rises after experience-earned Mark ${earned + 1}`);
}
assert.equal(Marks.prepareCharacterMarkProgress(hero).xp, 42, 'legacy shared XP remainder is preserved for one level-100 hero');
assert.equal(Endgame.endgame().marks.xp, 0, 'legacy shared remainder is cleared after transfer');
assert.equal(Endgame.endgame().markXpMigrationV1, true, 'legacy remainder transfer is recorded once');
Marks.prepareCharacterMarkProgress(hero);
assert.equal(hero.experienceMarks.xp, 42, 're-entering does not duplicate migrated XP');

const firstCost = Marks.markXp(0);
assert.equal(Marks.gainMarkXp(firstCost - 42, G.world, hero), 1, 'level-100 XP earns Marks before Velscour or the Altar is unlocked');
assert.equal(hero.experienceMarks.earned, 1, 'experience-earned lifetime count is per character');
assert.equal(hero.experienceMarks.xp, 0, 'exact threshold consumes exactly its requirement');
assert.equal(hero.level, MAX_LEVEL, 'virtual Mark levels never raise the character level');
assert.equal(hero.depth, 503, 'earning Infernal Marks never changes current dungeon depth');
assert.equal(hero.deepest, 502, 'earning Infernal Marks never changes completed-depth progression');
assert.equal(Endgame.endgame().marks.pts, 11, 'earned XP Mark is added to the existing account-wide currency');

const nextNeed = Marks.markXp(1), thirdNeed = Marks.markXp(2);
assert.ok(nextNeed > firstCost && thirdNeed > nextNeed, 'virtual levels keep increasing after the character level cap');
assert.equal(Marks.gainMarkXp(nextNeed + thirdNeed + 7, G.world, hero), 2, 'one large award can cross multiple rising thresholds');
assert.equal(hero.experienceMarks.earned, 3, 'both threshold crossings count toward this character lifetime');
assert.equal(hero.experienceMarks.xp, 7, 'experience beyond the final threshold is retained');
assert.equal(hero.depth, 503, 'multi-Mark virtual XP awards remain independent of dungeon depth');
assert.equal(hero.deepest, 502, 'multi-Mark virtual XP awards remain independent of completed depth');
assert.equal(Marks.capXp(hero).need, Marks.markXp(3), 'the HUD-facing progress uses the next virtual level');

const secondHero = { id: 'second-hero', name: 'Second Hero', level: 99, xp: xpToNext(99) - 10, experienceMarks: { earned: 0, xp: 0 } };
G.char = secondHero;
G.world = { kind: 'dungeon', depth: 100 };
const player = Object.create(Player.prototype);
player.char = secondHero;
player.world = G.world;
player.st = { xpPct: 0 };
player.levelUp = function () { this.char.level++; };
G.player = player;
player.gainXp(14, true);
assert.equal(secondHero.level, 100, 'normal leveling remains capped at 100');
assert.equal(secondHero.xp, 0, 'excess character XP is moved into post-cap progress');
assert.equal(secondHero.experienceMarks.xp, 4, 'overflow at the level-100 transition is carried forward');
assert.equal(secondHero.experienceMarks.earned, 0, 'a different hero starts its own experience-earned count');

G.char = hero;
G.player = { x: 2, y: 3, recompute() {} };
G.world = { kind: 'dungeon', depth: 101 };
Endgame.endgame().unlocked = Date.now();
const walletBeforeUnlockedXp = Marks.marksTotal();
assert.equal(Marks.gainMarkXp(Marks.markXp(3) - hero.experienceMarks.xp, G.world, hero), 1, 'XP progression remains active after the Altar unlocks');
assert.equal(Marks.marksTotal(), walletBeforeUnlockedXp + 1, 'experience-earned currency remains account-wide after unlocking');
assert.equal(hero.experienceMarks.earned, 4, 'post-unlock XP advances only this hero counter');
assert.equal(Marks.grantMarks(2, 'Rift reward', G.world), 2, 'non-XP sources still grant account-wide Marks');
assert.equal(hero.experienceMarks.earned, 4, 'non-XP rewards do not raise the virtual level');
const beforeSpend = hero.experienceMarks.earned;
assert.equal(Marks.purchaseUpgrade('might', 1), 1, 'currency can still be spent on upgrades');
assert.ok(Marks.refundUpgrade('might', 1), 'upgrade refund remains available');
assert.equal(hero.experienceMarks.earned, beforeSpend, 'spending and refunding do not change XP progression');

assert.equal(Save.writeSave(hero), true, 'character progression saves normally');
const saved = JSON.parse(data.get('velscour_saves_v1')).find((entry) => entry.id === hero.id);
assert.deepEqual(saved.experienceMarks, hero.experienceMarks, 'lifetime count and XP remainder persist in the character save');
assert.equal(saved.depth, 503, 'save writes keep campaign depth separate from virtual Mark progress');
assert.equal(saved.deepest, 502, 'save writes keep completed depth separate from virtual Mark progress');
const legacyShape = Save.newCharData('ranger', 'Migration Hero');
legacyShape.id = 'migration-hero';
legacyShape.level = MAX_LEVEL;
legacyShape.depth = 503;
legacyShape.deepest = 502;
legacyShape.experienceMarks = JSON.parse(JSON.stringify(saved.experienceMarks));
const restored = Save.migrate(legacyShape);
assert.deepEqual(restored.experienceMarks, hero.experienceMarks, 'save migration preserves the new per-character fields');
assert.equal(restored.depth, 503, 'save migration preserves independently stored campaign depth');
assert.equal(restored.deepest, 502, 'save migration preserves independently stored completed depth');
assert.equal(Marks.capXp(restored).earned, 4, 'restored character retains its lifetime display value');
for (const virtualEarned of [1000, 1e6, 1e12, Number.MAX_SAFE_INTEGER]) {
  assert.ok(Number.isFinite(Marks.markXp(virtualEarned)) && Marks.markXp(virtualEarned) > 0, `XP remains finite at virtual rank ${virtualEarned}`);
}
const largeRewardHero = { id: 'large-reward-hero', name: 'Large Reward Hero', level: MAX_LEVEL, xp: 0, experienceMarks: { earned: 0, xp: 0 } };
G.char = largeRewardHero; G.player = { x: 0, y: 0, recompute() {} };
const largeAward = Marks.gainMarkXp(1e30, G.world, largeRewardHero);
assert.ok(largeAward > 50000 && Number.isFinite(largeRewardHero.experienceMarks.xp), 'very large XP rewards are processed without per-Mark runaway loops or non-finite progress');
assert.ok(largeRewardHero.experienceMarks.xp < Marks.markXp(largeRewardHero.experienceMarks.earned), 'large rewards retain a remainder below the next rising requirement');
G.char = hero;

const milestones = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000];
const table = milestones.map((target) => {
  let cumulative = 0n;
  for (let i = 0; i < target; i++) cumulative += BigInt(xpToNext(MAX_LEVEL + i));
  return { mark: target, individualXP: xpToNext(MAX_LEVEL + target - 1), cumulativeXP: cumulative.toString() };
});
console.log('Post-level-100 Infernal Mark XP milestone table:');
console.table(table);
console.log('Infernal Mark per-character scaling, pre-Altar earning, overflow, multi-awards, migration, wallet independence and save/load passed.');
