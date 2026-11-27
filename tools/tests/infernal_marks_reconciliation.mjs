import assert from 'node:assert/strict';
import { G } from '../../src/state.js';

const data = new Map();
let failEndgameWriteOnce = false;
globalThis.localStorage = {
  getItem: (key) => data.get(key) ?? null,
  setItem(key, value) {
    if (failEndgameWriteOnce && key === 'velscour_endgame_v1') { failEndgameWriteOnce = false; throw new Error('simulated storage interruption'); }
    data.set(key, String(value));
  },
  removeItem: (key) => data.delete(key),
  key: (index) => [...data.keys()][index] ?? null,
  get length() { return data.size; },
};
data.set('velscour_campaign_overhaul_reset_v1', '1');

const { MAX_LEVEL, xpToNext } = await import('../../src/game/player.js');
const { markXp } = await import('../../src/game/marks.js');
const { resetEndgameCache } = await import('../../src/game/endgame.js');
const { reconcileInfernalMarksOnce } = await import('../../src/game/mark-reconciliation.mjs');
const { newCharData } = await import('../../src/game/save.js');
G.settings = {};
G.char = null;
G.player = null;
assert.equal(newCharData('ranger', 'Fresh Hero').infernalMarkReconciliationV1, true, 'new characters start on current rules and bypass legacy awards');

const threshold0 = markXp(0), threshold2 = markXp(2), threshold3 = markXp(3);
const originalSaves = [
  { id: 'cap-a', name: 'Cap A', level: MAX_LEVEL, xp: 400, cleared: { 101: true }, experienceMarks: { earned: 2, xp: threshold2 + threshold3 + 300 } },
  { id: 'below-cap', name: 'Below Cap', level: MAX_LEVEL - 1, xp: 500, experienceMarks: { earned: 0, xp: 900 } },
  { id: 'cap-b', name: 'Cap B', level: MAX_LEVEL, xp: threshold0, cleared: { 900: true } },
];
const originalEndgame = {
  marksResetVersion: 2, unlocked: 1, markXpMigrationV1: false,
  marks: { pts: 15, xp: 777, spentValue: 6, rewardRemainder: 0.4, spent: { might: 2 } },
};
data.set('velscour_saves_v1', JSON.stringify(originalSaves));
data.set('velscour_endgame_v1', JSON.stringify(originalEndgame));
const originalSavesRaw = data.get('velscour_saves_v1'), originalEndgameRaw = data.get('velscour_endgame_v1');

const migrated = reconcileInfernalMarksOnce();
assert.equal(migrated.ok, true);
assert.equal(migrated.migrated, true);
const firstReport = migrated.report.latestBatch;
assert.equal(firstReport.previousAccountBalance, 15);
assert.equal(firstReport.experienceMarksRecalculatedFromRecordedPendingXp, 3, 'only saved unprocessed cap XP thresholds are credited');
assert.equal(firstReport.correctedAccountBalance, 18);
assert.equal(firstReport.previousExpenditures, 6);
assert.equal(firstReport.freeBalanceAfterReconciliation, 12);
assert.equal(firstReport.verifiedDepthOrBossCreditsAdded, 0, 'ambiguous depth flags do not mint rewards');
assert.ok(firstReport.unresolvedHistory.some((line) => line.includes('cleared-depth map')));

const savedSaves = JSON.parse(data.get('velscour_saves_v1'));
assert.equal(savedSaves[0].experienceMarks.earned, 4);
assert.equal(savedSaves[0].xp, 0);
assert.equal(savedSaves[0].experienceMarks.xp, 700, 'partial XP is retained after paying exact thresholds');
assert.equal(savedSaves[1].experienceMarks.earned, 0, 'below-cap XP does not award Marks');
assert.equal(savedSaves[1].experienceMarks.xp, 900);
assert.equal(savedSaves[2].experienceMarks.earned, 1, 'missing cap-progress fields are reconstructed only from their recorded XP');
assert.equal(savedSaves[2].experienceMarks.xp, 0);
const savedAccount = JSON.parse(data.get('velscour_endgame_v1'));
assert.equal(savedAccount.marks.pts, 18);
assert.equal(savedAccount.marks.spentValue, 6, 'existing purchases remain recorded and are not charged again');
assert.equal(savedAccount.marks.rewardRemainder, 0.4, 'fractional reward carry is preserved');
assert.equal(savedAccount.marks.xp, 777, 'unowned legacy shared XP remains untouched for its existing migration');
assert.equal(savedAccount.markXpMigrationV1, false);
const firstJournal = JSON.parse(data.get('velscour_infernal_marks_reconciliation_v1'));
const firstBackup = JSON.parse(data.get(firstJournal.backupKey));
assert.equal(firstBackup.savesRaw, originalSavesRaw);
assert.equal(firstBackup.endgameRaw, originalEndgameRaw);

const onceSaves = data.get('velscour_saves_v1'), onceEndgame = data.get('velscour_endgame_v1');
const secondPass = reconcileInfernalMarksOnce();
assert.equal(secondPass.migrated, false);
assert.equal(data.get('velscour_saves_v1'), onceSaves, 'a second run does not modify character data');
assert.equal(data.get('velscour_endgame_v1'), onceEndgame, 'a second run does not duplicate account credits');

// New characters added after completion never inherit retroactive reconciliation rewards.
const afterMigration = JSON.parse(onceSaves);
afterMigration.push({ id: 'new-hero', level: 1, xp: 0, experienceMarks: { earned: 0, xp: 0 }, infernalMarkReconciliationV1: true });
data.set('velscour_saves_v1', JSON.stringify(afterMigration));
assert.equal(reconcileInfernalMarksOnce().migrated, false, 'a new character skips legacy reconciliation');
assert.equal(JSON.parse(data.get('velscour_endgame_v1')).marks.pts, 18);
assert.equal(reconcileInfernalMarksOnce().migrated, false, 'the new character is not processed repeatedly');
const afterNewHero = JSON.parse(data.get('velscour_saves_v1'));
afterNewHero.push({ id: 'imported-old', level: MAX_LEVEL, xp: threshold0, experienceMarks: { earned: 0, xp: 0 } });
data.set('velscour_saves_v1', JSON.stringify(afterNewHero));
assert.equal(reconcileInfernalMarksOnce().migrated, true, 'a subsequently imported legacy save gets one verified reconciliation pass');
assert.equal(JSON.parse(data.get('velscour_endgame_v1')).marks.pts, 19);
assert.equal(reconcileInfernalMarksOnce().migrated, false, 'the imported save cannot receive the credit twice');

// Interrupted writes roll both raw save records back and can safely retry from the backup.
data.delete('velscour_infernal_marks_reconciliation_v1');
for (const key of [...data.keys()]) if (key.startsWith('velscour_infernal_marks_reconciliation_backup_v1_')) data.delete(key);
data.set('velscour_saves_v1', JSON.stringify([{ id: 'recovery', level: MAX_LEVEL, xp: threshold0, experienceMarks: { earned: 0, xp: 0 } }]));
data.set('velscour_endgame_v1', JSON.stringify({ marksResetVersion: 2, marks: { pts: 4, spentValue: 1, spent: {} } }));
const recoverySaves = data.get('velscour_saves_v1'), recoveryEndgame = data.get('velscour_endgame_v1');
resetEndgameCache();
failEndgameWriteOnce = true;
const originalWarn = console.warn;
console.warn = () => {};
const interrupted = reconcileInfernalMarksOnce();
console.warn = originalWarn;
assert.equal(interrupted.ok, false, 'a failed save write stops the migration');
assert.equal(data.get('velscour_saves_v1'), recoverySaves, 'the first write is rolled back after a later write fails');
assert.equal(data.get('velscour_endgame_v1'), recoveryEndgame, 'the original account wallet is restored');
resetEndgameCache();
assert.equal(reconcileInfernalMarksOnce().ok, true, 'the prepared migration retries safely from its backup');
assert.equal(JSON.parse(data.get('velscour_endgame_v1')).marks.pts, 5, 'retry credits the exact threshold once');
assert.equal(reconcileInfernalMarksOnce().migrated, false, 'recovered migration remains idempotent');

console.log('Infernal Mark reconciliation: verified XP awards, purchase preservation, backups, rollback, retry, and idempotence passed.');
