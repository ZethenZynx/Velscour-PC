// Screen-space hit areas for world interactables. Kept independent of input state so
// the geometry can be validated without launching the game or a browser.
export function chestSpriteHit(c, sx, sy, zoom, tileToScreen) {
  const [cx, cy] = tileToScreen(c.x, c.y);
  const baseY = cy + 12 * zoom;
  return sx >= cx - 29 * zoom && sx <= cx + 29 * zoom &&
    sy >= baseY - 56 * zoom && sy <= baseY + 5 * zoom;
}

export function portalSpriteHit(p, sx, sy, zoom, tileToScreen) {
  const [px, py] = tileToScreen(p.x, p.y);
  // drawPortal renders a 1.3x floor ring (44.2 px radius) and a raised
  // portal whose glow reaches about 94 px above its ground anchor. Include a
  // small margin so the visible outer ring and foot are not dead click zones.
  const scale = Math.max(0.1, Number(zoom) || 1);
  return sx >= px - 47 * scale && sx <= px + 47 * scale &&
    sy >= py - 98 * scale && sy <= py + 24 * scale;
}

export function exitPortalIsOpen(p, run = p?.riftRun) {
  const isLinkedCompletedRift = run?.done && !run?.failed && (!run.exitPortal || run.exitPortal === p);
  return !!(p && !p.hidden && (p.active || isLinkedCompletedRift));
}

/** Completed exit artwork wins over overlapping ground-loot labels when clicked. */
export function activeExitSpriteAt(portals, sx, sy, zoom, tileToScreen, riftRun = undefined) {
  return (portals || []).find((p) => p?.type === 'exit' && exitPortalIsOpen(p, riftRun) &&
    portalSpriteHit(p, sx, sy, zoom, tileToScreen)) || null;
}

export function findNearbyInteractableSpot(x, y, isValid, maxRadius = 5, step = 0.25) {
  for (let radius = step; radius <= maxRadius; radius += step) {
    let best = null, bestDistance = Infinity;
    for (let dy = -radius; dy <= radius + 1e-6; dy += step) for (let dx = -radius; dx <= radius + 1e-6; dx += step) {
      if (Math.abs(Math.hypot(dx, dy) - radius) > step * 0.72) continue;
      const distance = dx * dx + dy * dy;
      if (distance >= bestDistance || !isValid(x + dx, y + dy)) continue;
      best = [x + dx, y + dy]; bestDistance = distance;
    }
    if (best) return best;
  }
  return null;
}

/** Find a portal anchor with enough room for the player and a path from the level start. */
export function findReachableInteractableSpot(map, start, x, y, maxRadius = 10, step = 0.5, bodyRadius = 0.42) {
  const valid = (px, py) => map.walkable(px, py) && map.circleFree(px, py, bodyRadius) &&
    !!map.findPath(start[0], start[1], px, py, 9000, bodyRadius - 0.04);
  if (valid(x, y)) return [x, y];
  return findNearbyInteractableSpot(x, y, valid, maxRadius, step);
}
