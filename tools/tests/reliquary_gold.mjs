import assert from 'node:assert/strict';
import {
  reliquary, resetReliquaryCache, transferReliquaryGold, recoverReliquaryGoldTransfer,
  MAX_RELIQUARY_GOLD,
} from '../../src/game/reliquary.js';
import { writeSave } from '../../src/game/save.js';

const savedStorage = globalThis.localStorage;
const storage = new Map([['velscour_campaign_overhaul_reset_v1', '1']]);
globalThis.localStorage = {
  get length() { return storage.size; },
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  key(index) { return [...storage.keys()][index] ?? null; },
};

try {
  resetReliquaryCache();
  assert.equal(reliquary().gold, 0, 'new account starts with zero shared gold');
  reliquary().tabs[0][0] = { type: 'gem', gem: 'ruby', tier: 3, count: 7 };
  assert.equal(reliquary().tabs[0][0].count, 7);
  const heroA = { id: 'gold-test-a', gold: 1000 };
  const heroB = { id: 'gold-test-b', gold: 200 };
  assert.equal(writeSave(heroA), true);
  assert.equal(writeSave(heroB), true);

  const deposited = transferReliquaryGold(heroA, 'deposit', 400, writeSave);
  assert.deepEqual({ ok: deposited.ok, persisted: deposited.persisted }, { ok: true, persisted: true });
  assert.equal(heroA.gold, 600);
  assert.equal(reliquary().gold, 400);

  const withdrawn = transferReliquaryGold(heroB, 'withdraw', 250, writeSave);
  assert.deepEqual({ ok: withdrawn.ok, persisted: withdrawn.persisted }, { ok: true, persisted: true });
  assert.equal(heroB.gold, 450, 'second character can withdraw another character’s deposit');
  assert.equal(reliquary().gold, 150);

  // Reload both stores from their serialized values, as on a restart/character switch.
  resetReliquaryCache();
  assert.equal(reliquary().gold, 150, 'shared balance reloads from account storage');
  assert.equal(reliquary().tabs[0][0].count, 7, 'existing shared vault contents remain untouched');
  let saves = JSON.parse(storage.get('velscour_saves_v1'));
  assert.equal(saves.find((c) => c.id === heroA.id).gold, 600);
  assert.equal(saves.find((c) => c.id === heroB.id).gold, 450);

  for (const [direction, amount] of [['deposit', 601], ['withdraw', 151], ['deposit', 0], ['withdraw', -1], ['deposit', 1.5], ['deposit', Number.MAX_SAFE_INTEGER + 1]]) {
    const before = { a: heroA.gold, vault: reliquary().gold };
    const result = transferReliquaryGold(heroA, direction, amount, writeSave);
    assert.equal(result.ok, false, `${direction} rejects invalid or unavailable amount ${amount}`);
    assert.deepEqual({ a: heroA.gold, vault: reliquary().gold }, before, 'rejected transfer changes neither balance');
  }

  // Interrupted second-key write: the prepared journal replays the exact intended balances once.
  const interrupted = transferReliquaryGold(heroA, 'deposit', 100, () => false);
  assert.equal(interrupted.ok, true);
  assert.equal(interrupted.persisted, false);
  assert.equal(heroA.gold, 500);
  assert.equal(reliquary().gold, 250);
  resetReliquaryCache();
  saves = JSON.parse(storage.get('velscour_saves_v1'));
  const recoveredHero = saves.find((c) => c.id === heroA.id);
  assert.equal(recoverReliquaryGoldTransfer(recoveredHero, writeSave), true);
  assert.equal(recoveredHero.gold, 500);
  assert.equal(reliquary().gold, 250);
  assert.equal(storage.get('velscour_reliquary_gold_tx_v1'), undefined, 'recovered transaction journal is cleared after both stores save');

  const account = reliquary();
  account.gold = MAX_RELIQUARY_GOLD - 5;
  const safeCharacter = { id: 'overflow-a', gold: 10 };
  assert.equal(writeSave(safeCharacter), true);
  assert.equal(transferReliquaryGold(safeCharacter, 'deposit', 6, writeSave).reason, 'overflow');
  account.gold = 1;
  const fullCharacter = { id: 'overflow-b', gold: MAX_RELIQUARY_GOLD };
  assert.equal(writeSave(fullCharacter), true);
  assert.equal(transferReliquaryGold(fullCharacter, 'withdraw', 1, writeSave).reason, 'overflow');

  console.log('Reliquary gold passed: zero initialization, cross-character deposit/withdraw, save reload, validation, overflow rejection, and interrupted-transfer recovery.');
} finally {
  resetReliquaryCache();
  if (typeof savedStorage === 'undefined') delete globalThis.localStorage;
  else globalThis.localStorage = savedStorage;
}
