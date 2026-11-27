const DEFAULT_SEARCH_RADIUS = 8;
const MAX_CANDIDATES = 512;
const MAX_PATH_CHECKS = 12;
const PATH_NODE_BUDGET = 2500;

const finitePoint = (x, y) => Number.isFinite(x) && Number.isFinite(y);

function bodyClear(map, x, y, radius) {
  return finitePoint(x, y) && map.isFloor(x, y) && map.circleFree(x, y, radius);
}

/**
 * Find a body-clear landing spot when loot was dropped over invalid terrain.
 * The search is deliberately bounded and is only called for invalid drops.
 * In cliff worlds, path checks ensure a nearby floor on a disconnected island
 * is not mistaken for loot the player can actually reach.
 */
export function resolveLootLanding(map, x, y, player, options = {}) {
  if (!map?.isFloor || !map?.circleFree || !map?.findPath) return null;
  const radius = Math.max(0.12, Number(options.radius) || 0.24);
  const hasOrigin = finitePoint(x, y);
  const origin = hasOrigin ? [x, y] : null;
  const hasPlayer = finitePoint(player?.x, player?.y);
  let start = hasPlayer && bodyClear(map, player.x, player.y, radius) ? [player.x, player.y] : null;
  if (hasPlayer && !start) {
    const recovered = map.nearestFloor?.(player.x, player.y, radius, 4);
    if (recovered && bodyClear(map, recovered[0], recovered[1], radius)) start = recovered;
  }

  const reachable = (point) => {
    if (!start) return !hasPlayer;
    return !!map.findPath(start[0], start[1], point[0], point[1], PATH_NODE_BUDGET, radius);
  };
  const valid = (px, py) => bodyClear(map, px, py, radius);

  // Ordinary floor drops retain their exact existing positions and scatter.
  // Cliff layouts additionally validate reachability because separate islands
  // can both be walkable while only one is connected to the player.
  if (origin && valid(x, y) && (!map.sheer || reachable(origin))) return null;

  const ox = origin ? x : (start?.[0] ?? 0);
  const oy = origin ? y : (start?.[1] ?? 0);
  const searchRadius = Math.max(1, Math.min(16, Number(options.searchRadius) || DEFAULT_SEARCH_RADIUS));
  const candidates = [];
  const minX = Math.max(0, Math.floor(ox - searchRadius));
  const maxX = Math.min(map.w - 1, Math.ceil(ox + searchRadius));
  const minY = Math.max(0, Math.floor(oy - searchRadius));
  const maxY = Math.min(map.h - 1, Math.ceil(oy + searchRadius));
  for (let ty = minY; ty <= maxY && candidates.length < MAX_CANDIDATES; ty++) {
    for (let tx = minX; tx <= maxX && candidates.length < MAX_CANDIDATES; tx++) {
      const px = tx + 0.5, py = ty + 0.5;
      const dx = px - ox, dy = py - oy, d2 = dx * dx + dy * dy;
      if (d2 > searchRadius * searchRadius || !valid(px, py)) continue;
      const pdx = start ? px - start[0] : 0, pdy = start ? py - start[1] : 0;
      candidates.push({ x: px, y: py, d2, playerD2: pdx * pdx + pdy * pdy });
    }
  }
  candidates.sort((a, b) => a.d2 - b.d2 || a.playerD2 - b.playerD2);

  let checked = 0;
  for (const candidate of candidates) {
    if (checked++ >= MAX_PATH_CHECKS) break;
    if (reachable([candidate.x, candidate.y])) {
      return { x: candidate.x, y: candidate.y, fromX: origin?.[0] ?? candidate.x,
        fromY: origin?.[1] ?? candidate.y, reason: map.sheer ? 'invalid-or-unreachable' : 'invalid-floor' };
    }
  }

  // If the source is surrounded by void, walls, or an isolated platform,
  // prefer a safe point close to the player. This is a fallback, not an award:
  // the same GroundItem and reward are retained and remain normally collectible.
  if (start) {
    const nearPlayer = map.nearestFloor?.(start[0], start[1], radius, 6);
    if (nearPlayer && valid(nearPlayer[0], nearPlayer[1]) && reachable(nearPlayer)) {
      return { x: nearPlayer[0], y: nearPlayer[1], fromX: origin?.[0] ?? nearPlayer[0],
        fromY: origin?.[1] ?? nearPlayer[1], reason: 'player-fallback' };
    }
    return { x: start[0], y: start[1], fromX: origin?.[0] ?? start[0], fromY: origin?.[1] ?? start[1], reason: 'player-fallback' };
  }

  // Generation and non-player reward paths may not have an active player.
  // Keep the item rather than silently discarding it if a bounded recovery
  // cannot establish a safe landing point.
  return null;
}
