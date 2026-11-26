// Shared health-bar preferences, classification and low-allocation canvas renderer.
// Static frame, emblem and fill artwork is loaded once and reused by overhead bars,
// the target banner and the settings preview.
import { G } from '../state.js';

export const HEALTH_BAR_CLASSES = Object.freeze([
  { id: 'normal', label: 'Normal Monster', color: '#c52b20', fill: 'red', fillAsset: 'fill-red', icon: 'normal' },
  { id: 'champion', label: 'Champion', color: '#2679df', fill: 'blue', fillAsset: 'fill-blue', icon: 'champion' },
  { id: 'unique', label: 'Unique Monster', color: '#d99916', fill: 'gold', fillAsset: 'fill-gold', icon: 'unique' },
  { id: 'boss', label: 'Boss', color: '#c51e16', fill: 'crimson', fillAsset: 'fill-crimson', icon: 'boss' },
  { id: 'nemesis', label: 'Nemesis', color: '#8d35d5', fill: 'purple', fillAsset: 'fill-purple', icon: 'nemesis' },
  { id: 'imp', label: 'Treasure Imp', color: '#128d36', fill: 'emerald', fillAsset: 'fill-emerald', icon: 'imp' },
  { id: 'companion', label: 'Companion / Summon', color: '#14939b', fill: 'teal', fillAsset: 'fill-teal', icon: 'companion' },
]);
const PLAYER_BAR_CLASS = Object.freeze({ id: 'player', label: 'Player', color: '#c52b20', fill: 'red', fillAsset: 'fill-red', icon: null });

export const DEFAULT_HEALTH_BAR_SETTINGS = Object.freeze({
  theme: 'velscour',
  overhead: Object.freeze({ width: 100, height: 100, opacity: 100, verticalOffset: 0, decorativeBorders: true, smoothHealthDepletion: true, visibility: 'always' }),
  target: Object.freeze({ width: 100, height: 100, opacity: 100, verticalOffset: 0, decorativeBorders: true, smoothHealthDepletion: true, visibility: 'always' }),
  classes: Object.freeze({ normal: true, champion: true, unique: true, boss: true, nemesis: true, imp: true, companion: true, player: false }),
  info: Object.freeze({ showEnemyName: false, showEnemyLevel: false, showHealthPercentage: false, showNumericalHealth: false, showAffixIcons: true, showStatusEffectIcons: true }),
});

const VISIBILITY = new Set(['always', 'damaged', 'combat', 'targeted', 'hidden']);
const STATUS_COLORS = [['burn', '#ff7040'], ['poison', '#83d64d'], ['bleed', '#bd2028'], ['chill', '#8eeaff'], ['freeze', '#b2f6ff'], ['stun', '#ffdc65'], ['fear', '#bd80ef']];
const STATUS_LABELS = [['burn', 'Burn'], ['poison', 'Poison'], ['bleed', 'Bleed'], ['chill', 'Chill'], ['freeze', 'Freeze'], ['stun', 'Stun'], ['fear', 'Fear']];
const AFFIX_LABELS = Object.freeze({ strong: 'Strong', fast: 'Fast', tough: 'Stone Skin', fiery: 'Fire', frozen: 'Cold', shocking: 'Lightning', vampiric: 'Vampiric', teleport: 'Teleport', multishot: 'Multishot', thorns: 'Thorns', regen: 'Regeneration' });
const AFFIX_GLYPHS = Object.freeze({ strong: 'S', fast: 'F', tough: 'T', fiery: 'F', frozen: 'C', shocking: 'L', vampiric: 'V', teleport: 'T', multishot: 'M', thorns: 'R', regen: '+' });
const OVERHEAD_DRAW_OPTIONS = Object.freeze({ system: 'overhead' });
const ASSET_ROOT = 'assets/ui/healthbars/';
const ART = Object.create(null);
let settingsRef = null;
let artPreloaded = false;
function image(name) {
  if (!ART[name] && typeof Image !== 'undefined') {
    const img = ART[name] = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof document !== 'undefined') {
        document.querySelector('[data-hb-preview]')?.dispatchEvent(new Event('healthbarartready'));
        document.dispatchEvent(new Event('healthbarartready'));
      }
    };
    img.src = `${ASSET_ROOT}${name}.webp`;
  }
  const img = ART[name];
  return img && img.complete && img.naturalWidth ? img : null;
}
export function preloadHealthBarArt() {
  if (artPreloaded) return;
  artPreloaded = true;
  image('frame');
  image('frame-target');
  image('frame-boss');
  for (const c of HEALTH_BAR_CLASSES) { image(c.icon); image(`fill-${c.fill}`); }
}

function bounded(n, min, max, fallback) {
  n = Number(n);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
export function normalizeHealthBarSettings(value, legacyLifeBars = true) {
  const src = value && typeof value === 'object' ? value : {};
  const out = {
    theme: src.theme === 'classic' ? 'classic' : 'velscour',
    overhead: { ...DEFAULT_HEALTH_BAR_SETTINGS.overhead, ...(src.overhead || {}) },
    target: { ...DEFAULT_HEALTH_BAR_SETTINGS.target, ...(src.target || {}) },
    classes: { ...DEFAULT_HEALTH_BAR_SETTINGS.classes, ...(src.classes || {}) },
    info: { ...DEFAULT_HEALTH_BAR_SETTINGS.info, ...(src.info || {}) },
  };
  // An old player's explicit preference is retained as the new overhead display mode.
  if (!Object.hasOwn(src, 'overhead') && legacyLifeBars === false) out.overhead.visibility = 'damaged';
  for (const key of ['overhead', 'target']) {
    const a = out[key];
    a.width = bounded(a.width, 60, 160, 100);
    a.height = bounded(a.height, 60, 160, 100);
    a.opacity = bounded(a.opacity, 15, 100, 100);
    a.verticalOffset = bounded(a.verticalOffset, -60, 60, 0);
    a.decorativeBorders = a.decorativeBorders !== false;
    a.smoothHealthDepletion = a.smoothHealthDepletion !== false;
    a.visibility = VISIBILITY.has(a.visibility) ? a.visibility : 'always';
  }
  for (const key of Object.keys(DEFAULT_HEALTH_BAR_SETTINGS.classes)) out.classes[key] = out.classes[key] !== false;
  for (const key of Object.keys(DEFAULT_HEALTH_BAR_SETTINGS.info)) out.info[key] = out.info[key] !== false;
  return out;
}
export function healthBarSettings() {
  const st = G.settings || {};
  // Normalize once per saved-settings object, never via deep comparison during each creature draw.
  if (!st.healthBars || st.healthBars !== settingsRef) {
    st.healthBars = normalizeHealthBarSettings(st.healthBars, st.lifeBars !== false);
    settingsRef = st.healthBars;
  }
  return st.healthBars;
}

export function healthBarClass(entity) {
  if (!entity) return HEALTH_BAR_CLASSES[0];
  if (entity.team === 'player' && entity.summon) return HEALTH_BAR_CLASSES[6];
  if (entity.isPlayer) return PLAYER_BAR_CLASS;
  if (entity.nemesis || entity.rank === 'nemesis') return HEALTH_BAR_CLASSES[4];
  if (entity.goblin || entity.treasureImp || entity.impVariant || entity.rank === 'imp') return HEALTH_BAR_CLASSES[5];
  if (entity.isRaid || entity.rank === 'raid' || entity.rank === 'boss' || entity === entity.world?.boss) return HEALTH_BAR_CLASSES[3];
  return HEALTH_BAR_CLASSES.find((entry) => entry.id === entity.rank) || HEALTH_BAR_CLASSES[0];
}

function combatIsActive(entity) {
  const world = entity?.world || G.world;
  if (world && Number(world._audioCombatUntil) > Number(world.time || 0)) return true;
  return !!(entity && (entity.awake || entity.aggro || entity.state === 'act'));
}
function currentlyTargeted(entity) {
  const player = G.player;
  return entity === G.hover || entity === G.lastHit || entity === player?.attackTarget?.target;
}
export function healthBarVisible(entity, system = 'overhead') {
  if (!entity || entity.dead || entity.hidden || entity.alpha === 0) return false;
  const s = healthBarSettings(), isPlayer = !!entity.isPlayer;
  if (isPlayer && (system !== 'overhead' || !s.classes.player)) return false;
  const category = healthBarClass(entity).id;
  if (!s.classes[category] || (isPlayer && !s.classes.player)) return false;
  const mode = s[system]?.visibility || 'always';
  if (mode === 'hidden') return false;
  if (mode === 'damaged' && entity.hp >= entity.maxHp) return false;
  if (mode === 'combat' && !combatIsActive(entity)) return false;
  if (mode === 'targeted' && !currentlyTargeted(entity)) return false;
  return true;
}

export function healthBarText(entity, s = healthBarSettings()) {
  const info = s.info, hp = Math.max(0, Number(entity?.hp) || 0), max = Math.max(0, Number(entity?.maxHp) || 0);
  const level = entity?.level ? `Lv. ${entity.level}` : '';
  const pct = max ? Math.round(hp / max * 100) : 0;
  const bits = [];
  if (info.showEnemyLevel && level) bits.push(level);
  if (entity?.isPlayer) bits.push('Player');
  else bits.push(healthBarClass(entity).label);
  if (info.showHealthPercentage) bits.push(`${pct}%`);
  if (info.showNumericalHealth) bits.push(`${Math.ceil(hp).toLocaleString()} / ${Math.ceil(max).toLocaleString()}`);
  if (entity?.ward > 0 && entity.ward < 1) bits.push('Ward');
  return bits.join('  ·  ');
}

/** Concise information placed below the boss banner; health values live inside its track. */
export function healthBarSummaryText(entity, s = healthBarSettings()) {
  const bits = [];
  if (s.info.showEnemyLevel && entity?.level) bits.push(`Lv. ${entity.level}`);
  bits.push(healthBarClass(entity).label);
  if (entity?.ward > 0 && entity.ward < 1) bits.push('Ward');
  return bits.join('  ·  ');
}

/** Health values for the boss track, independently controlled by the existing display options. */
export function healthBarValueText(entity, s = healthBarSettings()) {
  const hp = Math.max(0, Number(entity?.hp) || 0), max = Math.max(0, Number(entity?.maxHp) || 0);
  const bits = [];
  if (s.info.showHealthPercentage) bits.push(`${max ? Math.round(hp / max * 100) : 0}%`);
  if (s.info.showNumericalHealth) bits.push(`${Math.ceil(hp).toLocaleString()} / ${Math.ceil(max).toLocaleString()}`);
  return bits.join('  ·  ');
}

export function healthBarAffixText(entity) {
  if (!healthBarSettings().info.showAffixIcons) return '';
  const names = entity?.affixes || []; let text = '';
  for (const id of names) text += `${text ? '  ·  ' : ''}${AFFIX_LABELS[id] || id}`;
  return text;
}
export function healthBarStatusText(entity) {
  if (!healthBarSettings().info.showStatusEffectIcons) return '';
  let text = '';
  for (const [id, label] of STATUS_LABELS) if (entity?.status?.[id]?.t > 0) text += `${text ? '  ·  ' : ''}${label}`;
  return text;
}

function drawFallback(ctx, x, y, w, h, fraction, color) {
  ctx.fillStyle = '#120c08'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * fraction, h);
  ctx.fillStyle = 'rgba(255,230,160,.5)'; ctx.fillRect(x, y, w * fraction, Math.max(1, h * 0.22));
  ctx.strokeStyle = '#9a7340'; ctx.lineWidth = Math.max(1, h * 0.08); ctx.strokeRect(x, y, w, h);
}

/** Small, emblem-free overhead bar. Its pointed, metal-edged shape is independent of the large target frame. */
function drawCompactOverhead(ctx, x, y, w, h, fraction, color, theme, decorativeBorders) {
  ctx.save();
  try {
    const mid = y + h / 2, tip = Math.min(h * 0.55, w * 0.06), inset = Math.max(1, h * 0.16);
    ctx.beginPath();
    ctx.moveTo(x, mid); ctx.lineTo(x + tip, y); ctx.lineTo(x + w - tip, y);
    ctx.lineTo(x + w, mid); ctx.lineTo(x + w - tip, y + h); ctx.lineTo(x + tip, y + h); ctx.closePath();
    ctx.fillStyle = '#100b08'; ctx.fill();
    ctx.save();
    try {
      ctx.clip();
      const innerX = x + tip + inset, innerW = Math.max(0, w - 2 * (tip + inset));
      const innerY = y + inset, innerH = Math.max(1, h - inset * 2);
      if (fraction > 0) {
        ctx.fillStyle = color;
        ctx.fillRect(innerX, innerY, innerW * fraction, innerH);
        if (theme === 'classic') {
          ctx.fillStyle = 'rgba(255,255,255,.22)';
        } else {
          const sheen = ctx.createLinearGradient(0, innerY, 0, innerY + innerH);
          sheen.addColorStop(0, 'rgba(255,245,215,.62)'); sheen.addColorStop(.38, 'rgba(255,255,255,.12)'); sheen.addColorStop(1, 'rgba(0,0,0,.35)');
          ctx.fillStyle = sheen;
        }
        ctx.fillRect(innerX, innerY, innerW * fraction, innerH);
      }
    } finally { ctx.restore(); }
    if (decorativeBorders && theme !== 'classic') {
      ctx.beginPath(); ctx.moveTo(x + tip, y + .5); ctx.lineTo(x + w - tip, y + .5); ctx.lineTo(x + w - .5, mid); ctx.lineTo(x + w - tip, y + h - .5); ctx.lineTo(x + tip, y + h - .5); ctx.lineTo(x + .5, mid); ctx.closePath();
      ctx.strokeStyle = 'rgba(224,190,123,.96)'; ctx.lineWidth = Math.max(.8, h * .12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + tip + 1, y + 1.5); ctx.lineTo(x + w - tip - 1, y + 1.5);
      ctx.strokeStyle = 'rgba(255,239,192,.7)'; ctx.lineWidth = Math.max(.45, h * .07); ctx.stroke();
    } else if (decorativeBorders) {
      ctx.strokeStyle = '#6a5942'; ctx.lineWidth = Math.max(.8, h * .12); ctx.stroke();
    }
  } finally { ctx.restore(); }
}

/** Paint a horizontally nine-sliced frame so width adjustments do not squash its emblems or end caps. */
export function drawHealthBarFrame(ctx, classification, x, y, w, h, system = 'overhead') {
  const bossFrame = classification?.id === 'boss';
  const frame = image(bossFrame ? 'frame-boss' : system === 'target' ? 'frame-target' : 'frame');
  if (!frame) return false;
  const sw = frame.naturalWidth, sh = frame.naturalHeight;
  const leftFraction = bossFrame ? (system === 'target' ? 0.23 : 0.24) : system === 'target' ? 0.12 : 0.201;
  const rightFraction = bossFrame ? 0.12 : system === 'target' ? 0.09 : 0.12;
  const sourceLeft = sw * leftFraction, sourceRight = sw * (1 - rightFraction);
  let left = h * sourceLeft / sh, right = h * (sw - sourceRight) / sh;
  if (left + right > w) { const scale = w / (left + right); left *= scale; right *= scale; }
  ctx.drawImage(frame, 0, 0, sourceLeft, sh, x, y, left, h);
  ctx.drawImage(frame, sourceLeft, 0, sourceRight - sourceLeft, sh, x + left, y, Math.max(0, w - left - right), h);
  ctx.drawImage(frame, sourceRight, 0, sw - sourceRight, sh, x + w - right, y, right, h);
  return true;
}

/** Draw a reusable, image-backed Velscour bar. Coordinates are in the caller's current canvas space. */
export function drawHealthBarCanvas(ctx, entity, x, y, w, h, { system = 'overhead', forceClass = null, forceFraction = null } = {}) {
  const s = healthBarSettings(), appearance = s[system] || s.overhead;
  const classification = forceClass || healthBarClass(entity);
  let fraction = Math.min(1, Math.max(0, forceFraction == null ? (entity?.maxHp > 0 ? entity.hp / entity.maxHp : 0) : forceFraction));
  if (forceFraction == null && appearance.smoothHealthDepletion && entity) {
    if (!Number.isFinite(entity._healthBarDisplayHp)) entity._healthBarDisplayHp = fraction;
    const dt = Math.max(0, Math.min(0.1, Number(G.dt) || 1 / 60));
    entity._healthBarDisplayHp += (fraction - entity._healthBarDisplayHp) * (1 - Math.exp(-dt * 12));
    fraction = Math.min(1, Math.max(0, entity._healthBarDisplayHp));
  } else if (forceFraction == null && entity) entity._healthBarDisplayHp = fraction;
  const opacity = appearance.opacity / 100;
  ctx.save();
  try {
    ctx.globalAlpha *= opacity;
    if (system === 'overhead') {
      drawCompactOverhead(ctx, x, y, w, h, fraction, classification.color, s.theme, appearance.decorativeBorders);
      return;
    }
    if (s.theme === 'classic') {
      drawFallback(ctx, x, y, w, h, fraction, classification.color);
      return;
    }
    const bossFrame = classification.id === 'boss';
    const frame = image(bossFrame ? 'frame-boss' : system === 'target' ? 'frame-target' : 'frame'), fill = image(classification.fillAsset), emblem = classification.icon ? image(classification.icon) : null;
    if (!frame) { drawFallback(ctx, x, y, w, h, fraction, classification.color); return; }
    const target = system === 'target';
    const leftFraction = bossFrame ? (target ? 0.23 : 0.24) : target ? 0.12 : 0.201;
    const rightFraction = bossFrame ? 0.12 : target ? 0.09 : 0.12;
    const left = x + h * frame.naturalWidth * leftFraction / frame.naturalHeight;
    const right = x + w - h * frame.naturalWidth * rightFraction / frame.naturalHeight;
    const top = y + h * (bossFrame ? 0.37 : 0.365);
    const innerW = Math.max(0, right - left);
    const innerH = h * (bossFrame ? 0.21 : target ? 0.27 : 0.305);
    if (appearance.decorativeBorders) drawHealthBarFrame(ctx, classification, x, y, w, h, system);
    ctx.fillStyle = '#110b08'; ctx.fillRect(left, top, innerW, innerH);
    if (fill && fraction > 0) ctx.drawImage(fill, 0, 0, Math.max(1, fill.naturalWidth * fraction), fill.naturalHeight, left, top, innerW * fraction, innerH);
    else if (fraction > 0) { ctx.fillStyle = classification.color; ctx.fillRect(left, top, innerW * fraction, innerH); }
    ctx.fillStyle = 'rgba(255,236,190,.38)'; ctx.fillRect(left, top, innerW * fraction, Math.max(1, innerH * 0.2));
    if (emblem) {
      const size = h * 0.62;
      const centerX = x + h * frame.naturalWidth * (bossFrame ? 0.156 : target ? 0.066 : 0.118) / frame.naturalHeight;
      ctx.drawImage(emblem, centerX - size / 2, y + h * 0.5 - size / 2, size, size);
    }
    let iconAt = 0;
    if (entity && s.info.showAffixIcons && Array.isArray(entity.affixes)) {
      const count = Math.min(4, entity.affixes.length), r = Math.max(1, h * 0.045);
      for (let i = 0; i < count && iconAt < 4; i++, iconAt++) {
        const cx = x + w * (0.895 + iconAt * 0.019), cy = y + h * 0.5;
        ctx.beginPath(); ctx.fillStyle = '#ffd678'; ctx.strokeStyle = '#3b1a0a'; ctx.lineWidth = Math.max(0.6, r * 0.45);
        ctx.arc(cx, cy, r * 1.65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#281307'; ctx.font = `bold ${Math.max(6, r * 2.1)}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(AFFIX_GLYPHS[entity.affixes[i]] || '?', cx, cy);
      }
    }
    if (entity && s.info.showStatusEffectIcons) {
      for (const [id, color] of STATUS_COLORS) if (entity.status?.[id]?.t > 0 && iconAt < 4) {
        const r = Math.max(1, h * 0.045), cx = x + w * (0.895 + iconAt++ * 0.019), cy = y + h * 0.5;
        ctx.beginPath(); ctx.fillStyle = color; ctx.strokeStyle = '#1a0d0a'; ctx.lineWidth = Math.max(0.6, r * 0.45);
        ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#170b07'; ctx.font = `bold ${Math.max(6, r * 1.8)}px Georgia,serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(id.slice(0, 1).toUpperCase(), cx, cy);
      }
    }
    if (system === 'overhead' && healthBarSettings().info.showHealthPercentage) {
      ctx.fillStyle = '#f2dfbf'; ctx.font = `bold ${Math.max(8, h * 0.25)}px Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${Math.round(fraction * 100)}%`, left + innerW * 0.5, top + innerH * 0.55);
    }
  } finally {
    ctx.restore();
  }
}

export function drawOverheadHealthBar(ctx, entity, x, y, w, h) {
  drawHealthBarCanvas(ctx, entity, x, y, w, h, OVERHEAD_DRAW_OPTIONS);
}
