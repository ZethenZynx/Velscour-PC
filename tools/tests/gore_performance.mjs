import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addGoreDecal, goreDecalAlpha, goreDecalOutsideView, GORE_DECAL_FADE_START, GORE_DECAL_LIFETIME, MAX_GORE_DECALS, updateGoreDecals } from '../../src/gfx/goredecals.mjs';

const pool = [];
for (let i = 0; i < MAX_GORE_DECALS; i++) addGoreDecal(pool, { id: i, life: 10, grow: 1, alpha: 1 });
addGoreDecal(pool, { id: MAX_GORE_DECALS, life: 10, grow: 1, alpha: 1 });
assert.equal(pool.length, 150, 'gore collection stays within the cap');
assert.equal(pool[0].id, 1, 'the oldest gore is removed first at capacity');

const fade = { alpha: 0.8, life: GORE_DECAL_LIFETIME - GORE_DECAL_FADE_START };
assert.equal(goreDecalAlpha(fade), 0.8, 'gore remains fully opaque through eight seconds');
fade.life -= 1;
assert.equal(goreDecalAlpha(fade), 0.4, 'gore fades linearly during its final two seconds');
fade.life = 0.01;
assert.ok(goreDecalAlpha(fade) < 0.01, 'gore is nearly transparent just before expiry');

const view = { x0: 0, y0: 0, x1: 100, y1: 100 };
const decal = { size: 4 };
assert.equal(goreDecalOutsideView(decal, -3, 50, view, 5), false, 'a partially visible splatter remains until it leaves');
assert.equal(goreDecalOutsideView(decal, -6, 50, view, 5), true, 'a splatter is removable once fully outside the viewport');
const expiring = [{ life: 0.1, grow: 1 }, { life: 3, grow: 0 }];
assert.equal(updateGoreDecals(expiring, 0.1), 1, 'expired gore is compacted out');
assert.equal(expiring.length, 1);
assert.equal(expiring[0].grow, 0.12, 'only growing blood pools need a size update');

const vfx = await readFile(new URL('../../src/gfx/vfx.js', import.meta.url), 'utf8');
const render = await readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
const combat = await readFile(new URL('../../src/game/combat.js', import.meta.url), 'utf8');
assert.match(vfx, /if \(gore\) \{ addGoreDecal\(goreDecals, d\); return; \}/, 'gore bypasses permanently baked floor chunks');
assert.match(vfx, /updateGoreDecals\(goreDecals, dt\)/, 'gore ages in its dedicated collection');
assert.match(vfx, /goreDecalOutsideView\(d, px, py, goreVr, s\)/, 'off-screen gore is removed during rendering');
assert.match(render, /camera\.viewRect\(0\)/, 'gore culling uses the actual viewport boundary');
assert.match(combat, /'pool', 0\.92, \{ gore: true \}/, 'cosmetic enemy-death pools use temporary gore cleanup');

function timing(fn, rounds = 15) {
  const samples = [];
  for (let warm = 0; warm < 3; warm++) fn();
  for (let i = 0; i < rounds; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  return { p50: +samples[Math.floor(rounds * 0.5)].toFixed(3), p95: +samples[Math.floor(rounds * 0.95)].toFixed(3) };
}
const oldWorstCase = Array.from({ length: 8000 }, (_, i) => ({ x: i % 1000, y: i % 500, size: 1 }));
const cappedGore = oldWorstCase.slice(0, MAX_GORE_DECALS);
const scan = (list) => { let visible = 0; for (const d of list) if (d.x >= 250 && d.x <= 750 && d.y >= 100 && d.y <= 400) visible += d.size; return visible; };
const scanBatch = (list) => { for (let i = 0; i < 300; i++) scan(list); };
const benchmark = { previous8000CandidateScan: timing(() => scanBatch(oldWorstCase)), capped150CandidateScan: timing(() => scanBatch(cappedGore)) };
console.log(JSON.stringify({ syntheticCandidateScanMsPer300Passes: benchmark }, null, 2));
console.log(`Gore lifetime, fading, culling, oldest-first cap (${MAX_GORE_DECALS}), and render integration checks passed. Candidate timing is a Node microbenchmark, not a full-game frame measurement.`);
