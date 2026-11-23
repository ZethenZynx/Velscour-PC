import assert from 'node:assert/strict';
import { G } from '../../src/state.js';
import { itemSellValue, itemValue, qualityAtDepth, rollItem, RARITY_COMMON, tierOf } from '../../src/data/items.js';
import { COVENANTS, HEIRLOOMS, heirloomPreview, makeCovenant, makeHeirloom, migrateCovenantItem, relicBonuses, relicItemStats } from '../../src/data/relics.js';
import { riftLootDepth } from '../../src/data/rifts.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.addEventListener = () => {};

const Reliquary = await import('../../src/game/reliquary.js');
const oldCharHeirloom = makeHeirloom(90, { id: 'verdict' });
const oldCov = makeCovenant(72, { pieceId: 'templar_head', rarity: 3, maxRarity: 3 });
localStorage.setItem('velscour_saves_v1', JSON.stringify([{ id: 'legacy', bag: [oldCharHeirloom], equip: { head: oldCov } }]));
Reliquary.resetReliquaryCache();
const account = Reliquary.reliquary();
assert.ok(account.codex['h:verdict'], 'legacy owned Heirloom migrates to the shared Codex');
assert.equal(account.heirloomCodexMigrationV1, true, 'migration runs once and is versioned');

for (const spec of HEIRLOOMS) {
  const item = makeHeirloom(2500, { id: spec.id });
  assert.ok(item, `${spec.id} can be created`);
  assert.equal(item.ilvl, 1, `${spec.id} always has Tier 1 item level`);
  assert.equal(item.tier, tierOf(1), `${spec.id} uses ordinary Tier 1 material`);
  assert.equal(item.rarity, RARITY_COMMON, `${spec.id} has ordinary Tier 1 quality`);
  assert.equal(item.req, 1, `${spec.id} is equippable at level 1`);
  assert.equal(item.rid, spec.id);
  assert.ok(item.affixes.every((affix) => !affix.relic), `${spec.id} has no exclusive stat lines`);
  assert.deepEqual(relicItemStats(item), [], `${spec.id} has no unique power stats`);
  const bonuses = relicBonuses({ [item.slot]: item });
  assert.deepEqual(bonuses.stats, [], `${spec.id} has no unique set/stat bonuses`);
  assert.deepEqual(bonuses.procs, [], `${spec.id} has no special abilities`);
  assert.deepEqual(bonuses.legs, {}, `${spec.id} enables no legendary effect flags`);
  assert.equal(itemValue(item), 0, `${spec.id} has no vendor value`);
  assert.equal(itemSellValue(item), 0, `${spec.id} cannot generate sale gold`);
  const preview = heirloomPreview(spec.id);
  assert.equal(preview.ilvl, undefined, 'Codex preview does not roll an item or numerical stats');
  assert.equal(preview.affixes, undefined);
}

const unlocked = Reliquary.makeAccountHeirloom(100, { id: 'emberwake' });
assert.ok(unlocked && Reliquary.reliquary().codex['h:emberwake'], 'first eligible reward creates and unlocks exactly one account Heirloom');
assert.equal(Reliquary.makeAccountHeirloom(1, { id: 'emberwake' }), null, 'an unlocked Heirloom cannot drop again');
const savedRandom = Math.random;
const earlyWeapon = rollItem(1, { slot: 'weapon', rarity: RARITY_COMMON, base: 'mace', generic: true });
Math.random = () => 0;
const earlyHeirloom = Reliquary.maybeAccountRelic(earlyWeapon);
assert.equal(earlyHeirloom.relic, 'heir', 'early Tier 1 drops can discover an eligible Heirloom');
assert.equal(earlyHeirloom.ilvl, 1, 'low-depth Heirloom drop still has Tier 1 stats');
assert.ok(Reliquary.reliquary().codex['h:' + earlyHeirloom.rid], 'generated drop reserves its account discovery immediately');
Math.random = savedRandom;
const duplicateObject = JSON.stringify(oldCov);
assert.equal(migrateCovenantItem(oldCov), false, 'legacy Covenant migration is a no-op');
assert.equal(JSON.stringify(oldCov), duplicateObject, 'existing Covenant equipment is preserved unchanged');
const { newCharData, migrate } = await import('../../src/game/save.js');
const savedCharacter = newCharData('paladin', 'Legacy gear test');
const savedCovenant = makeCovenant(72, { pieceId: 'templar_head', rarity: 3, maxRarity: 3 });
savedCovenant.uid = 'preserved-covenant'; savedCovenant.upg = 2; savedCovenant.gems = [{ gem: 'ruby', tier: 1 }]; savedCovenant.sockets = 1;
const savedCovenantBefore = JSON.stringify(savedCovenant);
savedCharacter.bag[0] = savedCovenant;
migrate(savedCharacter);
assert.equal(JSON.stringify(savedCharacter.bag[0]), savedCovenantBefore, 'character save migration preserves existing Covenant item fields and stats');

for (const ilvl of [1, 15, 30, 72, 100, 250]) {
  const cov = makeCovenant(ilvl, { pieceId: 'templar_head', rarity: RARITY_COMMON, maxRarity: RARITY_COMMON });
  assert.ok(cov, `Covenant can drop at item level ${ilvl}`);
  assert.equal(cov.ilvl, ilvl, `Covenant preserves the actual drop item level ${ilvl}`);
  assert.equal(cov.tier, tierOf(ilvl), `Covenant uses the matching equipment tier at item level ${ilvl}`);
  assert.equal(cov.rarity, RARITY_COMMON, `Covenant respects eligible rarity at item level ${ilvl}`);
  assert.equal(cov.req, Math.min(ilvl, 100), `Covenant retains normal level requirement at item level ${ilvl}`);
}
const originalWorld = G.world;
G.world = { depth: 1 };
assert.equal(makeCovenant(100, { pieceId: 'templar_head' }).rarity, RARITY_COMMON, 'a deep character cannot bypass a campaign depth rarity cap');
G.world = { depth: 100, rift: { tier: 2 } };
const riftCovenant = makeCovenant(100, { pieceId: 'templar_head' });
assert.ok(riftCovenant.rarity <= qualityAtDepth(riftLootDepth(2)), 'a low-tier Rift cannot roll Covenant quality above its own progression');
G.world = originalWorld;

const twoSetPieces = Object.fromEntries(COVENANTS[0].pieces.slice(0, 2).map((piece) => [piece.slot, makeCovenant(25, { pieceId: piece.id, rarity: 1, maxRarity: 1 })]));
assert.ok(relicBonuses(twoSetPieces).stats.length > 0, 'Covenant set bonuses remain active for repeatable pieces');

console.log(`PASS: migrated legacy Heirlooms and validated ${HEIRLOOMS.length} Tier 1 Heirlooms, free copies, zero sale value, and Covenant tiers at six drop levels.`);
