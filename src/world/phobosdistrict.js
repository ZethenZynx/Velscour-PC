// Bounded, seeded district generator for the recurring Phobos level family.
// The original upstream city is a fixed 344x204 capital; this generator keeps the
// streets, blocks and city walls while building one compact, replayable district.
import { RNG } from '../core/util.js';
import { TW } from '../core/view.js';
import { A } from '../core/assets.js';
import { TileMap } from './map.js';
import { townObject } from './town.js';
import { PHOBOS_DISTRICTS } from '../data/phobosfamily.js';

const DRESS = {
  barbican: ['handcart', 'crate_stack', 'cart_debris', 'closed_barrel'],
  cinder: ['cart_debris', 'tiles_and_bricks', 'firewood_stack', 'cold_forge'],
  rookeries: ['cart_debris', 'closed_barrel', 'tiles_and_bricks', 'water_bucket'],
  chainmarket: ['market_table', 'cloth_crate', 'grain_sacks', 'vegetable_basket', 'handcart'],
  wharf: ['water_barrel', 'rope_and_hook', 'crate_stack', 'closed_barrel'],
  tanners: ['water_barrel', 'horse_trough', 'workbench', 'closed_barrel'],
  boneyards: ['stone_boundary', 'fieldstone_cluster', 'stone_bench'],
  barracks: ['tool_rack', 'crate_stack', 'anvil_stump', 'arrow_milestone'],
  mages: ['scroll_rack', 'potion_jars', 'stone_bench'],
  dukes: ['stone_bench', 'potion_jars', 'cloth_crate'],
  approach: ['arrow_milestone', 'crate_stack', 'stone_bench'],
};

const BASES = {
  city: ['setts', 'market_flags', 'boards'], sunscorched: ['rich_flags', 'boards', 'dressed'],
  frostbound: ['march_gravel', 'flags', 'castle_stone'], hellfallen: ['ash_ground', 'char_timber', 'soot_plaster'],
};

function cityFloorIndices(tileset, environment, rng) {
  const byName = new Map(tileset.floors.map((f, i) => [f.name, i]));
  const baseNames = BASES[environment] || BASES.city;
  const bases = baseNames.map((name) => byName.get(name)).filter(Number.isInteger);
  const features = tileset.features.filter((i) => {
    const name = tileset.floors[i].name;
    return /stain|wear|gravel|ash|plaster|marble|flags/i.test(name);
  });
  return { bases: bases.length ? bases : tileset.bases, features: features.length ? features : tileset.features, rng };
}

export function generatePhobosDistrict(depth, biome, tileset, seed, districtData) {
  const rng = new RNG(seed >>> 0);
  const W = 80 + rng.int(0, 32), H = 64 + rng.int(0, 32);
  const map = new TileMap(W, H);
  map.t.fill(1);
  for (let x = 0; x < W; x++) { map.t[x] = 0; map.t[(H - 1) * W + x] = 0; }
  for (let y = 0; y < H; y++) { map.t[y * W] = 0; map.t[y * W + W - 1] = 0; }

  const centerX = Math.floor(W / 2), centerY = Math.floor(H / 2);
  const district = districtData || PHOBOS_DISTRICTS.find((d) => d.id === biome.phobosDistrict) || PHOBOS_DISTRICTS[0];
  const style = district.style;
  const roadW = style === 'dense' || style === 'market' ? 3 : 4;
  const verticalRoads = style === 'industrial' || style === 'canal' ? [Math.floor(W * 0.3), centerX, Math.floor(W * 0.68)] : [Math.floor(W * 0.25), centerX, Math.floor(W * 0.75)];
  const horizontalRoads = style === 'estate' ? [Math.floor(H * 0.32), Math.floor(H * 0.69)] : [Math.floor(H * 0.28), centerY, Math.floor(H * 0.72)];
  const road = new Uint8Array(W * H), plaza = new Uint8Array(W * H);
  const paintRoad = (x, y, width) => {
    const half = Math.floor(width / 2);
    for (let yy = y - half; yy <= y + half; yy++) for (let xx = x - half; xx <= x + half; xx++) {
      if (xx > 0 && yy > 0 && xx < W - 1 && yy < H - 1) road[yy * W + xx] = 1;
    }
  };
  for (const x of verticalRoads) for (let y = 1; y < H - 1; y++) paintRoad(x, y, roadW);
  for (const y of horizontalRoads) for (let x = 1; x < W - 1; x++) paintRoad(x, y, roadW);
  // The district square anchors its themed scenery and required Ward Lord encounter.
  const squareR = style === 'fortress' ? 6 : 5;
  for (let y = centerY - squareR; y <= centerY + squareR; y++) for (let x = centerX - squareR; x <= centerX + squareR; x++) {
    if (Math.hypot(x - centerX, y - centerY) <= squareR + 0.35) plaza[y * W + x] = 1;
  }
  // Canal wards keep a visible, collidable water channel beside the street, with road bridges left open.
  const canalX = Math.floor(W * 0.38);
  if (style === 'canal') for (let y = 2; y < H - 2; y++) for (let x = canalX; x < canalX + 2; x++) {
    if (!road[y * W + x] && !plaza[y * W + x]) { map.t[y * W + x] = 0; map.phobosWater ||= new Uint8Array(W * H); map.phobosWater[y * W + x] = 1; }
  }

  const floors = cityFloorIndices(tileset, biome.phobosEnvironment, rng);
  const lotCenters = [];
  for (let y = 7; y < H - 6; y += 9) for (let x = 7; x < W - 6; x += 10) {
    const tx = x + 1, ty = y + 1, idx = ty * W + tx;
    const clear = Array.from({ length: 4 }, (_, dy) => Array.from({ length: 4 }, (_, dx) => {
      const xx = tx + dx, yy = ty + dy;
      return xx > 1 && yy > 1 && xx < W - 2 && yy < H - 2 && !road[yy * W + xx] && !plaza[yy * W + xx] && map.t[yy * W + xx] === 1;
    }).every(Boolean)).every(Boolean);
    if (!clear || rng.next() < (style === 'dense' ? 0.08 : style === 'ruined' ? 0.28 : 0.16)) continue;
    // City lots are real collision footprints under the original town building artwork.
    for (let yy = ty; yy < ty + 4; yy++) for (let xx = tx; xx < tx + 4; xx++) map.block[yy * W + xx] = 1;
    lotCenters.push([tx + 2, ty + 2]);
    const n = floors.features.length && rng.chance(0.12) ? floors.features : floors.bases;
    for (let yy = ty; yy < ty + 4; yy++) for (let xx = tx; xx < tx + 4; xx++) map.v[yy * W + xx] = n[rng.int(0, n.length - 1)];
  }

  // Roads, squares and open yards use district/environment floors from the imported Phobos tile packs.
  for (let i = 0; i < map.t.length; i++) {
    if (!map.t[i]) continue;
    const x = i % W, y = (i / W) | 0;
    let pool = plaza[i] ? floors.bases : road[i] ? floors.bases : floors.features.length ? floors.features : floors.bases;
    if (!pool?.length) pool = [0];
    map.v[i] = pool[rng.int(0, pool.length - 1)];
  }
  map.buildWalls(tileset, () => rng.next());

  const buildings = [];
  const names = style === 'estate' ? ['b_inn', 'b_cottage', 'b_alchemist']
    : style === 'market' ? ['b_bakery', 'b_inn', 'b_cottage']
      : style === 'military' || style === 'fortress' ? ['b_stables', 'b_cottage', 'b_bakery']
        : ['b_cottage', 'b_cottage', 'b_bakery', 'b_stables'];
  const townScale = A_TOWN_SCALE(tileset);
  for (const [x, y] of lotCenters) {
    const spr = townObject(names[rng.int(0, names.length - 1)]);
    if (!spr) continue;
    buildings.push({ cx: x, cy: y, spr, k: townScale, depth: x + y, flip: rng.chance(0.5), district: district.id });
  }

  const props = [];
  const dressing = DRESS[district.id] || DRESS.barbican;
  for (let n = 0; n < 12; n++) {
    const angle = (n / 12) * Math.PI * 2 + rng.range(-0.18, 0.18);
    const radius = squareR * rng.range(0.72, 1.04);
    const x = centerX + Math.cos(angle) * radius, y = centerY + Math.sin(angle) * radius;
    if (!map.walkable(x, y) || map.block[map.tileIdx(x, y)]) continue;
    const spr = townObject(dressing[n % dressing.length]);
    if (spr) props.push({ kind: 'scatter', x, y, spr, k: townScale * 0.72, flip: rng.chance(0.5), fixed: true, district: district.id });
  }

  const start = [centerX + 0.5, H - 5.5], exit = [centerX + 0.5, 4.5];
  const boss = [centerX + (style === 'canal' ? 6 : 0.5), centerY + (style === 'fortress' ? 0.5 : 1.5)];
  const spawnTargets = [
    [centerX - 10, centerY - 9], [centerX + 10, centerY - 9],
    [centerX - 11, centerY + 8], [centerX + 11, centerY + 8],
    [centerX - 17, centerY], [centerX + 17, centerY],
  ];
  const spawnCells = [];
  for (const [tx, ty] of spawnTargets) {
    const candidates = [];
    for (let radius = 0; radius <= 4; radius++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = tx + dx, y = ty + dy, px = x + 0.5, py = y + 0.5;
      const idx = map.tileIdx(px, py);
      if (idx < 0 || spawnCells.some(([sx, sy]) => sx === x && sy === y) || !map.walkable(px, py) || map.block[idx] || Math.hypot(x - start[0], y - start[1]) <= 8) continue;
      candidates.push([x, y]);
    }
    if (candidates.length) spawnCells.push(candidates[rng.int(0, candidates.length - 1)]);
  }

  const chestSpot = [[centerX - squareR - 2, centerY + squareR + 2], [centerX + squareR + 2, centerY - squareR - 2], [centerX - squareR - 2, centerY - squareR - 2]]
    .find(([x, y]) => map.walkable(x + 0.5, y + 0.5) && !map.block[map.tileIdx(x + 0.5, y + 0.5)] && Math.hypot(x - boss[0], y - boss[1]) > 7);
  return {
    map, rooms: [], props, buildings, torches: [], wallHangings: [],
    start, exit, boss, seed, district: district.id,
    chests: chestSpot ? [{ x: chestSpot[0] + 0.5, y: chestSpot[1] + 0.5, rare: depth > 75 }] : [],
    spawns: spawnCells.map(([x, y], i) => ({ x: x + 0.5, y: y + 0.5, arch: null, n: 2 + (i % 2), rank: i === 2 ? 'champion' : 'normal', phobosDistrictPack: true })),
    spawnCells,
  };
}

function A_TOWN_SCALE() { return (TW / (A.town?.meta?.tile?.[0] || 64)) * 1.38; }
