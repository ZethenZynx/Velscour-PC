// Heresies (docs/ENDGAME.md, data/heresies.js): the difficulty modifiers a hero switches on at the Altar of Heresy
// from the beginning. They are read when a level is built (game.buildDungeon / buildBreach: heresySpawns and
// heresyWorld, alongside endgame Greed rewards) and never in Abyssal Rifts or Velscour Unbound; heresyTick (from happeningsTick)
// marks every enemy as it appears. The hero's own ones (Glass Cannon, Dry Throat, Hunger) read the level he is in, so
// a rift is played clean. Saves keep c.heresy.on; the rank's rewards are heresyMods in data/heresies.js.
import { G } from '../state.js';
import { chance, pick, rand, angleTo, dist, shuffle, escapeHtml } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { addEffect, Telegraph, Ring, smoke, floatText } from '../gfx/vfx.js';
import { explosionFx } from '../gfx/shapes.js';
import { ELITE_AFFIXES } from '../data/enemies.js';
import { HERESIES, HERESY_BY_ID, HERESY_MAX_RANK, heresyRank, heresyMods, KEYS_RANK, MARKS_RANK } from '../data/heresies.js';
import { ARCH } from '../data/enemies.js';
import { depthLevel } from '../data/depth.js';
import { makeMonster } from './monster.js';
import { hit } from './combat.js';

export { HERESIES, HERESY_BY_ID, HERESY_MAX_RANK, heresyRank, heresyMods, KEYS_RANK, MARKS_RANK };

/** The Heresies this hero has switched on (ids). */
export const heresiesOf = (c = G.char) => (c && c.heresy && Array.isArray(c.heresy.on) ? c.heresy.on.filter((id) => HERESY_BY_ID[id]) : []);
export const heresyRankOf = (c = G.char) => heresyRank(heresiesOf(c));
/** The Heresies the level was built with (none in town, rifts and Unbound). */
export const worldHeresies = (w = G.world) => (w && w.heresy ? w.heresy.ids : []);
export const worldRank = (w = G.world) => (w && w.heresy ? w.heresy.rank : 0);

/** Pure roll helper; callers pass a seed-derived RNG so a generated floor never rerolls on reopen. */
export function rollHeresyEncounters(rank, random = Math.random) {
  return {
    bounty: rank >= 30 && random() < 0.15,
    hunt: rank >= 40 && random() < 0.20,
    sanctum: rank >= 50 && random() < 0.10,
    retribution: rank >= 60 && random() < 0.05,
  };
}
/** Is a Heresy in force where the hero stands: the level's set in a dungeon, the hero's own in town. */
export function heresyActive(id, c = G.char, w = G.world) {
  return (w && w.kind === 'dungeon' ? worldHeresies(w) : heresiesOf(c)).includes(id);
}
/** Switch one on or off (the altar). It takes hold from the next level built. */
export function setHeresy(id, on, c = G.char) {
  if (!c || !HERESY_BY_ID[id]) return false;
  const ids = heresiesOf(c), has = ids.includes(id);
  if (!!on === has) return false;
  c.heresy = { on: on ? [...ids, id] : ids.filter((k) => k !== id) };
  const H = HERESY_BY_ID[id], rank = heresyRankOf(c), M = heresyMods(rank);
  if (G.ui && G.ui.log) G.ui.log(`<b style="color:${H.color}">${escapeHtml(H.name)}</b> ${on ? 'embraced' : 'renounced'}: Heresy rank <b>${rank}</b> (x${M.loot.toFixed(2)} drops, +${M.mf}% magic find, +${Math.round((M.xp - 1) * 100)}% XP) from the next level.`, '#ffb090');
  if (G.player) G.player.recompute();
  return true;
}
/** One line naming what is on. */
export const heresyText = (ids) => (ids && ids.length ? ids.map((id) => HERESY_BY_ID[id] && HERESY_BY_ID[id].name).filter(Boolean).join(' · ') : 'none');

// ---------------------------------------------------------------- building a level
/** Pack spawns of a fresh level: Twinned Packs double every pack (not guardians, raid bosses or Velscour). */
export function heresySpawns(spawns, ids) {
  if (!Array.isArray(spawns) || !ids?.length) return spawns;
  const out = spawns.map((s, i) => {
    if (!s.n || ['raid', 'boss'].includes(s.rank)) return s;
    let next = ids.includes('twins') ? { ...s, n: s.n * 2 } : s;
    // Fixed pack cadence avoids per-spawn random rolls and uncontrolled population
    // multiplication when combined with Greed's independent density increase.
    if (ids.includes('champions_dominion') && i % 4 === 1 && next.rank === 'normal') next = { ...next, champ: true };
    return next;
  });
  if (ids.includes('rare_convergence')) {
    for (let i = 5; i < spawns.length; i += 8) {
      const s = spawns[i];
      if (s?.n && !['raid', 'boss', 'unique'].includes(s.rank)) out.push({ ...s, n: 1, rank: 'unique', champ: false, heresyRare: true, name: 'Heretical Harbinger' });
    }
  }
  return out;
}
/** Which Heresies a level is built with: set before its monsters are made (BOSS ROOM bosses read it), none in rifts and Unbound. */
export function heresyBegin(world, c = G.char) {
  if (!world || world.kind !== 'dungeon' || world.rift || world.unbound || world.unboundExploration) { if (world) world.heresy = null; return []; }
  const ids = heresiesOf(c);
  world.heresy = { ids, rank: heresyRank(ids), encounters: null };
  return ids;
}
/** The level's dials once built (after the omen and Greed): rewards by rank, the Legion's clock, ambush pace. */
export function heresyWorld(world, c = G.char) {
  if (world?.heresyApplied) return;
  if (!world || !world.heresy) heresyBegin(world, c);
  if (!world || !world.heresy) return;
  const { ids, rank } = world.heresy;
  if (!rank) return;
  world.heresyApplied = true;
  const M = heresyMods(rank);
  // Keep Greed and Heresy reward percentages additive. Legacy enemy/item drops
  // still receive the same rank 1–26 values via these world bonus dials.
  world.heresyLootPct = Math.round((M.loot - 1) * 100);
  world.heresyGoldPct = Math.round((M.gold - 1) * 100);
  world.heresyXpPct = Math.round((M.xp - 1) * 100);
  world.xpBonusPct = (world.xpBonusPct || 0) + world.heresyXpPct;
  world.mfAdd = (world.mfAdd || 0) + M.mf;
  world.sigilMul = (world.sigilMul || 1) * M.sigil;
  world.relicMul = (world.relicMul || 1) * M.relic; // (XP: per monster, heresyMonster)
  if (!world.heresy.encounters) {
    const seed = Number(world.environmentTrapSeed || world.chestSeed || world.depth || 1) >>> 0;
    let state = (seed ^ Math.imul(rank + 1, 0x9e3779b1)) >>> 0;
    const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    world.heresy.encounters = rollHeresyEncounters(rank, random);
  }
  if (ids.includes('ambush')) world.heresyAmbush = 3;
  if (ids.includes('hostile_terrain')) world.heresyTrapIntervalMul = 0.75;
  if (ids.includes('legion')) world.legionT = rand(25, 40);
  if (ids.includes('hunger')) { // no orbs from any source (kills, chests, the Feeding Frenzy affix, ...)
    const add = world.addLoot;
    world.addLoot = function (l) { return l && l.kind && l.kind.startsWith('orb_') ? l : add.call(this, l); };
  }
}

/** Install the once-per-generated-floor optional Heresy encounters. */
export function spawnHeresyEncounters(world, makePortal = null) {
  const H = world?.heresy;
  if (!H?.rank || H.encountersSpawned || world.rift || world.unbound || world.unboundExploration) return false;
  H.encountersSpawned = true;
  const plan = H.encounters || (H.encounters = rollHeresyEncounters(H.rank));
  const c = G.char;
  c.heresyRewards ||= { bountyClaims: {}, huntClaims: {}, sanctumClaims: {}, retributionClaims: {}, throneComplete: false };
  const runKey = `${world.biome?.id || 'dungeon'}:${world.depth || 1}:${Number(world.environmentTrapSeed || world.chestSeed || 0) >>> 0}`;
  if (c.heresyRewards.huntClaims?.[runKey]) plan.hunt = false;
  if (c.heresyRewards.retributionClaims?.[runKey]) plan.retribution = false;
  if (c.heresyRewards.sanctumClaims?.[runKey]) plan.sanctum = false;
  const roster = (world.roster || world.biome?.roster || []).filter((id) => ARCH[id]);
  const reachable = world.map.movementReachable?.(world.startPos || [world.player?.x || 0, world.player?.y || 0], 0.24) || [];
  const pts = [];
  for (let i = 0; i < reachable.length; i++) if (reachable[i]) {
    const x = i % world.map.w + 0.5, y = Math.floor(i / world.map.w) + 0.5;
    const nearTrap = (world.environmentTraps || []).some((site) => Math.hypot(site.x - x, site.y - y) < 3.2);
    const nearObject = [...(world.chests || []), ...(world.portals || []), ...(world.npcs || [])].some((o) => Number.isFinite(o?.x) && Math.hypot(o.x - x, o.y - y) < 2.5);
    if (world.map.circleFree(x, y, 0.45) && !nearTrap && !nearObject && (!world.player || dist(x, y, world.player.x, world.player.y) > 7)) pts.push([x, y]);
  }
  const point = (n) => pts.length ? pts[(Math.imul(n + 1, 2654435761) >>> 0) % pts.length] : null;
  const makeNamed = (name, style, idx, rank = 'unique', rewardKind = 'hunt') => {
    if (!roster.length) return null;
    const wanted = style === 'reaver' ? ['charger', 'brute', 'melee'] : style === 'cantor' ? ['caster', 'beamer', 'nova'] : ['ranged', 'caster', 'brute'];
    const candidates = roster.filter((id) => wanted.includes(ARCH[id]?.ai));
    const arch = (candidates.length ? candidates : roster)[idx % (candidates.length || roster.length)];
    const spawnPoint = point(idx + (style === 'reaver' ? 17 : style === 'cantor' ? 31 : 0));
    if (!spawnPoint) return null;
    const [x, y] = spawnPoint;
    const m = makeMonster(world, arch, world.biome, depthLevel(world.depth || 1) + 2, rank, x, y, 0);
    if (!m) return null;
    m.name = name; m.heresyChampion = style; m.depthBountyMark = true; m.heresyMarked = true;
    m.maxHp *= rank === 'boss' ? 2.1 : 1.55; m.hp = m.maxHp; m.dmg *= rank === 'boss' ? 1.45 : 1.3;
    if (style === 'reaver') m.speed *= 1.15;
    m.aura = style === 'cantor' ? '#a56be0' : style === 'reaver' ? '#ffd060' : '#ff572e';
    m.heresyEncounterKey = runKey; m.heresyRewardKind = rewardKind;
    m.onKilled = () => {
      const claims = c.heresyRewards ||= { bountyClaims: {}, huntClaims: {}, sanctumClaims: {}, retributionClaims: {}, throneComplete: false };
      const field = rewardKind === 'retribution' ? 'retributionClaims' : 'huntClaims';
      claims[field] ||= {};
      if (claims[field][runKey]) { m.noLoot = true; return; }
      claims[field][runKey] = true;
      world.heresyRewardChest?.(m, rewardKind);
      G.game?.autosave?.();
    };
    heresyMonster(m, H.ids); world.add(m); m.awake = true;
    return m;
  };
  if (plan.hunt) {
    const names = ["Ashen Harrower", 'Sable Apostle', 'Gravebound Reaver'];
    const styles = ['harrower', 'cantor', 'reaver'];
    const i = Math.abs((Number(world.environmentTrapSeed) || Number(world.depth) || 1) | 0) % names.length;
    const m = makeNamed(names[i], styles[i], i);
    if (m) { floatText(m.x, m.y, 70, 'HERETICAL CHAMPION', '#ffbd65', 10); UI.log(`<b style="color:#ff8050">${escapeHtml(m.name)}</b> has entered the hunt.`, '#ffb090'); }
  }
  if (plan.retribution && !H.retributionStarted) {
    H.retributionStarted = true;
    const m = makeNamed("Velscour's Avenger", 'reaver', 9, 'unique', 'retribution');
    if (m) {
      m.maxHp *= 1.35; m.hp = m.maxHp;
      addEffect(new Telegraph({ kind: 'circle', x: m.x, y: m.y, r: 1.8, dur: 1.4, color: '#ff3c20' }), 'ground');
      floatText(m.x, m.y, 86, "VELSCOUR'S RETRIBUTION", '#ff6840', 11);
      sfx('roar', 0.55);
      UI.centerMsg('VELSCOUR’S RETRIBUTION', 'An infernal champion answers your Heresy.', 2.4);
    }
  }
  if (plan.sanctum && typeof makePortal === 'function' && !H.sanctumPortalCreated) {
    const sanctumPoint = point(47);
    H.sanctumPortalCreated = !!(sanctumPoint && makePortal(sanctumPoint));
  }
  return plan;
}
/** Each enemy as it appears (packs, ambushes, adds): Iron Hide, Cruel Hand, Velscour's Gaze, Crowned Champions, the XP bonus. */
export function heresyMonster(m, ids) {
  if (!m || m._heresy || m.team !== 'enemy' || m.summon) return;
  m._heresy = true;
  if (!ids || !ids.length) return;
  if (ids.includes('iron')) { m.maxHp *= 1.5; m.hp *= 1.5; }
  if (ids.includes('cruel')) m.dmg *= 1.3;
  if (ids.includes('unholy_resilience')) m.heresyRegen = 0.01;
  if (ids.includes('relentless_assault')) m.heresyAttackRate = 1.25;
  if (ids.includes('swift_pursuit')) m.speed *= 1.3;
  if (ids.includes('infernal_fortification')) m.heresyDamageReduction = 0.20;
  if (ids.includes('gaze')) { m.aggroRange = (m.aggroRange ?? 8.5) * 2; m.gaze = true; } // (a raid boss's 0 stays 0; Monster.pickTarget: an awake one never loses the hero)
  if (ids.includes('crowned') && (m.rank === 'champion' || m.rank === 'unique') && m.affixes) {
    const keys = Object.keys(ELITE_AFFIXES).filter((k) => !m.affixes.includes(k) && (k !== 'multishot' || ['ranged', 'caster'].includes(m.ai)));
    for (const k of shuffle(keys).slice(0, m.rank === 'champion' ? 2 : 1)) {
      m.affixes.push(k);
      if (k === 'strong') m.dmg *= 1.5;
      if (k === 'fast') { m.speed *= 1.4; m.atkCd *= 0.75; }
      if (k === 'tough') { m.maxHp *= 1.5; m.hp *= 1.5; for (const e of ['phys', 'fire', 'cold', 'light', 'poison']) m.res[e] = (m.res[e] || 0) + 0.15; }
      if (k === 'fiery') m.res.fire = (m.res.fire || 0) + 0.4;
      if (k === 'frozen') m.res.cold = (m.res.cold || 0) + 0.4;
    }
  }
  if (ids.includes('death_echo') || ids.includes('unstable_remains')) m.heresyIds = ids;
}
/** Every so often (happeningsTick): mark the enemies that appeared, and open the Legion's hellgate when it is time. */
export function heresyTick(world, dt) {
  const H = world.heresy, p = world.player;
  if (!H || !H.rank || !p) return;
  const applyNew = (world.heresyT = (world.heresyT || 0) - dt) <= 0;
  if (applyNew) world.heresyT = 0.4;
  let pitAlive = 0;
  // Keep one creature pass for tagging event spawns, advancing the two exclusive
  // encounter controllers and counting Legion adds; a separate scan per feature
  // made maximum Greed + Heresy pay unnecessary frame-time costs.
  for (const m of world.creatures) {
    if (applyNew && !m._heresy && !m.dead) heresyMonster(m, H.ids);
    if (m.pitSpawn && !m.dead) pitAlive++;
    if (!m.dead && m.heresyThroneBoss) {
      const hp = m.hp / Math.max(1, m.maxHp);
      const phase = hp <= 0.33 ? 3 : hp <= 0.66 ? 2 : 1;
      if (phase > (m.heresyPhase || 1)) {
        m.heresyPhase = phase; m.dmg *= 1.12;
        const labels = { 2: 'THE CROWN BURNS', 3: 'DAMNATION UNBOUND' };
        floatText(m.x, m.y, 90, labels[phase], '#ff7250', 12);
        addEffect(new Ring(m.x, m.y, 0.3, 3.2, 0.75, '#e23a28', 5)); sfx('roar', 0.55);
        heresyBlast(world, p.x, p.y, phase === 3 ? 2.6 : 2.1, phase === 3 ? 'shadow' : 'fire', 1.15, 0.045, m);
      }
    }
    if (!m.dead && m.heresyChampion && !p.dead) {
      m.heresyAbilityT = (m.heresyAbilityT ?? 3) - dt;
      if (m.heresyAbilityT <= 0 && dist(m.x, m.y, p.x, p.y) < 8) {
        m.heresyAbilityT = 8 + (m.heresyChampion === 'cantor' ? 2 : 0);
        const element = m.heresyChampion === 'reaver' ? 'phys' : m.heresyChampion === 'cantor' ? 'shadow' : 'fire';
        const [x, y] = m.heresyChampion === 'reaver' ? [p.x, p.y] : [m.x, m.y];
        heresyBlast(world, x, y, m.heresyChampion === 'reaver' ? 1.7 : 2.3, element, 1.1, 0.055, m);
        floatText(m.x, m.y, 46, m.heresyChampion === 'cantor' ? 'SOUL REND' : m.heresyChampion === 'reaver' ? 'EXECUTION' : 'INFERNAL BURST', '#ff9c60', 9);
      }
    }
  }
  if (H.ids.includes('infernal_ground') && !p.dead) {
    world.heresyGroundT = (world.heresyGroundT || rand(8, 14)) - dt;
    if (world.heresyGroundT <= 0) {
      world.heresyGroundT = rand(14, 20);
      const [x, y] = world.map.randomNear(p.x, p.y, 2.2);
      heresyBlast(world, x, y, 2.1, 'fire', 1.05, 0.035);
    }
  }
  // Heretical champions use one capped, warned ability cycle; each role has its
  // own element and action but none recursively spawns additional enemies.
  // the Legion's clock stands still while a guardian or BOSS ROOM boss is awake; at most 8 of its demons alive
  if (world.legionT !== undefined && !p.dead && !(world.boss && world.boss.awake && !world.boss.dead) && (world.legionT -= dt) <= 0) {
    world.legionT = rand(40, 55);
    if (pitAlive < 8) legionGate(world, p, Math.min(4, 8 - pitAlive, 2 + Math.floor(rand(0, 3))), depthLevel(world.depth || 1));
  }
}

/** Visible, short-lived encounter hazard used by Heresy without a separate combat loop. */
function heresyBlast(world, x, y, radius, element, warning, targetMaxHpPct, source = null) {
  const src = source || { team: 'enemy', world, x, y, level: depthLevel(world.depth || 1), dmg: 0, rank: 'normal' };
  addEffect(new Telegraph({ kind: 'circle', x, y, r: radius, dur: warning, color: element === 'shadow' ? '#b063e8' : element === 'phys' ? '#ffd060' : '#ff5526' }), 'ground');
  world.addHazard({ t: warning, update(dt) {
    this.t -= dt; if (this.t > 0) return true;
      const targets = world.query(x, y, radius + 0.8, (c) => c !== src && !c.dead && (c.isPlayer || c.team === 'player' || c.team === 'enemy'));
    for (const target of targets) {
      const bossScale = target.rank === 'boss' ? 0.35 : 1;
      const amount = Math.min(target.maxHp * targetMaxHpPct * bossScale, (target.maxHp || 1) * 0.07);
      hit(src, target, amount, element, { aoe: true, affixHazard: true, crit: false, noVariance: true, noArc: true });
    }
    explosionFx(x, y, radius, element, element === 'phys' ? 'earth' : element === 'shadow' ? 'void' : 'explosion');
    sfx(element === 'fire' ? 'fire' : element === 'shadow' ? 'arcane' : 'thud', 0.28);
    return false;
  }, draw() {} });
}
/**
 * Velscour's Legion of the Pit: a hellgate tears open near `near` (a creature) and n Pit Demons / Imps climb out a
 * moment later (his own fight calls it with himself as the source; the Heresy with the hero). Their level: lvl - 2.
 */
export function legionGate(world, near, n, lvl, opts = {}) {
  const w = world, p = w.player;
  if (!p || n <= 0) return null;
  const a = opts.src ? angleTo(near.x, near.y, p.x, p.y) + (Math.random() < 0.5 ? 1.2 : -1.2) : rand(0, Math.PI * 2);
  let [gx, gy] = w.map.nudge(near.x + Math.cos(a) * (opts.src ? 3 : 4.5), near.y + Math.sin(a) * (opts.src ? 3 : 4.5), 0.6);
  // the Heresy's gate: in the hero's sight, on ground joined to him (not behind a wall, not on another island of the Breach)
  if (!opts.src) for (let i = 0; i < 24; i++) {
    const b = rand(0, Math.PI * 2), r = rand(3.5, 5.5), x = near.x + Math.cos(b) * r, y = near.y + Math.sin(b) * r;
    if (w.map.circleFree(x, y, 0.6) && w.map.flowAt(x, y) >= 0 && w.map.los(near.x, near.y, x, y)) { gx = x; gy = y; break; }
  }
  addEffect(new Telegraph({ kind: 'circle', x: gx, y: gy, r: 1.8, dur: 1.2, color: '#ff4010' }), 'ground');
  if (G.ui && G.ui.log) G.ui.log(`<b style="color:#ff5020">Legion of the Pit</b>: ${opts.src ? 'Velscour tears open a hellgate and his demons climb out!' : 'a hellgate tears open beside you; Velscour\'s demons climb out.'}`, '#ffb090');
  if (opts.src) floatText(near.x, near.y, 160, 'RISE, MY LEGION', '#ff5020', 16, { life: 1.6 });
  sfx('roar', 0.7);
  return w.addHazard({ t: 1.2, team: 'enemy', update(dt) {
    this.t -= dt; if (this.t > 0) return true;
    explosionFx(gx, gy, 2, 'fire', 'eruption'); addEffect(new Ring(gx, gy, 0.2, 2.2, 0.6, '#ff3010', 5)); sfx('summon');
    for (let i = 0; i < n; i++) {
      const [x, y] = w.map.randomNear(gx, gy, 1.6);
      const d = makeMonster(w, i % 2 ? 'imp' : 'demon', w.biome, Math.max(1, lvl - 2), i === 0 ? 'champion' : 'normal', x, y);
      d.awake = true; d.aggro = p; d.maxHp *= 0.55; d.hp = d.maxHp; d.pitSpawn = true; d.name = i % 2 ? 'Pit Imp' : 'Pit Demon';
      w.add(d); smoke(x, y, 0, '#200808', 5, 9);
    }
    return false; }, draw() {} });
}

// ---------------------------------------------------------------- the hero
/** Glass Cannon: { life: -25, dmg: +15 } (percent) where it is in force. */
export function heresyHero(c = G.char) {
  return {
    life: heresyActive('glass', c) ? -25 : 0,
    dmg: heresyActive('glass', c) ? 15 : 0,
    armorMul: heresyActive('shattered_armor', c) ? 0.8 : 1,
    resPenalty: heresyActive('elemental_frailty', c) ? 15 : 0,
    healingMul: heresyActive('mortal_wounds', c) ? 0.6 : 1,
  };
}
export function heresyAbilityCostMul(c = G.char, w = G.world) {
  return heresyActive('arcane_tax', c, w) ? 1.25 : 1;
}
export function heresyCooldownMul(c = G.char, w = G.world) {
  return heresyActive('arcane_suppression', c, w) ? 1.2 : 1;
}
export function heresyShrineDurationMul(c = G.char, w = G.world) {
  return heresyActive('hollow_sanctuary', c, w) ? 0.5 : 1;
}
/** May the hero drink ('potion'), pick up orbs ('orb'), regenerate ('regen') where he stands? */
export function heresyAllows(what, c = G.char, w = G.world) {
  if (what === 'potion') return !heresyActive('thirst', c, w);
  if (what === 'orb' || what === 'regen') return !heresyActive('hunger', c, w);
  return true;
}
/** The Fifth Phase: one more phase for a BOSS ROOM boss (the template's next, else its Final Stand again), marks respaced. */
export function heresyRaid(raid) {
  if (!raid || raid.fifth) return;
  raid.fifth = true;
  const tpl = raid.tpl, n = raid.phases.length;
  raid.phases = [...raid.phases, tpl.phases[n] || { ...raid.phases[n - 1], name: 'Beyond the End' }];
  const N = raid.phases.length;
  raid.marks = Array.from({ length: N - 1 }, (_, i) => Math.round((0.78 - (0.6 / (N - 2)) * i) * 100) / 100); // 5: [0.78, 0.58, 0.38, 0.18]
}
/** The Quest Log / altar: the rank's rewards in words. */
export function heresyRewardText(rank) {
  const M = heresyMods(rank);
  return `x${M.loot.toFixed(2)} drops · +${M.mf}% magic find · x${M.gold.toFixed(2)} gold · +${Math.round((M.xp - 1) * 100)}% XP · x${M.sigil.toFixed(2)} Sigils · x${M.relic.toFixed(2)} relics`;
}
export { pick, dist };
