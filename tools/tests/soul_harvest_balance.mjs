import test from 'node:test';
import assert from 'node:assert/strict';
import { DUNGEON_AFFIX_BY_ID, DUNGEON_AFFIX_CONFIG, triggerSoulHarvest } from '../../src/data/dungeonaffixes.js';

function makeAlly(maxHp = 1000) {
  return {
    maxHp,
    hp: maxHp * 0.5,
    dead: false,
    heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); },
  };
}

test('Soul Harvest has accurate copy and a bounded heal trigger in dense encounters', () => {
  const cfg = DUNGEON_AFFIX_CONFIG.soul_harvest;
  assert.deepEqual(cfg, { healFraction: 0.04, healCooldown: 1.5, damageMultiplier: 1.075, buffDuration: 8, radius: 6 });
  assert.match(DUNGEON_AFFIX_BY_ID.soul_harvest.description, /4% of maximum health.*once every 1\.5 seconds.*7\.5% damage for 8 seconds/);

  const pack = Array.from({ length: 30 }, (_, i) => makeAlly(500 + i * 100));
  assert.equal(triggerSoulHarvest(pack), 30);
  // Repeated deaths inside one cooldown refresh the damage buff, but cannot
  // repeatedly restore health on every nearby enemy.
  for (const ally of pack) {
    assert.ok(Math.abs(ally.hp - ally.maxHp * 0.54) < 1e-9);
    assert.equal(ally.affixSoulHarvestHealCd, 1.5);
    assert.equal(ally.affixSoulHarvestT, 8);
  }
  for (let i = 0; i < 29; i++) assert.equal(triggerSoulHarvest(pack), 0);
  for (const ally of pack) ally.affixSoulHarvestHealCd -= 1.5;
  assert.equal(triggerSoulHarvest(pack), 30);
  for (const ally of pack) assert.ok(Math.abs(ally.hp - ally.maxHp * 0.58) < 1e-9);
});

test('Soul Harvest remains finite and does not heal dead enemies', () => {
  const active = makeAlly();
  const dead = makeAlly();
  dead.dead = true;
  assert.equal(triggerSoulHarvest([active, dead]), 1);
  assert.equal(active.hp, 540);
  assert.equal(dead.hp, 500);
  assert.equal(dead.affixSoulHarvestT, undefined);
});
