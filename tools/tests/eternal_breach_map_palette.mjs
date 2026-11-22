import assert from 'node:assert/strict';
import { ETERNAL_BREACH_MAP_COLORS as colors, eternalBreachMapColor } from '../../src/gfx/mapcolors.js';

assert.deepEqual(colors, {
  walkable: '#645476', boundary: '#929BA8', inaccessible: '#141217', pathway: '#847396',
});

const map = {
  t: Uint8Array.from([1, 1, 1, 1, 0, 1, 0]),
  block: Uint8Array.from([0, 0, 1, 0, 0, 0, 0]),
  rounded: Uint8Array.from([0, 1, 0, 1, 0, 0, 0]),
  breach: {
    own: Int16Array.from([0, 0, 0, -1, -1, 1, -1]),
    bridgeOf: Int16Array.from([-1, -1, -1, 0, -1, -1, 0]),
    rock: Uint8Array.from([0, 0, 0, 0, 0, 1, 0]),
  },
  // The Breach uses a void face; the special palette must still resolve its islands and paths.
  voidFace: true,
};
assert.equal(eternalBreachMapColor(map, 0), colors.walkable, 'island floor uses walkable color');
assert.equal(eternalBreachMapColor(map, 1), colors.boundary, 'island rim uses boundary color');
assert.equal(eternalBreachMapColor(map, 2), colors.boundary, 'blocked terrain uses boundary color');
assert.equal(eternalBreachMapColor(map, 3), colors.pathway, 'connecting walkway uses pathway color');
assert.equal(eternalBreachMapColor(map, 4), colors.inaccessible, 'void uses inaccessible color');
assert.equal(eternalBreachMapColor(map, 5), colors.boundary, 'rock obstacles use boundary color');
assert.equal(eternalBreachMapColor(map, 6), colors.inaccessible, 'unassigned tiles remain inaccessible');
assert.equal(eternalBreachMapColor({ t: new Uint8Array(1) }, 0), null, 'non-Breach maps use the normal palette');
console.log('Eternal Breach map palette checks passed for islands, rims, obstacles, pathways, and void.');
