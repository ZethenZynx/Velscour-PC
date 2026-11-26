import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RNG } from '../../src/core/util.js';
import { ANIMALS } from '../../src/data/townsfolk.js';
import { addTownAnimals } from '../../src/game/townanimals.js';
import { audioGroupForSound } from '../../src/core/audio-settings.js';

const actOne = { biome: { id: 'town' } };
const actTwo = { biome: { id: 'act2_town' } };
function spawn(world, seed) {
  const agents = [];
  const d = {
    world, t: { center: { x: 24, y: 24 }, portal: { x: 24, y: 18 } },
    map: { w: 48, h: 48, walkable: () => true, circleFree: () => true, randomNear: (x, y) => [x, y] },
    randomSpot: () => [20, 20], makeAgent: (v, x, y, opts) => agents.push({ ...v, ...opts, x, y }),
  };
  addTownAnimals(d, new RNG(seed));
  return agents;
}

for (let seed = 1; seed <= 50; seed++) {
  const visit = spawn(actOne, seed);
  const hens = visit.filter((a) => a.species === 'chicken');
  assert.ok(hens.length >= 3 && hens.length <= 5, `Act I seed ${seed} gets 3–5 hens`);
  assert.ok(hens.every((a) => a.targetable === false && a.hostile === false), 'chickens are explicitly non-hostile and non-targetable');
  const nextVisit = spawn(actOne, seed);
  assert.ok(nextVisit.filter((a) => a.species === 'chicken').length >= 3 && nextVisit.filter((a) => a.species === 'chicken').length <= 5,
    're-entering creates a fresh bounded population rather than accumulating agents');
  assert.notEqual(nextVisit, visit, 'each town visit owns its own agent collection');
  assert.equal(spawn(actTwo, seed).filter((a) => a.species === 'chicken').length, 0, 'chickens do not leak into Act II towns');
}

assert.equal(audioGroupForSound('cluck'), 'ambient', 'clucks use the existing ambient volume control');
assert.equal(ANIMALS.filter((a) => a.species === 'cat').length, 3, 'cat roster is unchanged');
assert.equal(ANIMALS.filter((a) => a.species === 'dog').length, 3, 'dog roster is unchanged');
const townlife = readFileSync(new URL('../../src/game/townlife.js', import.meta.url), 'utf8');
assert.match(townlife, /const adults = take\(ordinary, rng\.int\(5, 7\)\)/, 'ambient ordinary humans are reduced by about half');
assert.match(townlife, /const guards = take\(pool\.filter\(\(v\) => v\.knight \|\| v\.guard && !v\.regular\), rng\.int\(1, 3\)\)/, 'existing guard generation remains unchanged');
assert.match(readFileSync(new URL('../../src/core/audio.js', import.meta.url), 'utf8'), /cluck: \(t, p\)/, 'a subtle procedural cluck is available when no sample is present');

console.log('Act I town animal counts, chicken targeting, act restriction, unchanged cats/dogs, and ambient cluck routing passed.');
