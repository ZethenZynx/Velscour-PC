import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addGoreDecal, goreDecalAge, goreDecalAlpha, goreDecalAlphaAt, goreDecalAlphaForAge, goreDecalExpiredAt, goreDecalGrowAt, goreDecalGrowForAge, goreDecalOutsideView, GORE_DECAL_FADE_START, GORE_DECAL_LIFETIME, GORE_PRESETS, goreLimit, goreMultiplier, trimGoreDecals, updateGoreDecals } from '../../src/gfx/goresettings.mjs';

assert.deepEqual(GORE_PRESETS.map((preset) => preset.name), ['Off', 'Minimal', 'Light', 'Bloody', 'Very Bloody', 'Extreme', 'Carnage', 'Massacre', 'Annihilation', 'Unlimited']);
assert.deepEqual(GORE_PRESETS.map((preset) => Number.isFinite(preset.limit) ? preset.limit : 'unlimited'), [0, 25, 75, 150, 250, 400, 700, 1200, 8000, 'unlimited']);
assert.equal(goreMultiplier('spray', 3), 1, 'Bloody retains the previous normal spray output');
assert.equal(goreMultiplier('spray', 5), 1.6, 'Extreme retains the previous 1.6x spray output');
assert.equal(goreMultiplier('gibs', 5), 1.5, 'Extreme retains the previous 1.5x gib output');
assert.equal(goreLimit({ gore: 5 }), 400, 'Extreme retains its established splatter limit');
assert.equal(goreLimit({ gore: 8, goreCustomEnabled: true, goreCustomLimit: 321 }), 321, 'custom limits override the selected preset cap');
assert.equal(goreLimit({ gore: 0, goreCustomEnabled: true, goreCustomLimit: 321 }), 0, 'Off remains off even if a custom limit is enabled');

const pool = [];
for (let i = 0; i < 5; i++) addGoreDecal(pool, { id: i, life: 10, grow: 1, alpha: 1 }, 3);
assert.deepEqual(pool.map((d) => d.id), [2, 3, 4], 'oldest entries are removed first at the selected cap');
assert.equal(trimGoreDecals(pool, 2), 1, 'lowering a limit immediately removes the excess oldest decal');
assert.deepEqual(pool.map((d) => d.id), [3, 4]);
assert.equal(trimGoreDecals(pool, Infinity), 0, 'Unlimited retains the complete active collection');
assert.equal(addGoreDecal(pool, { id: 5 }, 0), false, 'Off does not accumulate cosmetic gore');

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

const clocked = { alpha: 0.8, bornAt: 12, grow: 0, kind: 'pool' };
assert.equal(goreDecalExpiredAt(clocked, 19.99), false, 'clock-based gore remains through its tenth second');
assert.equal(goreDecalExpiredAt(clocked, 22), true, 'clock-based gore expires after ten seconds');
assert.equal(goreDecalAlphaAt(clocked, 20), 0.8, 'clock-based gore begins fading at eight seconds');
assert.equal(goreDecalAlphaAt(clocked, 21), 0.4, 'clock-based gore fades over its final two seconds');
assert.equal(goreDecalGrowAt(clocked, 12.5), 0.6, 'pool growth is derived from age without a per-frame mutation pass');
assert.equal(goreDecalAlphaForAge(clocked, 9), 0.4);
assert.equal(goreDecalGrowForAge(clocked, 0.5), 0.6);

const vfx = await readFile(new URL('../../src/gfx/vfx.js', import.meta.url), 'utf8');
const render = await readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
const combat = await readFile(new URL('../../src/game/combat.js', import.meta.url), 'utf8');
const screens = await readFile(new URL('../../src/ui/screens.js', import.meta.url), 'utf8');
assert.match(vfx, /addGoreDecal\(goreDecals, d, goreLimit\(G\.settings\)\)/, 'the active preference controls the cap and gore bypasses baked chunks');
assert.doesNotMatch(vfx, /updateGoreDecals\(goreDecals, dt\)/, 'stationary gore is not scanned in a separate update pass');
assert.match(vfx, /goreDecalAge\(d, goreClock\)/, 'expiry is checked during the existing render traversal');
assert.match(vfx, /bornAt: goreClock/, 'gore records its spawn time for allocation-free age calculations');
assert.match(vfx, /export function applyGoreSettings\(\) \{ trimGoreDecals\(goreDecals, goreLimit\(G\.settings\)\); \}/, 'lowering the selected cap trims old gore immediately');
assert.match(vfx, /goreDecalOutsideView\(d, px, py, goreVr, s\)/, 'off-screen gore is removed during rendering');
assert.match(render, /camera\.viewRect\(0\)/, 'gore culling uses the actual viewport boundary');
assert.match(combat, /'pool', 0\.92, \{ gore: true \}/, 'cosmetic enemy-death pools use temporary gore cleanup');
assert.match(screens, /data-gore-preset/, 'the settings UI exposes the ten presets');
assert.match(screens, /data-gore-limit/, 'the settings UI exposes a custom numeric limit');
assert.match(screens, /Performance warning:/, 'high and unlimited limits display a performance warning');

// Same synthetic, visible gore workload; the old path visits each decal once
// to mutate age/growth and again to render/cull it. The new path does one pass.
const goreCount = 8000, frames = 120, dt = 1 / 60, viewAll = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const seedPool = () => Array.from({ length: goreCount }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100), size: 1, rot: (i % 8) * 0.2, bornAt: 0, life: GORE_DECAL_LIFETIME, grow: i % 17 ? 1 : 0, alpha: 0.7 }));
function benchmarkCombinedPasses(singlePass) {
  const pool = seedPool(); let clock = 0, checksum = 0;
  const start = performance.now();
  for (let frame = 0; frame < frames; frame++) {
    clock += dt;
    if (!singlePass) updateGoreDecals(pool, dt);
    let write = 0;
    for (const d of pool) {
      const age = singlePass ? goreDecalAge(d, clock) : GORE_DECAL_LIFETIME - d.life;
      if (age >= GORE_DECAL_LIFETIME) continue;
      if (goreDecalOutsideView(d, d.x, d.y, viewAll, d.size)) continue;
      checksum += singlePass ? goreDecalAlphaForAge(d, age) + goreDecalGrowForAge(d, age) : goreDecalAlpha(d) + d.grow;
      pool[write++] = d;
    }
    pool.length = write;
  }
  return { ms: performance.now() - start, checksum };
}
const legacyBench = benchmarkCombinedPasses(false), currentBench = benchmarkCombinedPasses(true);
assert.ok(Math.abs(legacyBench.checksum - currentBench.checksum) < 10, 'single-pass lifetime/fade/growth preserve the visible synthetic results');
console.log(`8,000 visible-gore fixture over ${frames} frames: legacy update+draw ${legacyBench.ms.toFixed(2)} ms; single render traversal ${currentBench.ms.toFixed(2)} ms (${((1 - currentBench.ms / legacyBench.ms) * 100).toFixed(1)}% change in this Node run; one object pass removed).`);

console.log(`Gore preset limits, custom caps, lifetime, fading, culling, and render integration checks passed. Historical Annihilation limit: ${GORE_PRESETS[8].limit}.`);
