import assert from 'node:assert/strict';
import { HERRINGTON_TOWN_MAP_COLORS as colors, herringtonTownMapColor } from '../../src/gfx/mapcolors.js';

const transitionPairs = ['dirt__concrete', 'grass__dirt', 'grass__gravel'];
const town = { kind: 'town', biome: { id: 'town' } };
assert.equal(herringtonTownMapColor(town, 0, transitionPairs), colors.grass, 'grass uses the Wilds reference green');
assert.equal(herringtonTownMapColor(town, 1, transitionPairs), colors.gravel, 'gravel uses a muted bronze');
assert.equal(herringtonTownMapColor(town, 2, transitionPairs), colors.dirt, 'dirt paths use the established earth brown');
assert.equal(herringtonTownMapColor(town, 3, transitionPairs), colors.mud, 'mud remains distinct from paths');
assert.equal(herringtonTownMapColor(town, 4, transitionPairs), colors.stone, 'stone is warmed from the shared grey');
assert.equal(herringtonTownMapColor(town, 5, transitionPairs), colors.concrete, 'concrete is a muted warm grey');
assert.equal(herringtonTownMapColor(town, 6, transitionPairs), '#7c6751', 'mixed floor transitions blend the two material colors');
assert.equal(herringtonTownMapColor(town, 1, transitionPairs, true), colors.boundary, 'blocked buildings and boundaries use dark brown');
assert.equal(herringtonTownMapColor({ kind: 'dungeon', biome: { id: 'town' } }, 1, transitionPairs), null, 'dungeons never use the town-only palette');
assert.equal(herringtonTownMapColor({ kind: 'town', biome: { id: 'act2_town' } }, 1, transitionPairs), null, 'Act II town never uses the Act I palette');
assert.equal(herringtonTownMapColor({ kind: 'town', biome: { id: 'tkeep' } }, 1, transitionPairs), null, "Tessariel's Keep never uses the Act I palette");

const styles = [];
const ctx = new Proxy({}, {
  get: (_target, key) => (...args) => {},
  set: (_target, key, value) => { if (key === 'fillStyle') styles.push(value); return true; },
});
globalThis.document ||= { addEventListener() {}, fonts: { check: () => true }, createElement: () => ({ getContext: () => ctx }) };
globalThis.window ||= { addEventListener() {} };
globalThis.Image ||= class { addEventListener() {} set src(_value) {} };
const { drawMinimap } = await import('../../src/game/render.js');
const { G } = await import('../../src/state.js');
G.settings.tabMapTransparency = 0;
const map = {
  w: 4, h: 2, t: Uint8Array.from([1, 1, 1, 1, 0, 1, 0, 0]),
  v: Uint8Array.from([0, 1, 2, 4, 0, 5, 0, 0]), seen: new Uint8Array(8).fill(1),
  seenVersion: 1, seenDirty: [], minimapTerrainVersion: 0,
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; },
};
const world = { ...town, map, player: { x: 0.5, y: 0.5 }, townTiles: Array.from({ length: 6 }, () => ({})), portals: [], chests: [], npcs: [], creatures: [], depthQuests: [] };
const canvas = { width: 220, height: 160, getContext: () => ctx };
drawMinimap(world, 0.21, canvas, true); // TAB map
for (const color of [colors.grass, colors.gravel, colors.dirt, colors.stone, colors.concrete, colors.boundary]) {
  assert.ok(styles.includes(color), `TAB map draws Herrington Hollow color ${color}`);
}
styles.length = 0;
drawMinimap(world, 0.21, canvas, false); // HUD minimap
assert.ok(styles.includes(colors.grass) && styles.includes(colors.dirt) && styles.includes(colors.boundary), 'HUD minimap shares the Herrington Hollow palette');

console.log('Herrington Hollow palette tests passed for town materials, transition tiles, boundaries, TAB map, minimap, and area isolation.');
