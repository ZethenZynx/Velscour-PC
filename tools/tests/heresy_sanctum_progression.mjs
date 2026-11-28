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

console.log('Forbidden Sanctum progression regression checks passed: representative origin depths, both challenge entry kinds, death depth, return/town path wiring, interrupted reload, confirmed legacy recovery with backup, and account unlock preservation.');
