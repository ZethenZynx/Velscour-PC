import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const graphics = readFileSync(new URL('src/gfx/spires3d.js', root), 'utf8');
const game = readFileSync(new URL('src/game/game.js', root), 'utf8');
const setup = readFileSync(new URL('src/game/castlespires.js', root), 'utf8');
assert.match(game, /useSpires\(world\)/, 'world transitions run the Broken Spires lifecycle hook');
assert.match(graphics, /export function useSpires\(world\)[\s\S]*?if \(!world\?\.tower\?\.sp\) disposeSpires3D\(\)/, 'leaving the Spires releases its scene');
assert.match(graphics, /let buildToken = 0/);
assert.match(graphics, /const token = \+\+buildToken;[\s\S]*?await loadSpires3D\(sp\.style\);[\s\S]*?if \(token !== buildToken\) return null/, 'late asset loads cannot install a scene after an area change');
assert.match(graphics, /const M = await materials\(st\);[\s\S]*?if \(token !== buildToken\)[\s\S]*?m\.map\?\.dispose\(\)/, 'late material preparation releases its resources');
assert.match(graphics, /function disposeScene\(\)[\s\S]*?S\.scene\.traverse[\s\S]*?o\.geometry\.dispose\(\)[\s\S]*?o\.material\.map\.dispose\(\)[\s\S]*?S = null/);
assert.match(graphics, /export function disposeSpires3D\(\)\s*\{\s*buildToken\+\+;\s*disposeScene\(\);/);
assert.doesNotMatch(graphics, /function disposeScene\(\)[\s\S]*?R = null/, 'the shared renderer remains reusable across floor transitions');
assert.match(setup, /void buildSpires3D\(gen\)\.catch/, 'asset build errors retain the existing safe flat-route fallback');
await import(new URL('src/gfx/spires3d.js', root));
console.log('PASS: Broken Spires releases per-floor GPU resources on area exit and invalidates in-flight builds while retaining shared renderer and source-image caches.');
