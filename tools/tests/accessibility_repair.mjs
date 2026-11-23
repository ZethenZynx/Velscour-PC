// Regression check: a solid collision wall splits the map; generation-time repair makes a player-wide walking route.
import assert from 'node:assert/strict';
import { TileMap } from '../../src/world/map.js';
import { ensureAccessibleTargets } from '../../src/world/accessibility.js';
const map=new TileMap(24,16);map.t.fill(1);for(let y=0;y<16;y++)map.block[y*24+11]=1;
const result=ensureAccessibleTargets(map,[3.5,8.5],[{label:'required exit',at:[19.5,8.5]}]);
assert.equal(result.ok,true,result.reason);assert.equal(result.repaired,1);assert.ok(map.movementCanReach([3.5,8.5],[19.5,8.5],.24));
for(const i of result.repairedCells)assert.equal(map.block[i],0,'repaired path cells remain collision-free');
console.log('PASS synthetic collision barrier repair: the player-sized route is connected and walkable.');
