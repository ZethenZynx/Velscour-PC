import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, styles] = await Promise.all([
  readFile(new URL('../../src/ui/layoutcustomizer.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
]);

const renderAll = source.match(/renderAll\(refresh = true\)\s*\{([\s\S]*?)\n  \},\n\n  renderGuides/);
assert.ok(renderAll, 'layout editor has a shared overlay refresh method');
assert.doesNotMatch(renderAll[1], /overlayNodes\.clear\(/, 'refresh keeps existing outlines instead of recreating them');
assert.match(source, /let box = this\.overlayNodes\.get\(id\)/, 'each outline is reused by its stable element id');
assert.match(source, /before: clone\(this\.state\), changed: false/, 'a drag captures one pre-drag snapshot');
assert.match(source, /this\.pushUndo\(p\.before\)/, 'undo history records the completed drag as one action');
assert.match(source, /event\.buttons !== undefined && \(event\.buttons & 1\) === 0/, 'drag stops if the button is no longer held');
assert.match(source, /window\.addEventListener\('blur', this\.pointerUp\)/, 'window focus loss ends outline dragging');
assert.match(source, /startToolboxDrag\(event\)/, 'the editor panel can be dragged');
assert.match(source, /this\.pauseScreen\?\.classList\.add\('ui-layout-pause-hidden'\)/, 'the pause menu is hidden during customization');
assert.match(source, /this\.pauseScreen\?\.classList\.remove\('ui-layout-pause-hidden'\)/, 'the pause menu is restored on exit');
assert.match(source, /label: 'Save & Apply'/, 'a prominent Save & Apply action exists');
assert.match(source, /label: 'Cancel'/, 'a cancel action exists');
assert.match(source, /Your interface layout has been saved and applied\./, 'saving confirms the applied layout');
assert.match(styles, /\.screen\.ui-layout-screen[^\n]*pointer-events: none/, 'empty editor overlay areas let underlying interface elements receive input');
assert.match(styles, /\.screen\.ui-layout-pause-hidden\s*\{\s*display:\s*none/, 'hidden pause menu does not cover the editor');
assert.match(styles, /\.ui-layout-toolbox[^\n]*top: calc\(\(100vh - 72px\) \/ 2\)/, 'editor panel opens centered above the fixed action bar');
assert.match(styles, /\.ui-layout-toolbox header[^\n]*cursor: move/, 'the panel header advertises its drag affordance');

console.log('Passed editor outline reuse, drag lifecycle, pause-menu visibility, movable centered toolbox, and persistent save/cancel control checks.');
