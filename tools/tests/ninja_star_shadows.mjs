import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawStarShadow } from '../../src/gfx/blades3d.js';

class Path {
  commands = [];
  moveTo(...v) { this.commands.push(['move', ...v]); }
  quadraticCurveTo(...v) { this.commands.push(['curve', ...v]); }
  lineTo(...v) { this.commands.push(['line', ...v]); }
}
globalThis.Path2D = Path;
const calls = [], ctx = {
  globalAlpha: 0.8, fillStyle: '', save() { calls.push('save'); }, restore() { calls.push('restore'); },
  translate(...v) { calls.push(['translate', ...v]); }, scale(...v) { calls.push(['scale', ...v]); },
  rotate(v) { calls.push(['rotate', v]); }, fill(path) { calls.push(['fill', path]); },
};
drawStarShadow(ctx, 12, 30, 80, 1.2, 0.4);
assert.equal(ctx.globalAlpha, 0.8, 'shadow drawing restores caller alpha');
assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'fill'), 'shadow draws its cached star-shaped path');
const path = calls.find((c) => Array.isArray(c) && c[0] === 'fill')[1];
assert.equal(path.commands.filter((c) => c[0] === 'line').length, 4, 'the ground shadow has four star points');
const blades = readFileSync(new URL('../../src/game/hazards.js', import.meta.url), 'utf8');
assert.match(blades, /this\.fx === 'shuriken'\) drawStarShadow/, 'flying shuriken projectiles cast shadows');
assert.match(blades, /if \(this\.fx === 'shuriken'\) for \(const \[x, y\] of this\.pos\) drawStarShadow/, 'orbiting shuriken cast shadows');
assert.match(blades, /if \(this\.fx === 'shuriken'\) drawStarShadow\(ctx, isoX\(x, y\), isoY\(x, y\), f\.z/, 'raining shuriken cast height-scaled shadows');
delete globalThis.Path2D;
console.log('PASS: thrown, orbiting, and raining shuriken render a cached four-point ground shadow and restore canvas alpha.');
