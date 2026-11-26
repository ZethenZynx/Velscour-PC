import assert from 'node:assert/strict';
import { renderResolutionScale } from '../../src/core/render-resolution.mjs';
import { G } from '../../src/state.js';
import { World } from '../../src/game/world.js';
import { Area, Orbit, Projectile } from '../../src/game/hazards.js';

assert.equal(renderResolutionScale({ graphicsPreset: 'standard', adaptivePerformance: false }), 1);
assert.equal(renderResolutionScale({ graphicsPreset: 'standard', adaptivePerformance: true }), 1,
  'adaptive performance can change cosmetic quality but does not silently reduce rendering resolution');
assert.equal(renderResolutionScale({ graphicsPreset: 'extreme' }), 0.7,
  'the existing explicit extreme preset retains its reduced backing-store scale');

const createWorld = (includeDormantCluster) => {
  const world = new World('town', { map: { move(creature, dx, dy) { creature.x += dx; creature.y += dy; } } });
  const player = { team: 'player', isPlayer: true, x: 0.7, y: 0.7, r: 0.5, awake: true };
  const awakeA = { team: 'enemy', x: 1.2, y: 0.7, r: 0.5, awake: true };
  const awakeB = { team: 'enemy', x: 1.7, y: 0.7, r: 0.5, awake: true };
  world.player = player;
  world.creatures.push(player, awakeA, awakeB);
  if (includeDormantCluster) {
    for (let i = 0; i < 1000; i++) world.creatures.push({ id: i, team: 'enemy', x: 40 + (i % 20) * 0.005, y: 40 + (i % 30) * 0.005, r: 0.4, awake: false });
  }
  world._perfProfiling = true; world._perfCollisionPairs = 0;
  world.rebuildGrid();
  return world;
};

G.settings = { performanceProfiler: true };
const activeOnly = createWorld(false);
activeOnly.separate();
const baselineCollisionPairs = activeOnly._perfCollisionPairs;
assert.ok(baselineCollisionPairs > 0, 'awake actors still participate in broad-phase collision handling');

const populated = createWorld(true);
populated.separate();
assert.equal(populated._perfCollisionPairs, baselineCollisionPairs,
  'a large dormant cluster outside the existing 26-tile wake radius adds no physical pair checks');
const formerDormantPairChecks = (1000 * 999) / 2;
assert.equal(formerDormantPairChecks, 499500, 'fixture represents the prior same-cell all-pairs work for 1,000 sleeping enemies');
assert.equal(populated.creatures.filter((creature) => creature.team === 'enemy').length, 1002,
  'dormant enemies remain in the world and are not deleted');
assert.equal(populated.hostiles('player', 40, 40, 1).length, 1000,
  'dormant enemies remain available to spatial queries and gameplay systems');
assert.ok(populated.creatures.slice(3).every((creature) => creature.x >= 40 && creature.y >= 40),
  'skipped dormant enemies are not repositioned or otherwise changed');

function trackedWorld() {
  const usedBuffers = [];
  return { usedBuffers, map: { isFloor: () => true }, hostiles(team, x, y, radius, out = []) { out.length = 0; usedBuffers.push(out); return out; }, alliesOf(team, x, y, radius, out = []) { out.length = 0; usedBuffers.push(out); return out; } };
}

const projectileWorld = trackedWorld();
const projectileSource = { team: 'player', dead: false, x: 0, y: 0 };
const projectile = new Projectile({ world: projectileWorld, src: projectileSource, team: 'player', x: 0, y: 0, ang: 0, dmg: [1, 1] });
projectile.update(1 / 60); projectile.update(1 / 60);
assert.equal(projectileWorld.usedBuffers[0], projectileWorld.usedBuffers[1], 'projectile collision queries reuse one private target buffer across frames');

const areaWorld = trackedWorld();
const area = new Area({ world: areaWorld, src: projectileSource, team: 'player', x: 0, y: 0, el: 'fire', dmg: [1, 1], mode: 'zone', tick: 0.1 });
area.visual = () => {};
area.update(0.11); area.update(0.11);
assert.equal(areaWorld.usedBuffers[0], areaWorld.usedBuffers[1], 'area damage ticks reuse one private target buffer');

const orbitWorld = trackedWorld();
const orbit = new Orbit({ world: orbitWorld, src: projectileSource, team: 'player', x: 0, y: 0, el: 'fire', dmg: [1, 1], shieldVariant: true });
orbit.update(1 / 60);
assert.equal(orbitWorld.usedBuffers.length, orbit.n, 'each orbiting weapon still checks every intended orbit point');
assert.equal(new Set(orbitWorld.usedBuffers).size, 1, 'all sequential orbit checks reuse the hazard-private target buffer');

console.log(JSON.stringify({ baselineAwakeCollisionPairs: baselineCollisionPairs, pairsWith1000FarDormantEnemies: populated._perfCollisionPairs,
  priorDormantPairChecks: formerDormantPairChecks, dormantEnemiesPreserved: populated.hostiles('player', 40, 40, 1).length,
  standardResolutionScale: renderResolutionScale({ graphicsPreset: 'standard' }) }));
