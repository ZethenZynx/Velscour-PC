// Conservative, one-time repair for saved Infernal Mark XP progress. Historical
// non-XP reward receipts are not complete, so this migration never subtracts or
// estimates them into the account-wide wallet.
import { endgame, resetEndgameCache } from './endgame.js';
import { reconcileRecordedMarkXp } from './marks.js';
import { MAX_LEVEL } from '../data/depth.js';

const SAVES_KEY = 'velscour_saves_v1';
const ENDGAME_KEY = 'velscour_endgame_v1';
const MIGRATION_KEY = 'velscour_infernal_marks_reconciliation_v1';
const BACKUP_PREFIX = 'velscour_infernal_marks_reconciliation_backup_v1_';
const VERSION = 1;

function readJson(raw, fallback, label) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error(`The saved ${label} data is unreadable; Infernal Mark reconciliation was not applied.`); }
}
function writeRaw(key, raw) {
  if (raw == null) localStorage.removeItem(key);
  else localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw new Error(`Could not verify the ${key} save write.`);
}
function restoreBackup(backup) {
  writeRaw(SAVES_KEY, backup.savesRaw);
  writeRaw(ENDGAME_KEY, backup.endgameRaw);
  resetEndgameCache();
}
function checkedBackup(savesRaw, endgameRaw) {
  const backupKey = `${BACKUP_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const backup = { version: VERSION, savedAt: Date.now(), savesRaw, endgameRaw };
  localStorage.setItem(backupKey, JSON.stringify(backup));
  const savedBackup = readJson(localStorage.getItem(backupKey), null, 'migration backup');
  if (savedBackup?.version !== VERSION || savedBackup.savesRaw !== savesRaw || savedBackup.endgameRaw !== endgameRaw) {
    throw new Error('The original saves could not be verified in the migration backup; no balances were changed.');
  }
  return { backupKey, backup: savedBackup };
}

/** Reconcile only explicitly recorded, unspent XP progress; preserve all other account totals. */
export function reconcileInfernalMarksOnce() {
  if (typeof localStorage === 'undefined') return { ok: false, reason: 'storage-unavailable' };
  let journal = null, backup = null;
  try {
    journal = readJson(localStorage.getItem(MIGRATION_KEY), null, 'migration journal');
    if (journal?.version === VERSION && journal.state === 'prepared') {
      backup = readJson(localStorage.getItem(journal.backupKey), null, 'migration backup');
      if (!backup || backup.version !== VERSION) throw new Error('The prepared migration backup is missing or invalid; no save data was changed.');
      restoreBackup(backup);
    }

    const savesRaw = localStorage.getItem(SAVES_KEY);
    const endgameRaw = localStorage.getItem(ENDGAME_KEY);
    const saves = readJson(savesRaw, [], 'character save');
    if (!Array.isArray(saves)) throw new Error('Character saves have an unexpected format; no balances were changed.');
    const rawEndgame = readJson(endgameRaw, {}, 'account progression');
    if (rawEndgame != null && (typeof rawEndgame !== 'object' || Array.isArray(rawEndgame))) throw new Error('Account progression has an unexpected format; no balances were changed.');

    const savedReconciliation = rawEndgame?.infernalMarksReconciliationV1;
    const savedProcessed = Array.isArray(journal?.processedCharacterIds) ? journal.processedCharacterIds
      : Array.isArray(savedReconciliation?.processedCharacterIds) ? savedReconciliation.processedCharacterIds : [];
    const processedIds = new Set(savedProcessed.filter((id) => typeof id === 'string'));
    const pending = saves.filter((character) => character && typeof character === 'object' && !Array.isArray(character)
      && typeof character.id === 'string' && character.id && !processedIds.has(character.id) && character.infernalMarkReconciliationV1 !== true);
    if (journal?.version === VERSION && journal.state === 'complete' && pending.length === 0) return { ok: true, migrated: false, report: journal.report };

    const priorJournal = journal;
    const createdBackup = checkedBackup(savesRaw, endgameRaw);
    backup = createdBackup.backup;
    journal = {
      version: VERSION, state: 'prepared', startedAt: Date.now(), backupKey: createdBackup.backupKey,
      processedCharacterIds: [...processedIds], report: priorJournal?.report || null,
    };
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(journal));
    if (readJson(localStorage.getItem(MIGRATION_KEY), null, 'migration journal')?.state !== 'prepared') {
      throw new Error('Could not save the migration recovery journal; no balances were changed.');
    }

    resetEndgameCache();
    const account = endgame();
    const previousBalance = account.marks.pts;
    const previousExpenditures = account.marks.spentValue;
    let experienceEarnedBefore = 0, experienceMarksAdded = 0;
    const characters = pending.map((character) => {
      const before = Math.max(0, Math.floor(Number(character.experienceMarks?.earned) || 0));
      experienceEarnedBefore += before;
      const xpResult = reconcileRecordedMarkXp(character);
      character.infernalMarkReconciliationV1 = true;
      experienceMarksAdded += xpResult.added;
      return {
        id: String(character.id || ''), name: String(character.name || ''),
        previousExperienceMarks: before, experienceMarksAdded: xpResult.added,
        correctedExperienceMarks: xpResult.afterEarned, remainingRecordedXp: xpResult.xp,
        status: Number(character.level) >= MAX_LEVEL ? 'cap-xp-reconciled' : 'below-cap-no-xp-award',
      };
    });
    for (const character of pending) processedIds.add(character.id);

    // The XP progress was stored but had not crossed its award threshold before
    // this migration. Existing boss, Rift and Unbound credits remain untouched.
    account.marks.pts = Math.max(0, previousBalance) + experienceMarksAdded;
    const batchReport = {
      version: VERSION,
      savedAt: Date.now(),
      previousAccountBalance: previousBalance,
      experienceMarksPreviouslyRecorded: experienceEarnedBefore,
      experienceMarksRecalculatedFromRecordedPendingXp: experienceMarksAdded,
      verifiedDepthOrBossCreditsAdded: 0,
      otherHistoricalCreditsAdded: 0,
      previousExpenditures,
      correctedAccountBalance: account.marks.pts,
      freeBalanceAfterReconciliation: Math.max(0, account.marks.pts - previousExpenditures),
      netAdjustment: experienceMarksAdded,
      characters,
      unresolvedHistory: [
        'Cumulative post-cap XP from before per-character tracking is not fully stored; character level alone was not used to infer it.',
        'The saved cleared-depth map is also updated on depth entry/return, so it cannot prove boss rewards and was not used to grant Marks.',
        'Historical Heresy bonuses, Abyssal Imp rewards, and source receipts for repeatable Rift/Unbound rewards are not recorded per reward; existing balances were preserved without recrediting them.',
        'The legacy account-wide XP remainder remains under its existing one-time migration because its character owner is not recorded.',
      ],
    };
    const priorReport = priorJournal?.report || savedReconciliation || null;
    const previousBatches = Array.isArray(priorReport?.batches) ? priorReport.batches : [];
    const report = {
      version: VERSION,
      savedAt: Date.now(),
      batches: [...previousBatches, batchReport],
      processedCharacterIds: [...processedIds],
      totalExperienceMarksAdded: (Number(priorReport?.totalExperienceMarksAdded) || 0) + experienceMarksAdded,
      latestBatch: batchReport,
    };
    account.infernalMarksReconciliationV1 = report;

    const nextSavesRaw = JSON.stringify(saves);
    const nextEndgameRaw = JSON.stringify(account);
    try {
      writeRaw(SAVES_KEY, nextSavesRaw);
      writeRaw(ENDGAME_KEY, nextEndgameRaw);
      const savedAccount = readJson(localStorage.getItem(ENDGAME_KEY), null, 'updated account progression');
      const savedCharacters = readJson(localStorage.getItem(SAVES_KEY), null, 'updated character save');
      if (savedAccount?.infernalMarksReconciliationV1?.version !== VERSION || !Array.isArray(savedCharacters)) {
        throw new Error('The reconciled data did not pass its read-back validation.');
      }
      journal = { version: VERSION, state: 'complete', completedAt: Date.now(), backupKey: createdBackup.backupKey, processedCharacterIds: [...processedIds], report };
      localStorage.setItem(MIGRATION_KEY, JSON.stringify(journal));
      if (readJson(localStorage.getItem(MIGRATION_KEY), null, 'migration journal')?.state !== 'complete') {
        throw new Error('Could not persist the migration completion record.');
      }
      resetEndgameCache();
      return { ok: true, migrated: true, report };
    } catch (error) {
      restoreBackup(backup);
      localStorage.setItem(MIGRATION_KEY, JSON.stringify({
        version: VERSION, state: 'prepared', failedAt: Date.now(), backupKey: createdBackup.backupKey,
        processedCharacterIds: [...(Array.isArray(priorJournal?.processedCharacterIds) ? priorJournal.processedCharacterIds : [])],
        report: priorJournal?.report || null,
      }));
      throw error;
    }
  } catch (error) {
    console.warn('Infernal Mark reconciliation was not applied; original balances and the recovery backup were preserved.', error);
    return { ok: false, error };
  }
}
