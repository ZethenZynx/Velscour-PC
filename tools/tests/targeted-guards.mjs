import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canReceiveMovementAffix, isUsableInteraction, shouldSpawnTwinGuardian } from '../../src/game/targeted-guards.js';

assert.equal(isUsableInteraction({ use() {} }), true);
assert.equal(isUsableInteraction({ use: null }), false);
assert.equal(isUsableInteraction({}), false);

const ordinary = { team: 'enemy', awake: true, dead: false };
assert.equal(canReceiveMovementAffix(ordinary), true, 'awake ordinary enemies retain movement affixes');
for (const blocked of [
  { ...ordinary, awake: false },
  { ...ordinary, dead: true },
  { ...ordinary, static: true },
  { ...ordinary, isVelscour: true },
  { ...ordinary, raid: {} },
  { ...ordinary, vel: { holdBoss: () => true } },
]) assert.equal(canReceiveMovementAffix(blocked), false);

const twinWorld = { dungeonAffixes: ['twin_guardians'], boss: { ...ordinary, rank: 'boss' } };
assert.equal(shouldSpawnTwinGuardian(twinWorld), true);
assert.equal(shouldSpawnTwinGuardian({ ...twinWorld, boss: { ...ordinary, isVelscour: true } }), false);
assert.equal(shouldSpawnTwinGuardian({ ...twinWorld, boss: { ...ordinary, raid: {} } }), false);
assert.equal(shouldSpawnTwinGuardian({ ...twinWorld, boss: { ...ordinary, dead: true } }), false);

const controls = readFileSync(new URL('../../src/game/controls.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../../src/game/player.js', import.meta.url), 'utf8');
const monster = readFileSync(new URL('../../src/game/monster.js', import.meta.url), 'utf8');
const game = readFileSync(new URL('../../src/game/game.js', import.meta.url), 'utf8');
const velscour = readFileSync(new URL('../../src/game/velscour.js', import.meta.url), 'utf8');
assert.match(controls, /const usable = isUsableInteraction;[\s\S]*!usable\(n\)/, 'NPC selection excludes noninteractive objects');
assert.match(player, /if \(!isUsableInteraction\(t\)\)/, 'interaction handler is revalidated at use time');
assert.match(monster, /canReceiveMovementAffix\(this\)/, 'burrowing/phasing requires an awake eligible enemy');
assert.match(game, /if \(!canReceiveMovementAffix\(m\)\) continue;/, 'teleport affixes use the same eligibility');
assert.match(game, /if \(shouldSpawnTwinGuardian\(world\)\)/, 'twin guardian creation is eligibility gated');
assert.match(velscour, /if \(!this\.phase\) return 0;/, 'Velscour cannot take pre-encounter damage');

console.log('Passed targeted interaction, movement-affix, Velscour, and Twin Guardian checks.');
