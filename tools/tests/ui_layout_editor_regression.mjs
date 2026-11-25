import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDefaultLayoutState, normalizeLayoutState } from '../../src/ui/ui-layout.mjs';

const [source, styles, html, gameSource, mainSource] = await Promise.all([
  readFile(new URL('../../src/ui/layoutcustomizer.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/main.js', import.meta.url), 'utf8'),
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
assert.match(source, /migrateGroupedHudLayout\(state\)/, 'legacy HUD layout entries migrate to the new grouped elements');
assert.match(source, /\['main-action-bar', 'Main Action Bar', '#hud-bar'/, 'the actual action bar is customized as one grouped element');
assert.doesNotMatch(source, /\['(?:ability-hotbar|experience|experience-value|health-value|mana-value)'/, 'grouped child elements are no longer independently registered');
assert.match(source, /data-custom-field="anchor"/, 'buff and debuff groups expose their own anchor selector');
assert.match(source, /data-custom-field="textAlign"/, 'environment information exposes a persisted text alignment selector');
assert.match(source, /node\.style\.textAlign = entry\?\.textAlign \|\| 'left'/, 'saved environment text alignment is applied to the complete grouped element');
assert.match(source, /record\.type === 'attributes'/, 'the layout observer continues to restore visibility and class changes');
assert.match(source, /if \(insertedNodes\.length\) for \(const \[id, , selector\] of DEFINITIONS\)/, 'late-created customizable elements receive their saved layout');
assert.match(source, /const reinserted = node && insertedNodes\.some\(\(added\) => added === node \|\| \(added\.nodeType === 1 && added\.contains\(node\)\)\)/, 'reused UI elements receive their layout again when moved back into the DOM');
assert.match(source, /this\.visibilityObserver\?\.observe\(node, \{ attributes: true, attributeFilter: \['class', 'style'\] \}\)/, 'registered roots track both visibility and inline layout resets');
assert.match(source, /const appliedStyleText = new WeakMap\(\)/, 'layout manager records its own last-applied styles to avoid observer feedback loops');
assert.match(source, /record\.attributeName !== 'style' \|\| layoutStyleWasReset\(record\.target\)/, 'external position and size resets trigger one centralized layout restore');
assert.match(source, /record\.target\.contains\?\.\(child\)/, 'parent HUD class or style changes restore child layout overrides');
assert.match(source, /observe\(document\.body, \{ attributes: true, attributeFilter: \['class'\] \}\)/, 'viewport-wide body layout mode changes restore customized positions');
assert.match(source, /effective\(id, state = this\.state\) \{ return effectiveLayoutEntry\(state, id, characterLayoutId\(G\.char\)\)/, 'customizable UI resolves the active character override with profile-wide fallback');
assert.match(source, /entry\(id\) \{ const state = this\.state; return writableLayoutEntry\(state, id, characterLayoutId\(G\.char\)\)/, 'editing an inherited layout creates a character-specific copy without changing the account profile');
assert.match(source, /const state = this\.state, def = DEFAULTS\.get\(id\), entry = this\.effective\(id, state\)/, 'startup and dynamic UI application use the same resolved saved entry');
assert.match(source, /applyAll\(\) \{ for \(const \[id\] of DEFINITIONS\) this\.applyElement\(id\); \}/, 'every registered UI element is restored through the centralized manager');
assert.ok(mainSource.indexOf('loadSettings();') < mainSource.indexOf('HUD.init();') && mainSource.indexOf('HUD.init();') < mainSource.indexOf('applyUILayoutSettings();'), 'saved settings load before HUD creation and initial layout application');
assert.doesNotMatch(source, /\['(?:health-orb|mana-orb)'/, 'health and mana orbs are not independently registered');
assert.doesNotMatch(source, /\['panel-[^']+'/, 'temporary interaction windows are not registered as HUD elements');
assert.match(source, /layoutEditorRect\(node\.getBoundingClientRect\(\)\)/, 'outlines use the actual transformed viewport rectangle');
assert.match(source, /left: `\$\{rect\.left\}px`, top: `\$\{rect\.top\}px`, width: `\$\{rect\.width\}px`, height: `\$\{rect\.height\}px`/, 'outline position and dimensions are copied exactly from the actual UI');
assert.doesNotMatch(source, /innerWidth \* dx|innerHeight \* dy|present \? rect\.width : 156/, 'placeholders do not fall back to guessed coordinates or dimensions');
assert.match(source, /this\.bind\(\); this\.applyAll\(\); this\.renderAll\(\)/, 'saved transforms are applied before the editor measures HUD elements');
const uiManager = await readFile(new URL('../../src/ui/ui.js', import.meta.url), 'utf8');
assert.doesNotMatch(uiManager, /registerElement\(\{ id: layoutId/, 'temporary panels are not dynamically added to Customize UI');
assert.match(html, /id="hud-bar"[\s\S]*id="life-orb-group"[\s\S]*id="life-cover"[\s\S]*id="life-text"[\s\S]*id="mana-orb-group"[\s\S]*id="mana-cover"[\s\S]*id="mana-text"[\s\S]*id="hud-slots"/, 'both resource groups and their values are descendants of the unified Main Action Bar');
assert.match(styles, /\.ui-layout-item \{[^}]*box-sizing: border-box/, 'outline borders are included in their measured dimensions');
const startChar = gameSource.match(/startChar\(c, fresh\)\s*\{([\s\S]*?)\n\s*\},\s*autosave/);
assert.ok(startChar, 'character startup lifecycle is present');
const showHudAt = startChar[1].indexOf('HUD.show(true)');
const enterTownAt = startChar[1].indexOf('this.enterTown()');
const applyCalls = [...startChar[1].matchAll(/applyUILayoutSettings\(\)/g)].map((match) => match.index);
assert.ok(showHudAt >= 0 && enterTownAt > showHudAt, 'HUD and initial environment are initialized before the final layout pass');
assert.ok(applyCalls.some((index) => index > enterTownAt), 'saved UI layout is reapplied after character entry has exposed and arranged HUD elements');
for (const action of ['save', 'undo', 'redo', 'reset-selected', 'reset-all', 'cancel']) assert.match(source, new RegExp(`data-editor-action="${action}"`), `${action} control is inside the editor panel`);
assert.match(source, /Your interface layout has been saved and applied\./, 'saving confirms the applied layout');
assert.match(styles, /\.screen\.ui-layout-screen[^\n]*pointer-events: none/, 'empty editor overlay areas let underlying interface elements receive input');
assert.match(styles, /\.screen\.ui-layout-pause-hidden\s*\{\s*display:\s*none/, 'hidden pause menu does not cover the editor');
assert.match(styles, /\.ui-layout-toolbox[^\n]*top: 50%[^\n]*transform: translate\(-50%, -50%\)/, 'editor panel opens centered on screen');
assert.match(styles, /\.ui-layout-toolbox header[^\n]*cursor: move/, 'the panel header advertises its drag affordance');
assert.match(styles, /\.ui-layout-toolbox-actions[^\n]*flex: 0 0 auto/, 'the editor action controls remain fixed while panel content scrolls');
assert.doesNotMatch(styles, /\.ui-layout-dialog > \.row/, 'the separate bottom toolbar is removed');
assert.match(html, /class="hud-environment-info"[\s\S]*id="area-name"[\s\S]*id="area-sub"[\s\S]*id="area-affixes"/, 'environment name, description, and affixes share one movable group');

const definitionBlock = source.slice(source.indexOf('const DEFINITIONS = ['), source.indexOf('const DEFAULTS'));
const registeredIds = [...definitionBlock.matchAll(/\['([^']+)',\s*'([^']+)'/g)].map((match) => match[1]);
assert.ok(registeredIds.length >= 15, 'persistent HUD elements are registered centrally');
assert.equal(new Set(registeredIds).size, registeredIds.length, 'every customizable HUD element has a unique persistent identifier');
const allElementsState = createDefaultLayoutState();
for (const [index, id] of registeredIds.entries()) allElementsState.profiles.default.layouts[id] = {
  x: .1 + index / 100, y: .2 + index / 100, width: 280 + index, height: 90 + index,
  scale: 125, opacity: 75, visible: index % 2 === 0, locked: index % 3 === 0,
  anchor: 'right', textAlign: 'center',
};
const restoredAllElements = normalizeLayoutState(JSON.parse(JSON.stringify(allElementsState)));
for (const id of registeredIds) assert.deepEqual(restoredAllElements.profiles.default.layouts[id], allElementsState.profiles.default.layouts[id], `${id} retains position, size, scale, opacity, visibility, anchoring and alignment after persistence`);

console.log('Passed editor outline reuse, drag lifecycle, environment information grouping, persistent movable toolbox, pause-menu visibility, and in-panel controls checks.');
