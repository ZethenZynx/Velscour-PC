import test from 'node:test';
import assert from 'node:assert/strict';
import { kill } from '../../src/game/combat.js';
import { G } from '../../src/state.js';
import { effects, Telegraph } from '../../src/gfx/vfx.js';

test('Unstable Remains death warning does not abort boss completion', () => {
  const previousGore = G.settings.gore;
  const previousRandom = Math.random;
  G.settings.gore = 0;
  Math.random = () => 0; // deterministically pass the 22% Unstable Remains roll

  let completionCount = 0;
  const world = {
    dungeonAffixes: [],
    heresy: { ids: ['unstable_remains'] },
    depth: 1,
    creatures: [],
    hazards: [],
    addHazard(hazard) { this.hazards.push(hazard); },
    onBossKilled() { completionCount++; },
  };
  const boss = {
    dead: false, isPlayer: false, team: 'enemy', world,
    hp: 1, maxHp: 1, x: 4, y: 5, rank: 'boss', name: 'Regression Boss',
    goreType: 'flesh', status: {},
  };
  world.boss = boss;

  try {
    kill(boss, null);
  } finally {
    Math.random = previousRandom;
    G.settings.gore = previousGore;
  }

  assert.equal(boss.dead, true);
  assert.equal(world.hazards.length, 1, 'the delayed explosion hazard should be registered');
  assert.ok(effects.some((effect) => effect instanceof Telegraph && effect.x === 4 && effect.y === 5),
    'a visible warning telegraph should be registered');
  assert.equal(completionCount, 1, 'boss completion must run after its death effect is created');
});
