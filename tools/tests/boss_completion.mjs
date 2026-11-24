// Non-browser regression coverage for guardian defeat notifications.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notifyBossDefeated, reconcileBossDefeats } from '../../src/game/bosscompletion.js';

const calls = [];
const world = { creatures: [], onBossKilled: (boss) => calls.push(boss) };
const guardian = { rank: 'boss', dead: false };
world.boss = guardian;
world.creatures.push(guardian);

assert.equal(notifyBossDefeated(world, guardian), false, 'living guardians cannot complete a level');
assert.equal(calls.length, 0);

guardian.dead = true;
assert.equal(reconcileBossDefeats(world), 1, 'direct death state is reconciled before cleanup');
assert.deepEqual(calls, [guardian]);
assert.equal(notifyBossDefeated(world, guardian), false, 'normal kill and reconciliation cannot double-complete');
assert.equal(reconcileBossDefeats(world), 0, 'later update passes cannot repeat guardian rewards');
assert.equal(calls.length, 1);

const twinWorld = { creatures: [], opened: false, onBossKilled() {
  if (this.creatures.some((enemy) => enemy.rank === 'boss' && !enemy.dead)) return;
  this.opened = true;
} };
const first = { rank: 'boss', dead: false }, second = { rank: 'boss', dead: false };
twinWorld.boss = first;
twinWorld.creatures.push(first, second);
first.dead = true;
reconcileBossDefeats(twinWorld);
assert.equal(twinWorld.opened, false, 'one of two guardians cannot open the exit');
second.dead = true;
reconcileBossDefeats(twinWorld);
assert.equal(twinWorld.opened, true, 'the final guardian opens the exit');
assert.equal(reconcileBossDefeats(twinWorld), 0, 'twin completion is idempotent');

const removedWorld = { creatures: [], calls: 0, onBossKilled() { this.calls++; } };
const detached = { rank: 'boss', dead: true };
removedWorld.boss = detached;
assert.equal(reconcileBossDefeats(removedWorld), 1, 'world.boss remains authoritative if cleanup already detached the entity');
assert.equal(removedWorld.calls, 1);

const nonBoss = { rank: 'champion', dead: true };
assert.equal(notifyBossDefeated({ boss: null }, nonBoss), false, 'ordinary elite deaths do not complete levels');

const combat = readFileSync(new URL('../../src/game/combat.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../../src/game/world.js', import.meta.url), 'utf8');
assert.match(combat, /notifyBossDefeated\(world, tgt\)/, 'combat kills use the idempotent notifier');
assert.match(worldSource, /reconcileBossDefeats\(this\);[\s\S]{0,260}for \(let i = this\.creatures\.length - 1/, 'reconciliation runs before dead-creature cleanup');

console.log('Passed boss completion checks: alive guard, direct death, normal duplicate prevention, twins, detached guardian, and non-boss filtering.');
