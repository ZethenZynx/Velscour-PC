import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  key: (index) => [...storage.keys()][index] ?? null,
  get length() { return storage.size; },
};
storage.set('velscour_campaign_overhaul_reset_v1', '1');
storage.set('velscour_endgame_v1', JSON.stringify({ marksResetVersion: 2, unlocked: 0, marks: { pts: 0, spent: {} } }));

const Endgame = await import('../../src/game/endgame.js');
const Save = await import('../../src/game/save.js');
const Progression = await import('../../src/game/heresyprogression.mjs');

function character(id, depth, deepest, cleared) {
  const c = Save.newCharData('ranger', `Test ${id}`);
  Object.assign(c, { id, depth, deepest, cleared: { ...cleared }, level: 56, xp: 12345, gold: 98765, skillPoints: 7, marks: { pts: 4, xp: 9, spent: { life: 2 } } });
  c.bag[0] = { uid: `item-${id}`, type: 'gear', base: 'sword', slot: 'weapon', affixes: [{ s: 'str', v: 5 }] };
  return c;
}

// Both random red portals (campaign origin) and the Altar challenge (town origin)
// retain a separate context for their temporary 101+ scaling world.
for (const depth of [10, 25, 26, 50, 75, 99, 100, 101, 150, 240]) {
  for (const kind of ['sanctum', 'throne']) {
    const c = character(`${kind}-${depth}`, depth, Math.max(0, depth - 1), { [Math.max(1, depth - 1)]: true });
    const originalCleared = { ...c.cleared };
    const origin = kind === 'sanctum'
      ? { kind: 'dungeon', depth, biome: { id: 'catacombs' }, player: { x: 7, y: 9 } }
      : null;
    const context = Progression.snapshotHeresyProgression(c, origin, kind);
    assert.equal(context.progression.depth, depth);
    assert.equal(context.originMode, depth > 100 ? 'infinite-endgame' : kind === 'throne' ? 'campaign' : 'campaign');
    const virtualChallenge = { kind: 'dungeon', depth: Math.max(101, depth), heresyChallenge: { kind, progression: context } };
    assert.equal(Progression.heresyDeathProgression(c, virtualChallenge).depth, depth, `${kind} death depth at origin ${depth}`);
    c.depth = virtualChallenge.depth;
    c.deepest = 100;
    c.cleared[100] = true;
    c.heresyEncounterContext = context;
    assert.equal(Progression.restoreHeresyProgression(c, context), true);
    assert.equal(c.depth, depth, `${kind} restores campaign/endgame depth`);
    assert.equal(c.deepest, Math.max(0, depth - 1));
    assert.deepEqual(c.cleared, originalCleared, 'return restores exactly the originating clear flags');
    assert.equal(c.heresyEncounterContext, null);
  }
}

assert.equal(Progression.heresyDeathProgression({ depth: 26 }, { kind: 'dungeon', depth: 101 }).depth, 101,
  'ordinary endgame deaths keep their existing actual depth behavior');
for (const [world, mode] of [
  [{ kind: 'dungeon', depth: 26, breach: { floor: 3 } }, 'eternal-breach'],
  [{ kind: 'dungeon', depth: 26, rift: { tier: 7 } }, 'abyssal-rift'],
  [{ kind: 'dungeon', depth: 500, unbound: true }, 'velscour-unbound'],
  [{ kind: 'dungeon', depth: 126, unboundExploration: { floor: 4 } }, 'unbound-exploration'],
]) {
  assert.equal(Progression.snapshotHeresyProgression({ id: mode, depth: 26, deepest: 25 }, world, 'sanctum').originMode, mode,
    `${mode} is kept distinct from campaign and Endgame depth`);
}

// Legacy data lacks the original entry depth, so even a false Depth 100 clear is
// never auto-rewritten. The suggested depth is confirmed per-character after backup.
Endgame.resetEndgameCache();
const affected = character('legacy-campaign-ranger', 101, 100, { 25: true, 100: true });
const untouched = JSON.parse(JSON.stringify(affected));
const fixed = Save.migrate(affected);
assert.equal(fixed.depth, 101, 'legacy campaign depth is not guessed during load');
assert.equal(fixed.deepest, 100);
assert.equal(fixed.cleared[100], true);
const legacyReview = Save.sanctumRecoveryReview(fixed);
assert.equal(legacyReview.available, true);
assert.equal(legacyReview.suggestedDepth, 26);
assert.equal(Save.repairSanctumCampaignDepth(fixed, 26, { removeDepth100Clear: true }), true);
assert.equal(fixed.depth, 26);
assert.equal(fixed.deepest, 25);
assert.equal(fixed.cleared[100], undefined);
assert.equal(fixed.sanctumProgressionRepairV1, 1);
assert.equal(fixed.level, untouched.level);
assert.equal(fixed.xp, untouched.xp);
assert.equal(fixed.gold, untouched.gold);
assert.equal(fixed.skillPoints, untouched.skillPoints);
assert.equal(fixed.marks.pts, untouched.marks.pts);
assert.equal(fixed.marks.xp, untouched.marks.xp);
assert.equal(fixed.marks.spent.life, untouched.marks.spent.life);
assert.deepEqual(fixed.bag, untouched.bag);
const backupKey = `velscour_saves_v1_sanctum_recovery_backup_v1_${encodeURIComponent(fixed.id)}`;
const backup = JSON.parse(storage.get(backupKey));
assert.equal(backup.character.depth, 101, 'full pre-repair character save is backed up');
assert.equal(backup.character.cleared[100], true);
Save.migrate(fixed);
assert.equal(fixed.depth, 26, 'versioned repair does not run again');

// If another character legitimately unlocked Endgame, the legacy save is ambiguous:
// never guess. Expose a character-only, user-confirmed restore path instead.
storage.set('velscour_endgame_v1', JSON.stringify({ marksResetVersion: 2, unlocked: 123456, marks: { pts: 0, spent: {} } }));
Endgame.resetEndgameCache();
const ambiguous = character('ambiguous-ranger', 101, 100, { 25: true, 100: true });
Save.migrate(ambiguous);
assert.equal(ambiguous.depth, 101, 'ambiguous legacy data is not automatically rewritten');
const review = Save.sanctumRecoveryReview(ambiguous);
assert.equal(review.available, true);
assert.equal(review.suggestedDepth, 26);
assert.equal(Save.repairSanctumCampaignDepth(ambiguous, 26, { removeDepth100Clear: true }), true);
assert.equal(ambiguous.depth, 26);
assert.equal(ambiguous.deepest, 25);
assert.equal(ambiguous.cleared[100], undefined);
assert.equal(Endgame.endgame().unlocked, 123456, 'account-wide victory/unlock remains untouched');
assert.equal(JSON.parse(storage.get(`velscour_saves_v1_sanctum_recovery_backup_v1_${encodeURIComponent(ambiguous.id)}`)).character.depth, 101);

// The uniquely identified Level 56 Ranger from the campaign-depth incident is
// repaired on load, with an exact pre-migration copy and no account-wide edits.
const rangerRepair = character('affected-level-56-ranger', 101, 100, { 1: true, 25: true, 50: true, 75: true, 100: true });
rangerRepair.rebalancedV1 = true;
rangerRepair.nextBiome = 'catacombs';
rangerRepair.lastTown = 'act4';
rangerRepair.visitedAct2Town = true;
rangerRepair.act2AutoTravelDone = true;
rangerRepair.visitedAct3Town = true;
rangerRepair.act3AutoTravelDone = true;
rangerRepair.visitedAct4Town = true;
rangerRepair.act4AutoTravelDone = true;
rangerRepair.greedLevel = rangerRepair.greed = 3;
rangerRepair.dungeonAffixes = ['burrowing'];
rangerRepair.nextAffixes = ['burrowing'];
const preserveRangerFields = JSON.parse(JSON.stringify(rangerRepair));
const otherHero = Save.newCharData('paladin', 'Unchanged Hero');
otherHero.id = 'unchanged-other-hero';
storage.set('velscour_saves_v1', JSON.stringify([rangerRepair, otherHero]));
storage.set('velscour_endgame_v1', JSON.stringify({ marksResetVersion: 2, unlocked: 0, marks: { pts: 0, spent: {} } }));
Endgame.resetEndgameCache();
assert.equal(Endgame.endgameUnlocked(rangerRepair), true, 'the false per-character Depth 100 clear grants Endgame access before repair');
const deployedVictory = Endgame.endgame().unlocked;
const restoredRanger = Save.migrate(rangerRepair);
assert.equal(restoredRanger.depth, 26);
assert.equal(restoredRanger.deepest, 25);
assert.deepEqual(restoredRanger.cleared, { 1: true, 25: true }, 'only Act I clears and the Act I finale remain complete');
assert.equal(Endgame.endgameUnlocked(restoredRanger), false, 'removing the false per-character final clear removes its Endgame access');
assert.equal(restoredRanger.lastTown, 'act2');
assert.equal(restoredRanger.visitedAct2Town, true);
assert.equal(restoredRanger.act2AutoTravelDone, true);
assert.equal(restoredRanger.visitedAct3Town, false);
assert.equal(restoredRanger.act3AutoTravelDone, false);
assert.equal(restoredRanger.visitedAct4Town, false);
assert.equal(restoredRanger.act4AutoTravelDone, false);
assert.equal(restoredRanger.nextBiome, 'sea_of_sand', 'Depth 26 is assigned its Act II campaign biome');
assert.equal(restoredRanger.greed, 3, 'unrelated endgame preference is preserved');
assert.equal(restoredRanger.level, preserveRangerFields.level);
assert.equal(restoredRanger.xp, preserveRangerFields.xp);
assert.equal(restoredRanger.gold, preserveRangerFields.gold);
assert.equal(restoredRanger.skillPoints, preserveRangerFields.skillPoints);
assert.deepEqual(restoredRanger.attrs, preserveRangerFields.attrs);
assert.deepEqual(restoredRanger.skills, preserveRangerFields.skills);
assert.deepEqual(restoredRanger.mastery, preserveRangerFields.mastery);
assert.deepEqual(restoredRanger.equip, preserveRangerFields.equip);
assert.deepEqual(restoredRanger.bag, preserveRangerFields.bag);
assert.deepEqual(restoredRanger.gemBag, preserveRangerFields.gemBag);
assert.deepEqual(restoredRanger.stash, preserveRangerFields.stash);
assert.deepEqual(restoredRanger.potions, preserveRangerFields.potions);
assert.equal(restoredRanger.marks.pts, preserveRangerFields.marks.pts);
assert.equal(restoredRanger.marks.xp, preserveRangerFields.marks.xp);
assert.equal(restoredRanger.marks.spent.life, preserveRangerFields.marks.spent.life);
assert.equal(restoredRanger.sanctumRangerAct2RestoreV1, 1);
const rangerBackupKey = `velscour_saves_v1_sanctum_ranger_act2_backup_v1_${encodeURIComponent(restoredRanger.id)}`;
const rangerBackup = JSON.parse(storage.get(rangerBackupKey));
assert.equal(rangerBackup.character.depth, 101, 'exact original Ranger save is backed up before repair');
assert.deepEqual(rangerBackup.character.cleared, preserveRangerFields.cleared);
assert.equal(rangerBackup.character.level, 56);
const savedAfterRangerRepair = JSON.parse(storage.get('velscour_saves_v1'));
assert.equal(savedAfterRangerRepair.find((hero) => hero.id === otherHero.id).name, otherHero.name,
  'other character remains untouched by the targeted save write');
assert.equal(Endgame.endgame().unlocked, deployedVictory, 'account-wide Endgame unlock remains unchanged');
restoredRanger.depth = 27;
Save.migrate(restoredRanger);
assert.equal(restoredRanger.depth, 27, 'completed targeted migration never resets later legitimate progression');

// If two Rangers match the signature, do not guess. The current character gets
// a character-specific confirmation path that only repairs that selected save.
const duplicateA = character('duplicate-affected-ranger-a', 101, 100, { 25: true, 100: true });
const duplicateB = character('duplicate-affected-ranger-b', 101, 100, { 25: true, 100: true });
duplicateA.rebalancedV1 = duplicateB.rebalancedV1 = true;
storage.set('velscour_saves_v1', JSON.stringify([duplicateA, duplicateB]));
Save.migrate(duplicateA);
assert.equal(duplicateA.depth, 101, 'ambiguous matches are not changed automatically');
assert.equal(Save.rangerAct2RepairReview(duplicateA).available, true);
assert.equal(Save.repairRangerAct2Progression(duplicateA), true);
assert.equal(duplicateA.depth, 26);
assert.equal(duplicateA.cleared[100], undefined);
assert.equal(Save.rangerAct2RepairReview(duplicateA).available, false, 'confirmed repair is one-time');
assert.equal(JSON.parse(storage.get(`velscour_saves_v1_sanctum_ranger_act2_backup_v1_${encodeURIComponent(duplicateA.id)}`)).character.depth, 101);
assert.equal(JSON.parse(storage.get('velscour_saves_v1')).find((hero) => hero.id === duplicateB.id).depth, 101,
  'the nonselected matching Ranger remains untouched');

const nonmatchingRanger = character('other-level-55-ranger', 101, 100, { 25: true, 100: true });
nonmatchingRanger.level = 55;
storage.set('velscour_saves_v1', JSON.stringify([nonmatchingRanger]));
assert.equal(Save.migrate(nonmatchingRanger).depth, 101, 'other Rangers do not match the authorized level-specific repair');

// Reload recovery from a saved active challenge context preserves all character progression.
const interrupted = character('interrupted-challenge', 26, 25, { 25: true });
interrupted.heresyEncounterContext = Progression.snapshotHeresyProgression(interrupted,
  { kind: 'dungeon', depth: 26, biome: { id: 'catacombs' } }, 'sanctum');
interrupted.depth = 101; interrupted.deepest = 100; interrupted.cleared[100] = true;
const reloaded = Save.migrate(interrupted);
assert.equal(reloaded.depth, 26);
assert.equal(reloaded.deepest, 25);
assert.equal(reloaded.cleared[100], undefined);
assert.equal(reloaded.heresyEncounterContext, null);

const gameSource = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
assert.match(gameSource, /if \(G\.world\?\.heresyChallenge\) this\.restoreHeresyChallengeProgress\(G\.world\)/,
  'town return restores challenge context before town progression logic');
assert.match(gameSource, /useHeresySanctum\(origin, portal\)[\s\S]*?return !!this\.enterHeresyChallenge\(origin, portal\.challengeWorld\)/,
  'random red Sanctum portals use the guarded progression snapshot entry path');
assert.match(gameSource, /enterHeresyThrone\(\)[\s\S]*?return !!this\.enterHeresyChallenge\(null, this\.heresyThroneWorld\)/,
  'the Altar challenge button uses the same guarded progression snapshot entry path');
assert.match(gameSource, /const \{ depth \} = heresyDeathProgression\(c, w\)/,
  'player death path uses actual progression depth for Heresy challenges');
assert.match(gameSource, /character\.heresyEncounterContext = progression;[\s\S]*?if \(!this\.autosave\(\)\)/,
  'challenge entry persists progression context before transition');
assert.match(gameSource, /if \(w && w\.breach\) return this\.breachDeath\(src\);[\s\S]*?if \(w && w\.rift\) return this\.riftDeath\(src\);[\s\S]*?if \(w && \(w\.unbound \|\| w\.unboundExploration\)\) return this\.unboundDeath\(src\);[\s\S]*?heresyDeathProgression\(c, w\)/,
  'Breach, Rift and Unbound death handling remains on its existing specialized path');
assert.match(gameSource, /const returnPortal = [\s\S]*?this\.restoreHeresyChallengeProgress\(challenge\);[\s\S]*?if \(!back\)/,
  'the return portal restores the originating progression before transition');
const settingsSource = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
assert.match(settingsSource, /sanctumRecoveryReview\(G\.char\)[\s\S]*?data-sanctum-recovery/,
  'ambiguous legacy saves expose a character-specific recovery choice');
assert.match(settingsSource, /rangerAct2RepairReview\(G\.char\)[\s\S]*?data-ranger-act2-recovery/,
  'ambiguous affected Rangers expose a character-specific Depth 26 confirmation');

console.log('Forbidden Sanctum progression regression checks passed: challenge origin/death/return paths, reload recovery, uniquely targeted Ranger repair and backup, ambiguous confirmation, other-character preservation, and account unlock preservation.');
