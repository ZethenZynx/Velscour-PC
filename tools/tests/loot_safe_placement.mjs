import assert from 'node:assert/strict';
import { TileMap } from '../../src/world/map.js';
import { World } from '../../src/game/world.js';
import { GroundItem } from '../../src/game/loot.js';
import { resolveLootLanding } from '../../src/game/lootplacement.mjs';
import { G } from '../../src/state.js';

function makeMap(w = 40, h = 32, sheer = true) {
  const map = new TileMap(w, h);
  map.t.fill(1);
  map.block.fill(0);
  map.sheer = sheer ? {} : null;
  return map;
}

const player = { x: 4.5, y: 4.5, r: 0.35, isPlayer: true, team: 'player', dead: false, st: {} };

// Valid ordinary drops keep their existing exact coordinates and are not routed.
{
  const map = makeMap(12, 12, false);
  let paths = 0;
  const findPath = map.findPath.bind(map);
  map.findPath = (...args) => { paths++; return findPath(...args); };
  assert.equal(resolveLootLanding(map, 6.2, 6.7, player), null);
  assert.equal(paths, 0, 'valid ordinary drops do not pay pathfinding cost');
}

// A void drop is moved to the closest accessible body-clear floor.
{
  const map = makeMap();
  for (let y = 8; y < 18; y++) for (let x = 8; x < 18; x++) map.t[y * map.w + x] = 0;
  const landing = resolveLootLanding(map, 12.5, 12.5, player);
  assert.ok(landing, 'void drops receive a safe landing');
  assert.ok(map.circleFree(landing.x, landing.y, 0.24), 'landing fits the floor and collision clearance');
  assert.ok(map.findPath(player.x, player.y, landing.x, landing.y, 2500, 0.24), 'landing is reachable from player');
  assert.equal(landing.reason, 'invalid-or-unreachable');
}

// A nearer but disconnected Sheer Drops platform is rejected in favor of the player's reachable side.
{
  const map = makeMap(50, 40);
  map.t.fill(0);
  for (let y = 1; y < 10; y++) for (let x = 1; x < 11; x++) map.t[y * map.w + x] = 1;
  for (let y = 10; y < 18; y++) for (let x = 28; x < 36; x++) map.t[y * map.w + x] = 1;
  const landing = resolveLootLanding(map, 31.5, 14.5, player);
  assert.ok(landing, 'disconnected island drops use a reachable fallback');
  assert.ok(landing.x < 20, 'the destination is not on the disconnected island');
  assert.ok(map.findPath(player.x, player.y, landing.x, landing.y, 2500, 0.24));
  assert.equal(landing.reason, 'player-fallback');
}

// Props, walls, edges and an off-map source all resolve without losing the reward.
{
  const map = makeMap(24, 24, false);
  map.block[10 * map.w + 10] = 1;
  const blocked = resolveLootLanding(map, 10.5, 10.5, player);
  assert.ok(blocked && map.circleFree(blocked.x, blocked.y, 0.24), 'blocked terrain is avoided');
  const edge = resolveLootLanding(map, 0.1, 0.1, player);
  assert.ok(edge && map.circleFree(edge.x, edge.y, 0.24), 'map edge drops land on safe floor');
  const far = resolveLootLanding(map, -100, -100, player);
  assert.ok(far && far.reason === 'player-fallback', 'far-away failures fall back near the player');
}

// The real World.addLoot path retains a single collectible and completes its correction arc.
{
  const previous = { world: G.world, player: G.player, settings: G.settings };
  const map = makeMap(24, 24, true);
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) map.t[y * map.w + x] = 0;
  const world = new World('dungeon', { map, biome: {}, props: [], torches: [], portals: [], creatures: [] });
  world.player = player;
  G.world = world; G.player = player; G.settings = { ...(G.settings || {}), sfx: 0 };
  try {
    const reward = new GroundItem(11.5, 11.5, 'gold', { amount: 123 });
    world.addLoot(reward);
    assert.equal(world.loot.length, 1, 'the correction does not duplicate the reward');
    assert.ok(map.circleFree(reward.x, reward.y, 0.24), 'the pickup coordinate is safe immediately');
    assert.ok(reward._lootLandingArc, 'corrected drops use a short arc');
    assert.ok(world.movingLoot.has(reward), 'the animation is included in normal loot updates');
    for (let i = 0; i < 30; i++) reward.update(1 / 60, world);
    assert.equal(reward._lootLandingArc, null, 'the correction animation completes');
    assert.equal(reward.z, 0, 'the item settles normally');
    assert.equal(reward.amount, 123, 'reward contents remain unchanged');

    const otherKinds = [
      new GroundItem(11.5, 11.5, 'item', { item: { type: 'gear', rarity: 0, name: 'Test item' } }),
      new GroundItem(11.5, 11.5, 'potion', { item: { type: 'potion', name: 'Test potion' } }),
      new GroundItem(11.5, 11.5, 'key'),
      new GroundItem(11.5, 11.5, 'orb_hp'),
    ];
    for (const drop of otherKinds) {
      world.addLoot(drop);
      assert.ok(map.circleFree(drop.x, drop.y, 0.24), `${drop.kind} is placed on safe floor`);
      assert.ok(drop._lootLandingArc, `${drop.kind} uses the shared correction animation`);
    }
    assert.equal(world.loot.length, 1 + otherKinds.length, 'all reward kinds remain distinct and collectible');
  } finally {
    G.world = previous.world; G.player = previous.player; G.settings = previous.settings;
  }
}

console.log('Safe loot placement checks passed: valid drops, voids, disconnected platforms, obstacles, edges, fallback, arc completion, and reward identity.');
