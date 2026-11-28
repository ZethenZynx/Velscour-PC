// Castle Velscour is one optional environment in Infinite Endgame, not a
// second progression track. Its 100 authored floor configurations cycle on
// the existing endgame depth while creature levels use the actual game depth.
import { registerRegion } from '../regions.js';
import { G } from '../../state.js';
import { loadBiomeArt, biomeTileSet } from '../../core/assets.js';
import { preloadSheer } from '../../gfx/sheer.js';
import { sfx } from '../../core/audio.js';
import { Ring, addEffect } from '../../gfx/vfx.js';
import { bodyR } from '../../world/map.js';
import { loadArtFor } from '../../core/enemyart.js';
import { PHOBOS_ART, WINGS, wingOf, wingLordFor, captainFor, guardianFor, placeOf, placeLayout } from '../../data/phobos.js';
import { SHEER_BY_ID } from '../../data/sheer.js';
import { RNG } from '../../core/util.js';
import { generateCastleFloor, SHEER_LAYOUTS } from '../../world/castlevelscour.js';
import { generateSpires } from '../../world/castlespires.js';
import { loadPhobosTex, phobosFloors, floorV, PH_V } from '../../gfx/phobostex.js';
import { loadSpires3D } from '../../gfx/spires3d.js';
import { setupSpires } from '../castlespires.js';
import { VELSCOUR_RAIDS, WING_RAIDS } from '../phobosraids.js';

export const CASTLE_VELSCOUR_FLOORS = 100;
export const castleFloorAtDepth = (depth) => ((Math.max(0, Math.floor(Number(depth) || 101) - 101) % CASTLE_VELSCOUR_FLOORS) + CASTLE_VELSCOUR_FLOORS) % CASTLE_VELSCOUR_FLOORS + 1;

const artById = new Map(PHOBOS_ART.map((a) => [a.id, a]));
const validArt = (a) => a && a.id && a.arch && a.cat !== 'gray' && a.cat !== 'good';
const artFor = (wing, floor) => {
  const pool = [...new Set([...(wing.foes || []), ...(wing.knights || []), ...(wing.captains || []), ...(wing.lords || [])])]
    .map((a) => typeof a === 'string' ? artById.get(a) : a).filter(validArt);
  return pool.length ? pool : PHOBOS_ART.filter(validArt);
};
const layoutFor = (floor) => {
  const wing = wingOf(floor), authored = placeLayout(floor);
  return authored || wing.layouts[((floor - 1) % wing.layouts.length + wing.layouts.length) % wing.layouts.length] || 'gatehouse';
};
const leaderFor = (floor) => {
  const wing = wingOf(floor), hero = wingLordFor(floor) || (floor % 5 === 0 ? guardianFor(floor) : captainFor(floor));
  return validArt(hero) ? hero : (wing.captains || []).find(validArt) || (wing.lords || []).find(validArt) || guardianFor(floor);
};

function validateCastleFloor(gen) {
  const { map } = gen, links = (gen.leaps || []).filter((l) => map.circleFree(l.x, l.y, 0.24) && map.circleFree(l.tx, l.ty, 0.24));
  let reach = map.movementReachable(gen.start, 0.24), changed = true;
  // Crossings are traversable links, not floor tiles. Flood each reachable
  // landing pad as a new route origin until no additional platform is reached.
  for (let pass = 0; pass <= links.length && changed; pass++) {
    changed = false;
    for (const l of links) {
      const a = map.tileIdx(l.x, l.y), b = map.tileIdx(l.tx, l.ty);
      if (reach[a] && !reach[b]) {
        const next = map.movementReachable([l.tx, l.ty], 0.24);
        for (let i = 0; i < reach.length; i++) if (next[i] && !reach[i]) { reach[i] = 1; changed = true; }
      }
    }
  }
  const relocateToReachable = (at, maxDistance = 2.5) => {
    if (map.movementCanReach(gen.start, at, 0.24, reach)) return at;
    let best = null, bestD = maxDistance;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const p = [x + 0.5, y + 0.5], d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      if (d < bestD && reach[map.tileIdx(...p)] && map.circleFree(...p, 0.24) && map.movementCanReach(gen.start, p, 0.24, reach)) { best = p; bestD = d; }
    }
    return best;
  };
  const exit = relocateToReachable(gen.exit);
  if (exit) gen.exit = exit;
  for (const spawn of gen.spawns.filter((s) => s.rank === 'boss' || s.rank === 'raid')) {
    // The shared BOSS ROOM constructor enters four tiles east of the arena
    // anchor; validate that point too, or the raid can start inside a wall.
    const offsetX = spawn.rank === 'raid' ? 4 : 0;
    const at = relocateToReachable([spawn.x + offsetX, spawn.y]);
    if (at) { spawn.x = at[0] - offsetX; spawn.y = at[1]; }
  }
  const targets = [[...gen.exit], ...gen.spawns.filter((s) => s.rank === 'boss').map((s) => [s.x, s.y]),
    ...gen.spawns.filter((s) => s.rank === 'raid').map((s) => [s.x + 4, s.y])];
  const blocked = targets.filter((at) => !map.movementCanReach(gen.start, at, 0.24, reach));
  if (blocked.length) return { blocked, start: gen.start, exit: gen.exit, guardian: gen.guardian, bossSpawns: gen.spawns.filter((s) => s.rank === 'boss' || s.rank === 'raid').map((s) => [s.x, s.y]), reachableTiles: reach.reduce((n, v) => n + v, 0), links: links.length };
  gen.accessibility = { validated: true, repairs: 0, movementRadius: 0.24, movementLinks: links.length };
  return true;
}

// The phobos texture atlas uses floor IDs starting at PH_V, above ordinary
// biome floor IDs. Keep a per-world floor array so the global cached tile set
// is never mutated by this environment.
export function castleVelscourTileset(base, extraFloors = phobosFloors()) {
  const floors = base.floors.slice();
  while (floors.length < PH_V) floors.push(floors[0]);
  for (let i = 0; i < extraFloors.length; i++) floors[PH_V + i] = extraFloors[i] || floors[0];
  return { ...base, floors };
}

registerRegion({
  id: 'castle_velscour',
  words: ['castle velscour', 'velscour castle'],
  portal: 'Castle Velscour: an optional Infinite Endgame wing beyond the campaign.',
  townLine: 'An endgame route to Castle Velscour has opened beyond the campaign depths.',
  castleArt: true,
  async load(biome) {
    const floor = castleFloorAtDepth(G.char?.depth || 101), wing = wingOf(floor), layout = layoutFor(floor);
    const list = artFor(wing, floor);
    const promises = [loadBiomeArt(biome), loadPhobosTex(), loadArtFor(list.map((a) => a.id))];
    if (SHEER_LAYOUTS.has(layout)) {
      // Existing Sheer Drop assets supply the abyss for the castle's void rooms.
      promises.push(preloadSheer(SHEER_BY_ID.sheer_starless));
    }
    if (layout === 'spires') promises.push(loadSpires3D().catch((e) => { console.warn('Castle Velscour 3D art unavailable; retaining the playable flat route.', e); }));
    await Promise.all(promises);
  },
  ready: () => true,
  generate(depth, biome, seed, tileset) {
    const floor = castleFloorAtDepth(depth), wing = wingOf(floor), layout = layoutFor(floor), pool = artFor(wing, floor);
    const rng = new RNG((Number(seed) || 1) >>> 0), byArch = new Map();
    for (const a of pool) { const q = byArch.get(a.arch) || []; q.push(a.id); byArch.set(a.arch, q); }
    const pickArt = (random = rng) => pool[random.int(0, pool.length - 1)];
    const looks = {
      pickArt,
      lookOf: (a) => ({ art: a.id, swap: null }),
      all: () => pool.map((a) => ({ art: a.id })),
      ids: () => pool.map((a) => a.id),
      pick: (arch, random = Math.random) => {
        const ids = byArch.get(arch) || pool.map((a) => a.id);
        const n = Number(random()), i = Math.min(ids.length - 1, Math.max(0, Math.floor((Number.isFinite(n) ? n : 0) * ids.length)));
        return ids.length ? { art: ids[i] } : null;
      },
    };
    const sheer = SHEER_LAYOUTS.has(layout)
      ? (wing.id === 'stormspire' ? SHEER_BY_ID.sheer_storm : wing.id === 'bonespire' ? SHEER_BY_ID.sheer_ossuary : SHEER_BY_ID.sheer_starless)
      : null;
    const wingBiome = { ...biome, sheer };
    const atlasTileset = castleVelscourTileset(tileset || biomeTileSet(biome));
    let gen = layout === 'spires'
      ? generateSpires(floor, { name: placeOf(floor) }, wingBiome, atlasTileset, seed, { looks, raid: floor % 10 === 0 })
      : generateCastleFloor(floor, layout, wingBiome, atlasTileset, seed, { looks, color: wing.color, raid: floor % 10 === 0 });
    // Every tenth authored configuration is a four-phase Castle raid. The three
    // Velscour themes cycle on Infinite Endgame depth; they do not unlock or gate
    // separate progression tracks.
    const raidTheme = floor === 100 ? ['crimson', 'obsidian', 'cathedral'][Math.floor((depth - 101) / 100) % 3] : null;
    const raidTemplate = raidTheme ? VELSCOUR_RAIDS[raidTheme] : gen.raid ? WING_RAIDS[wing.boss] : null;
    if (raidTemplate && gen.raid) {
      const artId = raidTemplate.art?.[0], raidArt = artById.get(artId) || leaderFor(floor);
      gen.castleRaidTemplate = { ...raidTemplate, art: [raidArt.id], name: raidTemplate.name || raidArt.name, title: raidTemplate.title || wing.name };
      gen.castleBossArt = raidArt.id;
      gen.spawns.push({ x: gen.raid.cx, y: gen.raid.cy, arch: raidArt.arch || 'knight', n: 1, rank: 'raid', name: gen.castleRaidTemplate.name, castleVelscourBoss: true });
    } else {
      // A Castle guardian is required on every non-raid floor; these are ordinary
      // boss encounters and preserve the normal Infinite Endgame clear/reward path.
      const leader = leaderFor(floor), at = gen.guardian || gen.exit;
      if (leader && Number.isFinite(at?.[0]) && Number.isFinite(at?.[1])) {
        gen.spawns.push({ x: at[0], y: at[1], arch: leader.arch || 'knight', n: 1, rank: 'boss', look: { art: leader.id, swap: null }, name: leader.name, castleVelscourBoss: true });
        gen.castleBossArt = leader.id;
      }
    }
    // Convert the upstream floor dressing records to the fork's indexed atlas
    // convention. A missing optional carpet entry safely falls back to the base floor.
    for (const [x, y, name] of gen.floorOver || []) {
      const tx = Math.floor(x), ty = Math.floor(y), i = ty * gen.map.w + tx;
      if (!gen.map.t[i]) continue;
      const surface = name === 'garth' ? 'walk_paving' : name === 'carpet' ? `carpet_${wing.color}` : name;
      gen.map.v[i] = floorV(surface, tx, ty);
    }
    gen.castleFloor = floor;
    gen.castleWing = wing.id;
    gen.castleWingColor = wing.color;
    gen.castleLayout = layout;
    gen.castleFloorEntries = atlasTileset.floors;
    gen.roster = [...new Set(gen.spawns.filter((s) => s.arch && s.rank !== 'boss' && s.rank !== 'raid').map((s) => s.arch))];
    gen.looks = looks;
    const access = validateCastleFloor(gen);
    if (access !== true) throw new Error(`accessibility: Castle Velscour floor ${floor} blocks its boss or exit (${JSON.stringify(access)})`);
    return gen;
  },
  createRun(world, gen, biome, depth, win) {
    const leaps = (gen.leaps || []).map((l) => ({ ...l, cooldown: 0 }));
    const run = { id: 'castle_velscour', type: 'castle-endgame', depth, floor: gen.castleFloor, wing: gen.castleWing, layout: gen.castleLayout, completed: false, win,
      bossDefeated() {
        if (run.completed) return;
        run.completed = true;
        win();
      },
      update(dt) {
        const p = world.player;
        if (!p) return;
        if (p._castleLeap) {
          const leap = p._castleLeap; leap.elapsed += dt;
          const t = Math.min(1, leap.elapsed / leap.duration), ease = t * t * (3 - 2 * t);
          p.x = leap.from[0] + (leap.to[0] - leap.from[0]) * ease; p.y = leap.from[1] + (leap.to[1] - leap.from[1]) * ease;
          p.z = Math.sin(t * Math.PI) * 30;
          if (t >= 1) { p.x = leap.to[0]; p.y = leap.to[1]; p.z = 0; p.leaping = false; delete p._castleLeap; world.map.rememberPosition(p); addEffect(new Ring(p.x, p.y, 0.2, 1.2, 0.45, '#d8c090', 3)); }
          return;
        }
        for (const l of leaps) {
          l.cooldown = Math.max(0, l.cooldown - dt);
          if (l.cooldown || Math.hypot(p.x - l.x, p.y - l.y) > 0.52 || !world.map.circleFree(l.tx, l.ty, bodyR(p))) continue;
          l.cooldown = 1.15; p._castleLeap = { from: [p.x, p.y], to: [l.tx, l.ty], elapsed: 0, duration: 0.42 };
          p.leaping = true; p.channel = null; p.path = null; p.moveTarget = null; p.attackTarget = null;
          addEffect(new Ring(l.x, l.y, 0.25, 1.1, 0.35, '#e0d0a8', 3)); sfx(l.kind === 'swing' ? 'swing' : 'step', 0.5);
          break;
        }
      } };
    world.castleRun = run;
    world.castleVelscour = true;
    world.castleWingColor = gen.castleWingColor;
    if (gen.spires) setupSpires(world, gen, run);
    return run;
  },
  intro: (_world, gen) => `${WINGS.find((w) => w.id === gen.castleWing)?.name || 'Castle Velscour'} · ${placeOf(gen.castleFloor)}. Defeat the floor captain to open the exit.`,
  amb: 'inside_night',
});
