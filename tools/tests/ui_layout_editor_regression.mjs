import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, styles, html] = await Promise.all([
  readFile(new URL('../../src/ui/layoutcustomizer.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../../index.html', import.meta.url), 'utf8'),
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
assert.match(source, /uiLayoutEditorPosition = \{ x: clamp\(rect\.left \/ innerWidth/, 'the editor panel position persists after a drag');
assert.match(source, /restoreToolboxPosition\(\)/, 'saved editor panel position is restored');
assert.match(source, /this\.pauseScreen\?\.classList\.add\('ui-layout-pause-hidden'\)/, 'the pause menu is hidden during customization');
assert.match(source, /this\.pauseScreen\?\.classList\.remove\('ui-layout-pause-hidden'\)/, 'the pause menu is restored on exit');
assert.match(source, /Environment Information/, 'environment details are registered as one named layout element');
assert.match(source, /migrateEnvironmentInfoLayout\(state\)/, 'legacy environment-affix positioning is migrated without deleting old data');
for (const action of ['save', 'undo', 'redo', 'reset-selected', 'reset-all', 'cancel']) assert.match(source, new RegExp(`data-editor-action="${action}"`), `${action} control is inside the editor panel`);
assert.match(source, /Your interface layout has been saved and applied\./, 'saving confirms the applied layout');
assert.match(styles, /\.screen\.ui-layout-screen[^\n]*pointer-events: none/, 'empty editor overlay areas let underlying interface elements receive input');
assert.match(styles, /\.screen\.ui-layout-pause-hidden\s*\{\s*display:\s*none/, 'hidden pause menu does not cover the editor');
assert.match(styles, /\.ui-layout-toolbox[^\n]*top: 50%[^\n]*transform: translate\(-50%, -50%\)/, 'editor panel opens centered on screen');
assert.match(styles, /\.ui-layout-toolbox header[^\n]*cursor: move/, 'the panel header advertises its drag affordance');
assert.match(styles, /\.ui-layout-toolbox-actions[^\n]*flex: 0 0 auto/, 'the editor action controls remain fixed while panel content scrolls');
assert.doesNotMatch(styles, /\.ui-layout-dialog > \.row/, 'the separate bottom toolbar is removed');
assert.match(html, /class="hud-environment-info"[\s\S]*id="area-name"[\s\S]*id="area-sub"[\s\S]*id="area-affixes"/, 'environment name, description, and affixes share one movable group');

console.log('Passed editor outline reuse, drag lifecycle, environment information grouping, persistent movable toolbox, pause-menu visibility, and in-panel controls checks.');
