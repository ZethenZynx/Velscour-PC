import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actSelectionRows } from '../../src/game/actselection.js';
import { G } from '../../src/state.js';
import { game } from '../../src/game/game.js';
import { UI } from '../../src/ui/ui.js';

assert.deepEqual(actSelectionRows({ depth: 1, deepest: 0 }).map((a) => a.unlocked), [true, false, false, false]);
assert.deepEqual(actSelectionRows({ depth: 26, deepest: 25 }).map((a) => a.unlocked), [true, true, false, false]);
assert.deepEqual(actSelectionRows({ depth: 51, deepest: 50 }).map((a) => a.unlocked), [true, true, true, false]);
assert.deepEqual(actSelectionRows({ depth: 76, deepest: 75 }).map((a) => a.unlocked), [true, true, true, true]);
assert.deepEqual(actSelectionRows({ depth: 2, deepest: 0, visitedAct2Town: true }).map((a) => a.unlocked), [true, true, false, false]);
assert.equal(actSelectionRows({ depth: 30, deepest: 29 })[2].requirement, 'Complete Depth 50 to unlock Act 3.');

const [gameSource, townSource, act2TownSource] = await Promise.all([
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/world/town.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/world/act2town.js', import.meta.url), 'utf8'),
]);
assert.match(gameSource, /x: t\.breach\.x, y: t\.breach\.y, active: true, color: '#3a8aff'[\s\S]*?label: 'Portal to the Acts'/,
  'Herrington Hollow places the blue Act portal at the former Breach pad');
assert.match(gameSource, /if \(t\.breach\) world\.portals\.push\(\{[\s\S]*?x: t\.breach\.x, y: t\.breach\.y, active: true, color: '#3a8aff'[\s\S]*?label: 'Portal to the Acts'/,
  'Sunscorch Oasis uses the same blue portal at its former Breach pad');
assert.doesNotMatch(gameSource, /x: t\.center\.x \+ 3\.8[\s\S]{0,180}Waypoint.*Act II/, 'the former Act II waypoint location is no longer a portal');
assert.doesNotMatch(gameSource, /x: t\.act1Portal\.x[\s\S]{0,250}Waypoint.*Act I/, 'the former return waypoint is removed');
assert.match(townSource, /const breach = \{ x: Math\.floor\(C\.x \+ Math\.cos\(aB\) \* dB\)/, 'Herrington Hollow still reserves the former Breach location');
assert.match(act2TownSource, /const breach = \{[\s\S]{0,150}C\.x - R\(13, 17\)/, 'Sunscorch Oasis still reserves the former Breach location');

const oldDialog = UI.dialog;
const oldTown = game.enterTown;
const oldAct2Town = game.enterAct2Town;
let dialogSpec, clicked = [];
const buttons = [1, 2, 3, 4].map((act) => ({
  dataset: { act: String(act) },
  disabled: false,
  addEventListener(type, fn) { this.click = fn; },
}));
UI.dialog = (spec) => {
  dialogSpec = spec;
  return { close() { clicked.push('closed'); }, box: { querySelectorAll: () => buttons } };
};
game.enterTown = () => clicked.push('act1-town');
game.enterAct2Town = () => clicked.push('act2-town');
G.char = { depth: 51, deepest: 50, cleared: { 25: true, 50: true } };
try {
  game.openActSelection();
  assert.equal(dialogSpec.title, 'PORTAL TO THE ACTS');
  assert.equal(dialogSpec.buttons[0].label, 'Cancel');
  assert.match(dialogSpec.html, /ACT 3 — The Frozen Peaks/);
  assert.match(dialogSpec.html, /Depths 51–75/);
  assert.match(dialogSpec.html, /Town: Herrington Hollow/);
  assert.match(dialogSpec.html, /Current Act/);
  buttons[1].click();
  assert.deepEqual(clicked, ['closed', 'act2-town'], 'an unlocked Act II row routes to its authored town');
} finally {
  UI.dialog = oldDialog;
  game.enterTown = oldTown;
  game.enterAct2Town = oldAct2Town;
  G.char = null;
}

console.log('Act selection portal checks passed.');
