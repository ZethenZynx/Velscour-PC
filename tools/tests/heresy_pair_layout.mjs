// Non-browser checks for paired Altar/Marks positions and title-bar drag offsets.
// Run: node tools/tests/heresy_pair_layout.mjs
import assert from 'node:assert/strict';
import { heresyPairLayout, panelDragPosition, panelDragMovedFrom, isHeresyPairManagedPanel } from '../../src/ui/ui.js';

const wide = heresyPairLayout(1920, 1080);
assert.equal(wide.stacked, false);
assert.ok(wide.panels.heresies.x < wide.panels.marks.x, 'the Altar is on the left');
assert.equal(wide.panels.marks.x - wide.panels.heresies.x - wide.panels.heresies.w, wide.gap, 'default gap is consistent');
assert.ok(Math.abs((wide.panels.heresies.x + wide.panels.marks.x + wide.panels.marks.w) / 2 - 960) < 1, 'the pair is horizontally centered');
assert.equal(wide.panels.heresies.y, wide.panels.marks.y, 'both windows share a centered top edge');

const compact = heresyPairLayout(1366, 768);
assert.equal(compact.stacked, false, 'a compact landscape resolution remains side by side when both fit');
for (const panel of Object.values(compact.panels)) {
  assert.ok(panel.x >= 0 && panel.y >= 0, 'panel starts inside the viewport');
  assert.ok(panel.x + panel.w <= 1366 && panel.y + panel.h <= 768, 'panel ends inside the viewport');
}
assert.equal(heresyPairLayout(700, 900).stacked, true, 'narrow layouts stack instead of overflowing');

const saved = heresyPairLayout(1920, 1080, { marks: { x: 0.75, y: 0.25 } });
assert.equal(saved.panels.heresies.x, wide.panels.heresies.x, 'an untouched window keeps the default position');
assert.equal(saved.panels.marks.x, 0.75 * (1920 - saved.panels.marks.w), 'saved coordinates restore proportionally');
assert.equal(saved.panels.marks.y, 0.25 * (1080 - saved.panels.marks.h));
const clamped = heresyPairLayout(1366, 768, { heresies: { x: 2, y: -1 } });
assert.ok(clamped.panels.heresies.x + clamped.panels.heresies.w <= 1366, 'saved horizontal positions clamp on resize');
assert.ok(clamped.panels.heresies.y >= 0, 'saved vertical positions clamp on resize');

const host = { left: 120, top: 80 }, offset = { x: 26, y: 11 };
assert.deepEqual(panelDragPosition(356, 241, host, offset), { x: 210, y: 150 }, 'a stationary title click preserves the exact window position');
assert.deepEqual(panelDragPosition(376, 271, host, offset), { x: 230, y: 180 }, 'dragging moves the panel by the pointer delta without a jump');
assert.equal(panelDragMovedFrom({ x: 210, y: 150 }, panelDragPosition(356, 241, host, offset)), false, 'clicking without pointer motion never starts a position update');
assert.equal(panelDragMovedFrom({ x: 210, y: 150 }, panelDragPosition(376, 271, host, offset)), true, 'a real pointer delta starts a drag');
assert.equal(isHeresyPairManagedPanel('panel-marks', true), true, 'the layout customizer cannot override the paired Marks window');
assert.equal(isHeresyPairManagedPanel('panel-heresies', true), true, 'the layout customizer cannot override the paired Altar window');
assert.equal(isHeresyPairManagedPanel('panel-vendor', true), false, 'vendor layout remains under normal customization');

console.log('Altar/Marks layout defaults, responsive bounds, persisted coordinates, click-without-drag behavior, and drag offsets passed.');
