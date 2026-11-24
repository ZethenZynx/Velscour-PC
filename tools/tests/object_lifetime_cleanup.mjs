import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { G } from '../../src/state.js';
import { World } from '../../src/game/world.js';
import { OBJECT_LIFETIMES, groundLootLifetime, isProtectedGroundLoot, isometricTileBounds, lifetimeAlpha } from '../../src/core/objectlifetimes.mjs';

assert.deepEqual(OBJECT_LIFETIMES.corpse, { max: 10, fade: 2 });
assert.deepEqual(OBJECT_LIFETIMES.gore, { max: 10, fade: 2 });
assert.deepEqual(OBJECT_LIFETIMES.debris, { max: 5, fade: 1 });
assert.deepEqual(OBJECT_LIFETIMES.trail, { max: 3, fade: 1 });
assert.deepEqual(OBJECT_LIFETIMES.impact, { max: 2, fade: 0.5 });
assert.deepEqual(OBJECT_LIFETIMES.damageNumber, { max: 1.5, fade: 0.5 });
assert.deepEqual(OBJECT_LIFETIMES.equipment, { max: 120, fade: 5 });
assert.deepEqual(OBJECT_LIFETIMES.gold, { max: 120, fade: 5 });
assert.deepEqual(OBJECT_LIFETIMES.gem, { max: 120, fade: 5 });
assert.deepEqual(OBJECT_LIFETIMES.sigil, { max: 120, fade: 5 });
assert.deepEqual(OBJECT_LIFETIMES.relic, { max: 120, fade: 5 });
assert.deepEqual(OBJECT_LIFETIMES.potion, { max: 120, fade: 5 });
assert.deepEqual(OBJECT_LIFETIMES.orb, { max: 90, fade: 5 });
assert.deepEqual(groundLootLifetime({ kind: 'item', item: { type: 'gear' }, fades: 45 }, 10), { expiresAt: 55, fadeAt: 50, duration: 45 }, 'existing shorter item lifetimes remain shorter');
assert.equal(groundLootLifetime({ kind: 'item', item: { type: 'gem' }, fades: 180 }, 10).expiresAt, 130, 'longer gem timers are capped at the requested 120 seconds');
assert.equal(groundLootLifetime({ kind: 'orb_hp' }, 10).expiresAt, 100, 'resource orbs expire after 90 seconds');
assert.equal(groundLootLifetime({ kind: 'key' }, 10).expiresAt, Infinity, 'required keys remain protected');
assert.equal(groundLootLifetime({ kind: 'item', requiredProgression: true }, 10).expiresAt, Infinity, 'explicit progression rewards remain protected');
assert.equal(isProtectedGroundLoot({ kind: 'key' }), true);
assert.equal(lifetimeAlpha(108, 110, 108), 1, 'loot remains opaque until the final five seconds');
assert.equal(lifetimeAlpha(109, 110, 108), 0.5, 'loot fades during the final five seconds');
assert.equal(lifetimeAlpha(110, 110, 108), 0, 'expired loot is fully invisible');

const iso = isometricTileBounds({ x0: 0, y0: 0, x1: 100, y1: 60 }, 50, 25);
for (const [x, y] of [[0, 0], [100, 0], [0, 60], [100, 60]]) {
  const tx = (x / 50 + y / 25) / 2, ty = (y / 25 - x / 50) / 2;
  assert.ok(tx >= iso.minX && tx <= iso.maxX && ty >= iso.minY && ty <= iso.maxY, 'isometric bounds contain each projected viewport corner');
}

const map = { doors: [], nudge: (x, y) => [x, y], reveal() {}, walkable: () => true };
const world = new World('town', { map, biome: {}, props: [], torches: [], portals: [], npcs: [], chests: [] });
const population = 943;
for (let i = 0; i < population; i++) world.add({ x: i < 10 ? 29 + i * 0.25 : 100 + i, y: i < 10 ? 22 : 100 + i, r: 0.3, team: 'enemy', awake: i < 10, dead: false });
world.rebuildGrid();
const bounds = { x0: 27, y0: 19, x1: 34, y1: 27 };
const expected = world.creatures.filter((c) => !c.dead && c.x + c.r >= bounds.x0 && c.x - c.r <= bounds.x1 && c.y + c.r >= bounds.y0 && c.y - c.r <= bounds.y1);
const candidates = world.creaturesInBounds(bounds.x0, bounds.y0, bounds.x1, bounds.y1, []);
assert.deepEqual(candidates, expected, 'spatial render culling returns every in-bounds actor in stable insertion order');
assert.equal(population - candidates.length, 933, 'the fixture culls the 933 off-screen enemies from the reported capture');
const currentSamples = [], legacySamples = [];
for (let i = 0; i < 120; i++) {
  const start = performance.now();
  world.creaturesInBounds(bounds.x0, bounds.y0, bounds.x1, bounds.y1, world._renderCreatureBuffer);
  currentSamples.push(performance.now() - start);
  const legacyStart = performance.now();
  let found = 0;
  for (const c of world.creatures) if (!c.dead && c.x + c.r >= bounds.x0 && c.x - c.r <= bounds.x1 && c.y + c.r >= bounds.y0 && c.y - c.r <= bounds.y1) found++;
  legacySamples.push(performance.now() - legacyStart);
}
currentSamples.sort((a, b) => a - b); legacySamples.sort((a, b) => a - b);
console.log(`Spatial render fixture: ${population} entities -> ${candidates.length} viewport candidates (933 culled); legacy scan p50/p95 ${legacySamples[60].toFixed(4)}/${legacySamples[113].toFixed(4)} ms; grid query p50/p95 ${currentSamples[60].toFixed(4)}/${currentSamples[113].toFixed(4)} ms (synthetic, non-graphical).`);

const previousWorld = G.world;
try {
  G.world = null;
  const lootWorld = new World('town', { map, biome: {}, props: [], torches: [], portals: [], npcs: [], chests: [] });
  const targeted = { x: 10, y: 10, kind: 'gold', update: () => true };
  lootWorld.player = { x: 10, y: 10, dead: true, lootTarget: targeted };
  lootWorld.addLoot(targeted);
  const deadEnemy = lootWorld.add({ x: 30, y: 30, r: 0.35, dead: true, team: 'enemy' });
  const expiredHazard = lootWorld.addHazard({ update: () => false });
  lootWorld.time = targeted._lootExpiryAt;
  lootWorld.update(0.1);
  assert.equal(targeted._lootRemoved, true, 'expired targeted loot is removed instead of having its lifetime reset');
  assert.equal(lootWorld.player.lootTarget, null, 'expiry clears the player target reference');
  assert.equal(lootWorld.loot.length, 0, 'expired loot is compacted from the world collection immediately');
  assert.equal(lootWorld.lootCells.size, 0, 'expired loot is removed from the spatial index');
  assert.equal(deadEnemy.world, null, 'dead enemy world references are released after the existing removal handoff');
  assert.equal(expiredHazard.world, null, 'expired hazard world references are released');
  assert.equal(lootWorld.creatures.includes(deadEnemy), false);
  assert.equal(lootWorld.hazards.includes(expiredHazard), false);
} finally { G.world = previousWorld; }

const render = await (await import('node:fs/promises')).readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
const vfx = await (await import('node:fs/promises')).readFile(new URL('../../src/gfx/vfx.js', import.meta.url), 'utf8');
assert.match(render, /world\.creaturesInBounds\(/, 'the world renderer uses its spatial actor query');
assert.doesNotMatch(render, /for \(const c of world\.creatures\) \{[\s\S]{0,300}enqueue\(c\.x \+ c\.y/, 'depth-sorted actors no longer scan the entire retained enemy collection');
assert.match(vfx, /ONE_SHOT_IMPACTS\.has\(e\?\.constructor\?\.name\)[\s\S]*OBJECT_LIFETIMES\.impact\.max/, 'one-shot impact primitives receive the two-second lifetime cap');
assert.match(vfx, /Math\.min\(S\.life, OBJECT_LIFETIMES\.damageNumber\.max\)/, 'damage numbers cannot outlive the 1.5-second maximum');
console.log('Object lifetime, progression protection, immediate cleanup, and spatial culling checks passed.');
