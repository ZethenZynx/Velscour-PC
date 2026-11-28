import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { drawTowerMinimap } from '../../src/game/tower.js';

const calls = { save: 0, restore: 0, arc: 0, text: 0, stroke: 0, fill: 0 };
const ctx = {
  save() { calls.save++; }, restore() { calls.restore++; }, beginPath() {},
  arc() { calls.arc++; }, stroke() { calls.stroke++; }, fill() { calls.fill++; },
  fillText() { calls.text++; },
};
const player = { x: 20, y: 7 };
const world = {
  player,
  creatures: [{ x: 24, y: 8, dead: false, team: 'enemy', rank: 'normal' }],
  portals: [{ x: 1, y: 1, active: true, color: '#40a0ff' }],
};
const g = {
  rWall: 42, rIn: 31, r: (y) => 34 + y * 0.1, s: (x) => x * 1.1,
  sEnd: 240, C: 24, w: 5, rc: 36, v: { turns: 10 }, XR: 0,
  AX: 10, AY: 10, door: [6, 8],
};
const tw = { g, roof: false };

// Exercise the exact renderer reached from drawMinimap in HUD and TAB-map modes.
for (let frame = 0; frame < 500; frame++) {
  player.x = 20 + (frame % 180);
  player.y = 4 + (frame % 12);
  world.creatures[0].x = player.x + ((frame % 9) - 4);
  drawTowerMinimap(world, tw, ctx, 240, 180, frame % 2 === 0, frame % 2 ? 0.55 : 1);
}
assert.equal(calls.text, 500, 'stair minimap emits its turn label each render');
assert.ok(calls.arc >= 1500 && calls.stroke >= 1000 && calls.fill > 0, 'stair progress, creatures, door and player are rendered');

// The rooftop view is a distinct path with portals and creatures; test repeated updates too.
tw.roof = true;
for (let frame = 0; frame < 100; frame++) drawTowerMinimap(world, tw, ctx, 240, 180, frame % 2 === 0, 1);
assert.equal(calls.save, calls.restore, 'tower minimap always balances canvas save/restore state');

const [towerSource, spiresSource, rendererSource, hudSource, gameSource, mainSource] = await Promise.all([
  readFile(new URL('../../src/game/tower.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/castlespires.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
]);
assert.match(towerSource, /minimap: \(c, W, H, big, opacity\) => drawTowerMinimap\(world, tw, c, W, H, big, opacity\)/,
  'Serpentine Tower supplies its captured world and tower state to the minimap');
assert.match(rendererSource, /if \(world\.tower\) \{[\s\S]*?world\.tower\.minimap\(c, W, H, big, opacity\); return;/,
  'the renderer dispatches both compact and full-screen maps through the tower renderer');
assert.match(hudSource, /drawMinimap\(w, dt, \$\('#minimap'\)\)/, 'normal HUD updates use the shared minimap path');
assert.match(gameSource, /HUD\.update\(dt\)/, 'game updates continue to refresh the HUD');
assert.match(mainSource, /try \{ game\.update\(dt\); \} catch \(err\) \{ reportError\(err\); \}/,
  'the animation loop uses the same game update path');
assert.match(mainSource, /game\.update\(dt\);[\s\S]*?updates\+\+;/,
  'worker catch-up updates use the same game update path');
assert.match(spiresSource, /minimap\(c, W, H\)[\s\S]*?for \(let s = 0; s <= rb\.S; s \+= 2\)[\s\S]*?rb\.pos\(rb\.sOf\(p\.x\), rb\.uOf\(p\.y\), q\)/,
  'Broken Spires uses locally scoped route coordinates and its own valid run state');

console.log('Tower minimap regression passed: 500 stair frames, 100 roof frames, balanced canvas state, TAB/HUD and main/worker update wiring, plus Broken Spires scope audit.');
