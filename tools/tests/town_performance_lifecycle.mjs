import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { G } from '../../src/state.js';
import { World } from '../../src/game/world.js';
import { beginVictoryTownCelebration, townTick } from '../../src/game/happenings.js';
import { UI } from '../../src/ui/ui.js';
import { addEffect, particles, texts, clearVfx } from '../../src/gfx/vfx.js';
import { migrate, newCharData } from '../../src/game/save.js';
import { TileMap } from '../../src/world/map.js';

function testMap() {
  return {
    doors: [], flowRange: 64, flowBuilds: 0,
    buildFlow() { this.flowBuilds++; },
    reveal() {},
  };
}
function profileWorld(kind, duration = 4) {
  const map = testMap();
  const world = new World(kind, { map, biome: {}, torches: [], props: [], portals: [], creatures: [] });
  const player = { x: 10, y: 10, team: 'player', r: 0.35, dead: false, isPlayer: true, update() {} };
  world.player = player;
  world.add(player);
  G.world = world; G.player = player;
  for (let i = 0; i < duration * 60; i++) {
    world.update(1 / 60);
  }
  return { world, map };
}
function benchmarkTownIrrelevantFlowField() {
  const map = new TileMap(96, 96);
  map.t.fill(1);
  const samples = [];
  for (let i = 0; i < 140; i++) {
    const x = 8 + (i % 78), y = 8 + ((Math.floor(i / 78) * 19 + i * 3) % 78);
    const start = performance.now();
    map.buildFlow(x, y, 64);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[70], p95Ms: samples[133], worstMs: samples.at(-1) };
}

const saved = { world: G.world, player: G.player, centerMsg: UI.centerMsg, log: UI.log, settings: G.settings };
const originalStorage = globalThis.localStorage;
try {
  G.settings = { ...(G.settings || {}), sfx: 0 };
  const savedLocals = new Map();
  globalThis.localStorage = {
    getItem(key) { return savedLocals.has(key) ? savedLocals.get(key) : null; },
    setItem(key, value) { savedLocals.set(key, String(value)); },
    removeItem(key) { savedLocals.delete(key); },
  };
  UI.centerMsg = () => {};
  UI.log = () => {};
  clearVfx();

  const town = profileWorld('town');
  const dungeon = profileWorld('dungeon');
  assert.equal(town.map.flowBuilds, 0, 'town updates should not build the dungeon-only player flow field');
  assert.ok(dungeon.map.flowBuilds > 0, 'dungeon updates must retain flow-field pathfinding');

  const hero = {};
  const migratedHero = newCharData('paladin', 'Migration check');
  delete migratedHero.townVictoryFireworksDone;
  delete migratedHero.townVictoryFireworksPending;
  migrate(migratedHero);
  assert.equal(migratedHero.townVictoryFireworksDone, false, 'existing saves gain a safe one-time celebration default');
  assert.equal(migratedHero.townVictoryFireworksPending, false);
  migratedHero.townVictoryFireworksPending = true;
  migrate(migratedHero);
  assert.equal(migratedHero.townVictoryFireworksPending, true, 'pending celebration survives save migration');
  migratedHero.townVictoryFireworksDone = true;
  migrate(migratedHero);
  assert.equal(migratedHero.townVictoryFireworksDone, true);
  assert.equal(migratedHero.townVictoryFireworksPending, false, 'completed celebration cannot remain pending');

  const celebrationWorld = { kind: 'town', player: { x: 8, y: 8 } };
  assert.equal(beginVictoryTownCelebration(celebrationWorld, hero), false, 'ordinary town entries do not launch fireworks');
  townTick({ player: celebrationWorld.player, happen: { fireT: 0, fireLeft: 24 } }, 1);
  assert.equal(particles.length, 0, 'legacy recurring town-happening flags no longer launch fireworks');
  hero.townVictoryFireworksPending = true;
  assert.equal(beginVictoryTownCelebration(celebrationWorld, hero), true, 'a pending first-victory celebration starts once');
  assert.equal(hero.townVictoryFireworksPending, false);
  assert.equal(hero.townVictoryFireworksDone, true);
  for (let i = 0; i < 7; i++) townTick(celebrationWorld, 1);
  assert.equal(celebrationWorld.victoryFireworks, null, 'the celebration state expires');
  const particleCount = particles.length;
  assert.ok(particleCount > 0 && particleCount <= 6 * 26, 'the one celebration has a finite six-burst particle budget');
  assert.equal(beginVictoryTownCelebration(celebrationWorld, hero), false, 'saved completion prevents replay');

  clearVfx();
  const lifecycle = profileWorld('dungeon', 0);
  const world = lifecycle.world;
  for (let i = 0; i < 250; i++) world.creatures.push({ dead: true, removeT: 0, team: 'enemy', x: i, y: i, update() {} });
  for (let i = 0; i < 80; i++) world.hazards.push({ update() { return false; } });
  for (let i = 0; i < 80; i++) world.loot.push({ update() { return false; } });
  world.corpses.push({ t: 39.9 }, { t: 0, used: true });
  world.fallen.push({ t: 2.9 });
  addEffect({ update() { return false; } });
  texts.push({ life: 0.001, z: 0, vz: 0, comic: false });
  particles.push({ life: 0.001, max: 0.001, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, rot: 0, vr: 0, size: 1, size1: 1 });
  world.update(0.2);
  assert.equal(world.creatures.length, 1, 'dead enemy objects are removed from the active world collection');
  assert.equal(world.hazards.length, 0, 'expired hazards are removed');
  assert.equal(world.loot.length, 0, 'expired ground loot is removed');
  assert.equal(world.corpses.length, 0, 'expired/used corpses are removed');
  assert.equal(world.fallen.length, 0, 'expired summon remains are removed');
  assert.equal(particles.length, 0, 'expired particles are compacted out');
  assert.equal(texts.length, 0, 'expired damage text is compacted out');
  const flowCost = benchmarkTownIrrelevantFlowField();
  console.log(`Town flow-field builds: ${town.map.flowBuilds} in 4 s (dungeon control: ${dungeon.map.flowBuilds}); isolated 96x96 flow build median ${flowCost.medianMs.toFixed(4)} ms, p95 ${flowCost.p95Ms.toFixed(4)} ms, worst ${flowCost.worstMs.toFixed(4)} ms.`);
  console.log('Town flow-field optimization, one-time victory fireworks, and late-dungeon lifecycle cleanup passed.');
} finally {
  G.world = saved.world; G.player = saved.player; G.settings = saved.settings;
  UI.centerMsg = saved.centerMsg; UI.log = saved.log;
  if (typeof originalStorage === 'undefined') delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  clearVfx();
}
