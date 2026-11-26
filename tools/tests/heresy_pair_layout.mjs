// Non-browser checks for paired Altar/Marks positions and title-bar drag offsets.
// Run: node tools/tests/heresy_pair_layout.mjs
import assert from 'node:assert/strict';
import { heresyPairLayout, singleEndgamePanelPosition, panelDragPosition, panelDragMovedFrom, isHeresyPairManagedPanel } from '../../src/ui/ui.js';
import { heresyModifierColumns } from '../../src/ui/heresies.js';

const columns = heresyModifierColumns();
assert.deepEqual(columns.map((column) => column.length), [10, 10, 10], 'all 30 modifiers occupy three columns of ten');
assert.equal(new Set(columns.flat().map((modifier) => modifier.id)).size, 30, 'each modifier appears exactly once');

const collapsedHeights = { heresies: 720, marks: 640 };
const expandedHeights = { heresies: 900, marks: 640 };
const wide = heresyPairLayout(1920, 1080, {}, collapsedHeights);
assert.equal(wide.stacked, false);
assert.ok(wide.panels.heresies.x < wide.panels.marks.x, 'the Altar is on the left');
assert.equal(wide.panels.marks.x - wide.panels.heresies.x - wide.panels.heresies.w, wide.gap, 'default gap is consistent');
assert.ok(Math.abs((wide.panels.heresies.x + wide.panels.marks.x + wide.panels.marks.w) / 2 - 960) < 1, 'the pair is horizontally centered');
assert.equal(wide.panels.heresies.y, wide.panels.marks.y, 'both windows share a centered top edge');
assert.equal(wide.panels.heresies.w, wide.panels.marks.w, 'the Marks window matches the Altar width');
assert.equal(wide.panels.heresies.h, wide.panels.marks.h, 'both windows share aligned top and bottom edges');

const compact = heresyPairLayout(1366, 768, {}, { heresies: 700, marks: 620 });
assert.equal(compact.stacked, false, 'a compact landscape resolution remains side by side when both fit');
for (const panel of Object.values(compact.panels)) {
  assert.ok(panel.x >= 0 && panel.y >= 0, 'panel starts inside the viewport');
  assert.ok(panel.x + panel.w <= 1366 && panel.y + panel.h <= 768, 'panel ends inside the viewport');
}
assert.equal(heresyPairLayout(700, 900).stacked, true, 'narrow layouts stack instead of overflowing');
const capped = heresyPairLayout(1920, 1080, {}, { heresies: 1400, marks: 640 });
assert.equal(capped.panels.heresies.h, 1056, 'small viewports cap oversized content to the visible area');

assert.ok(wide.panels.heresies.w >= 900, 'the Altar uses the available horizontal space');
assert.equal(wide.panels.marks.w, wide.panels.heresies.w, 'the Marks panel uses the Altar reference width');
assert.equal(wide.panels.heresies.h, collapsedHeights.heresies, 'collapsed Altar uses its natural content height');
assert.equal(wide.panels.marks.h, collapsedHeights.heresies, 'the Marks panel matches the Altar height');
const expanded = heresyPairLayout(1920, 1080, {}, expandedHeights);
assert.equal(expanded.panels.heresies.h, expandedHeights.heresies, 'expanded milestones increase the Altar height to fit content');
assert.equal(expanded.panels.marks.h, expandedHeights.heresies, 'the Marks panel grows with the Altar to keep edges aligned');
assert.ok(expanded.panels.heresies.y < wide.panels.heresies.y, 'default pair recenters vertically when Altar content expands');
assert.equal(expanded.panels.marks.y, expanded.panels.heresies.y, 'expanded pair remains aligned without overlap');
assert.deepEqual(singleEndgamePanelPosition(1920, 1080, 900, 800), { x: 510, y: 140 }, 'a standalone window is centered in both axes');
const saved = heresyPairLayout(1920, 1080, { heresies: { x: 0, y: 0.1 }, marks: { x: 0.99, y: 0.1 } }, collapsedHeights);
assert.equal(saved.panels.heresies.x, 0, 'valid saved Altar coordinates restore');
assert.equal(saved.panels.marks.x, 0.99 * (1920 - saved.panels.marks.w), 'saved Marks coordinates restore proportionally');
assert.equal(saved.panels.marks.y, 0.1 * (1080 - saved.panels.marks.h));
assert.ok(saved.panels.heresies.x + saved.panels.heresies.w <= saved.panels.marks.x, 'valid saved windows remain side by side');
const obsolete = heresyPairLayout(1920, 1080, { heresies: { x: 0.4, y: 0.2 }, marks: { x: 0.42, y: 0.2 } }, collapsedHeights);
assert.equal(obsolete.resetSavedPositions, true, 'overlapping legacy positions reset to the expanded defaults');
assert.equal(obsolete.panels.marks.x - obsolete.panels.heresies.x - obsolete.panels.heresies.w, obsolete.gap, 'legacy reset restores the default gap');
const clamped = heresyPairLayout(1366, 768, { heresies: { x: 2, y: -1 } }, { heresies: 720, marks: 640 });
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
