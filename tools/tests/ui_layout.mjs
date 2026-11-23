import assert from 'node:assert/strict';
import {
  activeLayoutMap, characterLayoutId, cloneLayoutValue, createDefaultLayoutState, effectiveLayoutEntry, layoutEditorRect, layoutParentScale,
  exportLayoutProfile, importLayoutProfile, migrateEnvironmentInfoLayout, migrateGroupedHudLayout, normalizeLayoutEntry, normalizeLayoutState,
  snapUILayoutPosition, writableLayoutEntry,
} from '../../src/ui/ui-layout.mjs';

const defaults = normalizeLayoutEntry();
assert.deepEqual(defaults, { x: null, y: null, width: null, height: null, scale: 100, opacity: 100, visible: true, locked: false, anchor: 'left', textAlign: 'left' });
assert.equal(normalizeLayoutEntry({ scale: 1000, opacity: -10 }).scale, 200);
assert.equal(normalizeLayoutEntry({ scale: 1000, opacity: -10 }).opacity, 10);
assert.equal(normalizeLayoutEntry({ textAlign: 'center' }).textAlign, 'center');
assert.equal(normalizeLayoutEntry({ textAlign: 'right' }).textAlign, 'right');
assert.equal(normalizeLayoutEntry({ textAlign: 'justify' }).textAlign, 'left', 'invalid alignment safely falls back to left');

const state = createDefaultLayoutState();
state.profiles.default.layouts.minimap = { x: .8, y: .05, scale: 125, opacity: 80 };
state.profiles.default.layouts['environment-info'] = { x: .24, y: .12, textAlign: 'center', scale: 110, opacity: 85 };
state.profiles.default.layouts['buff-icons'] = { x: .18, y: .41, scale: 125, opacity: 80, anchor: 'right', visible: true, locked: true };
state.profiles.default.layouts['debuff-icons'] = { x: .62, y: .57, scale: 90, opacity: 70, anchor: 'center', visible: true, locked: false };
const accountMap = activeLayoutMap(state, 'hero-a');
assert.equal(accountMap.minimap.scale, 125);
assert.equal(accountMap['environment-info'].textAlign, 'center', 'environment text alignment persists in the active layout');
state.characterSpecific = true;
const characterMap = activeLayoutMap(state, 'hero-a');
characterMap.minimap = { x: .3, y: .4, scale: 75, visible: false };
assert.equal(characterMap.minimap.visible, false);
assert.equal(activeLayoutMap(state, 'hero-b').minimap, undefined, 'character overrides stay isolated');
assert.equal(characterLayoutId({ id: 'hero-a', name: 'A' }), 'hero-a');
assert.equal(normalizeLayoutState(state).activeProfile, 'default');

const inheritedState = createDefaultLayoutState();
inheritedState.profiles.default.layouts['buff-icons'] = { x: .18, y: .41, scale: 125, opacity: 80, anchor: 'right', visible: true, locked: true };
inheritedState.profiles.default.layouts['debuff-icons'] = { x: .62, y: .57, scale: 90, opacity: 70, anchor: 'center', visible: true, locked: false };
inheritedState.profiles.default.layouts.minimap = {
  x: .7, y: .08, width: 320, height: 240, scale: 125, opacity: 65,
  visible: false, locked: true, anchor: 'right', textAlign: 'center',
};
inheritedState.profiles.alternate = { name: 'Alternate', layouts: { minimap: { x: .2, y: .3 } }, characterOverrides: {} };
inheritedState.characterSpecific = true;
const inherited = effectiveLayoutEntry(inheritedState, 'minimap', 'hero-a');
assert.equal(inherited.scale, 125, 'character layouts inherit account profile scale when they have no override');
assert.equal(inherited.opacity, 65, 'character layouts inherit account profile opacity');
assert.equal(inherited.visible, false, 'character layouts inherit account profile visibility');
assert.equal(inherited.locked, true, 'character layouts inherit account profile lock state');
assert.equal(inherited.anchor, 'right', 'character layouts inherit account profile anchoring');
assert.equal(inherited.textAlign, 'center', 'character layouts inherit account profile alignment');
assert.equal('attachment' in inherited, false, 'obsolete orb attachment preferences are no longer part of layout entries');
const characterEdit = writableLayoutEntry(inheritedState, 'minimap', 'hero-a');
characterEdit.x = .4;
assert.equal(inheritedState.profiles.default.layouts.minimap.x, .7, 'editing a character override does not mutate account layout');
assert.equal(effectiveLayoutEntry(inheritedState, 'minimap', 'hero-b').x, .7, 'other characters continue inheriting the account layout');
assert.equal(effectiveLayoutEntry(inheritedState, 'minimap', 'hero-a').x, .4, 'the active character override takes precedence');
inheritedState.activeProfile = 'alternate';
assert.equal(effectiveLayoutEntry(inheritedState, 'minimap', 'hero-a').x, .2, 'profile selection changes the inherited layout source');
inheritedState.activeProfile = 'default';
const persistedState = normalizeLayoutState(JSON.parse(JSON.stringify(inheritedState)));
assert.deepEqual(persistedState.profiles.default.layouts.minimap, inheritedState.profiles.default.layouts.minimap, 'account layout properties survive serialization and normalization');
assert.deepEqual(
  Object.fromEntries(['x', 'y', 'scale', 'opacity', 'anchor', 'visible', 'locked'].map((key) => [key, persistedState.profiles.default.layouts['buff-icons'][key]])),
  { x: .18, y: .41, scale: 125, opacity: 80, anchor: 'right', visible: true, locked: true },
  'buff position and display preferences survive save/load normalization',
);
assert.deepEqual(
  Object.fromEntries(['x', 'y', 'scale', 'opacity', 'anchor', 'visible', 'locked'].map((key) => [key, persistedState.profiles.default.layouts['debuff-icons'][key]])),
  { x: .62, y: .57, scale: 90, opacity: 70, anchor: 'center', visible: true, locked: false },
  'debuff preferences persist independently from buff preferences',
);
assert.notEqual(persistedState.profiles.default.layouts['buff-icons'].x, persistedState.profiles.default.layouts['debuff-icons'].x, 'buff and debuff positions never share one saved coordinate');
assert.deepEqual(persistedState.profiles.default.characterOverrides['hero-a'].minimap, characterEdit, 'character override properties survive serialization and normalization');
assert.equal(effectiveLayoutEntry(persistedState, 'minimap', 'hero-a').scale, 125, 'new character snapshots preserve inherited account settings');

const legacyOverrideState = normalizeLayoutState({
  characterSpecific: true,
  profiles: { default: {
    layouts: { minimap: { x: .7, y: .08, scale: 125, opacity: 65, visible: false, locked: true } },
    characterOverrides: { 'hero-old': { minimap: { x: .35, y: .4 } } },
  } },
});
assert.equal(effectiveLayoutEntry(legacyOverrideState, 'minimap', 'hero-old').x, .35, 'legacy character-specific positions remain selected');
assert.equal(effectiveLayoutEntry(legacyOverrideState, 'minimap', 'hero-old').scale, 125, 'legacy default-filled overrides inherit customized account scale');
assert.equal(effectiveLayoutEntry(legacyOverrideState, 'minimap', 'hero-old').opacity, 65, 'legacy default-filled overrides inherit customized account opacity');
assert.equal(effectiveLayoutEntry(legacyOverrideState, 'minimap', 'hero-old').visible, false, 'legacy default-filled overrides inherit customized account visibility');

const legacyState = createDefaultLayoutState();
legacyState.profiles.default.layouts['area-affixes'] = { x: .35, y: .16, scale: 110 };
legacyState.profiles.default.characterOverrides['hero-a'] = { 'area-affixes': { x: .6, y: .2, opacity: 70 } };
assert.equal(migrateEnvironmentInfoLayout(legacyState), true, 'legacy environment layouts migrate once');
assert.deepEqual(legacyState.profiles.default.layouts['environment-info'], legacyState.profiles.default.layouts['area-affixes']);
assert.deepEqual(legacyState.profiles.default.characterOverrides['hero-a']['environment-info'], legacyState.profiles.default.characterOverrides['hero-a']['area-affixes']);
assert.equal(migrateEnvironmentInfoLayout(legacyState), false, 'existing migrated positions are not overwritten');

const groupedLegacy = normalizeLayoutState({ profiles: { default: {
  layouts: {
    'main-action-bar': { x: .42, y: .88, scale: 125 }, 'ability-hotbar': { x: .7, y: .8, scale: 90 },
    'health-orb': { x: .1, y: .2, scale: 80 }, mana: { x: .9, y: .3, scale: 75 },
  },
  characterOverrides: { hero: { 'mana-orb': { x: .8, y: .4 }, health: { x: .2, y: .5 } } },
  characterOverrideFields: { hero: { 'mana-orb': ['x', 'y', 'attachment'], health: ['x', 'y'] } },
} } });
assert.equal(migrateGroupedHudLayout(groupedLegacy), true, 'legacy separately positioned orb settings are migrated out');
const grouped = groupedLegacy.profiles.default;
assert.deepEqual([grouped.layouts['main-action-bar'].x, grouped.layouts['main-action-bar'].y, grouped.layouts['main-action-bar'].scale], [.42, .88, 125], 'existing action bar placement and scale take priority');
for (const obsolete of ['health-orb', 'mana-orb', 'health', 'mana', 'ability-hotbar']) assert.equal(obsolete in grouped.layouts, false, `${obsolete} legacy layout is removed`);
for (const obsolete of ['mana-orb', 'health']) assert.equal(obsolete in grouped.characterOverrides.hero, false, `${obsolete} character override is removed`);
assert.equal('attachment' in grouped.characterOverrideFields.hero, false, 'legacy attachment field metadata is removed');
assert.equal(migrateGroupedHudLayout(groupedLegacy), false, 'grouped HUD migration is idempotent');

const actualBox = { left: 123.5, top: 46.25, width: 386.75, height: 91.5 };
assert.deepEqual(layoutEditorRect(actualBox), actualBox, 'editor outline uses the live transformed viewport box without scaling or offset approximations');
assert.equal(layoutEditorRect({ left: 0, top: 0, width: 0, height: 20 }), null, 'unmeasurable elements do not receive guessed placeholder dimensions');
assert.deepEqual(layoutParentScale({ width: 300, height: 75 }, 200, 50), { x: 1.5, y: 1.5 }, 'nested editing converts between CSS and viewport dimensions through parent scaling');
assert.deepEqual(layoutParentScale({ width: 300, height: 50 }, 200, 50), { x: 1.5, y: 1 }, 'nonuniform parent scaling is preserved per axis');

const exported = exportLayoutProfile(state);
const imported = importLayoutProfile(exported);
assert.equal(imported.layouts.minimap.scale, 125);
assert.equal(imported.layouts['environment-info'].textAlign, 'center', 'environment alignment survives profile export and import');
assert.equal(imported.characterOverrides['hero-a'].minimap.scale, 75);
assert.throws(() => importLayoutProfile({ format: 'other', version: 1, profile: {} }), /supported Velscour/);
assert.deepEqual(importLayoutProfile(JSON.stringify(exported)), imported, 'JSON export/import round trips');

const grid = snapUILayoutPosition(53, 39, 100, 80, { width: 800, height: 600 }, { snapGrid: true, grid: 16 });
assert.deepEqual({ x: grid.x, y: grid.y }, { x: 48, y: 32 }, 'drag positions snap to the selected grid');
const edge = snapUILayoutPosition(4, 5, 180, 80, { width: 800, height: 600 }, { snapEdges: true });
assert.deepEqual({ x: edge.x, y: edge.y }, { x: 0, y: 0 }, 'panels snap to screen edges');
const neighbor = snapUILayoutPosition(202, 103, 100, 50, { width: 800, height: 600 }, { snapNeighbors: true }, [{ left: 100, top: 50, right: 200, bottom: 100, width: 100, height: 50 }]);
assert.deepEqual({ x: neighbor.x, y: neighbor.y }, { x: 200, y: 100 }, 'panels snap to neighboring edges');
assert.ok(neighbor.guides.length > 0, 'alignment guides are produced for neighbor snapping');
const clamped = snapUILayoutPosition(-200, 900, 180, 80, { width: 800, height: 600 });
assert.deepEqual({ x: clamped.x, y: clamped.y }, { x: 0, y: 520 }, 'panels stay reachable after a resize or invalid imported position');

console.log('Passed UI layout defaults, scale bounds, profile persistence, character overrides, import/export, snap guides, and screen-boundary checks.');
