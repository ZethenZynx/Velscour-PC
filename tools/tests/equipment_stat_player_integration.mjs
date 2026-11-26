import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { Player } = await import('../../src/game/player.js');
const { G } = await import('../../src/state.js');
const { gemStats } = await import('../../src/data/items.js');
const { buildEquipmentStatReport } = await import('../../src/game/statbreakdown.mjs');

const emptyEquip = () => Object.fromEntries(['weapon', 'offhand', 'head', 'body', 'hands', 'legs', 'feet', 'ring1', 'ring2', 'ring3', 'ring4'].map((slot) => [slot, null]));
const item = (slot, affixes = [], extras = {}) => ({ type: 'gear', slot, rarity: 5, ilvl: 80, upg: 0, affixes, gems: [], sockets: 0, dmg: slot === 'weapon' ? [20, 30] : undefined, armor: ['weapon', 'ring1', 'ring2', 'ring3', 'ring4'].includes(slot) ? 0 : 30, ...extras });
const character = () => ({ id: 'stat-test', classId: 'paladin', level: 40, xp: 0, attrs: { str: 20, dex: 30, vit: 15, int: 10 }, equip: emptyEquip(), talents: {}, skills: {}, cleared: {}, depth: 101, deepest: 101 });
const createPlayer = (c) => { G.char = c; G.world = { kind: 'dungeon', depth: c.depth, dungeonAffixes: [] }; return new Player(c); };
const jadeCrit = gemStats('jade', 2, 'weapon').find(([key]) => key === 'critChance')[1];
const expectedCritGear = 20 + 12 + jadeCrit + 1;

const c = character();
c.equip.weapon = item('weapon', [{ s: 'critChance', v: 20 }, { s: 'dex', v: 10 }], { gems: [{ gem: 'jade', tier: 2 }] });
c.equip.ring1 = item('ring', [{ s: 'critChance', v: 12 }, { s: 'cdr', v: 10 }]);
c.equip.ring1 = { ...c.equip.ring1, slot: 'ring1' };
c.equip.head = item('head', [{ s: 'resFire', v: 30 }, { s: 'reduce', v: 20 }], { relic: 'cov', cset: 'templar', rid: 'templar_head' });
c.equip.body = item('body', [{ s: 'resAll', v: 25 }, { s: 'reduce', v: 20 }], { relic: 'cov', cset: 'templar', rid: 'templar_body' });
let p = createPlayer(c);
let report = buildEquipmentStatReport(p, c);
const stat = (key) => report.rows.find((row) => row.key === key);
assert.equal(stat('critChance').rawEquipment, expectedCritGear, 'weapon, ring and gem contributions come through the real item stat collector');
assert.equal(stat('resFire').rawEquipment, 30 + 25, 'item and Covenant set resistance lines are included in equipment totals');
assert.ok(p.st.equipmentAudit.setStats.holyPct > 0, 'wearing two Covenant pieces contributes a set bonus to the audit');
assert.ok(report.affixRows.flatMap((group) => group.rows).find((row) => row.key === 'holyPct').sources.some((source) => /Vows of the Ashen Templar/.test(source.name)), 'Covenant set lines identify the originating set');
assert.equal(stat('cdr').rawEquipment, 10);
assert.ok(report.affixRows.find((group) => group.id === 'critical').rows.some((row) => row.key === 'critChance' && row.sources.some((source) => source.slot === 'weapon')));

// Temporary sources alter the displayed live total without being misattributed to equipment.
p.buffs.push({ stats: { crit: 40, reduce: 15, speed: 10 } });
p.recompute();
report = buildEquipmentStatReport(p, c);
assert.equal(stat('critChance').rawEquipment, expectedCritGear);
assert.ok(stat('critChance').combined > stat('critChance').rawEquipment, 'active buff is included in combined raw crit chance');
assert.ok(stat('reduce').combined > stat('reduce').rawEquipment, 'active defensive buff is reflected in the live total');

// Unequipping updates the live report immediately and leaves no stale source line.
c.equip.ring1 = null;
p.recompute();
report = buildEquipmentStatReport(p, c);
assert.equal(stat('critChance').rawEquipment, 20 + jadeCrit + 1);
assert.ok(!report.affixRows.flatMap((group) => group.rows).find((row) => row.key === 'cdr').sources.some((source) => source.slot === 'ring1'));

// Saving/loading retains the actual gear and gems; recomputing a new Player rebuilds the audit.
const loaded = JSON.parse(JSON.stringify(c));
p = createPlayer(loaded);
report = buildEquipmentStatReport(p, loaded);
assert.equal(stat('resFire').rawEquipment, 55);
assert.ok(report.audit.bySlot.weapon.stats.critChance > 0);
assert.deepEqual(loaded.equip.weapon.gems, [{ gem: 'jade', tier: 2 }]);

const rogue = character();
rogue.classId = 'rogue';
rogue.equip.weapon = item('weapon', [{ s: 'atkSpeed', v: 8 }]);
rogue.equip.offhand = item('weapon', [{ s: 'atkSpeed', v: 5 }]);
p = createPlayer(rogue);
report = buildEquipmentStatReport(p, rogue);
assert.ok(report.audit.specialSources.some((source) => source.name === 'Dual-wielding two weapons'));
assert.equal(report.rows.find((row) => row.key === 'atkSpeed').rawEquipment, 8 + 5 + 12, 'dual-wield bonus is reported as equipment-related, alongside direct weapon modifiers');

const capped = character();
capped.equip.head = item('head', [
  { s: 'critChance', v: 100 }, { s: 'atkSpeed', v: 200 }, { s: 'castSpeed', v: 200 },
  { s: 'moveSpeed', v: 200 }, { s: 'block', v: 200 }, { s: 'reduce', v: 200 },
  { s: 'cdr', v: 200 }, { s: 'resFire', v: 200 },
]);
p = createPlayer(capped);
report = buildEquipmentStatReport(p, capped);
assert.equal(p.st.critChance, 75);
assert.equal(report.rows.find((row) => row.key === 'critChance').effective, p.st.critChance);
for (const [key, cap] of [['atkSpeed', 150], ['castSpeed', 150], ['moveSpeed', 80], ['block', 60], ['reduce', 60], ['cdr', 60], ['resFire', 75]]) {
  assert.equal(report.rows.find((row) => row.key === key).effective, cap, `${key} report matches actual runtime cap`);
}

console.log('Player integration passed: item and gem sources, Covenant set bonuses, temporary buffs, equip/unequip updates and save/load recomputation.');
