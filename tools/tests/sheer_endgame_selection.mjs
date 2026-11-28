import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BIOME_BY_ID, biomesForDepth, biomeChoices, drawBiome, takeBiome } from '../../src/data/biomes.js';
import { phobosToken } from '../../src/data/phobosfamily.js';
import { SHEER } from '../../src/data/sheer.js';
import { generateDungeon } from '../../src/world/dungeon.js';

const depth = 101;
const sheerIds = SHEER.map(({ id }) => id);
const pool = biomesForDepth(depth);
const legacyPool = pool.filter((id) => !sheerIds.includes(id));
const rotationSize = new Set(pool.map(phobosToken)).size;
const total = 10_000;
const tileset = {
  bases: [0], features: [], floors: [{ name: 'test stone', lum: 0.5 }], families: ['test'],
  scatter: [], k: 1, pack: 'catacombs', arches: [], archSpan: {}, doors: [],
};

assert.equal(sheerIds.length, 10);
assert.ok(sheerIds.every((id) => pool.includes(id)), 'all ten dungeons belong to the live Infinite Endgame registry');

const newCharacter = { biomeBag: [], lastBiome: null };
const firstNewCharacterDraw = drawBiome(newCharacter, depth);
assert.ok(pool.includes(firstNewCharacterDraw));
assert.equal(newCharacter.biomeBag.length, rotationSize - 1, 'new characters begin with the full weighted endgame rotation');
const newCharacterExit = { biomeBag: [], lastBiome: null };
biomeChoices(newCharacterExit, depth, 3);
assert.equal(newCharacterExit.biomeBag.length, rotationSize, 'new-character exit choices retain the full weighted endgame rotation');

// Reproducible randomness makes both 10,000-selection runs repeatable.
const originalRandom = Math.random;
let randomState = 0x5eed1234;
Math.random = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
};

function countsFor(ids) { return Object.fromEntries(ids.map((id) => [id, 0])); }
function pct(count, denominator) { return (100 * count / denominator).toFixed(2); }
function legacyCharacter() { return { biomeBag: legacyPool.slice(), lastBiome: null }; }

try {
  // Exercise the town-entry automatic selector over persistent character state.
  const autoCharacter = legacyCharacter();
  const autoCounts = countsFor(pool);
  for (let i = 0; i < total; i++) {
    const id = drawBiome(autoCharacter, depth);
    assert.ok(pool.includes(id), `automatic selector returned unknown dungeon ${id}`);
    autoCounts[id]++;
    autoCharacter.lastBiome = id;
  }
  assert.equal(autoCharacter.sheerEndgamePoolVersion, 2, 'legacy saved destination bag was migrated once');
  for (const id of sheerIds) assert.ok(autoCounts[id] > 0, `${id} was never selected automatically`);

  // Exercise the exact candidate-list selector used by the cleared-exit portal, then
  // simulate selecting a card and spending it from the rotation as portalChoice does.
  const exitCharacter = legacyCharacter();
  const exitOptionCounts = countsFor(pool);
  const exitChosenCounts = countsFor(pool);
  let optionTotal = 0;
  for (let i = 0; i < total; i++) {
    const options = biomeChoices(exitCharacter, depth, 3);
    assert.ok(options.length >= 1 && options.length <= 3, 'exit selector returned an invalid card count');
    assert.equal(new Set(options).size, options.length, 'exit selector returned duplicate cards');
    for (const id of options) {
      assert.ok(pool.includes(id), `exit selector returned unknown dungeon ${id}`);
      exitOptionCounts[id]++;
      optionTotal++;
    }
    const selected = options[Math.floor(Math.random() * options.length)];
    exitChosenCounts[selected]++;
    takeBiome(exitCharacter, selected, depth);
    exitCharacter.lastBiome = selected;
  }
  assert.equal(exitCharacter.sheerEndgamePoolVersion, 2, 'exit portal migrated legacy saved destination bag once');
  for (const id of sheerIds) {
    assert.ok(exitOptionCounts[id] > 0, `${id} never appeared in an exit choice window`);
    assert.ok(exitChosenCounts[id] > 0, `${id} was never selected from an exit choice window`);
  }

  // Force each ID through each selector independently, then feed the selected registered
  // biome to the production dungeon generator. The generated map must retain its Sheer ID.
  let seed = 1;
  for (const id of sheerIds) {
    const auto = { biomeBag: [id], lastBiome: null, sheerEndgamePoolVersion: 2 };
    const autoId = drawBiome(auto, depth);
    assert.equal(autoId, id, `${id}: forced town selector destination`);
    const autoGen = generateDungeon(depth, BIOME_BY_ID[autoId], tileset, seed++ * 7919);
    assert.equal(autoGen.map.sheer.id, id, `${id}: town-selected dungeon did not load as Sheer terrain`);
    const autoReachable = autoGen.map.movementReachable(autoGen.start, 0.24);
    assert.ok(autoGen.map.movementCanReach(autoGen.start, autoGen.exit, 0.24, autoReachable), `${id}: town-selected exit is reachable`);

    const exit = { biomeBag: [id], lastBiome: null, sheerEndgamePoolVersion: 2 };
    const cards = biomeChoices(exit, depth, 3);
    assert.ok(cards.includes(id), `${id}: forced exit selector did not present a card`);
    const selected = cards.find((card) => card === id);
    takeBiome(exit, selected, depth);
    exit.nextBiome = selected;
    const resolved = BIOME_BY_ID[exit.nextBiome] || BIOME_BY_ID.catacombs;
    assert.equal(resolved.id, id, `${id}: exit destination silently fell back`);
    const exitGen = generateDungeon(depth, resolved, tileset, seed++ * 7919);
    assert.equal(exitGen.map.sheer.id, id, `${id}: exit-selected dungeon did not load as Sheer terrain`);
    const exitReachable = exitGen.map.movementReachable(exitGen.start, 0.24);
    assert.ok(exitGen.map.movementCanReach(exitGen.start, exitGen.exit, 0.24, exitReachable), `${id}: exit-selected destination is completable on foot`);
  }

  // Pin the production route wiring: town entry uses c.nextBiome/drawBiome and the exit
  // selector resolves each card through BIOME_BY_ID before entering the dungeon.
  const gameSource = await readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8');
  assert.match(gameSource, /biomeChoices\(c,\s*next,\s*3\)/, 'cleared exit uses the tested candidate selector');
  assert.match(gameSource, /c\.nextBiome\s*=\s*cd\.id;\s*takeBiome\(c,\s*cd\.id,\s*next\)/, 'exit selection persists and spends the selected destination');
  assert.match(gameSource, /BIOME_BY_ID\[destination\.id\]\s*\|\|\s*BIOME_BY_ID\.catacombs/, 'town destination resolves against the authoritative biome registry');

  console.log(`Eligible endgame dungeons: ${pool.length}; automatic destination draws: ${total}; exit windows: ${total}; exit card appearances: ${optionTotal}`);
  console.log('Dungeon | Town auto count (% of 10,000) | Exit cards (% of all cards) | Exit selected (% of 10,000)');
  for (const id of pool) {
    console.log(`${BIOME_BY_ID[id].name} (${id}) | ${autoCounts[id]} (${pct(autoCounts[id], total)}%) | ${exitOptionCounts[id]} (${pct(exitOptionCounts[id], optionTotal)}%) | ${exitChosenCounts[id]} (${pct(exitChosenCounts[id], total)}%)`);
  }
  console.log('Force-load verification: all ten Sheer dungeons loaded from both selection paths with their intended terrain IDs.');
} finally {
  Math.random = originalRandom;
}
