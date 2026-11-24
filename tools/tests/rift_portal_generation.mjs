// Non-browser validation: Rift layouts retain an accessible town portal and no exit portal dependency.
import assert from 'node:assert/strict';
import { generateDungeon } from '../../src/world/dungeon.js';
import { BIOMES } from '../../src/data/biomes.js';
import { RIFT_DENSITY, riftDepth } from '../../src/data/rifts.js';

const candidates = BIOMES.filter((b) => !b.overworld && !b.beta && !b.challenge && !b.tower && !b.cave && b.id !== 'throne');
assert.ok(candidates.length > 0, 'Rift biome pool exists');
let checked = 0;
for (const biome of candidates) for (let seed = 1; seed <= 3; seed++) {
  const tileset = { split: 0, bases: [0], features: [0], floors: [{ lum: 0, name: 'test floor' }],
    families: ['crypt'], scatter: [], pack: biome.pack || 'crypt', k: 1, arches: {}, doors: {}, archSpan: {} };
  const gen = generateDungeon(riftDepth(seed), biome, tileset, seed * 991 + biome.id.length * 37,
    { rift: true, raid: true, small: true, density: RIFT_DENSITY });
  const townPortal = gen.townPortal || gen.map.randomNear(gen.start[0], gen.start[1], 2);
  assert.ok(gen.map.walkable(...townPortal), `${biome.id} seed ${seed}: town portal anchor is walkable`);
  assert.ok(gen.map.circleFree(...townPortal, 0.42), `${biome.id} seed ${seed}: town portal clears player collision radius`);
  assert.ok(gen.map.findPath(...gen.start, ...townPortal, 9000, 0.38), `${biome.id} seed ${seed}: town portal is reachable`);
  checked++;
}
console.log(`Abyssal Rift town portal accessibility passed: ${checked} layouts across ${candidates.length} eligible environments.`);
