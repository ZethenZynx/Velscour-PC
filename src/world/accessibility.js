// Generation-time navigation checks that use TileMap's player collision radius and height-step rules.
export const PLAYER_ACCESS_RADIUS = 0.24; // bodyR({ r: 0.3 }) from game/player.js

export function nearestReachableStand(map, reachable, point, maxDistance = 2, radius = PLAYER_ACCESS_RADIUS) {
  if (!map || !reachable || !point) return null;
  let best = null, bestD2 = maxDistance * maxDistance;
  const x0 = Math.max(0, Math.floor(point[0] - maxDistance)), x1 = Math.min(map.w - 1, Math.ceil(point[0] + maxDistance));
  const y0 = Math.max(0, Math.floor(point[1] - maxDistance)), y1 = Math.min(map.h - 1, Math.ceil(point[1] + maxDistance));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * map.w + x;
    if (!reachable[i]) continue;
    const sx = x + 0.5, sy = y + 0.5, d2 = (sx - point[0]) ** 2 + (sy - point[1]) ** 2;
    if (d2 > bestD2 || !map.circleFree(sx, sy, radius)) continue;
    best = [sx, sy]; bestD2 = d2;
  }
  return best;
}

function carveWideRoute(map, reachable, target, radius) {
  const tx = Math.floor(target[0]), ty = Math.floor(target[1]);
  if (!map.inb(tx, ty)) return null;
  let source = -1, best = Infinity;
  for (let i = 0; i < reachable.length; i++) if (reachable[i]) {
    const x = i % map.w, y = (i / map.w) | 0, d = (x + 0.5 - target[0]) ** 2 + (y + 0.5 - target[1]) ** 2;
    if (d < best) { best = d; source = i; }
  }
  if (source < 0) return null;
  const sx = source % map.w, sy = (source / map.w) | 0, dx = tx - sx, dy = ty - sy;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1), cells = new Set();
  const level = map.hgt ? map.hgt[source] : 0;
  for (let k = 0; k <= steps; k++) {
    const x = Math.round(sx + dx * k / steps), y = Math.round(sy + dy * k / steps);
    const px = Math.abs(dx) >= Math.abs(dy) ? 0 : 1, py = Math.abs(dx) >= Math.abs(dy) ? 1 : 0;
    for (const w of [-1, 0, 1]) {
      const xx = x + px * w, yy = y + py * w;
      if (!map.inb(xx, yy)) continue;
      const i = yy * map.w + xx;
      map.t[i] = 1; map.block[i] = 0;
      if (map.kind) map.kind[i] = 0;
      if (map.hgt) map.hgt[i] = level;
      if (map.v) map.v[i] = map.v[source];
      cells.add(i);
    }
  }
  map.touchMinimapTerrain?.();
  map.flowFrom = [-999, -999];
  map.rebuildWalls?.();
  return cells;
}

/**
 * Validate mandatory points against actual player-sized movement. When a mandatory point has no reachable approach,
 * carve a three-tile route through blocking/void cells and recompute. Optional relocate callbacks can move an
 * obstructed spawn/portal onto the nearest reachable stand without changing its mechanics.
 */
export function ensureAccessibleTargets(map, start, targets, { radius = PLAYER_ACCESS_RADIUS, repair = true } = {}) {
  if (!map?.movementReachable || !start || !map.circleFree(start[0], start[1], radius)) {
    return { ok: false, reason: 'invalid entrance', repaired: 0, reachable: new Uint8Array(map?.t?.length || 0) };
  }
  let reachable = map.movementReachable(start, radius), repaired = 0;
  const repairedCells = new Set();
  for (const target of targets || []) {
    if (!target?.at) continue;
    let at = target.at;
    let direct = map.movementCanReach(start, at, radius, reachable);
    let approach = direct ? at : nearestReachableStand(map, reachable, at, target.approachRadius ?? 0, radius);
    if (!approach && repair) {
      const cells = carveWideRoute(map, reachable, at, radius);
      if (cells) {
        for (const i of cells) repairedCells.add(i);
        repaired++;
        reachable = map.movementReachable(start, radius);
        direct = map.movementCanReach(start, at, radius, reachable);
        approach = direct ? at : nearestReachableStand(map, reachable, at, target.approachRadius ?? 0, radius);
      }
    }
    if (!approach) return { ok: false, reason: `unreachable ${target.label || 'required point'}`, repaired, reachable, repairedCells };
    if (!direct && target.relocate) {
      target.relocate(approach[0], approach[1]);
      reachable = map.movementReachable(start, radius);
      if (!map.movementCanReach(start, approach, radius, reachable)) return { ok: false, reason: `could not relocate ${target.label || 'required point'}`, repaired, reachable, repairedCells };
    }
  }
  return { ok: true, repaired, reachable, repairedCells };
}
