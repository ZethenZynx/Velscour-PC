/** Visit hostile bodies intersecting one Storm Tether segment.
 *
 * Query only the segment's local bounds. A previous implementation queried an
 * 11-tile circle around the caster once, then tested every result against each
 * tether. In crowded rooms that made the narrow beams do work proportional to
 * (all nearby enemies x every beam), even though most enemies could not touch a
 * beam. World.hostilesInBounds uses the spatial grid and each body's radius to
 * return only creatures whose collision bounds overlap the beam's AABB.
 */
export function visitStormTetherTargets(world, team, x0, y0, x1, y1, out, visit, stats = null) {
  const dx = x1 - x0, dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.25 || lenSq > 81) return 0;

  const minX = Math.min(x0, x1) - 0.35, minY = Math.min(y0, y1) - 0.35;
  const maxX = Math.max(x0, x1) + 0.35, maxY = Math.max(y0, y1) + 0.35;
  world.hostilesInBounds(team, minX, minY, maxX, maxY, out);
  if (stats) stats.searches++;

  let hits = 0;
  for (const creature of out) {
    if (stats) stats.candidates++;
    if (creature.dead) continue;
    const u = Math.max(0, Math.min(1, ((creature.x - x0) * dx + (creature.y - y0) * dy) / lenSq));
    const ex = x0 + dx * u - creature.x, ey = y0 + dy * u - creature.y;
    const radius = 0.35 + (creature.r || 0);
    if (stats) stats.collisionChecks++;
    if (ex * ex + ey * ey > radius * radius) continue;
    visit(creature);
    hits++;
    if (stats) stats.damageEvents++;
  }
  return hits;
}
