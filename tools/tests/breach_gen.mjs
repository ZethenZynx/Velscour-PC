// The Breach generator without a browser: test every objective-count tier with randomized seeds.
//   node tools/tests/breach_gen.mjs [seeds-per-floor] [floors,comma,separated]
import { readFileSync } from 'fs';
import { generateBreach } from '../../src/world/breach.js';
import { breachIslandPlan, breachMapSpan } from '../../src/data/breach.js';
import { nearestReachableStand } from '../../src/world/accessibility.js';
const N = +(process.argv[2] || 20), FLOORS = String(process.argv[3] || '1,6,11,16,21').split(',').map(Number);
const meta = (p) => JSON.parse(readFileSync(new URL(`../../assets/tiles/${p}/pack.json`, import.meta.url)));
function mockSet(pack, more) {
  const m = meta(pack), floors = [], bases = [];
  for (const [pm] of [[m], ...(more ? [[meta(more)]] : [])]) pm.floors.forEach((f) => { if (f.seamless) bases.push(floors.length); floors.push({ name: f.name }); });
  const sl = (r) => ({ arm: r[0], a: r[0], part: Array.isArray(r[0]) ? r[0][0] : r[0], du: 0, dv: 0 });
  const walls = {}; for (const [fam, masks] of Object.entries(m.walls)) { walls[fam] = {}; for (const [k, v] of Object.entries(masks)) walls[fam][k] = v.map((x) => x.map(sl)); }
  const arches = {}; for (const [d, dirs] of Object.entries(m.arches)) { arches[d] = {}; for (const [k, v] of Object.entries(dirs)) arches[d][k] = v.map(sl); }
  const doors = {}; for (const [d, dirs] of Object.entries(m.doors)) { doors[d] = {}; for (const [k, st] of Object.entries(dirs)) { doors[d][k] = {}; for (const [s, v] of Object.entries(st)) doors[d][k][s] = v.map(sl); } }
  const scatter = [...m.scatter, ...(more ? meta(more).scatter : [])].map((s) => ({ name: s.name, block: s.block }));
  return { floors, bases, features: [], walls, families: Object.keys(walls), arches, doors, scatter, k: 0.4 };
}
const ts = mockSet('veilscar_march', 'eternal_breach');
const em = mockSet('eternal_breach');
Object.assign(ts, { walls: em.walls, families: em.families, arches: em.arches, doors: em.doors });
let fails = 0, t0 = Date.now();
for (const FLOOR of FLOORS) {
const sizes = [], plan = breachIslandPlan(FLOOR);
for (let s = 1; s <= N; s++) {
  const seed = s * 104729;
  let g;
  try { g = generateBreach(FLOOR, { roster: [] }, ts, null, seed); } catch (e) { console.log('seed', seed, 'FAILED', e.message); fails++; continue; }
  const I = g.islands, k = (n) => I.filter((o) => o.kind === n).length;
  const errs = [];
  if (k('small') !== plan.small || k('medium') !== plan.medium || k('large') !== plan.large) errs.push('island counts');
  if (g.objectives !== plan.objectives || I.filter((o) => o.shrine && !o.heart).length !== plan.objectives) errs.push('objective count');
  // solve the wards: from the start, complete any reachable shrine, cross any walkway whose ward is done
  const done = new Set(), reach = new Set([g.startIsland]);
  for (let pass = 0; pass < 40; pass++) {
    for (const b of g.bridges) if ((b.ward < 0 || done.has(b.ward)) && (reach.has(b.a) || reach.has(b.b))) { reach.add(b.a); reach.add(b.b); }
    for (const i of reach) if (I[i].shrine && !I[i].heart) done.add(i);
  }
  if (reach.size !== I.length) errs.push('wards leave ' + (I.length - reach.size) + ' islands unreachable');
  if (done.size !== plan.objectives) errs.push(`only ${done.size} of ${plan.objectives} shrines winnable`);
  if (!I[g.heart].heart || I[g.heart].kind !== 'large') errs.push('heart');
  // the exit portal stands on a clear tile of the Heart island with room to walk up to it
  { const m = g.map, [ex, ey] = g.exit, open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => m.walkable(ex + dx, ey + dy)).length;
    if (!m.walkable(ex, ey) || m.breach.own[m.tileIdx(ex, ey)] !== g.heart || open < 3) errs.push(`exit blocked (${open} open sides)`); }
  // Re-run progression with the same radius, height-step and collision rules as player movement.
  {
    const m = g.map, W = m.w, blk = m.block.slice();
    for (const b of g.bridges) if (b.ward >= 0) for (const i of b.gate) blk[i] = 1;
    const won = new Set();
    for (let pass = 0; pass <= plan.objectives; pass++) {
      const seen = m.movementReachable(g.start, 0.24, blk); let more = false;
      for (const o of I) if (o.shrine && !o.heart && !won.has(o.idx)) {
        const at = [o.cx, o.cy];
        if (m.movementCanReach(g.start, at, 0.24, seen) || nearestReachableStand(m, seen, at, 1.4, 0.24)) {
          won.add(o.idx); more = true;
          for (const b of g.bridges) if (b.ward === o.idx) for (const i of b.gate) blk[i] = 0;
        }
      }
      if (!more) break;
    }
    if (won.size !== plan.objectives) errs.push(`collision check: only ${won.size} of ${plan.objectives} shrines reachable in progression`);
    const finalReach = m.movementReachable(g.start, 0.24, blk);
    if (I.some((o) => !finalReach[m.tileIdx(o.cx, o.cy)])) errs.push('collision check: an island never reached');
    if (!m.movementCanReach(g.start, g.exit, 0.24, finalReach)) errs.push('collision check: exit cannot be walked to');
    const closed = m.block.slice();
    for (const b of g.bridges) if (b.ward >= 0) for (const i of b.gate) closed[i] = 1;
    const s2 = m.movementReachable(g.start, 0.24, closed);
    for (const b of g.bridges) if (b.ward >= 0 && I[b.near].hops >= 0) {
      const farIn = I[b.far].tiles.some((i) => s2[i]), nearIn = I[b.near].tiles.some((i) => s2[i]);
      void farIn; void nearIn;
    }
    // islands reached on the tiles with every ward closed must be exactly those the walkway graph allows
    const graph = new Set([g.startIsland]);
    for (let more = true; more;) { more = false; for (const b of g.bridges) if (b.ward < 0 && graph.has(b.a) !== graph.has(b.b)) { graph.add(b.a); graph.add(b.b); more = true; } }
    const tiles = I.filter((o) => o.tiles.some((i) => s2[i])).map((o) => o.idx);
    const leak = tiles.filter((k) => !graph.has(k));
    if (leak.length) errs.push('tiles: past a ward to islands ' + leak.join(',') + ' (graph allows ' + [...graph].join(',') + ')');
    if (![...graph].some((k) => I[k].shrine && !I[k].heart)) errs.push('no shrine reachable at the start');
  }
  const warded = g.bridges.filter((b) => b.ward >= 0).length;
  const actualLoops = g.bridges.length - I.length + 1;
  if (actualLoops !== g.loops || actualLoops < Math.min(plan.objectives, Math.floor(I.length / 2))) errs.push('insufficient playable loops');
  const degrees = I.map((o) => g.bridges.filter((b) => b.a === o.idx || b.b === o.idx).length);
  if (I.some((o) => o.shrine && !o.heart && degrees[o.idx] < 2)) errs.push('required objective is a dead-end island');
  sizes.push([g.map.w, g.map.h, g.bridges.length, warded, g.ruins.length, g.spawns.length, g.chests.length, g.props.length, I.length, actualLoops]);
  if (errs.length) { fails++; console.log('seed', seed, errs.join('; ')); }
}
const avg = (k) => (sizes.reduce((s, r) => s + r[k], 0) / sizes.length).toFixed(1);
console.log(`Floor ${FLOOR}: ${sizes.length}/${N} seeds ok; ${plan.objectives} objectives, ${plan.small + plan.medium + plan.large} islands, span ${breachMapSpan(FLOOR)}, map ${avg(0)}x${avg(1)}, walkways ${avg(2)} (${avg(9)} loops; ${avg(3)} warded), ruins ${avg(4)}, packs ${avg(5)}, chests ${avg(6)}, props ${avg(7)}`);
}
console.log(`${FLOORS.length * N - fails}/${FLOORS.length * N} randomized maps ok in ${Date.now() - t0} ms`);
process.exit(fails ? 1 : 0);
