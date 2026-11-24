// Shared NPC speech bubble regression checks; Node only, no browser or game launch.
import { strict as assert } from 'node:assert';
import { G } from '../../src/state.js';
import { camera } from '../../src/core/view.js';
import { clampSpeechBubble, drawTownSpeech, townSpeechDuration, wrapTownSpeech } from '../../src/game/townspeech.js';

const text = 'The northern watch has found a safe passage beyond the old bridge, but the road is watched by creatures from the marsh.';
const measure = (s) => s.length * 6;
const lines = wrapTownSpeech(text, 72, measure);
assert(lines.length > 2, 'long messages should wrap beyond two lines');
assert.equal(lines.join(' ').replace(/\s+/g, ' ').trim(), text, 'wrapping must retain every word');
assert(lines.every((line) => measure(line) <= 72), 'wrapped lines must fit their width');
const brokenToken = 'A'.repeat(40);
const brokenLines = wrapTownSpeech(brokenToken, 24, measure);
assert.equal(brokenLines.join(''), brokenToken, 'unbroken text must also be retained');
assert(brokenLines.every((line) => measure(line) <= 24), 'long tokens must wrap within the width');
assert(townSpeechDuration(text) > 4.6, 'reading duration must grow beyond the former hard cap');

G.W = 800; G.H = 600; camera.x = 0; camera.y = 0; camera.zoom = 1;
G.world = { npcs: [] }; G.player = null;
const ctx = {
  globalAlpha: 1, font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
  fillStyle: '', strokeStyle: '', lineWidth: 1, written: [],
  save() {}, restore() {}, measureText(s) { return { width: measure(s) }; },
  beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, stroke() {},
  fillText(s) { this.written.push(s); },
};
const npc = { talkText: text, talkT: 2, talkAge: 0 };
drawTownSpeech(ctx, npc, 390, 170);
assert(npc.bubbleRect, 'a bubble rectangle should be recorded');
const bounds = camera.viewRect();
assert(npc.bubbleRect[0] >= bounds.x0 + 4 && npc.bubbleRect[2] <= bounds.x1 - 4, 'bubble must stay within horizontal viewport bounds');
assert(npc.bubbleRect[1] >= bounds.y0 + 4 && npc.bubbleRect[3] <= bounds.y1 - 4, 'bubble must stay within vertical viewport bounds');
assert.equal(ctx.written.join(' ').replace(/\s+/g, ' ').trim(), text, 'renderer must draw every line');
assert(npc.talkT >= townSpeechDuration(text), 'short requested timers must be extended to the reading duration');

const [x, y] = clampSpeechBubble(-900, -900, 120, 80, bounds);
assert(x >= bounds.x0 + 8 && y >= bounds.y0 + 8, 'placement helper clamps bubbles at top and left edges');
console.log(`Town speech: ${lines.length} wrapped lines, full text retained, ${npc.talkT.toFixed(2)}s read time, viewport clamp passed.`);
