import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actSelectionRows, act2Unlocked, shouldAutoTravelToAct2 } from '../../src/game/actselection.js';
import { G } from '../../src/state.js';
import { game } from '../../src/game/game.js';
import { UI } from '../../src/ui/ui.js';
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { migrate, newCharData } = await import('../../src/game/save.js');

assert.deepEqual(actSelectionRows({ depth: 1, deepest: 0 }).map((a) => a.unlocked), [true, false, false, false]);
assert.deepEqual(actSelectionRows({ depth: 25, deepest: 24 }).map((a) => a.unlocked), [true, false, false, false], 'reaching depth 25 without clearing it does not unlock Act II');
assert.deepEqual(actSelectionRows({ depth: 26, deepest: 25 }).map((a) => a.unlocked), [true, true, false, false]);
assert.deepEqual(actSelectionRows({ depth: 76, deepest: 75 }).map((a) => a.unlocked), [true, true, false, false], 'Acts III and IV stay unavailable after later campaign milestones');
assert.deepEqual(actSelectionRows({ depth: 2, deepest: 0, visitedAct2Town: true }).map((a) => a.unlocked), [true, true, false, false]);
assert.equal(actSelectionRows({ depth: 1, deepest: 24, cleared: { 25: true } })[1].unlocked, true, 'legacy clear records unlock Act II');
assert.equal(actSelectionRows({ depth: 30, deepest: 29 })[1].requirement, 'Defeat Ossuarch and complete Depth 25 to unlock Act 2.');
assert.equal(act2Unlocked({ depth: 25, deepest: 24 }), false);
assert.equal(shouldAutoTravelToAct2({ depth: 25, deepest: 24, act2AutoTravelDone: false }, 25, true), true);
assert.equal(shouldAutoTravelToAct2({ depth: 26, deepest: 25, act2AutoTravelDone: true }, 25, true), false, 'a completed arrival never repeats');
assert.equal(shouldAutoTravelToAct2({ deepest: 25, act2AutoTravelDone: false }, 25, true), false, 'existing unlocked characters do not get teleported');
assert.equal(shouldAutoTravelToAct2({ deepest: 24, act2AutoTravelDone: false }, 25, false), false, 'an already cleared depth does not trigger arrival');
const fresh = newCharData('paladin', 'Fresh');
migrate(fresh);
assert.equal(fresh.act2AutoTravelDone, false, 'new characters retain the pending first-arrival state');
const legacy = newCharData('paladin', 'Legacy');
delete legacy.act2AutoTravelDone;
legacy.deepest = 25;
migrate(legacy);
assert.equal(legacy.act2AutoTravelDone, true, 'existing Act II progress migrates without an unsolicited teleport');

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
assert.match(gameSource, /autoTravelToAct2 = shouldAutoTravelToAct2\(c, depth, first\)/, 'the first depth 25 boss clear controls automatic arrival');
assert.match(gameSource, /if \(autoTravelToAct2\) c\.act2AutoTravelDone = true[\s\S]*?this\.autosave\(\)[\s\S]*?void this\.enterAct2Town\(\)/, 'the one-time flag and cleared progression save before town travel');
assert.match(gameSource, /act\.implemented \? \(act\.unlocked \? 'Travel' : 'Locked'\) : 'Coming Soon'/, 'unimplemented acts are visibly disabled');
assert.doesNotMatch(gameSource, /Travel to Current Town/, 'the misleading current-town action is removed');
const saveSource = await readFile(new URL('../../src/game/save.js', import.meta.url), 'utf8');
assert.match(saveSource, /c\.act2AutoTravelDone = !!\(c\.visitedAct2Town \|\| c\.deepest >= 25 \|\| c\.cleared\[25\]\)/, 'legacy saves at the Act II milestone are marked as already handled');

const oldDialog = UI.dialog;
const oldTown = game.enterTown;
const oldAct2Town = game.enterAct2Town;
let dialogSpec, clicked = [];
const buttons = [1, 2, 3, 4].map((act) => ({
  dataset: { act: String(act) },
  disabled: act > 2,
  addEventListener(type, fn) { this.click = fn; },
}));
UI.dialog = (spec) => {
  dialogSpec = spec;
  return { close() { clicked.push('closed'); }, box: { querySelectorAll: () => buttons.filter((button) => actSelectionRows(G.char).find((row) => row.act === Number(button.dataset.act))?.unlocked) } };
};
game.enterTown = () => clicked.push('act1-town');
game.enterAct2Town = () => clicked.push('act2-town');
G.char = { depth: 25, deepest: 24, cleared: { 24: true } };
try {
  game.openActSelection();
  assert.match(dialogSpec.html, /ACT 2 — The Scorched Wastes[\s\S]*?Locked/);
  assert.match(dialogSpec.html, /data-act="2" disabled>Locked/);
  assert.equal(buttons[1].click, undefined, 'locked Act II has no travel handler');
  assert.match(dialogSpec.html, /data-act="3" disabled>Coming Soon/);
  assert.match(dialogSpec.html, /data-act="4" disabled>Coming Soon/);
} finally {
  G.char = null;
}
G.char = { depth: 51, deepest: 50, cleared: { 25: true, 50: true } };
try {
  game.openActSelection();
  assert.equal(dialogSpec.title, 'PORTAL TO THE ACTS');
  assert.equal(dialogSpec.buttons[0].label, 'Cancel');
  assert.match(dialogSpec.html, /ACT 3 — The Frozen Peaks/);
  assert.match(dialogSpec.html, /Depths 51–75/);
  assert.match(dialogSpec.html, /Coming Soon/);
  assert.match(dialogSpec.html, /ACT 4 — Velscour&#39;s Throne/);
  assert.doesNotMatch(dialogSpec.html, /Travel to Current Town/);
  buttons[1].click();
  assert.deepEqual(clicked, ['closed', 'act2-town'], 'an unlocked Act II row routes to its authored town');
  G.char = { depth: 26, deepest: 25, cleared: { 25: true } };
  clicked = [];
  game.openActSelection();
  buttons[0].click();
  assert.deepEqual(clicked, ['closed', 'act1-town'], 'travel from Act II back to Act I remains available');
} finally {
  UI.dialog = oldDialog;
  game.enterTown = oldTown;
  game.enterAct2Town = oldAct2Town;
  G.char = null;
}

console.log('Act selection portal checks passed.');
