import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { A } from '../../src/core/assets.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';
import { CLIMB, DROP, generateSummit } from '../../src/world/summit.js';
import { reachFrom } from '../../src/world/alpine.js';
import { tickSummitFoeRecovery } from '../../src/game/summit.js';

// Snowy Summit generation only needs pack metadata and a canvas-like image in this headless test.
class FakeCanvas {
  constructor() { this.width = this.height = 4096; }
  getContext() { return { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, set globalCompositeOperation(_) {} }; }
}
globalThis.HTMLCanvasElement = FakeCanvas;
const dirs = Object.fromEntries(['SE', 'SW', 'NW', 'NE'].map((d) => [d, { closed: [], open: [] }]));
const walls = { summit_shrine_ashlar: {} };
for (let mask = 0; mask < 16; mask++) walls.summit_shrine_ashlar[mask] = [[]];
const image = new FakeCanvas();
A.packs.catacombs = { floors: image, walls: image, scatter: image, meta: {
  tile: [160, 80], zscale: 1, floors: [{ x: 0, y: 0, w: 160, h: 80, seamless: true, name: 'floor' }], walls,
  arches: { summit_shrine_portal: { SE: [], SW: [], NE: [], NW: [] } }, doors: { frozen_iron_gate: dirs }, archSpan: {}, scatter: [],
} };

const runtime = readFileSync(new URL('../../src/game/summit.js', import.meta.url), 'utf8');
assert.match(runtime, /Keep the entrance open during combat/);
assert.doesNotMatch(runtime, /if \(e\.gateIn\) shut\(e\.gateIn\)/, 'fight start must not close the retreat path');
assert.match(runtime, /if \(e\.gate\)\s*\{\s*open\(e\.gate\)/, 'the far gate opens only in encounter completion');
assert.match(runtime, /if \(!live\.length && e\.t > 1\) finishEnc\(e\)/, 'required foes still gate encounter completion');

for (let seed = 1; seed <= 40; seed++) {
  const gen = generateSummit(75, BIOME_BY_ID.snowy_summit, seed * 7919);
  const { map, start } = gen, sm = map.summit;
  const plateaus = sm.nodes.filter((n) => n.kind === 'plateau');
  const outGates = plateaus.map((n) => sm.gates.find((g) => g.node === n.i && g.role === 'out'));
  const inGates = plateaus.map((n) => sm.gates.find((g) => g.node === n.i && g.role === 'in'));
  assert.equal(outGates.length, 4, `seed ${seed}: four mandatory far-side gates`);
  assert.ok(outGates.every((g) => g && g.tiles.length && g.tiles.every((i) => map.block[i])), `seed ${seed}: far gates start blocked`);
  assert.ok(inGates.every((g) => g && g.tiles.length && g.tiles.every((i) => !map.block[i])), `seed ${seed}: retreat gates remain open`);
  const W = map.w, H = map.h, walk = Uint8Array.from(map.t), startIdx = Math.floor(start[1]) * W + Math.floor(start[0]);
  const peak = sm.peak, peakIdx = Math.floor(peak.y) * W + Math.floor(peak.x), allOpen = map.block.slice();
  for (const gate of sm.gates) for (const tile of gate.tiles) allOpen[tile] = 0;
  assert.ok(reachFrom(W, H, map.hgt, walk, allOpen, startIdx, CLIMB, DROP)[peakIdx], `seed ${seed}: the summit remains navigable once encounter gates open`);
  for (let i = 0; i < plateaus.length; i++) {
    const node = plateaus[i], nodeIdx = Math.floor(node.y) * W + Math.floor(node.x), lockedOut = allOpen.slice();
    for (const tile of outGates[i].tiles) lockedOut[tile] = 1;
    assert.equal(reachFrom(W, H, map.hgt, walk, lockedOut, nodeIdx, CLIMB, DROP)[peakIdx], 0, `seed ${seed}: far gate ${i + 1} still protects required progression`);
    const lockedIn = allOpen.slice();
    for (const tile of inGates[i].tiles) lockedIn[tile] = 1;
    assert.equal(reachFrom(W, H, map.hgt, walk, lockedIn, nodeIdx, CLIMB, DROP)[startIdx], 0, `seed ${seed}: entrance gate ${i + 1} remains a valid optional seal`);
  }
}

const makeFoe = (extra = {}) => ({ dead: false, targetable: false, awake: true, x: 2, y: 3, z: -10, nav: {}, action: 'cast', moving: true, summitUntargetableT: 0, ...extra });
let foe = makeFoe(), entered = 0;
const safe = () => [7, 8], reenter = (m, type) => { assert.equal(type, 'burrow'); entered++; m.entering = () => {}; };
assert.equal(tickSummitFoeRecovery(foe, 7.9, safe, reenter), false);
assert.equal(tickSummitFoeRecovery(foe, 0.1, safe, reenter), true);
assert.deepEqual([foe.x, foe.y, foe.z, foe.nav, foe.action, foe.moving], [7, 8, 0, null, null, false]);
assert.equal(entered, 1, 'recovered foe re-enters using the existing telegraphed burrow entrance');
for (const state of [{ entering() {} }, { dormantFor: {} }, { awake: false }, { targetable: true }, { dead: true }]) {
  foe = makeFoe({ summitUntargetableT: 6, ...state });
  assert.equal(tickSummitFoeRecovery(foe, 10, safe, reenter), false, 'legitimate entrance, dormant, targetable or dead state is not relocated');
  assert.equal(foe.summitUntargetableT, 0);
}
foe = makeFoe({ summitUntargetableT: 7.9 });
assert.equal(tickSummitFoeRecovery(foe, 0.2, () => [null, null], reenter), false, 'no safe tile does not force a terrain-invalid move');
assert.equal(foe.summitUntargetableT, 7.5, 'missing safe placement retries promptly');
console.log('PASS: 40 Summit seeds retain gated mandatory progression with an open retreat path; untargetable-foe recovery is safe, bounded, and does not skip fights.');
