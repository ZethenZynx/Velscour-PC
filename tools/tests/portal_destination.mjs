import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FINAL_DEPTH } from '../../src/data/depth.js';
import { resolveDepthDestination } from '../../src/data/breach.js';

// Depth 99 is the reported regression: its next transition can be a Breach
// interlude even though the ordinary campaign environment would be the Throne.
assert.deepEqual(resolveDepthDestination(100, 0, 'castle_keep'), {
  kind: 'breach', id: 'eternal_breach', name: 'The Eternal Breach', floor: 1,
});
assert.equal(resolveDepthDestination(100, 9, 'castle_keep').floor, 10);
assert.deepEqual(resolveDepthDestination(100, 10, 'castle_keep'), {
  kind: 'biome', id: 'throne', name: "Velscour's Throne",
});

// Each campaign boss milestone resolves to the exact next Breach floor, then
// resolves to its supplied/scheduled biome after that milestone is cleared.
for (let milestone = 10; milestone <= 100; milestone += 10) {
  const floor = milestone / 10;
  const route = resolveDepthDestination(milestone, floor - 1, 'dark_forest');
  assert.equal(route.kind, 'breach', `depth ${milestone} must route through the Breach`);
  assert.equal(route.floor, floor, `depth ${milestone} chooses the next unbeaten Breach floor`);
  const after = resolveDepthDestination(milestone, floor, milestone === FINAL_DEPTH ? 'dark_forest' : 'dark_forest');
  assert.equal(after.kind, 'biome');
  assert.equal(after.id, milestone === FINAL_DEPTH ? 'throne' : 'dark_forest');
}

// Infinite endgame transitions use the same interlude decision and otherwise
// retain the selected randomized environment. Repeated resolution is stable.
assert.equal(resolveDepthDestination(110, 10, 'frozen').floor, 11);
assert.deepEqual(resolveDepthDestination(111, 11, 'frozen'), { kind: 'biome', id: 'frozen' });
assert.deepEqual(resolveDepthDestination(501, 50, 'catacombs'), { kind: 'biome', id: 'catacombs' });

const source = readFileSync(new URL('../../src/game/game.js', import.meta.url), 'utf8');
const portalChoice = source.slice(source.indexOf('  portalChoice(world)'), source.indexOf('  awardFloorClear(depth)'));
const enterDungeon = source.slice(source.indexOf('  enterDungeon()'), source.indexOf('  buildDungeon('));
assert.match(portalChoice, /resolveDepthDestination\(next, c\?\.breach\?\.best, c\?\.nextBiome\)/);
assert.match(portalChoice, /destinationKey/);
assert.match(portalChoice, /destination\.kind === 'breach' \|\| destination\.id === 'throne' \? \[destination\.id\]/);
assert.match(portalChoice, /destination\.name.*destination\.floor/);
assert.match(enterDungeon, /resolveDepthDestination\(depth, c\.breach\?\.best, c\.nextBiome\)/);
assert.match(enterDungeon, /this\.enterBreach\(destination\.floor\)/);
assert.match(enterDungeon, /BIOME_BY_ID\[destination\.id\]/);
console.log('Passed portal destination checks for depth 99, campaign milestones, endgame routes, and shared popup/entry resolution.');
