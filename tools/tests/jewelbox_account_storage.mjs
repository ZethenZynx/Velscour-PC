import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JEWEL_BOX_ACCOUNT_KEY, JEWEL_BOX_MIGRATION_KEY, ensureJewelBoxMigration,
  jewelBoxAccount, addToAccountJewelBox, saveJewelBoxAccount,
} from '../../src/game/jewelboxstorage.mjs';

const SAVES = 'velscour_saves_v1';

class MemoryStorage {
  data = new Map();
  failKey = null;
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) {
    if (key === this.failKey) { this.failKey = null; throw new Error('simulated storage interruption'); }
    this.data.set(key, String(value));
  }
  removeItem(key) { this.data.delete(key); }
}

class MemoryBackup {
  entries = [];
  async write(text) { if (!this.entries.includes(text)) this.entries.push(text); }
  async read(hash, length) {
    // The production key is intentionally opaque; the test uses the recorded journal hash
    // by locating the exact source byte length and validating it via the migration retry.
    return this.entries.find((entry) => entry.length === length && (hash === this.hash(entry))) ?? null;
  }
  hash(text) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); a = Math.imul(a ^ code, 0x01000193) >>> 0; b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0; }
    return `${text.length.toString(36)}-${a.toString(36)}-${b.toString(36)}`;
  }
}

function hero(id, jewelBox) { return { id, classId: id, name: id, level: 1, jewelBox }; }
function sigil(uid, tier, count = 1, extra = {}) { return { uid, type: 'gem', gem: 'sig', tier, count, ilvl: 1 + tier * 25, ...extra }; }

test('migration combines only identical gem stacks and preserves all other contents and capacity', async () => {
  const storage = new MemoryStorage(), backup = new MemoryBackup();
  const source = [
    hero('paladin', [sigil('a1', 2, 4), sigil('unique-a', 3, 1, { quality: 'etched' }), { uid: 'odd', type: 'legacy-token', value: 7 }, ...Array(297).fill(null)]),
    hero('wizard', [sigil('b1', 2, 2), sigil('unique-b', 3, 1, { quality: 'polished' }), ...Array(608).fill(null)]),
    hero('empty', Array(300).fill(null)),
  ];
  source[0].jewelBox[305] = { uid: 'overflow', type: 'gem', gem: 'ruby', tier: 5, count: 3, ilvl: 999, customProperty: { source: 'kept' } };
  const raw = JSON.stringify(source);
  storage.setItem(SAVES, raw);

  const result = await ensureJewelBoxMigration({ storage, backupStore: backup });
  assert.equal(result.ok, true);
  assert.equal(backup.entries.includes(raw), true, 'original save payload is backed up before migration');
  assert.equal(storage.getItem(JEWEL_BOX_MIGRATION_KEY) && JSON.parse(storage.getItem(JEWEL_BOX_MIGRATION_KEY)).state, 'complete');
  const stored = jewelBoxAccount(storage).jewelBox.filter(Boolean);
  assert.equal(stored.find((item) => item.gem === 'sig' && item.tier === 2).count, 6);
  assert.equal(stored.filter((item) => item.gem === 'sig' && item.tier === 3).length, 2, 'different properties prevent merging');
  assert.deepEqual(stored.find((item) => item.gem === 'ruby'), source[0].jewelBox[305]);
  assert.deepEqual(stored.find((item) => item.type === 'legacy-token'), { uid: 'odd', type: 'legacy-token', value: 7 });
  assert.equal(jewelBoxAccount(storage).jewelBox.length, 610, 'shared capacity retains the largest legacy box');
  const savedHeroes = JSON.parse(storage.getItem(SAVES));
  assert.deepEqual(savedHeroes.map((item) => item.id), ['paladin', 'wizard', 'empty']);
  assert.equal(savedHeroes.every((item) => item.jewelBox.every((slot) => slot === null)), true);
});

test('migration grows beyond the old capacity rather than dropping unique items', async () => {
  const storage = new MemoryStorage(), backup = new MemoryBackup();
  const items = Array.from({ length: 650 }, (_, i) => ({ uid: `g${i}`, type: 'gem', gem: `gem_${i}`, tier: i % 20, count: i + 1, property: i }));
  storage.setItem(SAVES, JSON.stringify([hero('large', items)]));
  const result = await ensureJewelBoxMigration({ storage, backupStore: backup });
  assert.equal(result.ok, true);
  const box = jewelBoxAccount(storage).jewelBox;
  assert.equal(box.length, 650);
  assert.equal(box.filter(Boolean).length, 650);
  assert.equal(box.find((item) => item.uid === 'g649').count, 650);
});

test('interrupted migration resumes from its backup without losing or duplicating items', async () => {
  const storage = new MemoryStorage(), backup = new MemoryBackup();
  const raw = JSON.stringify([hero('ranger', [sigil('s1', 1, 7), ...Array(299).fill(null)])]);
  storage.setItem(SAVES, raw);
  storage.failKey = JEWEL_BOX_ACCOUNT_KEY;
  const interrupted = await ensureJewelBoxMigration({ storage, backupStore: backup });
  assert.equal(interrupted.ok, false);
  assert.equal(JSON.parse(storage.getItem(SAVES))[0].jewelBox.every((item) => item === null), true, 'source is recoverable from the journaled backup');
  const recovered = await ensureJewelBoxMigration({ storage, backupStore: backup });
  assert.equal(recovered.ok, true);
  assert.equal(jewelBoxAccount(storage).jewelBox.filter(Boolean).length, 1);
  assert.equal(jewelBoxAccount(storage).jewelBox.find(Boolean).count, 7);
  const repeated = await ensureJewelBoxMigration({ storage, backupStore: backup });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.migrated, false);
  assert.equal(jewelBoxAccount(storage).jewelBox.filter(Boolean).length, 1);
});

test('shared storage survives character deletion and is immediately visible to every character', async () => {
  const storage = new MemoryStorage(), backup = new MemoryBackup();
  storage.setItem(SAVES, JSON.stringify([hero('barbarian', [sigil('first', 4, 3), ...Array(299).fill(null)]), hero('monk', Array(300).fill(null))]));
  assert.equal((await ensureJewelBoxMigration({ storage, backupStore: backup })).ok, true);
  assert.equal(addToAccountJewelBox(sigil('second', 4, 2), storage), true);
  assert.equal(jewelBoxAccount(storage).jewelBox.find(Boolean).count, 5, 'every character reads the same persisted account store');
  storage.setItem(SAVES, '[]'); // deleting all heroes must not delete the independent account key
  const afterDeletion = jewelBoxAccount(storage);
  assert.equal(afterDeletion.jewelBox.find(Boolean).count, 5);
  afterDeletion.jewelBox[0] = null;
  assert.equal(saveJewelBoxAccount(afterDeletion, storage), true);
  assert.equal(jewelBoxAccount(storage).jewelBox[0], null);
});

test('window sizing widens the desktop panel slightly and keeps the ten-column grid responsive', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /body:not\(\.touch\) \.jewelbox-panel \{ width: min\(522px, calc\(100vw - 24px\)\); \}/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.jewelbox-panel \.jewelbox-grid \{ grid-template-columns: repeat\(10, minmax\(0, 1fr\)\); \}/);
});
