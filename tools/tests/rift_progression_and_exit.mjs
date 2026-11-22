// Non-browser regressions for Abyssal Rift loot progression and exit placement/clicking.
import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { qualityAtDepth, RARITY, rollSigil, sigilCap } from '../../src/data/items.js';
import { depthLevel, FINAL_DEPTH } from '../../src/data/depth.js';
import { riftLootDepth, riftReward } from '../../src/data/rifts.js';
import { activeExitSpriteAt, exitPortalIsOpen, findReachableInteractableSpot, portalSpriteHit } from '../../src/core/interactable-hit.js';
import { activateRiftExit } from '../../src/game/rifts.js';
import { controls } from '../../src/game/controls.js';
import { input } from '../../src/core/input.js';
import { camera } from '../../src/core/view.js';
import { game } from '../../src/game/game.js';
import { UI } from '../../src/ui/ui.js';
import { groundDropRarityCap, groundRewardDepth, rollGroundGem, rollGroundItem } from '../../src/game/loot.js';
import { makeCovenant } from '../../src/data/relics.js';

G.char = { level: 100, depth: FINAL_DEPTH };
for (let tier = 1; tier <= 40; tier++) {
  const lootDepth = riftLootDepth(tier);
  const expectedCap = qualityAtDepth(lootDepth);
  G.world = { kind: 'dungeon', depth: FINAL_DEPTH, rift: { tier } };
  assert.equal(groundRewardDepth(G.world, FINAL_DEPTH), lootDepth, `tier ${tier}: all world rewards use Rift progression`);
  assert.equal(groundDropRarityCap(lootDepth), expectedCap, `tier ${tier}: progression cap`);
  assert.equal(rollGroundItem(100, { rarity: 19, maxRarity: 19 }).rarity, expectedCap,
    `tier ${tier}: even a forced high-rarity roll respects the Rift cap`);
  for (let n = 0; n < 15; n++) assert.ok(rollGroundItem(100).rarity <= expectedCap, `tier ${tier}: random gear exceeded cap`);

  const gem = rollGroundGem(200);
  const gemLevelCap = Math.min(G.char.level, depthLevel(lootDepth) + 4);
  assert.ok(gem.ilvl <= gemLevelCap, `tier ${tier}: gem level exceeded progression`);
  assert.ok(gem.tier <= Math.min(7, Math.floor(gemLevelCap / 16)), `tier ${tier}: gem tier exceeded progression`);

  const maxSigil = sigilCap(lootDepth);
  for (let n = 0; n < 10; n++) assert.ok(rollSigil(lootDepth, 99).tier <= maxSigil, `tier ${tier}: sigil exceeded progression`);
  assert.equal(riftReward(tier, true).abyssal, 1, `tier ${tier}: first-clear premium roll remains guaranteed`);
  assert.equal(riftReward(tier, true).keys, tier >= 40 ? 2 : 1, `tier ${tier}: completion guarantees the intended key payout`);
}
assert.ok(qualityAtDepth(riftLootDepth(1)) < 19, 'first Rift cannot award Tier 20 gear');
assert.equal(riftLootDepth(16), RARITY[19].minDepth, 'Rift tier 16 reaches the existing Tier 20 unlock depth');
assert.equal(qualityAtDepth(riftLootDepth(15)), 18, 'Rift tier 15 remains below Tier 20');
assert.equal(qualityAtDepth(riftLootDepth(16)), 19, 'Tier 20 becomes eligible at Rift tier 16');
G.char.depth = FINAL_DEPTH;
G.world = { depth: FINAL_DEPTH, rift: { tier: 15 } };
assert.equal(makeCovenant(100), null, 'Covenant drops remain locked before the Rift reaches Tier 20 eligibility');
G.char.depth = 2000;
assert.equal(makeCovenant(100, { depth: G.char.depth }), null,
  'a high saved campaign depth and explicit caller depth cannot bypass low-tier Rift eligibility');
G.world.rift.tier = 16;
assert.equal(makeCovenant(100)?.rarity, 19, 'Covenant drops become eligible when Rift progression reaches the existing Tier 20 unlock');

// The generated exit anchor must be walkable for the player's full collision radius
// and connected to the start; the same helper is used by Rift generation.
const mockMap = {
  walkable: (x, y) => x >= 0.5 && x <= 2 && Math.abs(y) <= 1,
  circleFree: (x, y, r) => x - r >= 0.5 && x + r <= 2 && Math.abs(y) + r <= 1,
  findPath: (_sx, _sy, x, y, _nodes, r) => x - r >= 0.5 && x + r <= 2 && Math.abs(y) + r <= 1 ? [[x, y]] : null,
};
const exit = findReachableInteractableSpot(mockMap, [0.75, 0], 0.1, 0, 3, 0.25, 0.42);
assert.ok(exit, 'blocked portal anchor relocates to reachable walkable terrain');
assert.ok(mockMap.circleFree(...exit, 0.42), 'relocated portal respects player collision radius');
assert.ok(mockMap.findPath(0.75, 0, ...exit, 9000, 0.38), 'relocated portal remains reachable from the start');

const project = (x, y) => [x * 10, y * 10];
const completedExit = { x: 3, y: 2, type: 'exit', active: true };
assert.equal(activeExitSpriteAt([completedExit], 30, -50, 1, project), completedExit,
  'clicking the completed portal artwork selects the exit even if loot labels overlap it');
assert.equal(activeExitSpriteAt([{ ...completedExit, active: false }], 30, -50, 1, project), null,
  'sealed exits do not take priority over loot');

// Match the actual drawPortal() extents: 44.2 px floor ring radius and a
// raised glow reaching ~94 px above its anchor. Test the perimeter, not just
// one center point as the previous regression did.
const renderedPortal = { x: 0, y: 0, type: 'exit', active: true };
const screenAnchor = [400, 300], screenProject = () => screenAnchor;
for (const [dx, dy] of [[44, 0], [-44, 0], [0, -94], [0, 22]]) {
  assert.equal(portalSpriteHit(renderedPortal, screenAnchor[0] + dx, screenAnchor[1] + dy, 1, screenProject), true,
    `visible portal artwork at ${dx},${dy} is clickable`);
}
assert.equal(portalSpriteHit(renderedPortal, 455, 300, 1, screenProject), false, 'portal hit area remains bounded');

// Exercise the complete PC input path with loot covering the portal artwork,
// then open the real Rift results dialog and select its destination callback.
const run = { tier: 3, done: true, failed: false, exitPortal: null,
  result: { tier: 3, time: 40, jump: 1, next: 4, marks: 0 }, limit: 100 };
const actualExit = { x: 0, y: 0, type: 'exit', active: false, reach: 1.6, label: 'Sealed Exit', riftRun: run };
run.exitPortal = actualExit;
const riftWorld = { rift: run, portals: [actualExit], creatures: [], npcs: [], chests: [],
  map: { walkable: () => true }, biome: { id: 'rift' } };
assert.equal(exitPortalIsOpen(actualExit), true, 'completed run makes its linked exit targetable even if its sprite flag was stale');
assert.equal(activateRiftExit(riftWorld), true, 'completed run activates its registered exit');
assert.equal(actualExit.active, true);
assert.equal(actualExit.label, 'Exit');
const legacyExit = { x: 0, y: 0, type: 'exit', active: false };
const legacyRun = { done: true, failed: false };
assert.equal(activeExitSpriteAt([legacyExit], 444, 300, 1, screenProject, legacyRun), legacyExit,
  'completed existing Rift runs can target their exit even before a portal-to-run link is repaired');
assert.equal(activateRiftExit({ rift: legacyRun, portals: [legacyExit] }), true,
  'interaction repairs the link for an already-active Rift session');
assert.equal(legacyExit.riftRun, legacyRun);

const oldState = { W: G.W, H: G.H, dpr: G.dpr, touch: G.touch, world: G.world, char: G.char,
  player: G.player, ui: G.ui, paused: G.paused, cine: G.cine, zoom: camera.zoom,
  camX: camera.x, camY: camera.y, mouse: { ...input.mouse }, pointerType: input.lastPointerType,
  dialog: UI.dialog, enterRift: game.enterRift };
let dialogSpec = null, enteredTier = null;
try {
  G.W = 800; G.H = 600; G.dpr = 1; G.touch = false; G.world = riftWorld; G.paused = false; G.cine = false;
  G.char = { level: 100, depth: FINAL_DEPTH, classId: 'paladin', bar: [], rifts: { open: 4 } };
  G.ui = { modal: false, anyOpen: () => true };
  G.player = { dead: false, moveVec: [0, 0], moveTarget: null, path: null, attackTarget: null,
    interact: null, lootTarget: null, moving: false, bar: [], setMoveTarget() {} };
  camera.zoom = 1; camera.x = 0; camera.y = 0;
  input.lastPointerType = 'mouse';
  input.mouse = { x: 444, y: 300, left: false, right: false, leftPressed: true, rightPressed: false, inside: true };
  // The loot label deliberately overlaps the visual portal perimeter.
  G.lootBoxes = [{ x: 444, y: 300, w: 100, h: 60, loot: { x: 1, y: 1 } }];
  actualExit.use = () => game.useExit(riftWorld, actualExit);
  UI.dialog = (spec) => { dialogSpec = spec; return spec; };
  game.enterRift = (tier) => { enteredTier = tier; };
  controls.update(1 / 60);
  assert.equal(G.player.interact, actualExit, 'click selects the Rift exit ahead of an overlapping loot label');
  assert.equal(G.player.lootTarget, null, 'overlapping loot is not accidentally selected');
  G.player.interact.use();
  assert.match(dialogSpec.title, /Rift Tier 3 Closed/, 'click opens the Rift completion destination dialog');
  assert.equal(dialogSpec.buttons[0].label, 'Cancel', 'existing cancel action remains available');
  assert.equal(actualExit.active, true, 'opening the dialog does not consume the portal');
  dialogSpec.buttons[2].fn();
  assert.equal(enteredTier, 4, 'confirming destination selects the next unlocked Rift tier');
} finally {
  G.W = oldState.W; G.H = oldState.H; G.dpr = oldState.dpr; G.touch = oldState.touch;
  G.world = oldState.world; G.char = oldState.char; G.player = oldState.player; G.ui = oldState.ui;
  G.paused = oldState.paused; G.cine = oldState.cine; camera.zoom = oldState.zoom;
  camera.x = oldState.camX; camera.y = oldState.camY; input.mouse = oldState.mouse;
  input.lastPointerType = oldState.pointerType; UI.dialog = oldState.dialog; game.enterRift = oldState.enterRift;
  delete G.lootBoxes;
}

G.char = null;
G.world = null;
console.log('Abyssal Rift progression and exit regression tests passed.');
