import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { camera, isoX, isoY } from '../../src/core/view.js';
import { Cine } from '../../src/game/cinema.js';

G.W = 1400; G.H = 700; G.dpr = 1; G.touch = false; G.settings.zoom = 1.15;
G.world = { creatures: [] };
G.player = { x: 4, y: 7 };
camera.zoomK = 0.72; camera.leadX = 0; camera.leadY = 0;
camera.x = 0; camera.y = 0; camera.computeZoom(); camera.follow(G.player.x, G.player.y, 0, true);
const initialCameraX = camera.x, initialCameraY = camera.y;

assert.equal(G.settings.skipCutscenes, false, 'Cutscene skipping remains opt-in by default');

// The enabled setting must resolve a full scripted scene synchronously without
// running camera, wait, or until playback, but must complete state and dialogue callbacks.
G.settings.skipCutscenes = true;
let actions = 0, starts = 0, ends = 0, outerEnd = 0, untilCalls = 0;
Cine.play([
  { cam: { x: 900, y: -500, zoom: 0.25, dur: 6 } },
  { do: () => { actions++; camera.x = 900; camera.y = -500; camera.zoom = 0.25; camera.shakeAmt = 15; } },
  { say: { name: 'Guide', text: 'The entrance opens.', onStart: () => starts++, onEnd: () => ends++ }, dur: 99 },
  { wait: 99 },
  { until: () => { untilCalls++; return true; }, max: 99 },
], () => outerEnd++);
assert.equal(actions, 1, 'Gameplay/event state actions run exactly once');
assert.equal(starts, 1, 'Skipped dialogue start callback runs once');
assert.equal(ends, 1, 'Skipped dialogue completion callback runs once');
assert.equal(outerEnd, 1, 'Scene completion callback runs once');
assert.equal(untilCalls, 0, 'Skipped timed conditions are not polled');
assert.equal(Cine.active, false); assert.equal(G.cine, false);
assert.equal(Cine.steps.length, 0); assert.equal(Cine.bars, 0); assert.equal(G.zoomFlux, false);
assert.equal(camera.x, initialCameraX, 'Skipped camera actions do not move the camera');
assert.equal(camera.y, initialCameraY, 'Skipping does not snap the camera abruptly');
assert.equal(camera.zoom, G.settings.zoom, 'Player zoom is preserved; scene zoom is never displayed');
assert.equal(camera.shakeAmt, 0, 'Scripted camera shake is skipped');
let nestedDo = 0, nestedEnd = 0;
Cine.play([{ wait: 30 }], () => Cine.play([{ do: () => nestedDo++ }], () => nestedEnd++));
assert.equal(nestedDo, 1, 'A scene queued by a completion callback is resolved');
assert.equal(nestedEnd, 1, 'Nested scene completion is called exactly once');

// Enabling skip during a running cutscene drains its remainder without replaying
// the already-entered step or animating the camera any further.
G.settings.skipCutscenes = false;
let firstDo = 0, remainderDo = 0, appendedDo = 0, resumedStart = 0, resumedEnd = 0, resumedComplete = 0, appendedComplete = 0;
Cine.play([
  { do: () => firstDo++ },
  { wait: 60 },
  { say: { name: 'Scout', text: 'Ready.', onStart: () => resumedStart++, onEnd: () => resumedEnd++ }, dur: 60 },
  { cam: { x: -800, y: 400, zoom: 2, dur: 30 } },
  { do: () => { remainderDo++; camera.x = -800; camera.y = 400; } },
], () => resumedComplete++);
Cine.play([
  { cam: { x: 700, y: 700, zoom: 2.5, dur: 20 } },
  { do: () => { appendedDo++; camera.x = 700; camera.y = 700; } },
], () => appendedComplete++);
Cine.update(0.016);
assert.equal(Cine.active, true, 'Normal mode still plays the scene');
G.settings.skipCutscenes = true;
Cine.update(0.016);
assert.equal(firstDo, 1, 'Already executed state action is not repeated');
assert.equal(remainderDo, 1, 'Remaining gameplay state action completes');
assert.equal(appendedDo, 1, 'Queued scene state action completes');
assert.equal(resumedStart, 1); assert.equal(resumedEnd, 1); assert.equal(resumedComplete, 1);
assert.equal(appendedComplete, 1, 'Queued scene completion callback runs once');
assert.equal(Cine.active, false); assert.equal(G.cine, false);
assert.equal(camera.x, initialCameraX);
assert.equal(camera.zoom, G.settings.zoom);

// Central camera policy suppresses region focus offsets and automatic zoom
// while preserving the player's selected zoom setting.
camera.zoomK = 0.5; camera.leadX = 500; camera.leadY = 300; camera.computeZoom();
assert.equal(camera.zoom, G.settings.zoom, 'Automatic region zoom is disabled');
camera.follow(G.player.x, G.player.y, 0, true);
assert.equal(camera.x, isoX(G.player.x, G.player.y), 'Scripted focus offsets are ignored');
assert.equal(camera.y, isoY(G.player.x, G.player.y) - 24);
G.settings.skipCutscenes = false; camera.computeZoom();
assert.equal(camera.zoom, G.settings.zoom * 0.5, 'Normal environment zoom is preserved when the option is off');
camera.leadX = 0; camera.leadY = 0; camera.zoomK = 1; camera.computeZoom();
const startX = camera.x, startZoom = camera.zoom;
Cine.play([{ cam: { x: startX + 240, y: camera.y + 120, zoom: 0.6, dur: 1, wait: true } }]);
Cine.update(0.5);
Cine.update(0.25);
assert.equal(Cine.active, true, 'Normal camera transitions still play when skipping is off');
assert.notEqual(camera.x, startX, 'Normal camera pan remains available');
assert.notEqual(camera.zoom, startZoom, 'Normal cinematic zoom remains available');
Cine.abort();
assert.equal(Cine.active, false);

console.log('Cutscene skip integration checks passed: synchronous state completion, no camera playback, player tracking, and normal-mode compatibility.');
