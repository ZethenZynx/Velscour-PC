import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { UI } from '../../src/ui/ui.js';
import { townHappening, beginVictoryTownCelebration } from '../../src/game/happenings.js';
import { TOWN_REWARD_MAX_DEPTH, tickBlessing } from '../../src/game/defiance.js';
import { migrate, newCharData } from '../../src/game/save.js';

assert.equal(TOWN_REWARD_MAX_DEPTH, 25);
const saved = {
  char: G.char, player: G.player, world: G.world, random: Math.random,
  setTimeout: globalThis.setTimeout, localStorage: globalThis.localStorage,
  centerMsg: UI.centerMsg, log: UI.log, refresh: UI.refresh,
};
const pendingTimers = [];
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};
const notifications = [];
G.player = { buffs: [], recomputes: 0, recompute() { this.recomputes++; } };
UI.centerMsg = (...args) => notifications.push(['center', ...args]);
UI.log = (...args) => notifications.push(['log', ...args]);
UI.refresh = () => {};
globalThis.setTimeout = (fn, delay) => { pendingTimers.push({ fn, delay }); return pendingTimers.length; };
Math.random = () => 0; // Selects a guaranteed successful event roll and the first event key.

const act1Town = { kind: 'town', depth: 0, biome: { id: 'town' } };
let heroRewardedAt25;
function heroAt(depth) {
  return {
    depth, townVisitCount: 2, lastTownEvent: null, gold: 100,
    potions: { hp: 0, mp: 0, rejuv: 0, fury: 0 },
    equip: {}, bag: Array(36).fill(null), blessing: null,
  };
}

try {
  for (const depth of [1, 25]) {
    const c = heroAt(depth);
    G.char = c; G.world = act1Town;
    townHappening(act1Town);
    assert.equal(c.lastTownEvent, 'festival', `depth ${depth}: existing random event still occurs`);
    assert.deepEqual(c.potions, { hp: 3, mp: 3, rejuv: 1, fury: 0 }, `depth ${depth}: existing reward is unchanged`);
    if (depth === 25) heroRewardedAt25 = c;
  }

  const beyond = heroAt(26);
  beyond.townVisitCount = 20;
  beyond.lastTownEvent = 'oracle';
  beyond.blessing = { name: 'The Fortune Teller', left: 2, stats: { mf: 60, gf: 60 } };
  G.char = beyond; G.world = act1Town;
  const originalState = JSON.stringify({ gold: beyond.gold, potions: beyond.potions, bag: beyond.bag, last: beyond.lastTownEvent });
  for (let visit = 0; visit < 4; visit++) townHappening(act1Town);
  assert.equal(JSON.stringify({ gold: beyond.gold, potions: beyond.potions, bag: beyond.bag, last: beyond.lastTownEvent }), originalState, 'depth 26 grants no event reward and does not touch collected items or gold');
  assert.equal(beyond.blessing, null, 'legacy town-event blessing expires beyond depth 25');
  assert.equal(tickBlessing({ blessing: { left: 2, stats: { mf: 60 } } }, 26), true, 'blessing expires as soon as depth 26 is entered');
  const loadedBeyond = newCharData('paladin', 'Depth migration');
  loadedBeyond.depth = 26;
  loadedBeyond.blessing = { name: 'The Fortune Teller', left: 2, stats: { mf: 60, gf: 60 } };
  migrate(loadedBeyond);
  assert.equal(loadedBeyond.blessing, null, 'loading an existing depth-26 save expires the old town-event buff');

  const act2Hero = heroAt(1);
  G.char = act2Hero; G.world = { kind: 'town', depth: 0, biome: { id: 'act2_town' } };
  townHappening(G.world);
  assert.equal(act2Hero.lastTownEvent, null, 'random reward system remains specific to Act I town');

  // A delayed depth-25 announcement must not fire after the character has progressed to depth 26.
  const delayed = pendingTimers.at(-1);
  assert.ok(delayed, 'eligible event scheduled its existing delayed announcement');
  heroRewardedAt25.depth = 26;
  G.char = heroRewardedAt25; G.world = act1Town;
  const beforeNotificationCount = notifications.length;
  delayed.fn();
  assert.equal(notifications.length, beforeNotificationCount, 'pending town reward notification is cancelled after progression passes depth 25');

  // Fireworks are an independent saved first-victory celebration, including at endgame depth.
  beyond.townVictoryFireworksPending = true;
  const victoryTown = { kind: 'town', player: { x: 2, y: 2 } };
  assert.equal(beginVictoryTownCelebration(victoryTown, beyond), true, 'first-Velscour fireworks still trigger at depth 26');
  assert.equal(beyond.townVictoryFireworksDone, true);
  assert.equal(beyond.townVictoryFireworksPending, false);
  assert.equal(beginVictoryTownCelebration(victoryTown, beyond), false, 'fireworks remain one-time');

  console.log('Town random rewards pass at depths 1 and 25; depth 26 blocks repeat rewards, expires legacy buffs, cancels stale notification, and preserves one-time Velscour fireworks.');
} finally {
  G.char = saved.char; G.player = saved.player; G.world = saved.world;
  Math.random = saved.random; globalThis.setTimeout = saved.setTimeout;
  if (typeof saved.localStorage === 'undefined') delete globalThis.localStorage; else globalThis.localStorage = saved.localStorage;
  UI.centerMsg = saved.centerMsg; UI.log = saved.log; UI.refresh = saved.refresh;
}
