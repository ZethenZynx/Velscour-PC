// Non-browser regression and repeatable benchmark for retained dungeon loot.
// Run: node tools/tests/dungeon_accumulation_performance.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { World } from '../../src/game/world.js';
import { G } from '../../src/state.js';
import { clearVfx } from '../../src/gfx/vfx.js';

const old = { world: G.world, player: G.player, settings: G.settings };
const emptyMap = { doors: [], reveal() {} };
const player = { x: 0, y: 0, team: 'player', isPlayer: true, dead: false, r: 0.35, update() {} };
const world = new World('town', { map: emptyMap, biome: {}, props: [], torches: [], portals: [], creatures: [] });
world.player = player; world.add(player); G.world = world; G.player = player; G.settings = { ...(G.settings || {}), sfx: 0 };

function loot(x, y, extra = {}) {
  return { x, y, z: 0, vz: 0, vx: 0, vy: 0, kind: 'item', t: 0, updateCalls: 0,
    update() { this.updateCalls++; return true; }, ...extra };
}

try {
  // Persistent drops are retained, but distant settled items no longer wake each frame.
  const near = world.addLoot(loot(1, 1));
  const far = world.addLoot(loot(200, 200));
  world.update(1 / 60);
  assert.equal(near.updateCalls, 1, 'near loot continues its pickup check');
  assert.equal(far.updateCalls, 0, 'settled distant loot is asleep');
  assert.ok(world.loot.includes(far), 'sleeping loot remains collectible');
  assert.deepEqual(world.queryLootRect(-2, -2, 3, 3), [near], 'spatial query returns nearby drops only');

  // Expiring items are retired by the timer queue even while outside the active area.
  const timed = world.addLoot(loot(300, 300, { fades: 0.05 }));
  world.update(0.1);
  assert.ok(timed._lootRemoved, 'offscreen expired loot is removed');
  assert.ok(!world.queryLootRect(296, 296, 304, 304).includes(timed), 'expired loot is removed from spatial lookup');

  const moved = world.addLoot(loot(500, 500, { z: 10, vz: 1, update() { this.x = 40; this.y = 40; this.z = 0; this.vz = 0; this.updateCalls++; return true; } }));
  world.update(1 / 60);
  assert.ok(world.queryLootRect(39, 39, 41, 41).includes(moved), 'moving loot updates its spatial cell');
  assert.ok(!world.queryLootRect(496, 496, 504, 504).includes(moved), 'old spatial cells no longer return moved loot');

  const capWorld = new World('town', { map: emptyMap, biome: {}, props: [], torches: [], portals: [], creatures: [] });
  capWorld.player = { x: 0, y: 0, dead: true, lootTarget: null };
  for (let i = 0; i < 300; i++) capWorld.addLoot(loot(i, 0, { fades: i % 2 ? 8 : 12 }));
  assert.equal(capWorld._lootRegistered, 240, 'fading loot cap remains effective');
  assert.equal(capWorld.loot.filter((item) => !item._lootRemoved).length, 240);
  assert.ok(capWorld.loot.some((item) => item._lootRemoved), 'old fading drops are retired first when the cap is exceeded');
  G.world = capWorld; G.player = capWorld.player;
  capWorld.update(9);
  assert.equal(capWorld._lootRegistered, 150, 'expired fading loot is retired even while offscreen');
  capWorld.update(5);
  assert.equal(capWorld._lootRegistered, 0);
  assert.equal(capWorld.loot.length, 0, 'expired tombstones are compacted out of retained storage');
  assert.equal(capWorld.lootExpiry.length + capWorld.fadingLootOrder.length, 0, 'expired timer queues release their entries');

  // The old cap path scanned every retained entry on every overflow even for persistent loot.
  // Compare that exact work shape with the indexed insertion path on the same seeded positions.
  const sizes = [1000, 5000, 10000];
  const measurements = [];
  for (const count of sizes) {
    const positions = Array.from({ length: count }, (_, i) => [i % 400, Math.floor(i / 400)]);
    const startOld = performance.now(), legacy = [];
    for (const [x, y] of positions) {
      legacy.push({ x, y, kind: 'item' });
      if (legacy.length > 240) {
        let victim = -1;
        legacy.forEach((g, i) => { if (g.fades && (victim < 0 || g.fades < legacy[victim].fades)) victim = i; });
        if (victim >= 0) legacy.splice(victim, 1);
      }
    }
    const oldMs = performance.now() - startOld;
    const current = new World('town', { map: emptyMap, biome: {}, props: [], torches: [], portals: [], creatures: [] });
    const startNew = performance.now();
    for (let i = 0; i < positions.length; i++) current.addLoot(loot(...positions[i]));
    const newMs = performance.now() - startNew;
    assert.equal(current.loot.length, count, 'persistent loot is never discarded to satisfy the fading-drop cap');
    measurements.push({ count, oldMs, newMs });
  }

  const indexed = new World('town', { map: emptyMap, biome: {}, props: [], torches: [], portals: [], creatures: [] });
  const samples = (fn) => {
    const out = [];
    for (let i = 0; i < 60; i++) { const t = performance.now(); fn(); out.push(performance.now() - t); }
    out.sort((a, b) => a - b);
    return { p50: out[29], p95: out[56], p99: out[58], worst: out.at(-1) };
  };
  const phaseTimes = [];
  const phaseCounts = [0, 5000, 10000, 15000, 20000];
  for (let phase = 0; phase < phaseCounts.length; phase++) {
    const count = phaseCounts[phase];
    while (indexed._lootRegistered < count) {
      const i = indexed._lootRegistered;
      indexed.addLoot(loot(50 + (i % 500), 50 + Math.floor(i / 500)));
    }
    const scan = samples(() => { let n = 0; for (const item of indexed.loot) if (!item._lootRemoved && item.x >= -4 && item.x <= 4 && item.y >= -4 && item.y <= 4) n++; return n; });
    const query = samples(() => indexed.queryLootRect(-4, -4, 4, 4, indexed.lootNearBuffer).length);
    assert.equal(indexed.queryLootRect(-4, -4, 4, 4).length, 0, 'large distant collection returns no false nearby drops');
    if (count) assert.ok(query.p50 < scan.p50, 'local loot query is faster than scanning retained drops');
    phaseTimes.push({ count, scan, query });
  }
  const idlePlayer = { x: 0, y: 0, team: 'player', isPlayer: true, dead: false, r: 0.35, update() {} };
  indexed.player = idlePlayer; indexed.add(idlePlayer); G.world = indexed; G.player = idlePlayer;
  indexed.update(1 / 60);
  assert.equal(indexed.loot.reduce((n, item) => n + item.updateCalls, 0), 0, 'a cleared area does not update distant settled drops');

  console.log('Persistent loot insertion (legacy full scan vs indexed implementation):');
  for (const row of measurements) console.log(`  ${row.count.toLocaleString()} drops: ${row.oldMs.toFixed(2)} ms -> ${row.newMs.toFixed(2)} ms (${((row.oldMs - row.newMs) / row.oldMs * 100).toFixed(1)}% faster in this run)`);
  console.log('Dungeon clear simulation: retained loot scanning vs indexed local query (60 samples per stage):');
  for (const phase of phaseTimes) console.log(`  ${String(phase.count).padStart(5)} retained (${Math.round(phase.count / 200)}%): scan p50/p95/p99/max ${phase.scan.p50.toFixed(4)}/${phase.scan.p95.toFixed(4)}/${phase.scan.p99.toFixed(4)}/${phase.scan.worst.toFixed(4)} ms; query ${phase.query.p50.toFixed(4)}/${phase.query.p95.toFixed(4)}/${phase.query.p99.toFixed(4)}/${phase.query.worst.toFixed(4)} ms`);
  console.log('With 20,000 settled drops outside the player radius, world update called 0 loot updates (the former full-list loop called 20,000).');
  console.log('Dungeon retained-loot lifecycle and performance regressions passed. These are Node simulation timings, not graphical frame-time measurements.');
} finally {
  G.world = old.world; G.player = old.player; G.settings = old.settings; clearVfx();
}
