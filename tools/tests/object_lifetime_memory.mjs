import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { World } from '../../src/game/world.js';
import { clearVfx } from '../../src/gfx/vfx.js';

if (typeof globalThis.gc !== 'function') {
  console.log('Node heap retention check skipped: run with --expose-gc.');
  process.exit(0);
}

const map = { doors: [], nudge: (x, y) => [x, y], reveal() {}, walkable: () => true };
const world = new World('town', { map, biome: {}, props: [], torches: [], portals: [], npcs: [], chests: [] });
const previousWorld = G.world;
try {
  clearVfx(); G.world = null;
  globalThis.gc(); globalThis.gc();
  const baseline = process.memoryUsage().heapUsed;
  const count = 10000;
  for (let i = 0; i < count; i++) world.addLoot({ x: i % 100, y: Math.floor(i / 100), kind: 'item', item: { type: 'gear', name: `Fixture ${i}`, stats: { armor: i } } });
  globalThis.gc(); await new Promise((resolve) => setImmediate(resolve)); globalThis.gc();
  const populated = process.memoryUsage().heapUsed;
  world.time = 120;
  world.update(0.001);
  globalThis.gc(); await new Promise((resolve) => setImmediate(resolve)); globalThis.gc(); await new Promise((resolve) => setImmediate(resolve)); globalThis.gc();
  const cleaned = process.memoryUsage().heapUsed;
  assert.equal(world.loot.length, 0);
  assert.equal(world.lootCells.size, 0);
  assert.equal(world._lootRegistered, 0);
  console.log(JSON.stringify({ fixture: '10,000 synthetic ground equipment drops', heapBeforeBytes: baseline, heapPopulatedBytes: populated, heapAfterExpiryBytes: cleaned, reclaimedBytes: populated - cleaned, reclaimedPercentOfFixtureDelta: populated > baseline ? Number(((populated - cleaned) * 100 / (populated - baseline)).toFixed(1)) : null, caveat: 'Node V8 heap only; not browser canvas/GPU or live-game memory' }, null, 2));
} finally { G.world = previousWorld; clearVfx(); }
