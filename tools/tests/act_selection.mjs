import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actSelectionRows, act2Unlocked, shouldAutoTravelToAct2, act4Unlocked, shouldAutoTravelToAct4 } from '../../src/game/actselection.js';
import { G } from '../../src/state.js';
import { game } from '../../src/game/game.js';
import { UI } from '../../src/ui/ui.js';
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { migrate, newCharData } = await import('../../src/game/save.js');

assert.deepEqual(actSelectionRows({ depth: 1, deepest: 0 }).map((a) => a.unlocked), [true, false, false, false]);
assert.deepEqual(actSelectionRows({ depth: 25, deepest: 24 }).map((a) => a.unlocked), [true, false, false, false], 'reaching depth 25 without clearing it does not unlock Act II');
assert.deepEqual(actSelectionRows({ depth: 26, deepest: 25 }).map((a) => a.unlocked), [true, true, false, false]);
assert.deepEqual(actSelectionRows({ depth: 76, deepest: 75 }).map((a) => a.unlocked), [true, true, false, true], 'Act IV opens after the Depth 75 finale; Act III still has no travel town');
assert.deepEqual(actSelectionRows({ depth: 2, deepest: 0, visitedAct2Town: true }).map((a) => a.unlocked), [true, true, false, false]);
assert.equal(actSelectionRows({ depth: 1, deepest: 24, cleared: { 25: true } })[1].unlocked, true, 'legacy clear records unlock Act II');
assert.equal(actSelectionRows({ depth: 30, deepest: 29 })[1].requirement, 'Defeat Ossuarch and complete Depth 25 to unlock Act 2.');
assert.equal(actSelectionRows({ deepest: 74 })[3].requirement, 'Complete the Act III finale at Depth 75 to unlock Tessariel’s Keep.');
assert.equal(act2Unlocked({ depth: 25, deepest: 24 }), false);
assert.equal(shouldAutoTravelToAct2({ depth: 25, deepest: 24, act2AutoTravelDone: false }, 25, true), true);
assert.equal(shouldAutoTravelToAct2({ depth: 26, deepest: 25, act2AutoTravelDone: true }, 25, true), false, 'a completed arrival never repeats');
assert.equal(shouldAutoTravelToAct2({ deepest: 25, act2AutoTravelDone: false }, 25, true), false, 'existing unlocked characters do not get teleported');
assert.equal(shouldAutoTravelToAct2({ deepest: 24, act2AutoTravelDone: false }, 25, false), false, 'an already cleared depth does not trigger arrival');
assert.equal(act4Unlocked({ depth: 76, deepest: 74 }), false, 'display depth alone does not bypass the unlock milestone');
assert.equal(act4Unlocked({ deepest: 75 }), true);
assert.equal(act4Unlocked({ cleared: { 75: true } }), true);
assert.equal(shouldAutoTravelToAct4({ deepest: 74, act4AutoTravelDone: false }, 75, true), true);
assert.equal(shouldAutoTravelToAct4({ deepest: 75, act4AutoTravelDone: false }, 75, true), false, 'legacy Act IV progress never causes a surprise teleport');
assert.equal(shouldAutoTravelToAct4({ deepest: 74, act4AutoTravelDone: true }, 75, true), false, 'the one-time arrival flag prevents repeats');
assert.equal(shouldAutoTravelToAct4({ deepest: 74, act4AutoTravelDone: false }, 75, false), false, 'reclears do not trigger first arrival');

const fresh = newCharData('paladin', 'Fresh');
migrate(fresh);
assert.equal(fresh.act2AutoTravelDone, false, 'new characters retain the pending Act II arrival');
assert.equal(fresh.act4AutoTravelDone, false, 'new characters retain the pending Act IV arrival');
const legacy = newCharData('paladin', 'Legacy');
delete legacy.act2AutoTravelDone;
legacy.deepest = 25;
migrate(legacy);
assert.equal(legacy.act2AutoTravelDone, true, 'existing Act II progress migrates without an unsolicited teleport');
const legacyAct4 = newCharData('paladin', 'Legacy Act IV');
legacyAct4.deepest = 76;
legacyAct4.lastTown = 'act2';
delete legacyAct4.act4AutoTravelDone;
migrate(legacyAct4);
assert.equal(legacyAct4.lastTown, 'act4', 'legacy endgame characters return to the new official home');
assert.equal(legacyAct4.act4AutoTravelDone, true, 'legacy Act IV progress does not trigger a first-arrival teleport');

const [gameSource, townSource, act2TownSource, keepWorldSource, keepGameSource, rendererSource] = await Promise.all([
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/world/town.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/world/act2town.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/world/keepworld.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/tessarielskeep.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8'),
]);
assert.match(gameSource, /x: t\.breach\.x, y: t\.breach\.y, active: true, color: '#8fd45a'[\s\S]*?keepGate: true, label: 'Portal to the Acts'/,
  'Herrington Hollow replaces the Act portal art at the former Breach pad');
assert.match(gameSource, /if \(t\.breach\) world\.portals\.push\(\{[\s\S]*?x: t\.breach\.x, y: t\.breach\.y, active: true, color: '#8fd45a'[\s\S]*?keepGate: true, label: 'Portal to the Acts'/,
  'Sunscorch Oasis uses the same gate art at its former Breach pad');
assert.equal((gameSource.match(/keepGate: true/g) || []).length, 2, 'the two existing act portals are updated without adding duplicates');
assert.match(gameSource, /async enterTessarielKeep\(\)[\s\S]*?buildTessarielKeep\(this/,
  'Act IV builds the new town through the game entry flow');
assert.match(gameSource, /autoTravelToAct4 = shouldAutoTravelToAct4\(c, depth, first\)[\s\S]*?if \(autoTravelToAct4\) c\.act4AutoTravelDone = true[\s\S]*?void this\.enterTessarielKeep\(\)/,
  'the Depth 75 auto-arrival is claimed once before transition');
assert.match(gameSource, /openVendor: \(id\) => Vendor\.open\(id\)[\s\S]*?openStash: \(\) => Stash\.open\(\)[\s\S]*?openReliquary: \(\) => G\.ui\.reliquary\.open\(\)[\s\S]*?openJewelBox: \(\) => JewelBox\.open\(\)/,
  'Keep merchants and storage use fork-native interfaces');
assert.match(keepGameSource, /use: \(\) => game\.confirmDungeon\(\)/, 'Keep depth gate uses the existing portal-to-depths flow');
assert.match(keepGameSource, /keepGate: true, label: 'Portal to the Acts'[\s\S]*?label: `Portal - Depth \$\{game\.maxPortalFloor\(G\.char\)\}`[\s\S]*?game\.confirmDungeon\(\)/,
  'the Keep has only the fork-native Acts and Depths portals');
assert.match(keepWorldSource, /map\.c3only = true[\s\S]*?map\.keep = true/, 'the original isometric Keep terrain and collision data are retained');
assert.match(rendererSource, /if \(p\.keepGate\) return drawKeepGate\(ctx, p\)/, 'the Portal to the Acts shares the original Keep gate art');
assert.match(rendererSource, /if \(n\.keepFlame\)[\s\S]*?drawSacredFlame/, 'the original central Sacred Flame animation is rendered');
assert.doesNotMatch(gameSource, /Travel to Current Town/, 'the misleading current-town action remains removed');
const saveSource = await readFile(new URL('../../src/game/save.js', import.meta.url), 'utf8');
assert.match(saveSource, /c\.act4AutoTravelDone = !!\(c\.visitedAct4Town \|\| c\.deepest >= 75 \|\| c\.cleared\[75\]\)/, 'legacy saves at the Act IV milestone do not auto-teleport');

const oldDialog = UI.dialog;
const oldTown = game.enterTown;
const oldAct2Town = game.enterAct2Town;
const oldKeep = game.enterTessarielKeep;
let dialogSpec, clicked = [];
const buttons = [1, 2, 3, 4].map((act) => ({ dataset: { act: String(act) }, addEventListener(type, fn) { this.click = fn; } }));
UI.dialog = (spec) => {
  dialogSpec = spec;
  return { close() { clicked.push('closed'); }, box: { querySelectorAll: () => buttons.filter((button) => actSelectionRows(G.char).find((row) => row.act === Number(button.dataset.act))?.unlocked) } };
};
game.enterTown = () => clicked.push('act1-town');
game.enterAct2Town = () => clicked.push('act2-town');
game.enterTessarielKeep = () => clicked.push('act4-town');
G.char = { depth: 25, deepest: 24, cleared: { 24: true } };
try {
  game.openActSelection();
  assert.match(dialogSpec.html, /ACT 2[\s\S]*?The Scorched Wastes[\s\S]*?Locked/);
  assert.match(dialogSpec.html, /data-act="2" disabled>Locked/);
  assert.equal(buttons[1].click, undefined, 'locked Act II has no travel handler');
  assert.match(dialogSpec.html, /data-act="3" disabled>Coming Soon/);
  assert.match(dialogSpec.html, /data-act="4" disabled>Locked/);
  assert.match(dialogSpec.html, /Tessariel&#39;s Keep/);

  G.char = { depth: 51, deepest: 50, cleared: { 25: true, 50: true } };
  clicked = [];
  game.openActSelection();
  assert.equal(dialogSpec.title, 'PORTAL TO THE ACTS');
  assert.equal(dialogSpec.buttons[0].label, 'Cancel');
  assert.match(dialogSpec.html, /ACT 3[\s\S]*?The Frozen Peaks/);
  assert.match(dialogSpec.html, /Depths 51[\s\S]*?75/);
  assert.match(dialogSpec.html, /Coming Soon/);
  assert.match(dialogSpec.html, /ACT 4[\s\S]*?Velscour&#39;s Throne/);
  assert.doesNotMatch(dialogSpec.html, /Travel to Current Town/);
  buttons[1].click();
  assert.deepEqual(clicked, ['closed', 'act2-town'], 'unlocked Act II travel remains available');

  G.char = { depth: 26, deepest: 25, cleared: { 25: true } };
  clicked = [];
  game.openActSelection();
  buttons[0].click();
  assert.deepEqual(clicked, ['closed', 'act1-town'], 'travel from Act II back to Act I remains available');

  G.char = { depth: 76, deepest: 75, cleared: { 75: true } };
  clicked = [];
  game.openActSelection();
  assert.match(dialogSpec.html, /ACT 4[\s\S]*?Velscour&#39;s Throne[\s\S]*?Tessariel&#39;s Keep/);
  buttons[3].click();
  assert.deepEqual(clicked, ['closed', 'act4-town'], 'Act IV travel routes to Tessariel’s Keep');
} finally {
  UI.dialog = oldDialog;
  game.enterTown = oldTown;
  game.enterAct2Town = oldAct2Town;
  game.enterTessarielKeep = oldKeep;
  G.char = null;
}

console.log('Act selection portal checks passed.');
