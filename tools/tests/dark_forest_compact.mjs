// Node-only contract checks for the full-size Dark Forest, on-route landmarks and optional side labyrinths.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const pack = json('assets/tiles/dark_forest/pack.json'), treeMeta = json('assets/tiles/dark_forest/trees.json');
globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('trees.json') ? treeMeta : pack });
globalThis.Image = class { set src(_) { queueMicrotask(() => this.onload?.()); } };
const imp = (p) => import(pathToFileURL(path.join(root, p)));
const { loadDarkForestTrees } = await imp('src/gfx/darkforest.js');
const { BIOME_BY_ID } = await imp('src/data/biomes.js');
const { generateDarkForest, chooseDarkForestMazeRewardSpot, DF_W, DF_H } = await imp('src/world/darkforest.js');
const { createDarkForestRun } = await imp('src/game/darkforest.js');
const { setupWorldObjects } = await imp('src/game/worldobjects.js');
const { G } = await imp('src/state.js');
await loadDarkForestTrees();
const biome = BIOME_BY_ID.dark_forest;
const tileset = { pack: 'dark_forest', floors: pack.floors, walls: pack.walls, scatter: pack.scatter, families: Object.keys(pack.walls).map((name) => [name, 1]) };
const seeds = process.argv[2] == null ? 100 : +process.argv[2];
const routeProfiles = new Set();
for (let n = 1; n <= seeds; n++) {
  const g = generateDarkForest(7, biome, tileset, n * 7717 + 3), m = g.map;
  if (m.w !== DF_W || m.h !== DF_H || DF_W !== 192 || DF_H !== 192) throw Error('incorrect map size');
  if (m.walls.length < 1000 || m.doors.length || g.glades || g.labyrinths?.length !== 4) throw Error('expected four optional walled labyrinths and no trials');
  if (g.spawns.filter((s) => s.rank === 'boss').length !== 1) throw Error('expected exactly one boss');
  const regular = g.spawns.filter((s) => !['boss', 'raid'].includes(s.rank));
  const enemies = regular.reduce((sum, s) => sum + s.n, 0);
  if (regular.length < 80 || regular.length > 110 || enemies < 220 || enemies > 340) throw Error('enemy population is outside the original forest scale at seed ' + (n * 7717 + 3) + ': ' + regular.length + ' packs, ' + enemies + ' enemies');
  if (g.chests.length !== 6) throw Error('expected two route caches and one cache in each of four optional labyrinths');
  if (g.routeRewardSpots?.length < 20) throw Error('expected safe altar/shrine positions along the main path');
  const seen = new Uint8Array(m.w * m.h), idx = (x, y) => Math.floor(y) * m.w + Math.floor(x);
  const q = [idx(...g.start)]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % m.w, y = (i / m.w) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const X=x+dx,Y=y+dy,j=idx(X,Y);
      if(X>=0&&Y>=0&&X<m.w&&Y<m.h&&!seen[j]&&m.walkableTile(X,Y)){seen[j]=1;q.push(j);}
    }
  }
  for (const p of [g.boss,g.exit,...g.chests.map((c)=>[c.x,c.y]),...g.spawns.map((s)=>[s.x,s.y])]) if (!seen[idx(...p)]) throw Error('unreachable spawn or objective at seed '+(n*7717+3)+': '+JSON.stringify({p,spawn:g.spawns.find((s)=>s.x===p[0]&&s.y===p[1]),blocked:m.block[idx(...p)]}));
  if (!(g.start[0] < m.w/4 && g.start[1] > m.h*3/4 && g.boss[0] > m.w*3/4 && g.boss[1] < m.h/4)) throw Error('start and boss are not on opposite corners');
  const expectedLandmarks = ['camp', 'well', 'shrine', 'obelisk', 'swamp', 'webs'];
  if (g.landmarks?.length !== expectedLandmarks.length || expectedLandmarks.some((name) => !g.landmarks.some((landmark) => landmark.what === name)) || g.props.length < 22) throw Error('expected all six decorative landmarks and their props');
  const routeDx = g.boss[0] - g.start[0], routeDy = g.boss[1] - g.start[1], routeLen = Math.hypot(routeDx, routeDy);
  const sideX = -routeDy / routeLen, sideY = routeDx / routeLen;
  const routeT = (point) => ((point[0] - g.start[0]) * routeDx + (point[1] - g.start[1]) * routeDy) / (routeLen * routeLen);
  if (!g.routeBends || g.routeBends[0].offset !== 0 || g.routeBends.at(-1).offset !== 0) throw Error('path needs straight entrance and exit sections');
  const routeOffset = (t) => {
    t = Math.max(0, Math.min(1, t));
    let i = 1;
    while (i < g.routeBends.length - 1 && g.routeBends[i].t < t) i++;
    const a = g.routeBends[i - 1], b = g.routeBends[i], u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const eased = (1 - Math.cos(Math.PI * u)) * 0.5;
    return a.offset + (b.offset - a.offset) * eased;
  };
  const interior = g.routeBends.filter((bend) => bend.t > 0.2 && bend.t < 0.82);
  if (interior.length < 3 || interior.every((bend) => bend.offset === 0) || Math.max(...interior.map((bend) => Math.abs(bend.offset))) > 6.01) throw Error('path needs gentle randomized middle bends');
  routeProfiles.add(interior.map((bend) => `${bend.t.toFixed(2)}:${bend.offset}`).join(','));
  for (let t = 0.01; t < 1; t += 0.01) {
    const centerX = g.start[0] + routeDx * t + sideX * routeOffset(t), centerY = g.start[1] + routeDy * t + sideY * routeOffset(t);
    const connectedTrail = Array.from({ length: 121 }, (_, j) => {
      const angle = j / 120 * Math.PI * 2, x = Math.floor(centerX + Math.cos(angle) * 4), y = Math.floor(centerY + Math.sin(angle) * 4);
      return x >= 0 && y >= 0 && x < m.w && y < m.h && seen[idx(x,y)] && m.walkableTile(x,y);
    }).some(Boolean);
    if (!connectedTrail) throw Error('winding trail is disconnected near t=' + t.toFixed(2) + ' seed ' + (n * 7717 + 3));
  }
  for (const area of g.sideAreas) {
    const reachableSide = Array.from({ length: 81 }, (_, j) => [Math.floor(area.x) + j % 9 - 4, Math.floor(area.y) + ((j / 9) | 0) - 4]).some(([x,y]) => x >= 0 && y >= 0 && x < m.w && y < m.h && seen[idx(x,y)] && m.walkableTile(x,y) && Math.hypot(x + 0.5 - area.x, y + 0.5 - area.y) <= 4);
    if (!reachableSide) throw Error('side clearing is unreachable: ' + area.what);
  }
  const offsets = [];
  let previousT = 0;
  for (const landmark of g.landmarks) {
    const [lx, ly] = landmark.center, t = routeT([lx, ly]);
    const lateral = (lx - g.start[0]) * sideX + (ly - g.start[1]) * sideY;
    if (Math.abs(lateral - routeOffset(t) - landmark.offset) > 3.5) throw Error('landmark should sit directly on or beside the main path: ' + landmark.what);
    if (t - previousT < 0.06) throw Error('landmarks should be staggered along the main path, not clustered in pairs');
    previousT = t; offsets.push(Math.round(lateral * 10) / 10);
    if (g.labyrinths.some((maze) => { const [x0,y0,x1,y1] = maze.rect; return landmark.center[0] >= x0 && landmark.center[0] < x1 && landmark.center[1] >= y0 && landmark.center[1] < y1; })) throw Error('a landmark overlaps a labyrinth');
    const reachableClearing = Array.from({ length: 81 }, (_, j) => [Math.floor(landmark.center[0]) + j % 9 - 4, Math.floor(landmark.center[1]) + ((j / 9) | 0) - 4]).some(([x,y]) => x >= 0 && y >= 0 && x < m.w && y < m.h && seen[idx(x,y)] && m.walkableTile(x,y) && Math.hypot(x + 0.5 - landmark.center[0], y + 0.5 - landmark.center[1]) <= 4);
    if (!reachableClearing) throw Error('landmark clearing is not reachable: ' + landmark.what);
  }
  if (new Set(offsets).size < 5 || Math.max(...offsets) - Math.min(...offsets) < 4) throw Error('landmarks should be offset from each other instead of forming parallel rows');
  const expectedSides = ['north', 'south', 'north', 'south'];
  for (let i = 0; i < g.labyrinths.length; i++) {
    const maze = g.labyrinths[i], [x0, y0, x1, y1] = maze.rect;
    if (maze.side !== expectedSides[i] || x1 - x0 !== 44 || y1 - y0 !== 44) throw Error('four full-sized labyrinths must alternate sides of the path');
    if (maze.side === 'north' ? x1 + y1 >= 192 : x0 + y0 <= 192) throw Error('side labyrinth crossed the main path');
    if (i) {
      const prev = g.labyrinths[i - 1], [px0, py0, px1, py1] = prev.rect;
      const gapX = Math.max(0, x0 - px1, px0 - x1), gapY = Math.max(0, y0 - py1, py0 - y1);
      if (Math.hypot(gapX, gapY) < 20 || Math.hypot(maze.gate[0] - prev.gate[0], maze.gate[1] - prev.gate[1]) < 25) throw Error('adjacent labyrinths need a clear gap along the route');
    }
    const chest = g.chests.find((c) => c.mazeId === maze.id);
    if (!chest) throw Error('each optional labyrinth must contain exactly one reward chest');
    if (g.chests.filter((c) => c.mazeId === maze.id).length !== 1) throw Error('a maze must not receive duplicate reward chests');
    const [mx0,my0,mx1,my1]=maze.rect,size=mx1-mx0,distances=new Int16Array(size*size);distances.fill(-1);
    const entranceX=Math.floor(maze.entrance[0]),entranceY=Math.floor(maze.entrance[1]),startLocal=(entranceY-my0)*size+entranceX-mx0,queue=[startLocal];distances[startLocal]=0;
    for(let head=0;head<queue.length;head++){const local=queue[head],x=mx0+local%size,y=my0+((local/size)|0),d=distances[local]+1;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy,lx=X-mx0,ly=Y-my0;if(lx<1||ly<1||lx>=size-1||ly>=size-1||!m.walkableTile(X,Y))continue;const ni=ly*size+lx;if(distances[ni]>=0)continue;distances[ni]=d;queue.push(ni);}}
    const chestLocal=(Math.floor(chest.y)-my0)*size+Math.floor(chest.x)-mx0,chestDepth=distances[chestLocal];
    if(chestDepth<maze.backPathDistance-4)throw Error('maze chest is not among the deepest reachable cells at the far end');
    if(maze.side==='north'?chest.y>=my0+size*.38:chest.y<=my0+size*.62)throw Error('maze chest is not toward the back end opposite the entrance');
    for(const side of ['left','right']){
      const candidates=maze.rewardCorners?.[side];if(!candidates?.length)throw Error('maze is missing an accessible back-corner altar/shrine position');
      if(candidates.some((p)=>!m.walkable(p.x,p.y)||!seen[idx(p.x,p.y)]))throw Error('altar/shrine corner candidate is blocked or unreachable');
    }
  }
  if (g.trees.length < 14000 || g.trees.length > 15500) throw Error('tree population drifted from the full-size forest');
  if (g.trees.some((t)=>m.walkable(t.x,t.y))) throw Error('blocking tree has no collision');
}
if (seeds > 1 && routeProfiles.size < Math.ceil(seeds * 0.75)) throw Error('path bends should vary across random seeds');
let randomState=0x51a7e123,relocated=0;const relocatedMazes=new Set(),relocatedCorners=new Set();const seededRandom=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/0x100000000;};
const distributionGen=generateDarkForest(7,biome,tileset,0xdecafbad);
for(let i=0;i<10000;i++){
  const spot=chooseDarkForestMazeRewardSpot(distributionGen.labyrinths,distributionGen.chests,seededRandom);
  if(!spot)continue;relocated++;
  const maze=distributionGen.labyrinths.find((entry)=>entry.id===spot.mazeId),chest=distributionGen.chests.find((entry)=>entry.mazeId===maze.id);
  if(!maze||!maze.rewardCorners[spot.side].some((p)=>p.x===spot.x&&p.y===spot.y))throw Error('relocated shrine/altar did not use a generated back corner');
  if(Math.hypot(chest.x-spot.x,chest.y-spot.y)<8)throw Error('relocated shrine/altar overlaps its maze chest');
  relocatedMazes.add(spot.mazeId);relocatedCorners.add(spot.side);
}
if(relocated<3600||relocated>4400)throw Error(`altar/shrine relocation rate should be approximately 40%, got ${relocated/100}%`);
if(relocatedMazes.size!==4||relocatedCorners.size!==2)throw Error('maze selection or left/right corner randomization did not cover all options');
const buildObjectWorld=(seed)=>{
  G.char.worldObjectClaims={};
  const gen=generateDarkForest(7,biome,tileset,seed),world={kind:'dungeon',depth:7,biome,map:gen.map,tileset,chests:gen.chests.map((ch)=>({...ch})),portals:[{x:gen.start[0],y:gen.start[1]},{x:gen.exit[0],y:gen.exit[1]}],rooms:[]};
  return{gen,world};
};
const previousChar=G.char;G.char={worldObjectClaims:{}};
{
  const{gen,world}=buildObjectWorld(0xb451a7),realRandom=Math.random,values=[0,.1,0,.1,.1,.1,.1,.1];Math.random=()=>values.length?values.shift():.1;
  try{
    if(setupWorldObjects(world,gen.start,{special:true,gen})!==1)throw Error('relocated Forest shrine was not created');
    const obj=world.chests.find((entry)=>entry.isCustomShrineAltar);
    if(!obj||!gen.labyrinths.some((maze)=>obj.x>=maze.rect[0]&&obj.x<maze.rect[2]&&obj.y>=maze.rect[1]&&obj.y<maze.rect[3]))throw Error('selected Forest shrine did not relocate into a maze');
    const maze=gen.labyrinths.find((entry)=>['left','right'].some((side)=>entry.rewardCorners[side].some((point)=>point.x===obj.x&&point.y===obj.y)));
    if(!maze)throw Error('Forest shrine did not use a generated back corner');
    if(world.chests.filter((entry)=>entry.isCustomShrineAltar).length!==1)throw Error('relocation duplicated the existing Forest shrine');
  }finally{Math.random=realRandom;}
}
{
  const{gen,world}=buildObjectWorld(0xb451a8),realRandom=Math.random,values=[0,.99];Math.random=()=>values.length?values.shift():0;
  try{
    if(setupWorldObjects(world,gen.start,{special:true,gen})!==1)throw Error('main-route Forest shrine was not retained');
    const obj=world.chests.find((entry)=>entry.isCustomShrineAltar);
    if(!obj||gen.labyrinths.some((maze)=>obj.x>=maze.rect[0]-2.5&&obj.x<maze.rect[2]+2.5&&obj.y>=maze.rect[1]-2.5&&obj.y<maze.rect[3]+2.5))throw Error('unrelocated Forest shrine did not remain along the main path');
    if(!world.map.walkable(obj.x,obj.y)||!world.map.findPath(gen.start[0],gen.start[1],obj.x,obj.y,12000))throw Error('main-route Forest shrine is not accessible');
  }finally{Math.random=realRandom;}
}
G.char=previousChar;
const guardian = { rank:'boss', dead:false, x:179.5, y:12.5 }, world = { boss:guardian };
let opened = false;
const run = createDarkForestRun(world, {}, biome, () => { opened = true; });
guardian.dead = true;
run.bossDefeated(guardian);
if (!run.completed || run.active || !opened) throw Error('guardian defeat did not complete the Forest run');
console.log(`PASS full-size Dark Forest: ${seeds} maze seeds; maze chests use deep walkable path-distance placements; altar/shrine corners are separated; relocation rate ${relocated/100}% across 10,000 rolls; guardian exit callback verified`);
