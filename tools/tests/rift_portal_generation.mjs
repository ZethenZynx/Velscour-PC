// Non-browser integration check of Rift exit anchors in every eligible Rift biome.
import assert from 'node:assert/strict';
import { generateDungeon } from '../../src/world/dungeon.js';
import { BIOMES } from '../../src/data/biomes.js';
import { findReachableInteractableSpot } from '../../src/core/interactable-hit.js';
import { RIFT_DENSITY, riftDepth } from '../../src/data/rifts.js';

const candidates = BIOMES.filter((b) => !b.overworld && !b.beta && !b.challenge && !b.tower && !b.cave && b.id !== 'throne');
assert.ok(candidates.length > 0, 'Rift biome pool exists');
let checked = 0;
for (const biome of candidates) for (let seed = 1; seed <= 3; seed++) {
  // Geometry generation does not need loaded artwork; this minimal tileset supplies
  // the metadata consumed by the dungeon builder while retaining the real biome layout.
  const tileset = { split: 0, bases: [0], features: [0], floors: [{ lum: 0, name: 'test floor' }],
    families: ['crypt'], scatter: [], pack: biome.pack || 'crypt', k: 1, arches: {}, doors: {}, archSpan: {} };
  const gen = generateDungeon(riftDepth(seed), biome, tileset, seed * 991 + biome.id.length * 37,
    { rift: true, raid: true, small: true, density: RIFT_DENSITY });
  const exit = findReachableInteractableSpot(gen.map, gen.start, ...gen.exit);
  assert.ok(exit, `${biome.id} seed ${seed}: an accessible exit can be placed`);
  assert.ok(gen.map.walkable(...exit), `${biome.id} seed ${seed}: exit anchor is walkable`);
  assert.ok(gen.map.circleFree(...exit, 0.42), `${biome.id} seed ${seed}: exit clears player collision radius`);
  assert.ok(gen.map.findPath(...gen.start, ...exit, 9000, 0.38), `${biome.id} seed ${seed}: exit is reachable from start`);
  checked++;
}
console.log(`Abyssal Rift portal generation passed: ${checked} layouts across ${candidates.length} eligible environments.`);
