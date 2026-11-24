// Non-browser tests exercise the real monster and BOSS ROOM constructors.
import assert from 'node:assert/strict';
import { makeMonster } from '../../src/game/monster.js';
import { makeRaidBoss, RAID_BOSSES } from '../../src/game/raid.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';
import { riftHpMul, riftDmgMul } from '../../src/data/rifts.js';

const originalRandom = Math.random;
const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};
try {
  const biome = BIOME_BY_ID.catacombs;
  const normal = {};
  for (const tier of [1, 2, 5, 25, 100]) {
    Math.random = seeded(4312);
    const world = { depth: 100, riftHold: true, riftTier: tier, biome };
    const m = makeMonster(world, 'skeleton', biome, 100, 'normal', 0, 0, 0, { art: 'bone_colossus' });
    assert.ok(Number.isFinite(m.maxHp) && Number.isFinite(m.dmg));
    assert.ok(Math.abs(m.maxHp / (normal[1]?.hp || m.maxHp) - riftHpMul(tier)) < 1e-10, `ordinary monster HP uses tier ${tier} multiplier once`);
    assert.ok(Math.abs(m.dmg / (normal[1]?.dmg || m.dmg) - riftDmgMul(tier)) < 1e-10, `ordinary monster damage uses tier ${tier} multiplier once`);
    normal[tier] = { hp: m.maxHp, dmg: m.dmg };
  }
  const bosses = {};
  for (const tier of [1, 2, 5, 25, 100]) {
    Math.random = seeded(90210);
    const world = { depth: 100, riftHold: true, riftTier: tier, biome };
    const boss = makeRaidBoss(world, { cx: 10, cy: 10 }, 100, 100, { tpl: RAID_BOSSES[0] });
    assert.ok(Number.isFinite(boss.maxHp) && Number.isFinite(boss.dmg));
    bosses[tier] = { hp: boss.maxHp, dmg: boss.dmg };
  }
  assert.ok(Math.abs(normal[2].hp / normal[1].hp - 1.10) < 1e-10, 'ordinary monster HP applies exact Tier 2 multiplier');
  assert.ok(Math.abs(normal[2].dmg / normal[1].dmg - 1.06) < 1e-10, 'ordinary monster damage applies exact Tier 2 multiplier');
  assert.ok(Math.abs(normal[100].hp / normal[1].hp - riftHpMul(100)) < 1e-6, 'ordinary monster health follows compounded scaling');
  assert.ok(Math.abs(normal[100].dmg / normal[1].dmg - riftDmgMul(100)) < 1e-8, 'ordinary monster damage follows compounded scaling');
  assert.ok(Math.abs(bosses[2].hp / bosses[1].hp - riftHpMul(2)) < 1e-10, 'Guardian HP applies the Rift multiplier once');
  assert.ok(Math.abs(bosses[2].dmg / bosses[1].dmg - riftDmgMul(2)) < 1e-10, 'Guardian damage applies the Rift multiplier once');
  console.log('Actual ordinary monster and BOSS ROOM Guardian constructors apply stable Rift multipliers once.');
} finally {
  Math.random = originalRandom;
}
