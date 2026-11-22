import test from 'node:test';
import assert from 'node:assert/strict';
import { hit } from '../../src/game/combat.js';
import { enemyDamaged } from '../../src/game/enemyvariety.js';

test('combat safely initializes omitted optional curse and status containers', () => {
  const target = {
    team: 'enemy', dead: false, invuln: 0, targetable: true, hp: 100, maxHp: 100,
    rank: 'normal', res: {}, world: { depth: 1, dungeonAffixes: [] },
  };
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    assert.doesNotThrow(() => hit({ team: 'environment', isEnvironmentHazard: true }, target, 10, 'phys', {
      dot: true, silent: true, noStatus: true, noVariance: true,
    }));
    assert.deepEqual(target.curses, {});
    assert.deepEqual(target.status, {});
  } finally {
    Math.random = random;
  }
});

test('counterattack behavior does not retaliate against environmental hazard source records', () => {
  const world = { time: 0, creatures: [], hazards: [], addHazard(hazard) { this.hazards.push(hazard); } };
  const monster = {
    x: 0, y: 0, team: 'enemy', dead: false, facing: 0, dmg: 10, world,
    enemyBehaviors: ['counterattack'], enemyBlockedHit: true, enemyCounterCd: 0,
  };
  world.creatures.push(monster);
  enemyDamaged(monster, { x: 1, y: 0, team: 'environment', isEnvironmentHazard: true }, 5);
  assert.equal(world.hazards.length, 0, 'a trap source is not scheduled as an attack target');
  assert.equal(monster.enemyBlockedHit, false, 'the resisted hit flag is cleared after ignoring retaliation');
});

test('a delayed counterattack is canceled if its source leaves the world', () => {
  let dealt = 0;
  const world = { time: 0, creatures: [], hazards: [], addHazard(hazard) { this.hazards.push(hazard); } };
  const monster = {
    x: 0, y: 0, team: 'enemy', dead: false, facing: 0, dmg: 10, world,
    enemyBehaviors: ['counterattack'], enemyBlockedHit: true, enemyCounterCd: 0,
    deal() { dealt++; },
  };
  const attacker = { x: 1, y: 0, team: 'player', dead: false, hp: 100, maxHp: 100, targetable: true, world };
  world.creatures.push(monster, attacker);
  enemyDamaged(monster, attacker, 5);
  assert.equal(world.hazards.length, 1, 'valid combatants retain the existing counterattack');
  world.creatures.splice(world.creatures.indexOf(attacker), 1);
  world.hazards[0].update(0.25);
  assert.equal(dealt, 0, 'removed targets cannot receive delayed attacks');
});

test('a delayed counterattack is canceled if the retaliating enemy dies', () => {
  let dealt = 0;
  const world = { time: 0, creatures: [], hazards: [], addHazard(hazard) { this.hazards.push(hazard); } };
  const monster = {
    x: 0, y: 0, team: 'enemy', dead: false, facing: 0, dmg: 10, world,
    enemyBehaviors: ['counterattack'], enemyBlockedHit: true, enemyCounterCd: 0,
    deal() { dealt++; },
  };
  const attacker = { x: 1, y: 0, team: 'player', dead: false, hp: 100, maxHp: 100, targetable: true, world };
  world.creatures.push(monster, attacker);
  enemyDamaged(monster, attacker, 5);
  monster.dead = true;
  world.hazards[0].update(0.25);
  assert.equal(dealt, 0, 'dead enemies cannot complete a previously scheduled retaliation');
});
