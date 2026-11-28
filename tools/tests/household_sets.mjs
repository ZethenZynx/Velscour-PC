// Castle Velscour Household set contract: explicit family pieces are save-safe,
// retain the fork's rarity/itemization path, and the ordinary Covenant pool does
// not begin dropping Castle-only equipment in unrelated areas.
import assert from 'node:assert/strict';
globalThis.localStorage = (() => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key), key: (i) => [...values.keys()][i] ?? null, get length() { return values.size; } };
})();
const { COVENANTS, COVENANT_BY_ID, PIECE_BY_ID, makeCovenant, relicBonuses } = await import('../../src/data/relics.js');
const { maybeAccountRelic } = await import('../../src/game/reliquary.js');

const household = ['v_gold', 'v_red', 'v_blue', 'v_green'];
const ids = new Set();
for (const setId of household) {
  const set = COVENANT_BY_ID[setId];
  assert.ok(set?.castleVelscour, `${setId} Castle-only marker`);
  assert.equal(set.pieces.length, 5, `${setId} five equipment slots`);
  assert.equal(new Set(set.pieces.map((piece) => piece.slot)).size, 5, `${setId} slots are unique`);
  assert.ok(set.bonus.length >= 3, `${setId} retains the 2/3/4-piece bonus tiers`);
  const equipment = {};
  for (const piece of set.pieces) {
    assert.equal(PIECE_BY_ID[piece.id]?.set, setId, `${piece.id} is registered`);
    assert.ok(!ids.has(piece.id), `${piece.id} is unique`);
    ids.add(piece.id);
    const item = makeCovenant(100, { pieceId: piece.id, rarity: 3, maxRarity: 3, depth: 100 });
    assert.ok(item, `${piece.id} creates`);
    assert.equal(item.relic, 'cov');
    assert.equal(item.rid, piece.id);
    assert.equal(item.cset, setId);
    assert.equal(item.rarity, 3, 'new set pieces stay at the fork Covenant rarity');
    const saveCopy = JSON.parse(JSON.stringify(item));
    assert.equal(saveCopy.rid, item.rid);
    assert.equal(saveCopy.cset, item.cset);
    equipment[piece.slot] = saveCopy;
  }
  const worn = relicBonuses(equipment);
  assert.ok(worn.stats.length >= 3, `${setId} applies its five-piece stats`);
  assert.ok(worn.procs.length || Object.keys(worn.legs).length, `${setId} power resolves through existing effect hooks`);
}

// The unqualified random Covenant roll remains in the original non-Castle pool.
for (let i = 0; i < 500; i++) {
  const item = makeCovenant(80);
  assert.ok(item && !household.includes(item.cset), 'ordinary Covenant selection excludes Castle sets');
}
assert.equal(COVENANTS.filter((set) => set.castleVelscour).length, 4);
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  const source = { type: 'gear', slot: 'body', ilvl: 100, rarity: 3 };
  const castleDrop = maybeAccountRelic(source, 1, { depth: 100, castleVelscour: true, castleWingColor: 'blue' });
  assert.equal(castleDrop.cset, 'v_blue', 'Castle loot selects the wing-associated Household set');
  assert.equal(castleDrop.slot, 'body', 'set conversion preserves the originally rolled slot');
  const ordinaryDrop = maybeAccountRelic(source, 0, { depth: 100, biome: { id: 'catacombs' } });
  assert.notEqual(ordinaryDrop.cset, 'v_blue', 'non-Castle loot cannot receive a Household set');
} finally { Math.random = originalRandom; }
console.log(`PASS Household equipment: ${household.length} sets, ${ids.size} unique pieces, save round-trips and bonus resolution`);
