import assert from 'node:assert/strict';
import {
  activeLayoutMap, characterLayoutId, cloneLayoutValue, createDefaultLayoutState,
  exportLayoutProfile, importLayoutProfile, migrateEnvironmentInfoLayout, normalizeLayoutEntry, normalizeLayoutState,
  snapUILayoutPosition,
} from '../../src/ui/ui-layout.mjs';

const defaults = normalizeLayoutEntry();
assert.deepEqual(defaults, { x: null, y: null, width: null, height: null, scale: 100, opacity: 100, visible: true, locked: false, anchor: 'left', attachment: 'attached' });
assert.equal(normalizeLayoutEntry({ scale: 1000, opacity: -10 }).scale, 200);
assert.equal(normalizeLayoutEntry({ scale: 1000, opacity: -10 }).opacity, 10);

const state = createDefaultLayoutState();
state.profiles.default.layouts.minimap = { x: .8, y: .05, scale: 125, opacity: 80 };
const accountMap = activeLayoutMap(state, 'hero-a');
assert.equal(accountMap.minimap.scale, 125);
state.characterSpecific = true;
const characterMap = activeLayoutMap(state, 'hero-a');
characterMap.minimap = { x: .3, y: .4, scale: 75, visible: false };
assert.equal(characterMap.minimap.visible, false);
assert.equal(activeLayoutMap(state, 'hero-b').minimap, undefined, 'character overrides stay isolated');
assert.equal(characterLayoutId({ id: 'hero-a', name: 'A' }), 'hero-a');
assert.equal(normalizeLayoutState(state).activeProfile, 'default');

const legacyState = createDefaultLayoutState();
legacyState.profiles.default.layouts['area-affixes'] = { x: .35, y: .16, scale: 110 };
legacyState.profiles.default.characterOverrides['hero-a'] = { 'area-affixes': { x: .6, y: .2, opacity: 70 } };
assert.equal(migrateEnvironmentInfoLayout(legacyState), true, 'legacy environment layouts migrate once');
assert.deepEqual(legacyState.profiles.default.layouts['environment-info'], legacyState.profiles.default.layouts['area-affixes']);
assert.deepEqual(legacyState.profiles.default.characterOverrides['hero-a']['environment-info'], legacyState.profiles.default.characterOverrides['hero-a']['area-affixes']);
assert.equal(migrateEnvironmentInfoLayout(legacyState), false, 'existing migrated positions are not overwritten');

const exported = exportLayoutProfile(state);
const imported = importLayoutProfile(exported);
assert.equal(imported.layouts.minimap.scale, 125);
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
