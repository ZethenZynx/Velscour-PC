import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actSelectionRows, act2Unlocked, act3Unlocked, act4Unlocked, actFinaleExit, recordActFinaleProgress } from '../../src/game/actselection.js';
import { G } from '../../src/state.js';
import { game } from '../../src/game/game.js';
import { UI } from '../../src/ui/ui.js';
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const { migrate, newCharData } = await import('../../src/game/save.js');

assert.deepEqual(actSelectionRows({ depth: 1, deepest: 0 }).map((a) => a.unlocked), [true, false, false, false]);
assert.deepEqual(actSelectionRows({ depth: 25, deepest: 24 }).map((a) => a.unlocked), [true, false, false, false], 'reaching depth 25 without clearing it does not unlock Act II');
assert.deepEqual(actSelectionRows({ depth: 26, deepest: 25 }).map((a) => a.unlocked), [true, true, false, false]);
assert.deepEqual(actSelectionRows({ depth: 76, deepest: 75 }).map((a) => a.unlocked), [true, true, true, true], 'Act III town remains available after the Act IV finale');
assert.deepEqual(actSelectionRows({ depth: 2, deepest: 0, visitedAct2Town: true }).map((a) => a.unlocked), [true, true, false, false]);
assert.equal(actSelectionRows({ depth: 1, deepest: 24, cleared: { 25: true } })[1].unlocked, true, 'legacy clear records unlock Act II');
assert.equal(actSelectionRows({ depth: 30, deepest: 29 })[1].requirement, 'Defeat Ossuarch and complete Depth 25 to unlock Act 2.');
assert.equal(actSelectionRows({ deepest: 74 })[3].requirement, "Complete the Act III finale at Depth 75 to unlock Tessariel's Keep.");
assert.equal(act2Unlocked({ depth: 25, deepest: 24 }), false);
assert.equal(act3Unlocked({ deepest: 49, cleared: {} }), false);
assert.equal(act3Unlocked({ deepest: 50 }), true);
assert.equal(act4Unlocked({ depth: 76, deepest: 74 }), false, 'display depth alone does not bypass the unlock milestone');
assert.equal(act4Unlocked({ deepest: 75 }), true);
assert.equal(act4Unlocked({ cleared: { 75: true } }), true);

for (const [depth, nextDepth, town] of [[25, 26, 'act2'], [50, 51, 'act3'], [75, 76, 'act4'], [100, 101, 'post-campaign']]) {
  const before = { depth, deepest: depth - 1, lastTown: 'act1', cleared: {} };
  assert.deepEqual(actFinaleExit(depth), { depth: nextDepth, town, townName: actFinaleExit(depth).townName });
  const destination = recordActFinaleProgress(before, depth);
  assert.equal(destination.town, town);
  assert.equal(before.depth, nextDepth, `Depth ${depth} progression is recorded without leaving the active level`);
  assert.equal(before.deepest, depth);
  assert.equal(before.cleared[depth], true);
  assert.equal(before.lastTown, 'act1', 'recording a finale does not change the character location');
  recordActFinaleProgress(before, depth);
  assert.equal(before.depth, nextDepth, 'repeated completion does not advance beyond the next campaign depth');
}
for (const depth of [24, 26, 49, 51, 74, 76, 99, 101]) assert.equal(actFinaleExit(depth), null, `${depth} is not an Act finale`);
assert.equal(recordActFinaleProgress({}, 24), null, 'non-finale progression is unchanged');

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
assert.match(gameSource, /x: t\.breach\.x, y: t\.breach\.y, active: true, color: '#3a8aff', reach: 2\.0,[\s\S]*?label: 'Portal to the Acts'/,
  'Herrington Hollow uses the original blue portal at the former Breach pad');
assert.match(gameSource, /if \(t\.breach\) world\.portals\.push\(\{[\s\S]*?x: t\.breach\.x, y: t\.breach\.y, active: true, color: '#3a8aff', reach: 2\.0,[\s\S]*?label: 'Portal to the Acts'/,
  'Sunscorch Oasis uses the same original blue portal at its former Breach pad');
assert.equal((gameSource.match(/keepGate: true/g) || []).length, 0, 'no Act portal is redirected to the green Keep gate renderer');
assert.match(gameSource, /async enterTessarielKeep\(\)[\s\S]*?buildTessarielKeep\(this/,
  'Act IV builds the new town through the game entry flow');
const bossHandler = gameSource.match(/world\.onBossKilled = \(m\) => \{([\s\S]*?)\n    \};/);
assert.ok(bossHandler, 'campaign boss completion handler exists');
assert.doesNotMatch(bossHandler[1], /void this\.enterAct2Town\(|void this\.enterAct3Town\(|void this\.enterTessarielKeep\(|setTimeout\(\(\) => victoryScreen/,
  'defeating an Act finale never forces a town transition or victory-screen transition');
assert.match(bossHandler[1], /recordActFinaleProgress\(c, depth\)/, 'finale progression is recorded while the dungeon stays loaded');
assert.match(bossHandler[1], /if \(m\.isVelscour && !world\.practice && depth === FINAL_DEPTH\)/, 'only the true Depth 100 Velscour encounter unlocks endgame');
assert.match(gameSource, /const canUseExit = !!exit\?\.active;[\s\S]*?const actFinale = actFinaleExit\(world\.depth\);[\s\S]*?if \(actFinale && world\.depth < FINAL_DEPTH[\s\S]*?void this\.enterAct2Town\(\)[\s\S]*?void this\.enterAct3Town\(\)[\s\S]*?void this\.enterTessarielKeep\(\)/,
  'Depths 25, 50 and 75 transition only through their active exit portal');
assert.match(gameSource, /openVendor: \(id\) => Vendor\.open\(id\)[\s\S]*?openStash: \(\) => Stash\.open\(\)[\s\S]*?openReliquary: \(\) => G\.ui\.reliquary\.open\(\)[\s\S]*?openJewelBox: \(\) => JewelBox\.open\(\)/,
  'Keep merchants and storage use fork-native interfaces');
assert.match(keepGameSource, /use: \(\) => game\.confirmDungeon\(\)/, 'Keep depth gate uses the existing portal-to-depths flow');
assert.match(keepGameSource, /color: '#3a8aff', reach: 2, label: 'Portal to the Acts', use: \(\) => game\.openActSelection\(\)[\s\S]*?label: `Portal - Depth \$\{game\.maxPortalFloor\(G\.char\)\}`[\s\S]*?game\.confirmDungeon\(\)/,
  'the Keep uses the original blue Acts portal and preserves its separate Depths portal');
assert.match(keepWorldSource, /map\.c3only = true[\s\S]*?map\.keep = true/, 'the original isometric Keep terrain and collision data are retained');
assert.match(rendererSource, /if \(p\.keepGate\) return drawKeepGate\(ctx, p\)/, 'the renderer retains the Keep gate for any other intended callers');
assert.match(rendererSource, /if \(n\.keepFlame\)[\s\S]*?drawSacredFlame/, 'the original central Sacred Flame animation is rendered');
assert.doesNotMatch(gameSource, /Travel to Current Town/, 'the misleading current-town action remains removed');
const saveSource = await readFile(new URL('../../src/game/save.js', import.meta.url), 'utf8');
assert.match(saveSource, /c\.act4AutoTravelDone = !!\(c\.visitedAct4Town \|\| c\.deepest >= 75 \|\| c\.cleared\[75\]\)/, 'legacy saves at the Act IV milestone do not auto-teleport');

const oldDialog = UI.dialog;
const oldTown = game.enterTown;
const oldAct2Town = game.enterAct2Town;
const oldAct3Town = game.enterAct3Town;
const oldKeep = game.enterTessarielKeep;
let dialogSpec, clicked = [];
const buttons = [1, 2, 3, 4].map((act) => ({ dataset: { act: String(act) }, addEventListener(type, fn) { this.click = fn; } }));
UI.dialog = (spec) => {
  dialogSpec = spec;
  return { close() { clicked.push('closed'); }, box: { querySelectorAll: () => buttons.filter((button) => actSelectionRows(G.char).find((row) => row.act === Number(button.dataset.act))?.unlocked) } };
};
game.enterTown = () => clicked.push('act1-town');
game.enterAct2Town = () => clicked.push('act2-town');
game.enterAct3Town = () => clicked.push('act3-town');
game.enterTessarielKeep = () => clicked.push('act4-town');
G.char = { depth: 25, deepest: 24, cleared: { 24: true } };
try {
  game.openActSelection();
  assert.match(dialogSpec.html, /ACT 2[\s\S]*?The Scorched Wastes[\s\S]*?Locked/);
  assert.match(dialogSpec.html, /data-act="2" disabled>Locked/);
  assert.equal(buttons[1].click, undefined, 'locked Act II has no travel handler');
  assert.match(dialogSpec.html, /data-act="3" disabled>Locked/);
  assert.match(dialogSpec.html, /data-act="4" disabled>Locked/);
  assert.match(dialogSpec.html, /Tessariel&#39;s Keep/);

  G.char = { depth: 51, deepest: 50, cleared: { 25: true, 50: true } };
  clicked = [];
  game.openActSelection();
  assert.equal(dialogSpec.title, 'PORTAL TO THE ACTS');
  assert.equal(dialogSpec.buttons[0].label, 'Cancel');
  assert.match(dialogSpec.html, /ACT 3[\s\S]*?The Frozen Peaks/);
  assert.match(dialogSpec.html, /Depths 51[\s\S]*?75/);
  assert.match(dialogSpec.html, /Town: Bellmourn/);
  assert.match(dialogSpec.html, /ACT 4[\s\S]*?Velscour&#39;s Throne/);
  assert.doesNotMatch(dialogSpec.html, /Travel to Current Town/);
  buttons[1].click();
  assert.deepEqual(clicked, ['closed', 'act2-town'], 'unlocked Act II travel remains available');
  buttons[2].click();
  assert.deepEqual(clicked.slice(-2), ['closed', 'act3-town'], 'unlocked Act III travel routes to Bellmourn');

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
  // Exercise the real active-exit dispatch for each Act finale.
  clicked = [];
  for (const [depth, expected] of [[25, 'act2-town'], [50, 'act3-town'], [75, 'act4-town']]) {
    game.useExit({ depth }, { active: true });
    assert.deepEqual(clicked, [expected], `Depth ${depth} exit routes to its Act town only after use`);
    clicked = [];
  }

  // Depth 100 retains the explicit Return to Town choice.
  G.char = { depth: 101, deepest: 100, cleared: { 100: true }, lastTown: 'act4' };
  let finaleDialog;
  UI.dialog = (spec) => { finaleDialog = spec; return {}; };
  game.enterTown = () => clicked.push('post-campaign-town');
  game.useExit({ depth: 100, boss: { isVelscour: true } }, { active: true });
  assert.equal(finaleDialog.title, 'Demon Lord Velscour Defeated');
  assert.deepEqual(clicked, [], 'Depth 100 does not transition until the player chooses Return to Town');
  finaleDialog.buttons[0].fn();
  assert.deepEqual(clicked, ['post-campaign-town']);
} finally {
  UI.dialog = oldDialog;
  game.enterTown = oldTown;
  game.enterAct2Town = oldAct2Town;
  game.enterAct3Town = oldAct3Town;
  game.enterTessarielKeep = oldKeep;
  G.char = null;
}

console.log('Act selection portal checks passed.');
