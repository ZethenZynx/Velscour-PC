import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { input } from '../../src/core/input.js';
import { controls } from '../../src/game/controls.js';

const loot = { x: 3, y: 4 };
const calls = [];
const player = {
  dead: false, castLock: 0, moveVec: [0, 0], moveTarget: null, path: null,
  attackTarget: null, interact: null, lootTarget: null, moving: false,
  setMoveTarget(x, y) { this.moveTarget = [x, y]; this.path = null; },
  tryUseSkill(skill, x, y, target) { calls.push({ id: skill.id, x, y, target }); return true; },
};

G.W = 800; G.H = 600; G.dpr = 1; G.touch = false; G.settings = { zoom: 1, skipCutscenes: false };
G.ui = { modal: false, anyOpen: () => false }; G.paused = false; G.cine = null; G.hover = null;
G.world = { kind: 'dungeon', creatures: [], portals: [], chests: [], npcs: [], rift: null };
G.player = player;
G.char = { classId: 'wizard', bar: Array(15).fill(null), macros: [] };
G.char.bar[0] = 'wizard.0.0'; G.char.bar[13] = 'wizard.0.1';
G.lootBoxes = [
  { x: 400, y: 300, w: 80, h: 36, loot },
  ...[420, 440, 460, 480, 500].map((x) => ({ x, y: 300, w: 42, h: 30, loot: { x: x / 100, y: 4 } })),
];

function prepare() {
  input.reset(); input.lastPointerType = 'mouse'; input.mouse.inside = true; input.mouse.x = 400; input.mouse.y = 300;
  controls.mode = 'move'; controls.holdLeft = 0; controls.leftCombatPress = false; controls.rightShiftPress = false;
  player.castLock = 0; player.moveTarget = null; player.path = null; player.attackTarget = null;
  player.interact = null; player.lootTarget = null; calls.length = 0;
}

prepare();
input.mouse.left = true; input.mouse.leftPressed = true;
controls.update(1 / 60);
assert.equal(player.lootTarget, loot, 'normal left click still selects ground loot');
assert.deepEqual(player.moveTarget, [loot.x, loot.y], 'normal loot pickup still moves toward the item');
assert.equal(calls.length, 0, 'normal loot click does not trigger a combat ability');

prepare();
input.keys.add('ShiftLeft'); input.mouse.left = true; input.mouse.leftPressed = true;
controls.update(1 / 60);
assert.equal(player.lootTarget, null, 'Shift+left ignores the ground loot label');
assert.equal(player.moveTarget, null, 'Shift+left cancels movement toward loot');
assert.equal(calls.at(-1)?.id, 'wizard.0.0', 'Shift+left activates the assigned primary ability');
controls.update(1 / 60);
assert.equal(calls.at(-1)?.id, 'wizard.0.0', 'holding Shift+left repeats the primary ability');
input.keys.delete('ShiftLeft'); controls.update(1 / 60);
assert.equal(player.lootTarget, null, 'releasing Shift during the same mouse press cannot start loot pickup');
assert.equal(calls.at(-1)?.id, 'wizard.0.0', 'primary attack continues after Shift is released while LMB remains held');
input.keys.add('ShiftRight'); controls.update(1 / 60); input.keys.delete('ShiftRight'); controls.update(1 / 60);
assert.equal(player.lootTarget, null, 'repeated Shift changes do not switch the held combat press into loot mode');
assert.equal(calls.at(-1)?.id, 'wizard.0.0', 'combat remains continuous while the cursor is over a loot label');
input.mouse.x = 480; controls.update(1 / 60);
assert.equal(player.lootTarget, null, 'moving the held combat cursor across stacked loot labels never starts pickup');
assert.equal(calls.at(-1)?.id, 'wizard.0.0', 'primary ability remains active while sweeping across loot labels');

input.mouse.left = false; controls.update(1 / 60);
input.mouse.left = true; input.mouse.leftPressed = true; controls.update(1 / 60);
assert.ok(player.lootTarget, 'a new intentional unmodified click can still select the item');
assert.deepEqual(player.moveTarget, [player.lootTarget.x, player.lootTarget.y], 'normal pickup still moves toward the selected item');

prepare();
input.keys.add('ShiftRight'); input.mouse.right = true; input.mouse.rightPressed = true;
player.lootTarget = loot; player.moveTarget = [loot.x, loot.y];
controls.update(1 / 60);
assert.equal(player.lootTarget, null, 'Shift+right cancels an existing loot target');
assert.equal(player.moveTarget, null, 'Shift+right cancels movement toward loot');
assert.equal(calls.at(-1)?.id, 'wizard.0.1', 'Shift+right activates the assigned secondary ability');
input.keys.delete('ShiftRight'); controls.update(1 / 60);
assert.equal(player.lootTarget, null, 'releasing Shift during a held RMB ability cannot start loot pickup');
assert.equal(calls.at(-1)?.id, 'wizard.0.1', 'RMB ability continues independently of later Shift changes');

input.reset();
assert.equal(input.down('ShiftRight'), false, 'input reset clears held Shift on focus loss');
assert.equal(input.mouse.left || input.mouse.right, false, 'input reset releases held mouse buttons on focus loss');
console.log('Shift combat priority and normal loot interaction checks passed.');
