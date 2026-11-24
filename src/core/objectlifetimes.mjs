/** Cosmetic and ground-loot lifetime policy, measured in world/gameplay seconds. */
export const OBJECT_LIFETIMES = Object.freeze({
  corpse: Object.freeze({ max: 10, fade: 2 }),
  gore: Object.freeze({ max: 10, fade: 2 }),
  debris: Object.freeze({ max: 5, fade: 1 }),
  trail: Object.freeze({ max: 3, fade: 1 }),
  impact: Object.freeze({ max: 2, fade: 0.5 }),
  damageNumber: Object.freeze({ max: 1.5, fade: 0.5 }),
  equipment: Object.freeze({ max: 120, fade: 5 }),
  gold: Object.freeze({ max: 120, fade: 5 }),
  gem: Object.freeze({ max: 120, fade: 5 }),
  sigil: Object.freeze({ max: 120, fade: 5 }),
  relic: Object.freeze({ max: 120, fade: 5 }),
  potion: Object.freeze({ max: 120, fade: 5 }),
  orb: Object.freeze({ max: 90, fade: 5 }),
});

const PROTECTED_LOOT_FLAGS = ['riftCompletionReward', 'questItem', 'requiredProgression', 'protectedReward'];

/** Returns true only for explicitly protected loot or required progression keys. */
export function isProtectedGroundLoot(loot) {
  if (!loot) return false;
  if (loot.kind === 'key') return true;
  return PROTECTED_LOOT_FLAGS.some((flag) => loot[flag] === true);
}

/**
 * Compute the absolute world-time deadline and fade start for ground loot.
 * Existing shorter `fades` values are retained; long or absent timers are
 * bounded by the requested maximum. Expiry is anchored once at creation.
 */
export function groundLootLifetime(loot, bornAt = 0) {
  if (isProtectedGroundLoot(loot)) return { expiresAt: Infinity, fadeAt: Infinity, duration: Infinity };
  let policy = OBJECT_LIFETIMES.gold;
  if (loot?.kind === 'potion') policy = OBJECT_LIFETIMES.potion;
  else if (loot?.kind?.startsWith?.('orb')) policy = OBJECT_LIFETIMES.orb;
  else if (loot?.kind === 'item') {
    const item = loot.item;
    if (item?.type === 'gem') policy = item?.sigil || item?.gem?.sigil ? OBJECT_LIFETIMES.sigil : OBJECT_LIFETIMES.gem;
    else if (item?.relic || item?.type === 'relic') policy = OBJECT_LIFETIMES.relic;
    else policy = OBJECT_LIFETIMES.equipment;
  }
  const prior = Number(loot?.fades);
  const duration = Number.isFinite(prior) && prior > 0 ? Math.min(policy.max, prior) : policy.max;
  const fade = Math.min(policy.fade, duration);
  return { expiresAt: bornAt + duration, fadeAt: bornAt + duration - fade, duration };
}

/** Fade alpha from a deadline without updating/resetting an object timer. */
export function lifetimeAlpha(now, expiresAt, fadeAt) {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(fadeAt) || now <= fadeAt) return 1;
  return Math.max(0, Math.min(1, (expiresAt - now) / Math.max(0.001, expiresAt - fadeAt)));
}

/** Conservative tile-space AABB for the isometric projection of a world-pixel rectangle. */
export function isometricTileBounds(x0, y0, x1, y1, halfTileWidth, halfTileHeight, out = {}) {
  // Transform the four corners using scalars; render callers pass a reused
  // output record so viewport culling allocates no arrays or temporary points.
  const ax = (x0 / halfTileWidth + y0 / halfTileHeight) / 2;
  const ay = (y0 / halfTileHeight - x0 / halfTileWidth) / 2;
  const bx = (x1 / halfTileWidth + y0 / halfTileHeight) / 2;
  const by = (y0 / halfTileHeight - x1 / halfTileWidth) / 2;
  const cx = (x0 / halfTileWidth + y1 / halfTileHeight) / 2;
  const cy = (y1 / halfTileHeight - x0 / halfTileWidth) / 2;
  const dx = (x1 / halfTileWidth + y1 / halfTileHeight) / 2;
  const dy = (y1 / halfTileHeight - x1 / halfTileWidth) / 2;
  out.minX = Math.min(ax, bx, cx, dx); out.maxX = Math.max(ax, bx, cx, dx);
  out.minY = Math.min(ay, by, cy, dy); out.maxY = Math.max(ay, by, cy, dy);
  return out;
}
