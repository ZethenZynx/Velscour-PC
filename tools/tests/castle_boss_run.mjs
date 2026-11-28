// Node-only contract checks for the full-size Castle guardian route.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const pack = readJson('assets/tiles/castle/pack.json');
const ramparts = readJson('assets/tiles/castle/ramparts.json');

globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => String(url).includes('ramparts.json') ? ramparts : pack,
});
// Castle artwork construction is exercised in Node without changing the browser
// renderer. Supply the small canvas surface its texture loader expects.
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  querySelector: () => null,
  dispatchEvent() {},
  addEventListener() {},
};
globalThis.Image = class {
  constructor() { this.width = 16384; this.height = 16384; }
  set src(_) { queueMicrotask(() => this.onload?.()); }
};
const imp = (p) => import(pathToFileURL(path.join(root, p)));

const { loadCastlePack } = await imp('src/gfx/castle.js');
const { BIOME_BY_ID } = await imp('src/data/biomes.js');
const { generateCastle, CASTLE_SIZE } = await imp('src/world/castleworld.js');
const { createCastleRun, createDarkForestRun } = await imp('src/game/darkforest.js');
await loadCastlePack();

const count = process.argv[2] == null ? 10 : +process.argv[2];
const biome = BIOME_BY_ID.castle;
for (let seed = 1; seed <= count; seed++) {
  const g = generateCastle(30, biome, seed * 7717 + 3, 0), m = g.map;
  if (m.w !== CASTLE_SIZE[0] || m.h !== CASTLE_SIZE[1] || m.w !== 336 || m.h !== 304) throw Error('Castle size is not 336 x 304');
  if (g.spawns.filter((s) => s.rank === 'boss').length !== 1) throw Error('expected exactly one guardian');
  if (g.shrine || g.sites) throw Error('unexpected legacy shrine or sites were added');
  if (!Number.isInteger(g.scenarioId) || g.scenarioId < 0 || g.scenarioId >= 40) throw Error('Castle story variant is missing or invalid');
  if (!Array.isArray(g.chests) || g.chests.length < 1) throw Error('Castle lost its generated treasure chests');
  const regular = g.spawns.filter((s) => s.rank !== 'boss');
  const enemies = regular.reduce((sum, s) => sum + s.n, 0);
  // The Castle currently mixes the seeded legacy patrols with two themed patrol
  // layers; guard against large density regressions without assuming one seed's
  // exact total.
  if (enemies < 240 || enemies > 360) throw Error('regular monster population drifted: ' + enemies);
  // The current castle is baked from the shared 3D structure arrays. The older
  // test inspected flags on individual props that this renderer no longer emits.
  const routeWalls = g.map.rampartWall.reduce((n, bit) => n + bit, 0);
  const buildings = g.map.c3bld.reduce((n, id) => n + (id ? 1 : 0), 0);
  const gates = g.map.castleBridges.length;
  if (routeWalls < 500 || buildings < 10 || gates !== 3 || g.map.castleGateTiles.length < 1)
    throw Error('the route needs continuous walls, buildings and three accessible gates: ' + JSON.stringify({ routeWalls, buildings, gates, gateTiles: g.map.castleGateTiles.length }));
  // The Castle has walkable elevated ramparts and stairs, so a flat-tile BFS
  // incorrectly labels valid elevated routes as disconnected.
  // The guardian is behind the intentionally locked drawbridge/postern. Check
  // the authored route after the run's objective unlocks those crossings.
  const openGates = m.block.slice();
  for (const i of m.castleGateTiles) openGates[i] = 0;
  const reach = m.movementReachable(g.start, 0.24, openGates);
  for (const p of [g.boss, g.exit, ...g.spawns.map((s) => [s.x, s.y])])
    if (!m.movementCanReach(g.start, p, 0.24, reach)) throw Error('unreachable spawn or route endpoint: ' + JSON.stringify({ p, spawn: g.spawns.find((s) => s.x === p[0] && s.y === p[1]), walkable: m.walkable(...p), tile: [Math.floor(p[0]), Math.floor(p[1])], start: g.start }));
  if (Math.hypot(g.start[0] - g.boss[0], g.start[1] - g.boss[1]) < m.h * 0.35)
    throw Error('the Castle guardian should remain a meaningful journey from the entry');
}
const forestGuardian = { rank: 'boss', team: 'enemy', dead: false };
if (createDarkForestRun({ boss: forestGuardian }, { seed: 1 }, biome).type !== 'forest') throw Error('Dark Forest run behavior changed');
const guardian = { rank: 'boss', team: 'enemy', dead: false, x: 320.5, y: 15.5 };
const camp = { castleObjective: 'camp', dead: false, x: 20, y: 20 }, graveyard = { castleObjective: 'graveyard', dead: false, x: 30, y: 30 };
const world = { boss: guardian, creatures: [guardian, camp, graveyard], portals: [], map: { castleGateUnlocked: false } };
let opened = false;
const run = createCastleRun(world, { seed: 1, castleObjectives: [
  { key: 'camp', label: 'Siege Camp' }, { key: 'graveyard', label: 'Graveyard' },
] }, biome, () => { opened = true; });
if (run.objectives.length !== 2 || world.portals.length !== 2) throw Error('both outside Castle objectives should register as accessible markers');
guardian.dead = true;
run.bossDefeated(guardian);
if (!run.completed || run.active || !opened) throw Error('guardian defeat did not complete the Castle run');
console.log('PASS Castle guardian route: ' + count + ' seeds, connected full-size map, accessible gates, and both objective markers plus guardian completion verified');
