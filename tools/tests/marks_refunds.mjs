// Non-browser regression checks for exact, one-time per-upgrade rank refunds.
// Run: node tools/tests/marks_refunds.mjs
import assert from 'node:assert/strict';

const originalStorage = globalThis.localStorage;
const data = new Map();
globalThis.localStorage = {
  getItem(key) { return data.get(key) ?? null; },
  setItem(key, value) { data.set(key, String(value)); },
  removeItem(key) { data.delete(key); },
};

try {
  const { G } = await import('../../src/state.js');
  const EG = await import('../../src/game/endgame.js');
  const Marks = await import('../../src/game/marks.js');
  EG.resetEndgameCache();
  let recomputes = 0, refreshes = 0;
  G.world = null;
  G.player = { recompute() { recomputes++; } };
  G.ui = { refresh() { refreshes++; }, log() {} };
  const record = EG.endgame().marks;
  record.pts = 1000;

  const purchased = Marks.purchaseUpgrade('haste', 5);
  assert.equal(purchased, 5);
  const spent = Marks.purchaseCost('haste', 0, 5);
  assert.equal(record.spentValue, spent, 'purchases store the exact escalating rank cost');
  assert.equal(Marks.marksIn('haste'), 5);
  assert.equal(Marks.refundCost('haste', 2), Marks.purchaseCost('haste', 3, 2), 'refund amount is the exact cost of the latest ranks');

  const result = Marks.refundUpgrade('haste', 2);
  assert.deepEqual(result, { ranks: 2, marks: Marks.purchaseCost('haste', 3, 2) });
  assert.equal(Marks.marksIn('haste'), 3);
  assert.equal(record.spentValue, Marks.purchaseCost('haste', 0, 3));
  assert.equal(Marks.marksFree(), 1000 - record.spentValue);
  assert.equal(recomputes, 2, 'purchase and refund immediately recompute player stats');
  assert.equal(refreshes, 2, 'purchase and refund refresh the UI');
  const nextRefund = Marks.refundUpgrade('haste', 2);
  assert.deepEqual(nextRefund, { ranks: 2, marks: Marks.purchaseCost('haste', 1, 2) }, 'a later refund applies only to ranks still owned');
  assert.equal(Marks.marksIn('haste'), 1);
  assert.equal(record.spentValue, Marks.purchaseCost('haste', 0, 1));

  const allRemaining = Marks.refundUpgrade('haste', 99);
  assert.equal(allRemaining.ranks, 1, 'MAX refunds only ranks actually owned');
  assert.equal(allRemaining.marks, Marks.purchaseCost('haste', 0, 1));
  assert.equal(Marks.marksIn('haste'), 0);
  assert.equal(Marks.marksFree(), 1000);

  EG.resetEndgameCache();
  assert.equal(Marks.marksIn('haste'), 0, 'rank and refunded balance persist after reloading the shared record');
  assert.equal(Marks.marksFree(), 1000);
  assert.equal(Marks.refundCost('haste', 'max'), 0, 'a zero-rank upgrade has no refundable cost');
  assert.equal(Marks.refundUpgrade('haste', 'max'), null, 'MAX cannot refund an upgrade with no ranks');
  console.log('Infernal Mark refunds preserve exact rank costs, recompute immediately, persist, and cannot be duplicated.');
} finally {
  if (typeof originalStorage === 'undefined') delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
}
