import { JEWEL_BOX_BASE_ROWS, JEWEL_BOX_COLS } from '../data/bag.js';
import { stashRaw, listRaw } from './herobackup.js';

export const JEWEL_BOX_ACCOUNT_KEY = 'velscour_jewelbox_account_v1';
export const JEWEL_BOX_MIGRATION_KEY = 'velscour_jewelbox_migration_v1';
const SAVES_KEY = 'velscour_saves_v1';
const BASE_SIZE = JEWEL_BOX_BASE_ROWS * JEWEL_BOX_COLS;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sourceHash(text) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `${text.length.toString(36)}-${a.toString(36)}-${b.toString(36)}`;
}

function gemStackKey(item) {
  const copy = { ...item };
  delete copy.uid;
  delete copy.count;
  return stable(copy);
}

export function sameStackableJewelGem(a, b) {
  return !!a && !!b && a.type === 'gem' && b.type === 'gem' && gemStackKey(a) === gemStackKey(b);
}

function manifest(items) {
  const gems = new Map(), other = new Map();
  for (const item of items || []) {
    if (!item) continue;
    if (item.type === 'gem') {
      const key = gemStackKey(item);
      gems.set(key, (gems.get(key) || 0) + Math.max(1, Number(item.count) || 1));
    } else {
      const key = stable(item);
      other.set(key, (other.get(key) || 0) + 1);
    }
  }
  return stable({ gems: [...gems].sort(([a], [b]) => a.localeCompare(b)), other: [...other].sort(([a], [b]) => a.localeCompare(b)) });
}

function collect(saves) {
  const slots = [], stackByKey = new Map();
  let capacity = BASE_SIZE;
  for (const hero of saves) {
    const box = Array.isArray(hero?.jewelBox) ? hero.jewelBox : [];
    capacity = Math.max(capacity, Math.ceil(box.length / JEWEL_BOX_COLS) * JEWEL_BOX_COLS);
    for (const item of box) {
      if (!item) continue;
      const copy = JSON.parse(JSON.stringify(item));
      if (copy && typeof copy === 'object' && copy.type === 'gem') {
        const key = gemStackKey(copy);
        const previous = stackByKey.get(key);
        if (previous) {
          previous.count = Math.max(1, Number(previous.count) || 1) + Math.max(1, Number(copy.count) || 1);
          continue;
        }
        copy.count = Math.max(1, Number(copy.count) || 1);
        stackByKey.set(key, copy);
      }
      slots.push(copy);
    }
  }
  capacity = Math.max(capacity, Math.ceil(slots.length / JEWEL_BOX_COLS) * JEWEL_BOX_COLS);
  const items = Array(capacity).fill(null);
  slots.forEach((item, index) => { items[index] = item; });
  return { jewelBox: items, rows: capacity / JEWEL_BOX_COLS, migrationV1: true };
}

function readAccount(storage) {
  let value;
  try { value = JSON.parse(storage.getItem(JEWEL_BOX_ACCOUNT_KEY) || 'null'); } catch { return null; }
  if (!value || value.version !== 1 || !Array.isArray(value.jewelBox)) return null;
  return value;
}

export function jewelBoxAccount(storage = globalThis.localStorage) {
  return storage ? readAccount(storage) : null;
}

export function jewelBoxMigrationComplete(storage = globalThis.localStorage) {
  return !!storage && readMigration(storage)?.state === 'complete' && !!readAccount(storage);
}

export function saveJewelBoxAccount(account, storage = globalThis.localStorage) {
  if (!storage || !account || !Array.isArray(account.jewelBox)) return false;
  const value = { ...account, version: 1, rows: Math.ceil(account.jewelBox.length / JEWEL_BOX_COLS) };
  try {
    const json = JSON.stringify(value);
    storage.setItem(JEWEL_BOX_ACCOUNT_KEY, json);
    const verified = storage.getItem(JEWEL_BOX_ACCOUNT_KEY);
    if (verified !== json) return false;
    return true;
  } catch { return false; }
}

function readMigration(storage) {
  try { return JSON.parse(storage.getItem(JEWEL_BOX_MIGRATION_KEY) || 'null'); } catch { return null; }
}

async function writeBackup(raw, storage, backupStore) {
  const hash = sourceHash(raw);
  // IndexedDB avoids temporarily doubling a potentially large localStorage save file.
  await backupStore.write(raw);
  const restored = await backupStore.read(hash, raw.length);
  if (restored !== raw) throw new Error('Could not verify the Jewel Box source backup.');
  return { kind: 'indexedDB', hash, length: raw.length };
}

async function readBackup(record, storage, backupStore) {
  if (!record?.backup) return null;
  if (record.backup.kind === 'inline') return typeof record.backup.raw === 'string' && sourceHash(record.backup.raw) === record.backup.hash ? record.backup.raw : null;
  return backupStore.read(record.backup.hash, record.backup.length);
}

const defaultBackupStore = {
  async write(raw) { await stashRaw(raw); },
  async read(hash, length) {
    const entries = await listRaw();
    return entries.find((entry) => typeof entry.text === 'string' && entry.text.length === length && sourceHash(entry.text) === hash)?.text ?? null;
  },
};

/** One-time journaled migration. Original saves remain recoverable until the account vault is verified. */
export async function ensureJewelBoxMigration({ storage = globalThis.localStorage, backupStore = defaultBackupStore } = {}) {
  if (!storage) return { ok: false, error: new Error('Local save storage is unavailable.') };
  try {
    let journal = readMigration(storage);
    if (journal?.state === 'complete') {
      const account = readAccount(storage);
      return account ? { ok: true, account, migrated: false } : { ok: false, error: new Error('The shared Jewel Box data is missing or unreadable; the migration backup was preserved.') };
    }

    let raw;
    if (journal?.state === 'prepared') {
      raw = await readBackup(journal, storage, backupStore);
      if (raw === null) throw new Error('The interrupted migration backup could not be read; no additional changes were made.');
      if (sourceHash(raw) !== journal.sourceHash || raw.length !== journal.sourceLength) throw new Error('The migration backup does not match its recovery record; no additional changes were made.');
    } else {
      raw = storage.getItem(SAVES_KEY) ?? '[]';
      let saves;
      try { saves = JSON.parse(raw); } catch { throw new Error('Character saves could not be read; the Jewel Box migration stopped without changing them.'); }
      if (!Array.isArray(saves)) throw new Error('Character saves have an unexpected format; the Jewel Box migration stopped without changing them.');
      const backup = saves.length === 0
        ? { kind: 'inline', hash: sourceHash(raw), length: raw.length, raw }
        : await writeBackup(raw, storage, backupStore);
      // The journal is a small durable pointer to the exact original payload and is written before source data changes.
      journal = { version: 1, state: 'prepared', sourceHash: sourceHash(raw), sourceLength: raw.length, backup, startedAt: Date.now() };
      storage.setItem(JEWEL_BOX_MIGRATION_KEY, JSON.stringify(journal));
      if (readMigration(storage)?.state !== 'prepared') throw new Error('Could not save the migration recovery record; character data was left unchanged.');
    }

    let saves;
    try { saves = JSON.parse(raw); } catch { throw new Error('The backed-up character saves are unreadable; the Jewel Box migration was not applied.'); }
    if (!Array.isArray(saves)) throw new Error('The backed-up character data has an unexpected format; the Jewel Box migration was not applied.');
    const account = collect(saves);
    const expectedManifest = manifest(saves.flatMap((hero) => Array.isArray(hero?.jewelBox) ? hero.jewelBox : []));
    const stripped = saves.map((hero) => {
      const oldBox = Array.isArray(hero?.jewelBox) ? hero.jewelBox : [];
      const legacyCapacity = Math.max(BASE_SIZE, Math.ceil(oldBox.length / JEWEL_BOX_COLS) * JEWEL_BOX_COLS);
      return { ...hero, jewelBox: Array(legacyCapacity).fill(null) };
    });
    const strippedJson = JSON.stringify(stripped);

    // Free the per-character payload only after the exact original is backed up and the recovery journal exists.
    storage.setItem(SAVES_KEY, strippedJson);
    const persistedSaves = JSON.parse(storage.getItem(SAVES_KEY) || 'null');
    if (!Array.isArray(persistedSaves) || persistedSaves.length !== saves.length || persistedSaves.some((hero) => !Array.isArray(hero.jewelBox) || hero.jewelBox.some(Boolean))) {
      throw new Error('Could not validate the cleared character Jewel Boxes; the backup and recovery journal remain available.');
    }

    const storedAccount = { ...account, version: 1, migratedAt: Date.now(), sourceHash: journal.sourceHash };
    if (!saveJewelBoxAccount(storedAccount, storage)) throw new Error('Could not save and verify the shared Jewel Box; the migration will resume safely next launch.');
    const verifiedAccount = readAccount(storage);
    if (!verifiedAccount || manifest(verifiedAccount.jewelBox) !== expectedManifest || verifiedAccount.jewelBox.length < account.jewelBox.length) {
      throw new Error('Shared Jewel Box contents failed validation; the migration will resume from its backup next launch.');
    }

    journal = { ...journal, state: 'complete', completedAt: Date.now(), migratedItems: verifiedAccount.jewelBox.filter(Boolean).length };
    storage.setItem(JEWEL_BOX_MIGRATION_KEY, JSON.stringify(journal));
    if (readMigration(storage)?.state !== 'complete') throw new Error('Could not record migration completion; the saved recovery journal will retry safely.');
    return { ok: true, account: verifiedAccount, migrated: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function addToAccountJewelBox(item, storage = globalThis.localStorage) {
  if (!item || item.type !== 'gem') return false;
  const account = jewelBoxAccount(storage);
  if (!account) return false;
  const key = gemStackKey(item);
  const same = account.jewelBox.find((entry) => entry?.type === 'gem' && gemStackKey(entry) === key);
  if (same) same.count = Math.max(1, Number(same.count) || 1) + Math.max(1, Number(item.count) || 1);
  else {
    const index = account.jewelBox.findIndex((entry) => !entry);
    if (index < 0) return false;
    account.jewelBox[index] = item;
  }
  return saveJewelBoxAccount(account, storage);
}