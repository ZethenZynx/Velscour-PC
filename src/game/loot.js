// Drops on the ground: gold, recovery/blessing orbs, potions, gear and gems.
import { G } from '../state.js';
import { rand, chance, randi, TAU, pick, clamp, measureCtx, fmtInt } from '../core/util.js';
import { isoX, isoY, camera } from '../core/view.js';
import { sfx } from '../core/audio.js';
import { spawn, glowSprite, floatText, addLight, elem } from '../gfx/vfx.js';
import { replacementIcon } from '../core/replacementart.js';
import { pixelSprite, gemIcon, goldIcon, ringIcon } from '../gfx/pixelart.js';
import { rollItem, rollGem, itemName, itemColor, goldPile, goldScale, MATERIALS, GEMS, potionItem, RARITY_COLORS, RARITY_RARE, RARITY_EPIC, RARITY_LEGENDARY, qualityAtDepth, rarityAt } from '../data/items.js';
import { potionIcon } from '../core/assets.js';
import { artIcon } from '../core/classart.js';
import { gearIcon } from '../core/gearart.js';
import { heldIcon } from '../gfx/heldart.js';
import { AUGMENTS } from '../data/rings.js';
import { depthLevel } from '../data/depth.js';
import { sheetIcon } from '../gfx/notation.js';
import { filterPasses, labelFilterPasses, shouldSuppressPotionLabelForCapacity } from './lootfilter.js';
import { rollSigil, SIGILS } from '../data/items.js';
import { maybeAccountRelic } from './reliquary.js';
import { heresyAllows } from './heresies.js';
import { keyChance } from './unbound.js';
import { CHEST_RARITIES } from '../data/treasurechests.js';
import { riftQualityRange, riftRewardProgressionDepth } from '../data/rifts.js';
import { greedQuantity } from './greed.js';
import { lifetimeAlpha } from '../core/objectlifetimes.mjs';
import { canDropNaturalSigil, naturalSigilDropChance, recordNaturalSigilDrop } from './sigildrops.mjs';

/** Highest quality unlocked for ground drops at this campaign depth. */
export function groundDropRarityCap(depth) { return qualityAtDepth(Math.max(1, depth || 1)); }

/** Progression depth for a ground reward; Rift items scale by Rift tier while combat level stays capped at 100. */
export function groundRewardDepth(world = G.world, fallbackDepth = 1) {
  return world?.rift ? riftRewardProgressionDepth(world.rift.tier, G.char) : fallbackDepth;
}

/** Rift sigils follow Rift tier but cannot outrun the hero's normal-depth unlocks. */
export function groundRewardSigilDepth(world = G.world, fallbackDepth = world?.depth || G.char?.depth || 1) {
  return world?.rift ? riftRewardProgressionDepth(world.rift.tier, G.char) : Math.max(1, Number(fallbackDepth) || 1);
}

/** Roll a Sigil using the owning world's effective progression depth. */
export function rollGroundSigil(world = G.world, fallbackDepth = world?.depth || G.char?.depth || 1, bonus = 0) {
  return rollSigil(groundRewardSigilDepth(world, fallbackDepth), bonus);
}

const ORB_COLOR = { orb_hp: '#ff2a2a', orb_mp: '#3a6aff', orb_rejuv: '#c040ff', orb_fury: '#ffa020' };
const ORB_ICON = {
  orb_hp: ['orb_hp', null], orb_mp: ['orb_mp', null],
  orb_rejuv: ['orb_hp', { colorize: [282, 0.95] }], orb_fury: ['orb_hp', { colorize: [35, 0.95] }],
};
/** Roll an orb reward, with a 5% Rejuvenation and 2% Fury chance by default. */
export function rollOrbKind(rejuvenationChance = 0.05, furyChance = 0.02, healthChance = 0.5) {
  if (chance(furyChance)) return 'orb_fury';
  if (chance(rejuvenationChance)) return 'orb_rejuv';
  return chance(healthChance) ? 'orb_hp' : 'orb_mp';
}

/** Roll gear drops at the character's level and current depth's quality cap. Keep vendor rolls on rollItem. */
export function rollGroundItem(ilvl, opts = {}) {
  // Use the world that owns the reward, not an unrelated/stale global world.
  // This matters for asynchronous rewards and generation tests as well as Rift
  // drops: G.world.depth is always 100 in a Rift, while eligibility follows its tier.
  const { world = G.world, ...rollOpts } = opts;
  const level = G.char?.level;
  const depth = world?.depth > 0 ? world.depth : G.char?.depth ?? 1;
  const progressionDepth = groundRewardDepth(world, depth);
  const depthCap = groundDropRarityCap(progressionDepth);
  const requestedCap = Number.isFinite(rollOpts.maxRarity) ? rollOpts.maxRarity : depthCap;
  const bounds = world?.rift ? riftQualityRange(world.rift.tier, G.char) : null;
  const rarityCap = Math.max(0, Math.min(depthCap, requestedCap, bounds ? bounds.max - 1 : depthCap));
  const rarityFloor = bounds ? Math.min(rarityCap, bounds.min - 1) : Math.min(rarityCap, Number.isFinite(rollOpts.minRarity) ? rollOpts.minRarity : 0);
  // Rifts preserve existing MF/quality weights but gently favor the lower end
  // of their eligible band so higher quality remains a rarer find.
  const finalOpts = { ...rollOpts, maxRarity: rarityCap, minRarity: rarityFloor, ...(bounds ? { lowerQualityBias: 0.75 } : {}) };
  // A Rift-specific requested rarity is honored only if it is eligible. An
  // out-of-range request falls back to a weighted roll across the legal band;
  // it is never clamped into a guaranteed maximum-quality reward.
  if (bounds && Number.isFinite(finalOpts.rarity) &&
      (finalOpts.rarity < rarityFloor || finalOpts.rarity > rarityCap)) delete finalOpts.rarity;
  return rollItem(level == null ? ilvl : Math.min(ilvl, level), finalOpts);
}

/** Roll ground gems at a tier available to the character's current level. */
export function rollGroundGem(ilvl, world = G.world) {
  const level = G.char?.level;
  const progressionDepth = world?.rift ? riftRewardProgressionDepth(world.rift.tier, G.char) : 0;
  const progressionLevel = world?.rift ? depthLevel(progressionDepth) + 4 : ilvl;
  return rollGem(level == null ? progressionLevel : Math.min(progressionLevel, level), G.player?.st?.markGemTier || 0);
}

// Breakable dungeon clutter can pay out only small, non-equipment rewards. Keep the gem
// chance below every other reward; orb chances match the established rare-orb rates.
export const CLUTTER_DROP_CHANCES = Object.freeze({
  gold: 0.10,
  orbHp: 0.08,
  orbMp: 0.08,
  orbRejuv: 0.05,
  orbFury: 0.02,
  gem: 0.01,
});

/** Roll the small reward table for a broken dungeon prop. At most one orb can drop. */
export function dropClutterLoot(world, x, y) {
  const p = G.player;
  if (world?.kind !== 'dungeon' || !p || typeof world.addLoot !== 'function') return [];

  const level = depthLevel(world.depth || G.char?.depth || 1);
  const st = p.st || {};
  const dropped = [];
  const add = (kind, data = {}) => {
    const item = new GroundItem(x + rand(-0.2, 0.2), y + rand(-0.2, 0.2), kind, data);
    world.addLoot(item);
    dropped.push(item);
  };

  if (chance(CLUTTER_DROP_CHANCES.gold)) {
    add('gold', { amount: Math.max(1, Math.round(goldPile(level) * rand(0.6, 1.0) * ((1 + ((st.goldFind || 0) + (st.markGold || 0)) / 100) * (world.goldMul || 1) + ((world.greedGoldPct || 0) + (world.heresyGoldPct || 0)) / 100))) });
  }

  if (heresyAllows('orb', p.char || G.char, world)) {
    const roll = Math.random();
    if (roll < CLUTTER_DROP_CHANCES.orbHp) add('orb_hp');
    else if (roll < CLUTTER_DROP_CHANCES.orbHp + CLUTTER_DROP_CHANCES.orbMp) add('orb_mp');
    else if (roll < CLUTTER_DROP_CHANCES.orbHp + CLUTTER_DROP_CHANCES.orbMp + CLUTTER_DROP_CHANCES.orbRejuv) add('orb_rejuv');
    else if (roll < CLUTTER_DROP_CHANCES.orbHp + CLUTTER_DROP_CHANCES.orbMp + CLUTTER_DROP_CHANCES.orbRejuv + CLUTTER_DROP_CHANCES.orbFury) add('orb_fury');
  }

  if (chance(Math.min(1, CLUTTER_DROP_CHANCES.gem * (world.gemDropMul || 1)))) {
    const bonus = 1 + ((world.greedLootPct || 0) + (world.heresyLootPct || 0)) / 100;
    const count = Math.floor(bonus) + (chance(bonus % 1) ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const item = rollGroundGem(level, world);
      add('item', { item, fades: fadeOf(item) });
    }
  }

  return dropped;
}

const sigilCache = new Map();
/** A Sigil Stone's icon: a dark rune slab with its sigil's mark in the stone's colour, more ornate by rank. */
export function sigilIcon(rank, size = 48) {
  const key = rank + '|' + size;
  let c = sigilCache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), S = SIGILS[rank] || SIGILS[0], s = size;
  x.translate(s / 2, s / 2);
  const w = s * 0.56, h = s * 0.72, r = s * 0.12;
  const g = x.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, '#5a5048'); g.addColorStop(1, '#1c1814');
  x.fillStyle = g; x.strokeStyle = '#0a0806'; x.lineWidth = Math.max(2, s / 20);
  x.beginPath(); x.moveTo(-w / 2 + r, -h / 2); x.arcTo(w / 2, -h / 2, w / 2, h / 2, r); x.arcTo(w / 2, h / 2, -w / 2, h / 2, r); x.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); x.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r); x.closePath();
  x.fill(); x.stroke();
  // the mark: strokes seeded by the rank, so each stone has its own glyph
  x.shadowColor = S.color; x.shadowBlur = s * (0.12 + rank * 0.008);
  x.strokeStyle = S.color; x.lineWidth = Math.max(2, s / 16); x.lineCap = 'round';
  let q = rank * 7919 + 13;
  const rnd = () => ((q = (q * 16807) % 2147483647) / 2147483647);
  x.beginPath(); x.moveTo(0, -h * 0.32); x.lineTo(0, h * 0.32);
  for (let i = 0; i < 2 + (rank % 3); i++) { const y0 = (rnd() - 0.5) * h * 0.55, dx = (rnd() < 0.5 ? -1 : 1) * w * 0.3; x.moveTo(0, y0); x.lineTo(dx, y0 + (rnd() - 0.5) * h * 0.3); }
  x.stroke();
  if (rank >= 10) { x.shadowBlur = 0; x.strokeStyle = 'rgba(255,230,160,.55)'; x.lineWidth = 1; x.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6); }
  sigilCache.set(key, c);
  return c;
}

// Seconds a monster's lesser drop waits on the ground (Orange, Light Blue, Yellow; a gem). A long fight drops hundreds that
// keys, what the hero dropped, chest and quest rewards don't fade. 0: never.
const FADE = [45, 60, 120];
export const fadeOf = (it) => (it.relic ? 0 : it.type === 'gem' ? (GEMS[it.gem].sigil ? 0 : 180) : it.type === 'gear' ? FADE[it.rarity] || 0 : 0);

export class GroundItem {
  constructor(x, y, kind, data = {}) {
    this.x = x; this.y = y; this.z = 0;
    this.kind = kind; // gold | orb_hp | orb_mp | orb_rejuv | orb_fury | item | potion
    Object.assign(this, data);
    const a = rand(TAU), s = rand(0.5, 1.6);
    this.vx = Math.cos(a) * s; this.vy = Math.sin(a) * s; this.vz = rand(90, 150);
    this.t = 0;
    this.r = 0.35;
  }
  get label() {
    if (this.kind === 'gold') return `${fmtInt(this.amount)} Gold`;
    if (this.kind === 'item') return itemName(this.item);
    if (this.kind === 'potion') return this.item.name;
    if (this.kind === 'key') return 'Abyssal Key';
    return null;
  }
  get color() {
    if (this.kind === 'gold') return '#ffd34a';
    if (this.kind === 'key') return KEY_COLOR;
    if (ORB_COLOR[this.kind]) return ORB_COLOR[this.kind];
    if (this.kind === 'item' || this.kind === 'potion') return itemColor(this.item);
    return '#fff';
  }
  update(dt, world) {
    if (this._lootRemoved) return false;
    if (Number.isFinite(this._lootExpiryAt) && world.time >= this._lootExpiryAt) return false;
    // Items outside the active pickup/movement area may be asleep for many frames.
    // Derive their age from world time when they wake so expiry stays exact.
    if (Number.isFinite(this._lootBornAt) && Number.isFinite(world.time)) this.t = Math.max(this.t || 0, world.time - this._lootBornAt);
    else this.t += dt;
    if (this.z > 0 || this.vz > 0) {
      this.vz -= 420 * dt; this.z += this.vz * dt;
      const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
      if (world.map.walkable(nx, ny)) { this.x = nx; this.y = ny; }
      if (this.z <= 0) { this.z = 0; this.vz = this.vz < -60 ? -this.vz * 0.3 : 0; if (this.kind === 'item' && this.item.type === 'gear' && this.item.rarity >= RARITY_EPIC) sfx('pickup'); }
    }
    const p = world.player;
    if (!p || p.dead) return true;
    const dx = p.x - this.x, dy = p.y - this.y, d2 = dx * dx + dy * dy;
    const magnet = Math.max(this.kind === 'gold' ? 2.2 : this.kind.startsWith('orb') || this.kind === 'key' ? 3.2 : 0, p.st?.markPickupRadius || 0);
    if (magnet && d2 < magnet * magnet && this.t > 0.4) {
      const k = Math.min(1, dt * 9);
      this.x += dx * k; this.y += dy * k;
    }
    const auto = !this.dropped && (this.kind !== 'item' || ((G.touch || G.settings.autoLoot) && filterPasses(this.item))); // the loot filter (game/lootfilter.js); never what the hero dropped
    const pickupRadius = 0.55 + (p.st?.markPickupRadius || 0), targetPickupRadius = 1.2 + (p.st?.markPickupRadius || 0);
    if (this.t > 0.35 && (d2 < pickupRadius * pickupRadius || (p.lootTarget === this && d2 < targetPickupRadius * targetPickupRadius)) && (auto || p.lootTarget === this)) {
      if (p.pickup(this)) {
        if (p.lootTarget === this) p.lootTarget = null;
        return false;
      }
    }
    if (Number.isFinite(this._lootExpiryAt) && world.time >= this._lootExpiryAt) return false;
    if (this.kind.startsWith('orb')) addLight(this.x, this.y, 1.8, 0.7);
    return true;
  }
  icon() {
    if (this.kind === 'item') return itemIcon(this.item);
    if (this.kind === 'key') return keyIcon(48);
    if (this.kind === 'potion') return this._ic || (this._ic = potionIcon(this.item.color, 48)); // (kept per drop: it built a canvas a frame)
    if (this.kind === 'gold') return goldIcon(48, this.amount);
    return null;
  }
  draw(ctx) {
    const px = isoX(this.x, this.y), py = isoY(this.x, this.y) - this.z;
    const alpha = lifetimeAlpha(G.world?.time ?? this._lootBornAt ?? 0, this._lootExpiryAt, this._lootFadeAt);
    if (alpha <= 0) return;
    const priorAlpha = ctx.globalAlpha;
    ctx.globalAlpha = priorAlpha * alpha;
    if (ORB_COLOR[this.kind]) {
      const c = ORB_COLOR[this.kind];
      const b = 8 + Math.sin(this.t * 6) * 1.5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite(c), px - b * 2.2, py - 10 - b * 2.2, b * 4.4, b * 4.4);
      ctx.globalCompositeOperation = 'source-over';
      const [art, swap] = ORB_ICON[this.kind];
      const orb = replacementIcon(art, 20, null, 0.88, swap);
      if (orb) { ctx.drawImage(orb, px - 10, py - 20 - Math.sin(this.t * 4) * 2); ctx.globalAlpha = priorAlpha; return; }
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py - 10 - Math.sin(this.t * 4) * 2, 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(px - 2, py - 13 - Math.sin(this.t * 4) * 2, 2, 2);
      ctx.globalAlpha = priorAlpha; return;
    }
    const img = this.icon();
    if (!img) { ctx.globalAlpha = priorAlpha; return; }
    const art = this.kind === 'item' && ((this.item.art && artIcon(this.item)) || gearIcon(this.item) || heldIcon(this.item));
    const s = this.kind === 'gold' ? 20 : art ? 30 : this.kind === 'key' ? 26 : 22;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(px, py + 1, 9, 4, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(px, py - s * 0.45);
    if (this.kind === 'item' && this.item.type === 'gear' && !art) ctx.rotate(-0.6); // catalog and gear art are drawn upright / diagonal already
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
    ctx.globalAlpha = priorAlpha;
  }
}

const iconCache = new Map();
export const KEY_COLOR = '#20e0ff';
/** An Abyssal Key (docs/ENDGAME.md): a skeleton key of black iron with a cyan void-stone in its bow. */
export function keyIcon(size = 48) {
  const key = 'key|' + size;
  let c = iconCache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), s = size / 48;
  x.save(); x.translate(24 * s, 24 * s); x.rotate(-0.7);
  x.strokeStyle = '#1a1c24'; x.lineWidth = 5 * s; x.lineCap = 'round';
  x.beginPath(); x.moveTo(-6 * s, 0); x.lineTo(17 * s, 0); x.stroke(); // the shaft
  x.beginPath(); x.moveTo(12 * s, 0); x.lineTo(12 * s, 6 * s); x.moveTo(17 * s, 0); x.lineTo(17 * s, 7 * s); x.stroke(); // the bit
  x.strokeStyle = '#3a3e4c'; x.lineWidth = 2 * s;
  x.beginPath(); x.moveTo(-6 * s, -1 * s); x.lineTo(17 * s, -1 * s); x.stroke();
  x.fillStyle = '#1a1c24'; x.beginPath(); x.arc(-12 * s, 0, 8 * s, 0, TAU); x.fill(); // the bow
  x.fillStyle = '#0a0c12'; x.beginPath(); x.arc(-12 * s, 0, 4.5 * s, 0, TAU); x.fill();
  x.fillStyle = KEY_COLOR; x.beginPath(); x.arc(-12 * s, 0, 3 * s, 0, TAU); x.fill(); // the void-stone
  x.fillStyle = '#ffffff'; x.fillRect(-13.5 * s, -1.5 * s, 1.5 * s, 1.5 * s);
  x.restore();
  iconCache.set(key, c);
  return c;
}
export function bannerKitIcon(size = 48) {
  const key = 'item_banner_kit|' + size;
  let c = iconCache.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), s = size / 48;
  x.save();
  const bg = x.createRadialGradient(24 * s, 24 * s, 3 * s, 24 * s, 24 * s, 24 * s);
  bg.addColorStop(0, 'rgba(70, 114, 207, 0.45)');
  bg.addColorStop(1, 'rgba(0, 0, 0, 0)');
  x.fillStyle = bg;
  x.fillRect(0, 0, size, size);
  x.strokeStyle = '#7c5a32'; x.lineWidth = 2.4 * s; x.lineCap = 'round';
  x.beginPath(); x.moveTo(24 * s, 6 * s); x.lineTo(24 * s, 44 * s); x.stroke();
  x.strokeStyle = '#d4af37'; x.lineWidth = 2 * s;
  x.beginPath(); x.moveTo(8 * s, 11 * s); x.lineTo(40 * s, 11 * s); x.stroke();
  x.fillStyle = '#ffd860';
  x.beginPath(); x.moveTo(24 * s, 3 * s); x.lineTo(27 * s, 8 * s); x.lineTo(21 * s, 8 * s); x.closePath(); x.fill();
  x.fillStyle = '#224488';
  x.beginPath();
  x.moveTo(10 * s, 11 * s);
  x.lineTo(38 * s, 11 * s);
  x.lineTo(38 * s, 35 * s);
  x.lineTo(24 * s, 42 * s);
  x.lineTo(10 * s, 35 * s);
  x.closePath();
  x.fill();
  x.strokeStyle = '#e6be44'; x.lineWidth = 1.2 * s; x.stroke();
  x.fillStyle = '#edf2fa';
  x.beginPath();
  x.moveTo(24 * s, 18 * s); x.lineTo(27 * s, 23 * s); x.lineTo(24 * s, 30 * s); x.lineTo(21 * s, 23 * s);
  x.closePath();
  x.fill();
  x.strokeStyle = '#ffdf68'; x.lineWidth = 1 * s;
  x.beginPath(); x.moveTo(17 * s, 30 * s); x.lineTo(31 * s, 18 * s); x.stroke();
  x.restore();
  iconCache.set(key, c);
  return c;
}
/** Inventory icon canvas for any item. */
export function itemIcon(item, size = 48) {
  if (item.type === 'gem' && GEMS[item.gem].sigil) return sigilIcon(item.tier, size);
  if (item.type === 'gem') return gemIcon(item.gem, GEMS[item.gem].color, item.tier, size);
  if (item.type === 'potion') return potionIcon(item.color || item.kind, size);
  if (item.type === 'sheet') return sheetIcon(item, size);
  if (item.type === 'banner_kit') return bannerKitIcon(size);
  if (item.slot === 'ring') return ringIcon(MATERIALS[item.tier].color, elem((AUGMENTS[(item.aug && item.aug[0] || {}).id] || {}).el || 'arcane').glow, item.rarity, size);
  if (item.art) { const a = artIcon(item, size); if (a) return a; }
  { const g = gearIcon(item, size) || heldIcon(item, size); if (g) return g; } // body/head gear art, the held weapon designs
  const key = `${item.icon}|${item.tier}|${item.rarity}|${item.base}|${size}`;
  let c = iconCache.get(key);
  if (c) return c;
  const mat = MATERIALS[item.tier].color;
  const pal = { m: mat, w: '#ffffff', b: item.icon === 'shield' ? '#5a2a1a' : '#5a3a20', g: item.rarity >= RARITY_LEGENDARY ? '#ffd040' : '#b08a3a', c: item.rarity >= RARITY_RARE ? RARITY_COLORS[item.rarity] : '#8a6a40', e: '#ff4040', k: '#101010' };
  if (item.icon === 'orb') { pal.c = mat; pal.e = '#c060ff'; }
  if (item.icon === 'staff' || item.icon === 'wand') { pal.c = RARITY_COLORS[item.rarity] || '#ffffff'; pal.b = '#6a4a2a'; pal.e = '#ffffff'; }
  c = replacementIcon('item_' + item.icon, size, mat) || pixelSprite(item.icon, pal, 4);
  iconCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ drops
export function dropLoot(world, m) {
  if (m.chestMimic) return; // the disguised chest pays its own stored reward when the mimic dies
  const p = G.player;
  if (!p) return;
  const isRiftActive = world.rift && !world.rift.done && !m.isRaid && !m.riftPinata;
  const st = p.st;
  const breachScale = world.breach ? 1 + (st.markBreachRewards || 0) / 100 : 1;
  const lvl = m.level;
  const rank = m.rank || 'normal';
  const R = { normal: 1, champion: 3, unique: 5, boss: 10 }[rank];
  const add = (kind, data) => world.addLoot(new GroundItem(m.x + rand(-0.2, 0.2), m.y + rand(-0.2, 0.2), kind, data));
  const lootBonusPct = (world.greedLootPct || 0) + (world.heresyLootPct || 0);
  const more = (n) => greedQuantity(n, (st.drops || 0) + lootBonusPct, chance);
  const greedMore = (n) => greedQuantity(n, lootBonusPct, chance);
  // gold (suppressed during active rifts)
  if (!isRiftActive && chance(rank === 'normal' ? 0.45 : 1)) {
    const n = rank === 'boss' ? 5 : 1;
    for (let i = 0; i < n; i++) add('gold', { amount: Math.max(1, Math.round(goldPile(lvl) * rand(0.6, 1.4) * Math.sqrt(R) * breachScale * ((1 + (st.goldFind + (st.markGold || 0)) / 100) * (world.goldMul || 1) + ((world.greedGoldPct || 0) + (world.heresyGoldPct || 0)) / 100))) });
  }
  if (!isRiftActive && st.legendary.greed && chance(0.15)) for (let i = 0; i < 4; i++) add('gold', { amount: Math.round((2 + lvl) * goldScale(lvl) * (1 + (st.goldFind + (st.markGold || 0)) / 100) * breachScale) });
  // Orbs (none under the Hunger of the Abyss Heresy).
  if (heresyAllows('orb', p.char, world)) {
    // Health orbs: primary recovery in dungeons with natural HP regen removed outside of town.
    if (rank === 'boss') {
      const nOrbs = randi(2, 4);
      for (let i = 0; i < nOrbs; i++) add('orb_hp', {});
      add('orb_mp', {});
    } else if (rank === 'unique') {
      add('orb_hp', {});
      if (chance(0.75)) add('orb_hp', {});
      if (chance(0.6)) add('orb_mp', {});
    } else if (rank === 'champion') {
      add('orb_hp', {});
      if (chance(0.5)) add('orb_hp', {});
      if (chance(0.4)) add('orb_mp', {});
    } else {
      // Normal monsters: 30% base chance, increased to 50% if hero is wounded (<50% life)
      const lowHpBonus = p.hp < p.maxHp * 0.5 ? 0.20 : 0;
      if (chance(0.30 + lowHpBonus)) add('orb_hp', {});
      if (chance(0.12)) add('orb_mp', {});
    }
    const rankScale = Math.sqrt(R);
    if (chance(0.05 * rankScale)) add('orb_rejuv', {});
    if (chance(0.02 * rankScale)) add('orb_fury', {});
  }
  // active rifts suppress gear/gold drops until the Guardian piñata
  if (isRiftActive) return;

  // potions
  if (chance(0.035 * R)) add('potion', { item: potionItem(pick(['hp', 'hp', 'mp', 'mp', 'rejuv', 'fury'])) });
  // gear
  // Loot quantity adds extra generated rewards once; it must not also inflate the
  // underlying chance that a normal monster drops its first item.
  const items = more((rank === 'boss' ? randi(2, 3) + (world.depth % 10 === 0 ? 1 : 0) : rank === 'unique' ? randi(1, 2) : rank === 'champion' ? (chance(0.3) ? randi(1, 2) : 0) : (chance(0.0425 * (world.lootMul || 1)) ? 1 : 0)) * breachScale);
  const bonus = rank === 'boss' ? 1.8 : rank === 'unique' ? 0.7 : rank === 'champion' ? 0.35 : 0;
  const boost = (world.raid || m.isRaid || m.isVelscour ? 3 : 1) * (world.relicMul || 1) * (1 + (st.markCollector || 0) / 100); // Collector only modifies eligible Covenant chance
  for (let i = 0; i < items; i++) {
    const ilvl = lvl + (rank === 'boss' ? 2 : rank === 'normal' ? 0 : 1) + randi(-1, 1);
    const item = maybeAccountRelic(rollGroundItem(ilvl, { world, mf: st.magicFind + (world.mfAdd || 0), bonus }), boost, world);
    add('item', { item, fades: fadeOf(item) });
  }
  // Natural Sigils use the tuned 95% reduction and share a persisted one-per-generated-level
  // cap across ordinary drops, bosses, chests, and random encounters.
  const sigilBase = { normal: 0.004, champion: 0.03, unique: 0.08, boss: 0.45 }[rank];
  if (sigilBase && world.depth && canDropNaturalSigil(world, G.char)
      && chance(naturalSigilDropChance(sigilBase, world, st, { includeBreachReward: true }))) {
    const dropped = add('item', { item: rollGroundSigil(world, world.depth, rank === 'boss' ? 1 : 0) });
    if (dropped && recordNaturalSigilDrop(world, G.char)) G.game?.autosave?.();
  }
  // an Abyssal Key (docs/ENDGAME.md): BOSS ROOM bosses past depth 600 under Heresy rank 10, rift guardians from tier 10
  if (m.isRaid && chance(keyChance(world, m))) add('key', {}); // (keyChance rolls once a boss: a raid boss pays out three dropLoots)
  // rings: a guardian usually drops one
  if ((rank === 'boss' && chance(0.6)) || (rank === 'unique' && chance(0.2))) add('item', { item: rollGroundItem(lvl + 2, { world, slot: 'ring', mf: st.magicFind + (world.mfAdd || 0), bonus }) });
  // gems
  const gemChance = Math.min(1, (rank === 'normal' ? 0.025 : 0.25) * (world.gemDropMul || 1) * (1 + (st.markGemChance || 0) / 100) * breachScale);
  const gems = greedMore(rank === 'boss' ? randi(1, 3) : chance(gemChance) ? 1 : 0);
  for (let i = 0; i < gems; i++) { const item = rollGroundGem(lvl + (rank === 'boss' ? 6 : 0), world); add('item', { item, fades: fadeOf(item) }); }
}

export function dropChest(world, chest, depth) {
  const st = G.player ? G.player.st : { magicFind: 0, goldFind: 0 };
  const breachScale = world.breach ? 1 + (st.markBreachRewards || 0) / 100 : 1;
  const breachCount = (n) => Math.floor(n * breachScale) + (chance((n * breachScale) % 1) ? 1 : 0);
  const lootBonusPct = (world.greedLootPct || 0) + (world.heresyLootPct || 0);
  const greedCount = (n) => greedQuantity(n, lootBonusPct, chance);
  const add = (kind, data) => world.addLoot(new GroundItem(chest.x, chest.y + 0.3, kind, data));
  const rarity = Number.isInteger(chest.chestRarity) ? CHEST_RARITIES[chest.chestRarity] : null;
  const goldOnly = chest.chestType === 'gilded';
  const gemsOnly = chest.chestType === 'jeweled';
  // Special map caches and event chests keep their original rare/ordinary reward rules.
  const gearRange = rarity ? rarity.gear : chest.rare ? [2, 3] : [1, 2];
  const goldRange = rarity ? rarity.gold : [2, 4];
  const baseGearCount = goldOnly || gemsOnly ? 0 : randi(gearRange[0], gearRange[1]);
  const abundantGear = baseGearCount * (1 + ((st.markAbundance || 0) + lootBonusPct) / 100);
  let gearCount = goldOnly || gemsOnly ? 0 : Math.floor(abundantGear) + (chance(abundantGear % 1) ? 1 : 0);
  if (chest.heretical && !goldOnly && !gemsOnly) gearCount = Math.max(chest.heresyPool === 'retribution' ? 3 : 2, gearCount);
  gearCount = breachCount(gearCount);
  if (!goldOnly && !gemsOnly && (chest.chestType === 'explosive' || chest.chestType === 'mimic')) gearCount++;
  const rarityBonus = chest.heretical ? 2.1 : rarity ? [0.35, 0.65, 1.2, 1.5, 1.8, 2.1][rarity.id] : chest.rare ? 1.2 : 0.35;
  for (let i = 0; i < gearCount; i++) {
    const itemDepth = depthLevel(depth) + 1;
    const item = rollGroundItem(itemDepth, { world, mf: st.magicFind + (world.mfAdd || 0), bonus: rarityBonus,
      ...(chest.heretical ? { rarity: rarityAt(itemDepth, Math.min(4, groundDropRarityCap(groundRewardDepth(world, depth)))) } : {}) });
    add('item', { item: maybeAccountRelic(item, (1 + (st.markCollector || 0) / 100) * (world.relicMul || 1), world) });
  }
  const sigilChance = rarity ? rarity.sigilChance : chest.rare ? 0.25 : 0.06;
  if (!goldOnly && !gemsOnly && canDropNaturalSigil(world, G.char)
      && chance(naturalSigilDropChance(sigilChance, world, st))) {
    const dropped = add('item', { item: rollGroundSigil(world, depth) });
    if (dropped && recordNaturalSigilDrop(world, G.char)) G.game?.autosave?.();
  }
  if (chest.heresyPool === 'hunt' || chest.heresyPool === 'retribution') {
    const count = chest.heresyPool === 'retribution' ? 2 : 1;
    for (let i = 0; i < count; i++) add('item', { item: rollGroundSigil(world, depth, 1) });
    if (!goldOnly) add('item', { item: rollGroundGem(depthLevel(depth) + 4, world) });
  }
  const goldPiles = gemsOnly ? 0 : greedCount(breachCount(randi(goldRange[0], goldRange[1])) + (goldOnly ? 2 : 0));
  if (!gemsOnly) for (let i = 0; i < goldPiles; i++) add('gold', { amount: Math.round((10 + depthLevel(depth) * 4) * goldScale(depthLevel(depth)) * rand(0.6, 1.4) * ((1 + (st.goldFind + (st.markGold || 0)) / 100) * (world.goldMul || 1) + ((world.greedGoldPct || 0) + (world.heresyGoldPct || 0)) / 100)) });
  const gemChance = Math.min(1, (rarity ? rarity.gemChance : chest.rare ? 0.8 : 0.3) * (1 + (st.markGemChance || 0) / 100));
  const guaranteedGems = Math.max(gemsOnly ? 1 : 0, rarity ? rarity.guaranteedGems : 0);
  if (!goldOnly) {
    for (let i = 0; i < greedCount(breachCount(guaranteedGems + (chance(rarity?.extraGemChance || 0) ? 1 : 0))); i++) {
      add('item', { item: rollGroundGem(depthLevel(depth) + 4, world) });
    }
    if (guaranteedGems === 0 && chance(gemChance)) for (let i = 0, count = greedCount(1); i < count; i++) add('item', { item: rollGroundGem(depthLevel(depth) + 4, world) });
  }
  if (!goldOnly && !gemsOnly) {
    if (chance(0.5)) add('potion', { item: potionItem(pick(['hp', 'mp', 'rejuv'])) });
    if (heresyAllows('orb', G.player?.char, world) && chance(0.75)) add('orb_hp', {});
    if (heresyAllows('orb', G.player?.char, world) && chance(0.05)) add('orb_rejuv', {});
  }
}

/** Draw D2-style ground labels for nearby items (screen space). Returns hit boxes. */
// Loot label text baked once per text/colour/font (measureText + fillText every frame for every label on the ground
// added up on phones); the box behind it still draws live (it lights up under the mouse).
const labelCache = new Map();
function labelSprite(text, color, font) {
  const key = font + '|' + color + '|' + text;
  let e = labelCache.get(key);
  if (e) return e;
  const tw = measureCtx(font).measureText(text).width, fs = parseFloat(font), pad = 2;
  const c = document.createElement('canvas'); c.width = Math.ceil(tw) + pad * 2; c.height = Math.ceil(fs * 1.6) + pad * 2;
  const g = c.getContext('2d'); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2);
  e = { c, tw };
  // the fallback face draws until the web font loads: don't keep that one
  if (!document.fonts || document.fonts.check(font)) { labelCache.set(key, e); if (labelCache.size > 256) labelCache.delete(labelCache.keys().next().value); }
  return e;
}

// Which drops get a name: a budget by screen height, the best first, and lesser ones only close by. The rest show a name
// under the mouse and take a click on the item, like Settings > Hide dropped item names (Show every item name: no limit).
const labelRank = (l) => {
  if (l.kind === 'key') return 9;
  if (l.kind !== 'item') return 0; // gold, potions
  const it = l.item;
  if (it.type === 'gem') return labelFilterPasses(it) ? 3 : -1;
  if (it.type !== 'gear') return 3; // sheets
  return labelFilterPasses(it) ? it.rarity || 0 : -1; // the ground-label filter controls unprompted names
};
const labelReach = (r) => (r < 0 ? 0 : r < 2 ? 5 : r === 2 ? 9 : 14);
export const labelBudget = (screenH) => clamp(Math.floor(screenH / 48), 8, 20);

function drawLabel(ctx, spr, sx, sy, w, h, hover) {
  ctx.fillStyle = hover ? 'rgba(40,30,80,0.9)' : 'rgba(0,0,0,0.72)';
  ctx.fillRect((sx - w / 2) * G.dpr, (sy - h / 2) * G.dpr, w * G.dpr, h * G.dpr);
  ctx.drawImage(spr.c, Math.round(sx * G.dpr - spr.c.width / 2), Math.round((sy + 1) * G.dpr - spr.c.height / 2));
}

export function drawLootLabels(ctx, world, mouse) {
  const boxes = [], silent = [], cand = [], labelGrid = new Map();
  const p = world.player, S = G.settings, all = S.allItemNames && !S.hideItemNames;
  const font = `${Math.round(12 * G.dpr)}px "Alegreya Sans", sans-serif`;
  const h = 16;
  const candidates = p && world.queryLootRect
    ? world.queryLootRect(p.x - 14, p.y - 14, p.x + 14, p.y + 14, world._labelLootBuffer || (world._labelLootBuffer = []))
    : world.loot;
  for (const l of candidates) {
    if (l._lootRemoved) continue;
    if (l.kind !== 'item' && l.kind !== 'potion' && l.kind !== 'key' && !(l.kind === 'gold' && l.amount > 0)) continue;
    const dx = p ? p.x - l.x : 0, dy = p ? p.y - l.y : 0, d2 = dx * dx + dy * dy;
    if (d2 > 196) continue;
    if (l.kind === 'potion') {
      l._potionLabelSuppressedForCapacity = shouldSuppressPotionLabelForCapacity(p?.char, l.item?.kind);
      if (l._potionLabelSuppressedForCapacity) { l.named = false; silent.push(l); continue; }
    }
    const d = Math.sqrt(d2);
    if (l.kind === 'gold' && !S.showGoldLabels) continue;
    const r = labelRank(l);
    if (S.hideItemNames || r < 0 || (!all && d > labelReach(r))) { l.named = false; silent.push(l); continue; }
    l.nameScore = r * 100 - d + (l.named ? 2 : 0); // (a name keeps its place until something clearly better comes along)
    cand.push(l);
  }
  const budget = all ? Infinity : labelBudget(ctx.canvas.height / G.dpr);
  const keep = cand.length > budget ? new Set([...cand].sort((a, b) => b.nameScore - a.nameScore).slice(0, budget)) : null;
  let labelCheckId = 0;
  const eachLabelCell = (x, y, w, visit) => {
    const x0 = Math.floor((x - w / 2) / 48), x1 = Math.floor((x + w / 2) / 48);
    const y0 = Math.floor((y - h / 2) / 24), y1 = Math.floor((y + h / 2) / 24);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (visit(`${cx},${cy}`) === false) return false;
    return true;
  };
  for (const l of cand) { // (in ground order, so the stacks hold still as the hero walks)
    if (keep && !keep.has(l)) { l.named = false; silent.push(l); continue; }
    const [sx, sy0] = camera.tileToScreen(l.x, l.y, 26);
    let sy = sy0, free = false;
    const spr = labelSprite(l.label, l.color, font), w = spr.tw / G.dpr + 10;
    // avoid overlapping labels
    for (let k = 0; k < 8; k++) {
      const id = ++labelCheckId;
      free = true;
      eachLabelCell(sx, sy, w, (cellKey) => {
        const bucket = labelGrid.get(cellKey);
        if (!bucket) return true;
        for (const b of bucket) {
          if (b._checkId === id) continue;
          b._checkId = id;
          if (Math.abs(b.x - sx) < (b.w + w) / 2 && Math.abs(b.y - sy) < h) { free = false; return false; }
        }
        return true;
      });
      if (free) break;
      sy -= h + 1;
    }
    if (!free && !all) { l.named = false; silent.push(l); continue; } // a wall of names reads as nothing: no room, no name
    l.named = true;
    const box = { x: sx, y: sy, w, h, loot: l };
    eachLabelCell(sx, sy, w, (cellKey) => {
      let bucket = labelGrid.get(cellKey);
      if (!bucket) labelGrid.set(cellKey, (bucket = []));
      bucket.push(box);
      return true;
    });
    drawLabel(ctx, spr, sx, sy, w, h, mouse && Math.abs(mouse.x - sx) < w / 2 && Math.abs(mouse.y - sy) < h / 2);
    boxes.push(box);
  }
  // no name: an unseen hit box on the item itself (after the labels: a label under the mouse wins), its name under the mouse
  let shown = !mouse || boxes.some((b) => Math.abs(mouse.x - b.x) < b.w / 2 && Math.abs(mouse.y - b.y) < b.h / 2);
  const z = camera.zoom || 1;
  for (const l of silent) {
    const [gx, gy] = camera.tileToScreen(l.x, l.y, 6);
    const box = { x: gx, y: gy, w: 30 * z, h: 24 * z, loot: l };
    boxes.push(box);
    if (l._potionLabelSuppressedForCapacity) {
      if (mouse && Math.abs(mouse.x - gx) < box.w / 2 && Math.abs(mouse.y - gy) < box.h / 2) shown = true;
      continue;
    }
    if (shown || Math.abs(mouse.x - gx) >= box.w / 2 || Math.abs(mouse.y - gy) >= box.h / 2) continue;
    shown = true;
    const [sx, sy] = camera.tileToScreen(l.x, l.y, 26), spr = labelSprite(l.label, l.color, font), w = spr.tw / G.dpr + 10;
    drawLabel(ctx, spr, sx, sy, w, h, true);
  }
  return boxes;
}

export { clamp, floatText, spawn };
