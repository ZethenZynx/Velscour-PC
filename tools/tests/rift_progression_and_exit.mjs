// Non-browser regressions for Rift tier progression, completion countdown and return safety.
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { MAX_RIFT_TIER, normalizeRiftTier, nextRiftTier, riftJump, riftHpMul, riftDmgMul,
  riftMaxQuality, riftMinQuality, riftQualityRange, normalProgressionDepth } from '../../src/data/rifts.js';
import { riftTick, restoreRiftCompletion, requestRiftReturn, riftOpen } from '../../src/game/rifts.js';
import { UI } from '../../src/ui/ui.js';

assert.equal(normalizeRiftTier(2 ** 31 + 50), 2 ** 31 + 50, 'tiers do not wrap at signed 32-bit boundary');
assert.equal(normalizeRiftTier(MAX_RIFT_TIER * 4), MAX_RIFT_TIER, 'tiers clamp to exact safe integer range');
assert.equal(normalizeRiftTier(-5), 1);
assert.equal(nextRiftTier(MAX_RIFT_TIER - 1, 3), MAX_RIFT_TIER);
assert.equal(riftOpen({ rifts: { open: 2 ** 31 + 50 } }), 2 ** 31 + 50);
assert.deepEqual([riftJump(0.5), riftJump(0.5001), riftJump(0.8), riftJump(0.8001)], [3, 2, 2, 1]);
for (let tier = 1; tier <= 1000; tier++) {
  assert.ok(Number.isFinite(riftHpMul(tier)) && riftHpMul(tier) >= 1, `Tier ${tier} finite health scale`);
  assert.ok(Number.isFinite(riftDmgMul(tier)) && riftDmgMul(tier) >= 1, `Tier ${tier} finite damage scale`);
  assert.ok(riftMaxQuality(tier) >= riftMinQuality(tier));
  assert.ok(riftMaxQuality(tier) <= 20 && riftMinQuality(tier) <= 20);
}
for (let tier = 1; tier <= 100; tier++) {
  const expectedMin = Math.min(20, 1 + Math.floor((tier - 1) / 5));
  const expectedMax = Math.min(20, 5 + Math.floor((tier - 1) / 5));
  assert.equal(riftMinQuality(tier), expectedMin, `Tier ${tier} minimum quality`);
  assert.equal(riftMaxQuality(tier), expectedMax, `Tier ${tier} maximum quality`);
}
assert.equal(riftHpMul(1), 1);
assert.equal(riftDmgMul(1), 1);
assert.ok(Math.abs(riftHpMul(2) - 1.1) < 1e-12);
assert.ok(Math.abs(riftDmgMul(2) - 1.06) < 1e-12);
assert.deepEqual(riftQualityRange(100, { level: 100, depth: 101, deepest: 100 }), {
  min: 5, max: 5, progressionMax: 5, normalDepth: 101,
});
assert.equal(normalProgressionDepth({ depth: 101, deepest: 100 }), 101);
assert.equal(riftQualityRange(100, { depth: 125, deepest: 124 }).max, 5);
assert.equal(riftQualityRange(100, { depth: 126, deepest: 125 }).max, 6);
assert.equal(riftQualityRange(100, { depth: 476, deepest: 475 }).max, 20);

const old = { char: G.char, world: G.world, game: G.game, show: UI.showRiftCompletion,
  update: UI.updateRiftCompletion, hide: UI.hideRiftCompletion, warn: UI.warnRiftCompletion };
let shown = null, updated = null, actions = null, warned = 0, hidden = 0, townTrips = 0, saves = 0;
try {
  G.char = { rifts: { open: 4 }, riftCompletionPending: null };
  G.player = { dead: false };
  G.game = { autosave() { saves++; }, enterTown() { townTrips++; } };
  UI.showRiftCompletion = (data, nextActions) => { shown = data; actions = nextActions; };
  UI.updateRiftCompletion = (data) => { updated = data; };
  UI.hideRiftCompletion = () => { hidden++; };
  UI.warnRiftCompletion = () => { warned++; };
  const world = { player: G.player, loot: [], rift: { tier: 3, t: 100, limit: 420, quota: 1, progress: 1,
    done: false, failed: false, guardian: null, hooks: {}, warned: {} } };
  G.world = world;
  const pending = { version: 1, tier: 3, result: { tier: 3, time: 100, timed: true, jump: 3, highest: 6, marks: 1, rewardSummary: '3 equipment' },
    completion: { remaining: 8, total: 10, blocked: false }, loot: [] };
  assert.equal(restoreRiftCompletion(world, pending), true);
  assert.equal(world.rift.done, true);
  assert.equal(world.rift.result.jump, 3);
  assert.equal(shown.tier, 3, 'saved completed Rift restores its card without replaying rewards');
  riftTick(world, 3);
  assert.equal(updated.remaining, 5);
  assert.equal(townTrips, 0, 'countdown remains active before it expires');
  actions.onMoreTime(); actions.onMoreTime();
  assert.equal(world.rift.completion.remaining, 65, 'More Time can be used repeatedly without restarting the card');
  actions.onCollect();
  assert.equal(world.rift.completion.remaining, 30, 'Collect Remaining Rewards offers a fresh 30-second collection window');
  world.loot.push({ riftCompletionReward: true, _lootRemoved: false });
  riftTick(world, 30);
  assert.equal(warned, 1, 'uncollected completion items block automatic return');
  assert.equal(world.rift.completion.blocked, true);
  assert.equal(townTrips, 0);
  assert.equal(requestRiftReturn(world, false), false, 'return now requires an explicit second confirmation with rewards left');
  assert.equal(requestRiftReturn(world, true), true, 'confirmed return succeeds');
  assert.equal(townTrips, 1);
  assert.equal(hidden, 1);
  assert.equal(saves, 1, 'completion handoff is persisted before leaving');
  assert.equal(G.char.riftCompletionPending, null);
  assert.equal(requestRiftReturn(world, true), false, 'duplicate transition cannot execute twice');

  const automatic = { player: G.player, loot: [], rift: { tier: 1, t: 1, limit: 420, quota: 1, progress: 1,
    done: true, failed: false, guardian: null, hooks: {}, warned: {}, result: { tier: 1, time: 1, timed: true, jump: 1 },
    completion: { remaining: 0.1, total: 10, blocked: false, returning: false, started: true } } };
  G.world = automatic;
  riftTick(automatic, 0.2);
  assert.equal(townTrips, 2, 'countdown expiry automatically returns to town when no completion rewards remain');
  riftTick(automatic, 2);
  assert.equal(townTrips, 2, 'automatic return is exactly once');
} finally {
  G.char = old.char; G.world = old.world; G.game = old.game;
  UI.showRiftCompletion = old.show; UI.updateRiftCompletion = old.update;
  UI.hideRiftCompletion = old.hide; UI.warnRiftCompletion = old.warn;
}

console.log('Abyssal Rift progression, difficulty, quality bands, overflow protection and completion recovery passed.');
