export const MAX_GORE_DECALS = 150;
export const GORE_DECAL_LIFETIME = 10;
export const GORE_DECAL_FADE_START = 8;

export function addGoreDecal(pool, decal) {
  if (pool.length >= MAX_GORE_DECALS) pool.shift();
  pool.push(decal);
}

/** Age and compact only cosmetic gore decals; returns the number removed. */
export function updateGoreDecals(pool, dt) {
  let write = 0, removed = 0;
  for (let i = 0; i < pool.length; i++) {
    const decal = pool[i];
    if (decal.grow < 1) decal.grow = Math.min(1, decal.grow + dt * 1.2);
    decal.life -= dt;
    if (decal.life <= 0) { removed++; continue; }
    pool[write++] = decal;
  }
  pool.length = write;
  return removed;
}

export function goreDecalAlpha(decal) {
  const fadeDuration = GORE_DECAL_LIFETIME - GORE_DECAL_FADE_START;
  return decal.alpha * (decal.life <= fadeDuration ? Math.max(0, decal.life / fadeDuration) : 1);
}

/** Keep a decal until its visible footprint has fully left the viewport. */
export function goreDecalOutsideView(decal, px, py, view, radius) {
  const c = Math.abs(Math.cos(decal.rot || 0)), s = Math.abs(Math.sin(decal.rot || 0));
  const rx = radius * (c + s * 0.5), ry = radius * (s + c * 0.5);
  return px + rx < view.x0 || px - rx > view.x1 || py + ry < view.y0 || py - ry > view.y1;
}
