import assert from 'node:assert/strict';
import { generateDunes } from '../../src/world/dunes.js'; import { BIOME_BY_ID } from '../../src/data/biomes.js';
const count=30,start=Date.now();let repairs=0;
for(let seed=1;seed<=count;seed++){
 const gen=generateDunes(seed%100+1,BIOME_BY_ID.sea_of_sand,seed*7919,seed%5),m=gen.map;
 assert.ok(gen.accessibility?.validated,`seed ${seed}: not certified`);
 const inner=m.movementReachable(gen.dunes.arrive,.24);assert.ok(m.movementCanReach(gen.dunes.arrive,gen.exit,.24,inner),`seed ${seed}: tomb exit`);
 if(!gen.dunes.pyramidOnly){const outer=m.movementReachable(gen.dunes.start,.24);assert.ok(m.movementCanReach(gen.dunes.start,gen.dunes.pyramid.doorStep,.24,outer),`seed ${seed}: pyramid threshold`);for(const c of gen.dunes.camps)assert.ok(m.movementCanReach(gen.dunes.start,[c.x,c.y],.24,outer),`seed ${seed}: waystone camp`);}
 repairs+=gen.accessibility.repairs||0;
}
for(let seed=1;seed<=count;seed++){
 const gen=generateDunes(seed%100+1,BIOME_BY_ID.scorpion_king_pyramid,seed*104729,seed%5),m=gen.map;
 assert.ok(gen.accessibility?.validated&&gen.dunes.pyramidOnly,`pyramid/${seed}: not certified`);
 const reach=m.movementReachable(gen.start,.24);assert.ok(m.movementCanReach(gen.start,gen.exit,.24,reach),`pyramid/${seed}: exit`);
}
console.log(`PASS dunes walking transitions: ${count} Sea of Sand + ${count} standalone Pyramid layouts across all 5 variants; repairs=${repairs}; ${Date.now()-start}ms.`);
