import assert from 'node:assert/strict';
import { findTrapGroundAnchor, isometricTileCorners, pointInTrapTile } from '../../src/game/trapgeometry.mjs';

const width = 5, height = 6, rgba = new Uint8ClampedArray(width * height * 4);
for (const [x, y, alpha] of [[1, 2, 255], [2, 4, 255], [4, 4, 255], [0, 5, 8]]) rgba[(y * width + x) * 4 + 3] = alpha;
assert.deepEqual(findTrapGroundAnchor(rgba, width, height), { x: 3.5, y: 5 }, 'ground pivot follows the lowest visible source pixels instead of transparent frame padding');
assert.deepEqual(findTrapGroundAnchor(new Uint8ClampedArray(16), 2, 2), null, 'fully transparent animation frames use the safe render fallback');

const corners = isometricTileCorners({ x: 7.5, y: 4.5 });
const project = ({ x, y }) => [(x - y) * 32, (x + y) * 16];
assert.deepEqual(corners.map(project), [[96, 176], [128, 192], [96, 208], [64, 192]], 'a warning tile uses the complete 64-by-32 isometric floor diamond');
assert.equal(pointInTrapTile({ x: 8, y: 5 }, { x: 7.5, y: 4.5 }), true, 'collision reaches the visible tile edge');
assert.equal(pointInTrapTile({ x: 8.01, y: 5.01 }, { x: 7.5, y: 4.5 }), false, 'collision excludes points outside the warning footprint');
assert.equal(pointInTrapTile({ x: 8.15, y: 5.15 }, { x: 7.5, y: 4.5 }, 0.22), true, 'the existing creature-radius tolerance remains supported');

console.log('Trap ground-anchor, isometric warning footprint, and damage-area alignment checks passed.');
