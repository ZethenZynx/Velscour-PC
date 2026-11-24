import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AFFIXES, GEMS, LEGENDARY } from '../../src/data/items.js';
import { POWERS } from '../../src/data/relics.js';
import { buildEquipmentStatReport } from '../../src/game/statbreakdown.mjs';

const baseSt = {
  str: 34, dex: 90, vit: 22, int: 18,
  armor: 725, lifeRegen: 11.5, manaRegen: 8.2,
  res: { fire: 92, cold: 51, light: 33, poison: 76, magic: 18 },
  rawCritChance: 91, critChance: 75, critOver: 13, critDmg: 76,
  rawAtkSpeed: 178, atkSpeed: 150, rawCastSpeed: 120, castSpeed: 120,
  rawMoveSpeed: 96, moveSpeed: 80, rawBlock: 67, block: 60,
  rawReduce: 73, reduce: 60, rawCdr: 84, cdr: 60,
  dmgPct: 29, physPct: 12, elemPct: { fire: 21, cold: 0, light: 3, poison: 0, arcane: 7, holy: 0, shadow: 0, blood: 0, acid: 0 },
  lifeSteal: 4.5, manaSteal: 1, goldFind: 80, magicFind: 35, xpPct: 9, bossDmg: 12,
  drops: 0, thorns: 21, areaPct: 5, projSpeed: 0, extraProj: 0.34, pierce: 0,
  chainPlus: 0, splitChance: 0, echoChance: 3, skillsAll: 0, skillTree0: 0, skillTree1: 0, skillTree2: 0, skillTree3: 0,
  equipmentAudit: {
    armor: 420,
    stats: { str: 10, dex: 12, allAttr: 2, critChance: 10, resFire: 20, resAll: 5, reduce: 18, cdr: 24, life: 30, mana: 5, firePct: 9 },
    bySlot: {
      weapon: { name: 'Keen Blade', armor: 0, stats: { critChance: 6, dex: 4, resFire: 20 } },
      ring1: { name: 'Jade Band', armor: 0, stats: { critChance: 4, dex: 8, allAttr: 2 } },
    },
    setStats: { resAll: 5, reduce: 6 },
    combinedInputs: { str: 10, dex: 12, allAttr: 2, critChance: 10 },
    formulaInputs: {
      critChance: { raw: 91, convertedOverflow: 13 }, atkSpeed: 178, castSpeed: 120,
      moveSpeed: 96, block: 67, reduce: 73, cdr: 84,
    },
  },
};
const player = { st: baseSt, maxHp: 12345, maxMana: 678, buffs: [] };
const character = { attrs: { str: 20, dex: 30, vit: 10, int: 10 }, equip: {} };
const report = buildEquipmentStatReport(player, character);
const metric = (key) => report.rows.find((row) => row.key === key);

assert.equal(metric('critChance').rawEquipment, 10 + (12 + 2) * 0.1, 'crit gear includes direct chance and Dexterity-derived chance');
assert.equal(metric('critChance').combined, 91, 'pre-cap chance uses the runtime formula input');
assert.equal(metric('critChance').effective, 75, 'critical chance uses the live capped value');
assert.equal(metric('critChance').excess, 16, 'chance over the hard cap is distinguished from the converted portion in the note');
assert.equal(metric('critChance').wasted, 3, 'only the unconverted critical chance is reported as wasted');
assert.match(metric('critChance').overCapText, /13% converts to \+26% critical damage; 3% is wasted/);
assert.match(metric('critChance').note, /13 percentage points.*convert to \+26% critical damage/);
assert.equal(metric('resFire').rawEquipment, 25, 'element resistance includes the all-resistance set and item bonuses');
assert.equal(metric('resFire').combined, 92);
assert.equal(metric('resFire').effective, 75);
assert.equal(metric('resFire').excess, 17);
assert.equal(metric('atkSpeed').cap, 150);
assert.equal(metric('atkSpeed').excess, 28);
assert.equal(metric('moveSpeed').cap, 80);
assert.equal(metric('reduce').effective, 60);
assert.equal(metric('cdr').excess, 24);
assert.equal(metric('critChance').capState, 'over');
assert.equal(metric('block').capState, 'over');
assert.equal(metric('goldFind').capState, 'uncapped');
assert.equal(metric('goldFind').cap, null, 'uncapped stats are represented as No Cap by the UI');
assert.equal(metric('maxHealth').effective, 12345);
assert.equal(metric('maxMana').effective, 678);
assert.equal(report.affixRows.flatMap((group) => group.rows).length >= AFFIXES.length, true);
for (const affix of AFFIXES) assert.ok(report.affixRows.some((group) => group.rows.some((row) => row.key === affix.s)), `zero and populated modifier ${affix.s} is listed`);
const allEquipmentKeys = new Set([
  ...AFFIXES.map((affix) => affix.s),
  ...Object.values(GEMS).flatMap((gem) => (gem.stats || []).map(([key]) => key)),
  ...Object.values(LEGENDARY).flatMap((power) => (power.stats || []).map(([key]) => key)),
  ...Object.values(POWERS).flatMap((power) => [...(power.stats || []).map(([key]) => key), ...(power.legs || []).flatMap((flag) => (LEGENDARY[flag]?.stats || []).map(([key]) => key))]),
]);
for (const key of allEquipmentKeys) assert.ok(report.affixRows.some((group) => group.rows.some((row) => row.key === key)), `gem/legendary/set power modifier ${key} is listed, even at zero`);
assert.deepEqual(report.affixRows.find((group) => group.id === 'critical').rows.find((row) => row.key === 'critChance').sources.map((source) => source.slot), ['weapon', 'ring1']);
assert.equal(report.affixRows.find((group) => group.id === 'armor').rows.find((row) => row.key === 'reduce').sources.at(-1).slot, 'set', 'Covenant set bonus is a separate contributor');
assert.deepEqual(report.metricGroups.flatMap((group) => group.metrics.map((row) => row.key)).sort(), report.rows.map((row) => row.key).sort(), 'every live total is assigned to one breakdown category');
assert.equal(new Set(report.metricGroups.map((group) => group.id)).size, report.metricGroups.length, 'breakdown category identifiers are unique');
const atCapSt = structuredClone(baseSt); atCapSt.rawMoveSpeed = 80; atCapSt.moveSpeed = 80; atCapSt.equipmentAudit.formulaInputs.moveSpeed = 80;
assert.equal(buildEquipmentStatReport({ st: atCapSt, maxHp: 1, maxMana: 1 }, character).rows.find((row) => row.key === 'moveSpeed').capState, 'at', 'a stat exactly at its live cap is marked at-cap');
const nearCapSt = structuredClone(baseSt); nearCapSt.rawMoveSpeed = 75; nearCapSt.moveSpeed = 75; nearCapSt.equipmentAudit.formulaInputs.moveSpeed = 75;
assert.equal(buildEquipmentStatReport({ st: nearCapSt, maxHp: 1, maxMana: 1 }, character).rows.find((row) => row.key === 'moveSpeed').capState, 'approaching', 'a stat within ten percent of its live cap is marked approaching');

// Verify a save/load-style reconstruction: the UI report reads newly recomputed live stats and
// a fresh audit, rather than persisting a stale presentation snapshot in character save data.
const loadedSt = structuredClone(baseSt);
loadedSt.critChance = 70; loadedSt.rawCritChance = 70; loadedSt.critOver = 0;
const afterLoad = buildEquipmentStatReport({ st: loadedSt, maxHp: 12000, maxMana: 700 }, structuredClone(character));
assert.equal(metric('critChance').effective, 75);
assert.equal(afterLoad.rows.find((row) => row.key === 'critChance').effective, 70);

const inventorySource = readFileSync(new URL('../../src/ui/inventory.js', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
for (const control of ['Expand All', 'Collapse All', 'Show Overcapped Stats', 'Show Capped Stats', 'Hide Zero-Value Stats']) assert.ok(inventorySource.includes(control), `Character & Stats exposes ${control}`);
assert.match(inventorySource, /Search stats or bonuses/);
assert.match(inventorySource, /Overcapped Stats \(/);
assert.match(inventorySource, /data-jump-stat/);
for (const state of ['below', 'approaching', 'at', 'over']) assert.ok(styleSource.includes(`cap-${state}`), `cap state ${state} has a visual style`);

console.log(`Equipment stat breakdown passed: ${AFFIXES.length} equipment affixes present, cap stages and source attribution verified.`);
