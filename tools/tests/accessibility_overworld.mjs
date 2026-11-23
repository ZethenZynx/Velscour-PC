// Generation-only reachability soak for Forsaken Wilds and all Castle variants.
import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const root=process.cwd(), read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')), imp=p=>import(pathToFileURL(path.join(root,p)));
const pack=read('assets/tiles/castle/pack.json'), trees=read('assets/tiles/dark_forest/trees.json'), ramparts=read('assets/tiles/castle/ramparts.json');
globalThis.fetch=async url=>({ok:true,json:async()=>String(url).includes('dark_forest')?trees:String(url).includes('ramparts')?ramparts:pack});
globalThis.Image=class{set src(_){queueMicrotask(()=>this.onload?.());}};
const context=new Proxy({getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])})},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>context})};
const [{loadCastlePack},{loadDarkForestTrees},{A},{BIOME_BY_ID},{generateOverworld},{CASTLE_VARIANTS},{nearestReachableStand}]=await Promise.all([
 imp('src/gfx/castle.js'),imp('src/gfx/darkforest.js'),imp('src/core/assets.js'),imp('src/data/biomes.js'),imp('src/world/overworld.js'),imp('src/data/castles.js'),imp('src/world/accessibility.js')]);
await loadCastlePack(); await loadDarkForestTrees(); A.town={meta:read('assets/tiles/town/town.json'),objects:{},ground:{}};
let wild=0, castles=0, fixed=0; const begin=Date.now();
for(let seed=1;seed<=60;seed++){const g=generateOverworld(12,BIOME_BY_ID.overworld,seed*7919),m=g.map,reach=m.movementReachable(g.start,.24);assert.ok(g.accessibility?.validated,`wild/${seed} uncertified`);assert.ok(m.movementCanReach(g.start,g.exit,.24,reach),`wild/${seed} exit`);for(const p of [...g.sites,g.shrine])assert.ok(m.movementCanReach(g.start,p,.24,reach)||nearestReachableStand(m,reach,p,1.4,.24),`wild/${seed} objective`);wild++;fixed+=g.accessibility.repairs||0;}
for(const v of CASTLE_VARIANTS)for(let seed=1;seed<=1;seed++){const g=generateOverworld(19,BIOME_BY_ID.castle,seed*1777+v.id.length*131+31,v.id),m=g.map;assert.ok(g.accessibility?.validated,`${v.id}/${seed} uncertified`);const closed=m.block.slice();for(const i of m.castleGateTiles||[])closed[i]=1;const before=m.movementReachable(g.start,.24,closed);for(const o of g.castleObjectives||[])assert.ok(m.movementCanReach(g.start,[o.x,o.y],.24,before)||nearestReachableStand(m,before,[o.x,o.y],1.4,.24),`${v.id}/${seed} side objective ${o.key}`);const open=m.block.slice();for(const i of m.castleGateTiles||[])open[i]=0;assert.ok(m.movementCanReach(g.start,g.boss,.24,m.movementReachable(g.start,.24,open)),`${v.id}/${seed} boss`);castles++;}
console.log(`PASS overworld access: ${wild} Forsaken Wilds + ${castles} Castle layouts (${CASTLE_VARIANTS.length} variants); Forsaken terrain repairs=${fixed}; ${Date.now()-begin}ms.`);
