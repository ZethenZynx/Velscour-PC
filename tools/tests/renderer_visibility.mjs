import assert from 'node:assert/strict';
import { canCullCreaturesByViewport, viewportCandidatesContainPlayer } from '../../src/game/renderpolicy.mjs';
import { isCurrentWorldForArtRelease } from '../../src/game/levelart.mjs';
import { World } from '../../src/game/world.js';

const plain = { map: { w: 40, h: 40 }, creaturesInBounds() {} };
assert.equal(canCullCreaturesByViewport(plain), true, 'ordinary flat dungeons retain spatial culling');
for (const map of [
  { hgt: new Uint8Array(1) }, { smoothField: true }, { c3struct: new Uint8Array(1) },
  { tallOcclusion: true }, { castleMat: new Uint8Array(1) }, { sea: true }, { sky: true },
]) assert.equal(canCullCreaturesByViewport({ map, creaturesInBounds() {} }), false, 'special projection uses conservative full actor list');
for (const worldFlag of ['cave', 'tower', 'sky', 'seaRun', 'warped']) {
  assert.equal(canCullCreaturesByViewport({ map: {}, creaturesInBounds() {}, [worldFlag]: {} }), false, `${worldFlag} uses conservative actor visibility`);
}

const hero = {};
assert.equal(viewportCandidatesContainPlayer({ player: hero }, [hero]), true);
assert.equal(viewportCandidatesContainPlayer({ player: hero }, []), false, 'stale grid is detected before it can cull the player');
assert.equal(viewportCandidatesContainPlayer({}, []), true, 'worlds without a player still use ordinary candidate handling');
const current = {}, stale = {};
assert.equal(isCurrentWorldForArtRelease(stale, current), false, 'stale transitions cannot release shared assets');
assert.equal(isCurrentWorldForArtRelease(current, current), true, 'active world cleanup is permitted');

const map = {
  w: 20, h: 20,
  nudge: (x, y) => [x, y],
};
const world = new World('dungeon', { map });
world.player = hero;
Object.assign(hero, { x: 8.5, y: 9.5, r: 0.3, dead: false });
world.add(hero);
world.rebuildGrid();
const got = world.creaturesInBounds(7, 8, 10, 11, []);
assert.ok(got.includes(hero), 'the current grid returns a nearby player candidate');
console.log('Renderer visibility policy checks passed for flat, elevated, 3D and transition states.');
