// Bellmourn, Town III. Reuse the same bounded Phobos city-block generator as
// the campaign/endgame districts, but lay it with Frostbound streets and keep
// the fork's existing vendors, portals, services and town-life director.
import { RNG } from '../core/util.js';
import { VENDORS } from './town.js';
import { generatePhobosDistrict } from './phobosdistrict.js';

const DISTRICT = Object.freeze({ id: 'barbican', name: 'Bellmourn', style: 'fortress' });
const CITY = Object.freeze({ id: 'bellmourn', phobosEnvironment: 'frostbound', phobosDistrict: 'barbican' });

function findOpen(map, x, y, avoid, maxRadius = 8, minFromCenter = 0) {
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const px = Math.floor(x) + dx + 0.5, py = Math.floor(y) + dy + 0.5;
      if (!map.walkable(px, py) || !map.circleFree(px, py, 0.32) || Math.hypot(px - x, py - y) < minFromCenter) continue;
      if (avoid.some((p) => Math.hypot(px - p[0], py - p[1]) < 2.1)) continue;
      return [px, py];
    }
  }
  return null;
}

/**
 * Build a winter city hub. The city generator supplies the stone street grid,
 * walled perimeter, blocked building lots and Frostbound town-house sprites;
 * this wrapper supplies reachable Act III services and town destinations.
 */
export function generateBellmourn(tileset, seed = 2301114) {
  let result = null, lastError;
  for (let attempt = 0; attempt < 12 && !result; attempt++) {
    const nextSeed = (Number(seed) + attempt * 7919) >>> 0;
    try { result = generatePhobosDistrict(60, CITY, tileset, nextSeed, DISTRICT); }
    catch (error) { lastError = error; }
  }
  if (!result) throw lastError || new Error('Bellmourn city generation failed');
  const { map } = result, center = { x: Math.floor(map.w / 2) + 0.5, y: Math.floor(map.h / 2) + 0.5 };
  const northGate = findOpen(map, center.x, 5.5, [], 4);
  const southGate = findOpen(map, center.x, map.h - 5.5, northGate ? [northGate] : [], 4);
  if (!northGate || !southGate) throw new Error('Bellmourn could not place both city gates on reachable streets');
  const start = findOpen(map, center.x, center.y + 9, [northGate, southGate], 8, 5) || findOpen(map, center.x, center.y, [northGate, southGate], 8);
  if (!start) throw new Error('Bellmourn has no reachable town arrival point');
  const placed = [northGate, southGate, start];
  const npcs = [];
  const ring = [
    [center.x - 10, center.y - 9], [center.x, center.y - 11], [center.x + 10, center.y - 9],
    [center.x - 12, center.y + 2], [center.x + 12, center.y + 2],
    [center.x - 9, center.y + 11], [center.x, center.y + 13], [center.x + 9, center.y + 11],
  ];
  const rng = new RNG((Number(seed) || 1) >>> 0);
  for (let i = 0; i < VENDORS.length; i++) {
    const base = ring[i], rotated = (i + rng.int(0, ring.length - 1)) % ring.length;
    let at = findOpen(map, base[0], base[1], placed, 7, 5);
    if (!at) at = findOpen(map, ring[rotated][0], ring[rotated][1], placed, 9, 4);
    if (!at) throw new Error(`Bellmourn could not place reachable service ${VENDORS[i].id}`);
    placed.push(at);
    npcs.push({ vendor: VENDORS[i], x: at[0], y: at[1], flip: rng.next() < 0.5 });
  }
  // Town Life uses door anchors to assign homes. The city lots are four tiles
  // square, and keep the same simple front access rule as the town builder.
  const buildings = (result.buildings || []).map((b) => ({ ...b, x0: Math.floor(b.cx) - 2, y0: Math.floor(b.cy) - 2, sx: !!b.flip }));
  return {
    ...result,
    seed: Number(seed) >>> 0,
    start,
    portal: { x: northGate[0], y: northGate[1] },
    breach: { x: southGate[0], y: southGate[1] },
    center,
    altar: findOpen(map, center.x + 17, center.y, [...placed], 10, 12),
    npcs,
    buildings,
    props: result.props || [],
    wallHangings: [],
    chests: [],
    spawns: [],
  };
}
