// Seeded, non-browser accessibility soak test using TileMap's actual player collision checks.
import assert from 'node:assert/strict';
import { generateDungeon } from '../../src/world/dungeon.js';
import { BIOMES, BIOME_BY_ID } from '../../src/data/biomes.js';
import { RIFT_DENSITY, riftDepth } from '../../src/data/rifts.js';

const directions = ['NE', 'SE', 'SW', 'NW'], masks = {};
for (let mask = 0; mask < 16; mask++) masks[mask] = [directions.filter((_, bit) => mask & (1 << bit)).map((arm) => ({ arm, ox: 0, oy: 0 }))];
const tileset = (biome) => ({ split: 0, bases: [0], features: [0], floors: [{ lum: 0, name: 'test floor' }],
  walls: { mock: masks }, families: ['mock'], scatter: [], pack: biome.pack || 'crypt', k: 1, arches: {}, doors: {}, archSpan: {} });
const regular = BIOMES.filter((b) => !b.overworld && !b.beta && !b.challenge && !b.tower && !b.cave && b.id !== 'throne');
const assertTargets = (g, label) => {
  const m = g.map, reach = m.movementReachable(g.start, 0.24);
  assert.ok(m.circleFree(...g.start, 0.24), `${label}: entrance accepts player collision`);
  assert.ok(m.movementCanReach(g.start, g.exit, 0.24, reach), `${label}: exit walkable from entrance`);
  for (const s of g.spawns || []) if (s.rank === 'boss' || s.rank === 'raid')
    assert.ok(m.movementCanReach(g.start, [s.x, s.y], 0.24, reach) ||
      m.nearestReachableStand?.(reach, [s.x, s.y]), `${label}: boss is walk-reachable`);
  assert.equal(g.accessibility?.validated, true, `${label}: generation is certified`);
};
const N = 64, R = 24;
let total = 0, regenerated = 0, repaired = 0, longestMs = 0;
const start = Date.now();
for (const biome of regular) for (let seed = 1; seed <= N; seed++) {
  const key = (seed * 0x9e3779b1 + biome.id.length * 997) >>> 0, t = performance.now();
  const g = generateDungeon(30 + seed, biome, tileset(biome), key);
  longestMs = Math.max(longestMs, performance.now() - t);
  assertTargets(g, `${biome.id}/${seed}`); total++;
  regenerated += g.accessibility.regenerated || 0; repaired += g.accessibility.repairs || 0;
}
for (const biome of regular) for (let seed = 1; seed <= R; seed++) {
  const key = (seed * 0x85ebca6b + biome.id.length * 31337) >>> 0, t = performance.now();
  const g = generateDungeon(riftDepth(seed), biome, tileset(biome), key,
    { rift: true, raid: true, small: true, density: RIFT_DENSITY });
  longestMs = Math.max(longestMs, performance.now() - t);
  assertTargets(g, `rift:${biome.id}/${seed}`); total++;
  regenerated += g.accessibility.regenerated || 0; repaired += g.accessibility.repairs || 0;
}
{
  const biome = BIOME_BY_ID.throne, g = generateDungeon(100, biome, tileset(biome), 0x51a7e, { practiceVelscour: false });
  assertTargets(g, 'campaign-depth-100-throne'); total++;
  regenerated += g.accessibility.regenerated || 0; repaired += g.accessibility.repairs || 0;
}
console.log(`PASS collision-aware dungeon layouts: ${total} (${regular.length} environments; ${N} standard and ${R} Rift seeds each). Repairs=${repaired}; regenerated attempts=${regenerated}; total=${Date.now()-start}ms; slowest layout=${longestMs.toFixed(2)}ms.`);
