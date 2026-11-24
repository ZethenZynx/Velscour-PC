// Abyssal Rifts (docs/ENDGAME.md, docs/ENDGAME_OVERHAUL.md): the run inside a rift level.
import { G } from '../state.js';
import { rand, chance, pick, escapeHtml } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { addEffect, Ring, Column, Bolt, sparkle, floatText } from '../gfx/vfx.js';
import { UI } from '../ui/ui.js';
import { makeRaidBoss, RAID_BOSSES } from './raid.js';
import { GroundItem, rollGroundItem, rollGroundGem, groundRewardSigilDepth } from './loot.js';
import { rollSigil, goldPile } from '../data/items.js';
import { hit } from './combat.js';
import { RIFT_TIME, RIFT_QUOTA, RIFT_DENSITY, RIFT_GUARDIAN_HP, PYLONS, riftDepth, riftLevel, riftLootDepth, riftJump, riftWeight, riftReward, fmtTime, instabilitiesForTier, normalizeRiftTier, nextRiftTier, riftHpMul, riftDmgMul } from '../data/rifts.js';
import { markBonuses, grantMarksWithBonus, riftMarks } from './marks.js';
import { heroDamage } from './heroDamage.js';
import { noteRiftBest, endgame } from './endgame.js';
import { barred } from './leaderboard.js';

export { RIFT_TIME, RIFT_QUOTA, RIFT_DENSITY, riftDepth, riftLevel, riftLootDepth, riftJump, riftReward, fmtTime };
/** The clock a rift gives: the base plus Haste Marks. */
export const riftTime = () => RIFT_TIME + markBonuses().rift;
/** May the hero enter tier T: 1 .. the tier his wins opened. */
export const riftOpen = (c = G.char) => normalizeRiftTier(c?.rifts?.open ?? 1);
export { riftHpMul, riftDmgMul, normalizeRiftTier, nextRiftTier };

const completionLootRemain = (world) => !!world?.loot?.some((loot) => loot?.riftCompletionReward && !loot._lootRemoved);
const completionData = (world) => {
  const R = world?.rift, C = R?.completion, result = R?.result || {};
  return {
    tier: R?.tier || 1, time: fmtTime(result.time ?? R?.t ?? 0), timed: !!result.timed,
    highest: G.char?.rifts?.open || 1, additional: result.jump || 0, marks: result.marks || 0,
    rewardSummary: result.rewardSummary || '', remaining: C?.remaining ?? 10, total: C?.total ?? 10,
    blocked: !!C?.blocked,
  };
};

/** Explicit completion return; the caller must confirm before leaving uncollected completion loot. */
export function requestRiftReturn(world = G.world, confirmed = false) {
  const R = world?.rift, C = R?.completion;
  if (!R?.done || R.failed || !C || C.returning || G.world !== world) return false;
  if (!confirmed && completionLootRemain(world)) {
    C.blocked = true;
    UI.warnRiftCompletion();
    UI.updateRiftCompletion(completionData(world));
    return false;
  }
  C.returning = true;
  if (G.char) G.char.riftCompletionPending = null;
  UI.hideRiftCompletion();
  sfx('portal');
  // Persist the one-way completion handoff before replacing the Rift world.
  G.game?.autosave?.();
  G.game?.enterTown?.();
  return true;
}

/** Restore an already paid Rift completion without replaying its boss or granting rewards again. */
export function restoreRiftCompletion(world, pending) {
  const R = world?.rift;
  if (!R || !pending || pending.version !== 1) return false;
  R.tier = normalizeRiftTier(pending.tier);
  R.done = true; R.failed = false; R.timedOut = !pending.result?.timed;
  R.guardian = null; R.progress = R.quota;
  R.result = pending.result && typeof pending.result === 'object' ? pending.result : {};
  const remaining = Math.max(0, Number(pending.completion?.remaining) || 0);
  R.completion = {
    remaining, total: Math.max(remaining, Number(pending.completion?.total) || 10),
    blocked: !!pending.completion?.blocked, returning: false, started: true,
    warningPlayed: !!pending.completion?.warningPlayed,
  };
  R.completionShown = false;
  showRiftCompletion(world, false);
  UI.updateRiftCompletion(completionData(world));
  return true;
}

function updateRiftCompletion(world, dt) {
  const R = world.rift, C = R.completion;
  if (!C || C.returning) return;
  if (C.blocked && !completionLootRemain(world)) {
    requestRiftReturn(world, true);
    return;
  }
  if (!C.blocked) C.remaining = Math.max(0, C.remaining - dt);
  if (!C.blocked && C.remaining > 0 && C.remaining <= 3 && !C.warningPlayed) {
    C.warningPlayed = true;
    sfx('error');
  }
  if (C.remaining <= 0 && completionLootRemain(world)) {
    C.remaining = 0;
    C.blocked = true;
    UI.warnRiftCompletion();
  } else if (C.remaining <= 0) {
    requestRiftReturn(world, true);
    return;
  }
  UI.updateRiftCompletion(completionData(world));
}

function showRiftCompletion(world, playSound = true) {
  const R = world.rift;
  if (R.completionShown || !R.completion) return;
  R.completionShown = true;
  UI.showRiftCompletion(completionData(world), {
    onReturn: (confirmed) => requestRiftReturn(world, confirmed),
    onMoreTime: () => {
      if (R.completion.returning) return;
      R.completion.blocked = false;
      R.completion.remaining += 30;
      R.completion.total += 30;
      R.completion.warningPlayed = false;
      UI.updateRiftCompletion(completionData(world));
    },
    onCollect: () => {
      if (R.completion.returning) return;
      R.completion.blocked = false;
      R.completion.remaining = 30;
      R.completion.total = Math.max(30, R.completion.total + 30);
      R.completion.warningPlayed = false;
      UI.updateRiftCompletion(completionData(world));
    },
  });
  if (playSound) sfx('gate');
}

/** The run object, kept on world.rift. */
export function createRiftRun(world, gen, tier, hooks = {}) {
  const total = world.creatures.reduce((s, m) => s + (m.team === 'enemy' && !m.dead ? riftWeight(m) : 0), 0);
  const run = {
    tier, t: 0, limit: riftTime(), progress: 0, total: Math.max(1, total), quota: Math.max(1, Math.ceil(total * RIFT_QUOTA)),
    guardian: null, done: false, failed: false, deaths: 0, gen, world, hooks, warned: {},
    get left() { return Math.max(0, this.limit - this.t); },
    get pct() { return Math.min(100, Math.floor((this.progress / this.quota) * 100)); },
    label() { return `TIER ${this.tier} · ${fmtTime(this.left)} · ${this.guardian ? (this.guardian.dead ? 'cleared' : 'the Guardian') : this.pct + '%'}`; },
  };
  return run;
}

/** A kill in a rift: progress toward the Guardian. */
export function riftKill(world, m) {
  const R = world.rift;
  if (!R || R.done || R.failed) return;
  const w = riftWeight(m);
  if (!w) return;
  R.progress += w;
  if (!R.guardian && R.progress >= R.quota) spawnGuardian(world);
}

/** Activate a Pylon buff for the party */
export function activatePylon(world, def) {
  const p = world.player;
  if (!p) return;
  UI.centerMsg(def.name.toUpperCase(), def.desc, 3.0);
  UI.log(`<b style="color:${def.color}">${def.name}</b> activated! ${def.desc}`, def.color);
  addEffect(new Ring(p.x, p.y, 0.4, 8, 1.2, def.color, 8));
  addEffect(new Column(p.x, p.y, def.color, 1.5, 50, 300));
  sfx('holy'); sfx('boss');
  p.pylonBuff = { id: def.id, timer: def.dur, dur: def.dur, def };
  // Cache the player's average main-attack hit; p.st.attack is not a player stat.
  if (def.id === 'conduit') {
    const attack = heroDamage(p).atk;
    p.pylonBuff.zap = Number.isFinite(attack) && attack > 0 ? attack : 0;
  }
  if (def.id === 'aegis') p.invuln = def.dur;
}

/** The Guardian stirs in the boss room once quota is met */
export function spawnGuardian(world) {
  const R = world.rift;
  if (!R || R.guardian) return null;
  const A = R.gen?.raid || R.gen?.bossRoom;
  if (!A) return null;

  const depth = world.depth, lvl = riftLevel(R.tier);
  const c = G.char, tpl = pick(RAID_BOSSES.filter((b) => !b.sigs && b.id !== (c && c.lastRiftBoss)));
  if (c) c.lastRiftBoss = tpl.id;

  const m = makeRaidBoss(world, A, depth, lvl + 3, { tpl, hp: RIFT_GUARDIAN_HP });
  world.add(m);
  world.boss = m; world.raid = m.raid;
  R.guardian = m; R.gT = R.t;
  const od = m.onDeath;
  m.onDeath = () => { od(); riftWin(world, m); };
  m.raid.announced = true;

  // Reveal the boss room on the map so the player knows where to head
  if (world.map) {
    world.map.reveal(A.cx, A.cy, 18);
  }

  UI.centerMsg('THE GUARDIAN STIRS IN THE BOSS ROOM', `${m.name}, ${m.title}`, 3.2);
  UI.log(`<b style="color:#20e0ff">The Guardian stirs in the Boss Room:</b> ${escapeHtml(m.name)}. Enter the arena and slay it before the clock runs out!`, '#a0f0ff');
  addEffect(new Ring(m.x, m.y, 0.4, 8, 1.2, '#20e0ff', 8)); sfx('roar'); sfx('boss');
  return m;
}

/** Death penalty in co-op/solo rift */
export function riftDeathPenalty(world) {
  const R = world.rift;
  if (!R || R.done || R.failed) return;
  R.deaths = (R.deaths || 0) + 1;
  const penalty = Math.min(25, 5 * R.deaths);
  R.t += penalty;
  UI.log(`<b style="color:#ff6050">+${penalty}s death penalty added to the Rift clock!</b>`, '#ff9090');
}

/** The clock and active pylon ticks */
export function riftTick(world, dt) {
  const R = world.rift, p = world.player;
  if (R && R.failed && R.backT > 0) { if ((R.backT -= dt) <= 0 && R.hooks.onBack) R.hooks.onBack(); return; }
  if (!R || R.failed || !p) return;
  if (R.done) {
    // Recover legacy completed runs that predate the completion card; do not replay rewards.
    if (!R.completion) {
      R.completion = { remaining: 10, total: 10, blocked: completionLootRemain(world), returning: false, started: true };
      if (!R.result) R.result = { tier: R.tier, timed: !R.timedOut, jump: 0, marks: 0, rewardSummary: 'Previously granted Rift rewards' };
    }
    showRiftCompletion(world);
    updateRiftCompletion(world, dt);
    return;
  }

  // Pylon buff processing
  if (p.pylonBuff && p.pylonBuff.timer > 0) {
    p.pylonBuff.timer -= dt;
    const b = p.pylonBuff;
    if (b.id === 'conduit' && chance(dt * 3.5)) {
      const targets = world.creatures.filter((m) => m.team === 'enemy' && !m.dead && Math.hypot(m.x - p.x, m.y - p.y) < 10);
      if (targets.length) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        addEffect(Bolt(p.x, p.y, 25, target.x, target.y, 25, '#30b0ff', 0.15, 4));
        sfx('spark');
        hit(p, target, (b.zap || 0) * 4.5 * (1 + (R.tier || 1) * 0.1), 'light');
        sparkle(target.x, target.y, 10, '#30b0ff', 12, 0.5);
      }
    }
    if (b.timer <= 0) {
      UI.log(`<b style="color:${b.def.color}">${b.def.name}</b> has expired.`, '#ccc');
      p.pylonBuff = null;
    }
  }

  if (p.dead) return;
  R.t += dt;
  const left = R.left;
  for (const [at, msg] of [[60, 'One minute left in the Rift!'], [30, 'Thirty seconds!'], [10, 'Ten seconds!']]) {
    if (left <= at && !R.warned[at]) { R.warned[at] = true; UI.centerMsg(fmtTime(at), 'The Rift is closing', 1.8); sfx('error'); }
  }
  if (left <= 0 && !R.timedOut) {
    R.timedOut = true;
    UI.centerMsg('RIFT TIMER EXPIRED', 'Defeat the Guardian in overtime; no additional tiers will unlock.', 3.2);
    UI.log('<b style="color:#ffb86b">Rift time expired.</b> You may still defeat the Guardian and claim completion rewards, but this run will not unlock more tiers.', '#ffb86b');
    sfx('error');
  }
}

/** The Guardian is dead: The Grand Piñata reward explosion */
export function riftWin(world, m) {
  const R = world.rift, c = G.char, p = world.player;
  if (!R || R.done || R.failed) return;
  const tier = normalizeRiftTier(R.tier);
  R.done = true;
  const time = Math.max(0, Number(R.t) || 0), timed = !R.timedOut && time <= R.limit;
  const jump = timed ? riftJump(time / R.limit) : 0;
  c.rifts ||= { open: 1, best: 0, cleared: {}, bestTime: {}, runs: 0, fails: 0, deaths: 0 };
  const first = !c.rifts.cleared[tier];
  c.rifts.cleared[tier] = (c.rifts.cleared[tier] || 0) + 1;
  c.rifts.best = Math.max(c.rifts.best || 0, tier);
  c.rifts.open = Math.max(riftOpen(c), nextRiftTier(tier, jump));
  c.rifts.bestTime[tier] = Math.min(c.rifts.bestTime[tier] || 1e9, Math.round(time * 10) / 10);
  const rewardScale = 1 + (p?.st?.markRiftRewards || 0) / 100;
  const scaledCount = (n) => Math.floor(n * rewardScale) + (chance((n * rewardScale) % 1) ? 1 : 0);
  const marks = grantMarksWithBonus(riftMarks(tier), `for Tier ${tier}`, world, p?.st?.markRiftRewards || 0);

  // The Grand Piñata Reward Hoard:
  const RW = riftReward(tier, first), lvl = 100, lootDepth = riftLootDepth(tier);
  const itemCount = scaledCount(RW.items || 4), sigilCount = scaledCount(RW.sigils), gemCount = scaledCount(3);
  let keyCount = 0;
  const drop = (kind, data) => {
    const loot = new GroundItem(m.x + rand(-2.0, 2.0), m.y + rand(-2.0, 2.0), kind, data);
    loot.riftCompletionReward = true;
    return world.addLoot(loot);
  };

  // Equipment drops
  for (let i = 0; i < itemCount; i++) {
    const enhancedWeight = (i === 0 && chance(RW.abyssal)) || (RW.abyssal >= 1 && i < 2);
    drop('item', { item: rollGroundItem(lvl, { world, mf: p ? p.st.magicFind : 0, bonus: enhancedWeight ? 1.35 : 0.35 }) });
  }

  // Abyssal Keys for Unbound Exploration
  if (RW.keys > 0) {
    keyCount = scaledCount(RW.keys);
    for (let k = 0; k < keyCount; k++) drop('key', {});
    UI.log(`<b style="color:#20e0ff">+${keyCount} Abyssal Key${keyCount > 1 ? 's' : ''}</b> dropped! Use them at the town portal for Unbound Exploration.`, '#a0f0ff');
  }

  // Sigils, Gems & Gold
  for (let i = 0; i < sigilCount; i++) drop('item', { item: rollSigil(groundRewardSigilDepth(world, lootDepth), RW.sigilBonus) });
  for (let i = 0; i < gemCount; i++) drop('item', { item: rollGroundGem(lvl + 4, world) });
  for (let i = 0; i < 6; i++) drop('gold', { amount: Math.round(goldPile(lvl) * rand(3, 6) * (1 + (((p && p.st.goldFind) || 0) + (p?.st?.markGold || 0)) / 100) * rewardScale) });

  // Records
  const cheat = barred(c), best = !cheat && noteRiftBest(c.classId, tier, time);
  const unlocked = Math.max(1, normalizeRiftTier(c.rifts.open));
  const rewardSummary = `${itemCount} equipment · ${sigilCount} sigils · ${gemCount} gems · ${keyCount} key${keyCount === 1 ? '' : 's'}`;
  R.result = { tier, time, jump, next: nextRiftTier(tier, jump), highest: unlocked, marks, first, timed, rewardSummary, best, personal: c.rifts.bestTime[tier] === Math.round(time * 10) / 10 };
  R.completion = { remaining: 10, total: 10, blocked: false, returning: false, started: true };
  UI.log(`<b style="color:#20e0ff">Abyssal Rift Tier ${tier}</b> completed in ${fmtTime(time)} (${timed ? 'timed success' : 'overtime'}): ${jump ? `+${jump} tiers unlocked` : 'no additional tiers unlocked'}${best ? ', <b>a new best</b> for your ' + c.classId.replace('_', ' ') : ''}.`, '#a0f0ff');
  addEffect(new Column(m.x, m.y, '#20e0ff', 1.4, 60, 420)); G.flash = 0.5;
  showRiftCompletion(world);
  if (R.hooks.onWin) R.hooks.onWin(R.result);
}

/** The hero left a rift: fail */
export function riftLeave(world) {
  const R = world.rift, c = G.char;
  if (!R || R.done || R.failed || !c) return;
  R.failed = true;
  c.rifts.fails = (c.rifts.fails || 0) + 1;
}

export { pick };
