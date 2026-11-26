import assert from 'node:assert/strict';
import { findTrapGroundAnchor, isometricTileCorners, pointInTrapTile, trapAnchorFrame, trapAtlasFrameRect } from '../../src/game/trapgeometry.mjs';

const width = 5, height = 6, rgba = new Uint8ClampedArray(width * height * 4);
for (const [x, y, alpha] of [[1, 2, 255], [2, 4, 255], [4, 4, 255], [0, 5, 8]]) rgba[(y * width + x) * 4 + 3] = alpha;
assert.deepEqual(findTrapGroundAnchor(rgba, width, height), { x: 3.5, y: 5 }, 'ground pivot follows the lowest visible source pixels instead of transparent frame padding');
assert.deepEqual(findTrapGroundAnchor(new Uint8ClampedArray(16), 2, 2), null, 'fully transparent animation frames use the safe render fallback');

const noisyBase = new Uint8ClampedArray(9 * 10 * 4);
for (let x = 3; x <= 7; x++) noisyBase[(8 * 9 + x) * 4 + 3] = 255;
noisyBase[(9 * 9 + 1) * 4 + 3] = 255;
assert.deepEqual(findTrapGroundAnchor(noisyBase, 9, 10), { x: 5.5, y: 9 }, 'isolated artwork beneath the substantial ground base cannot pull the anchor off-center');

for (const [sheetW, sheetH, cols, rows] of [[1024, 1536, 4, 6], [1182, 1330, 4, 9], [724, 2172, 4, 12], [1312, 1200, 4, 4]]) {
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const rect = trapAtlasFrameRect(sheetW, sheetH, cols, rows, col, row);
    assert.ok(rect && Number.isInteger(rect.sx) && Number.isInteger(rect.sy) && rect.sw > 0 && rect.sh > 0, 'every trap state has a positive integer crop');
    assert.ok(rect.sx + rect.sw <= sheetW && rect.sy + rect.sh <= sheetH, 'a trap crop never crosses the atlas boundary');
    if (col + 1 < cols) assert.equal(rect.sx + rect.sw, trapAtlasFrameRect(sheetW, sheetH, cols, rows, col + 1, row).sx, 'neighboring animation columns meet without overlap or gaps');
    if (row + 1 < rows) assert.equal(rect.sy + rect.sh, trapAtlasFrameRect(sheetW, sheetH, cols, rows, col, row + 1).sy, 'neighboring trap rows meet without overlap or gaps');
  }
}
assert.equal(trapAtlasFrameRect(1182, 1330, 4, 9, 4, 0), null, 'out-of-range animation frames are rejected');
for (const kind of ['plate', 'crystal', 'vent', 'spikes', 'rune', 'ice']) for (let frame = 0; frame < 4; frame++) {
  assert.equal(trapAnchorFrame(kind, frame), 0, `${kind} animation frame ${frame} keeps the idle ground pivot`);
}
assert.equal(trapAnchorFrame('icicle', 2), 2, 'falling icicles retain their authored falling-frame movement');

const corners = isometricTileCorners({ x: 7.5, y: 4.5 });
const project = ({ x, y }) => [(x - y) * 32, (x + y) * 16];
assert.deepEqual(corners.map(project), [[96, 176], [128, 192], [96, 208], [64, 192]], 'a warning tile uses the complete 64-by-32 isometric floor diamond');
assert.equal(pointInTrapTile({ x: 8, y: 5 }, { x: 7.5, y: 4.5 }), true, 'collision reaches the visible tile edge');
assert.equal(pointInTrapTile({ x: 8.01, y: 5.01 }, { x: 7.5, y: 4.5 }), false, 'collision excludes points outside the warning footprint');
assert.equal(pointInTrapTile({ x: 8.15, y: 5.15 }, { x: 7.5, y: 4.5 }, 0.22), true, 'the existing creature-radius tolerance remains supported');

console.log('Trap ground-anchor, isometric warning footprint, and damage-area alignment checks passed.');
