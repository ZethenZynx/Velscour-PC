import test from 'node:test';
import assert from 'node:assert/strict';
import { hit } from '../../src/game/combat.js';
import { BIOMES, BETA_BIOMES, BREACH_BIOME, SCORPION_KING_PYRAMID_BIOME, TOWN_BIOME, ACT2_TOWN_BIOME } from '../../src/data/biomes.js';
import { ENVIRONMENT_TRAP_PROFILES, ENVIRONMENT_TRAP_TYPES, setupEnvironmentalTraps, trapDamageAmount, trapDamageScale } from '../../src/game/environmenttraps.js';

test('all playable non-town environments have three to five valid hazard types', () => {
  const biomes = [...new Map([TOWN_BIOME, ACT2_TOWN_BIOME, ...BIOMES, ...BETA_BIOMES, BREACH_BIOME, SCORPION_KING_PYRAMID_BIOME].map((b) => [b.id, b])).values()];
  for (const biome of biomes.filter((b) => !b.town && !['town', 'act2_town'].includes(b.id))) {
    const profile = ENVIRONMENT_TRAP_PROFILES[biome.id];
    assert.ok(profile, `missing trap profile for ${biome.id}`);
    assert.ok(profile.length >= 3 && profile.length <= 5, `${biome.id} has ${profile.length} trap types`);
    for (const id of profile) assert.ok(ENVIRONMENT_TRAP_TYPES[id], `${biome.id} refers to unknown trap ${id}`);
  }
});

test('trap definitions have a physical fixture and bounded damage mode', () => {
  for (const [id, trap] of Object.entries(ENVIRONMENT_TRAP_TYPES)) {
    assert.ok(trap.name && trap.fixture, `${id} needs a visible physical fixture`);
    assert.ok(['direct', 'dot'].includes(trap.mode), `${id} has unsupported damage mode`);
    assert.ok(trap.damage > 0 && trap.damage <= 0.075, `${id} damage must be modest and capped`);
  }
});

test('environmental elemental hits can bypass secondary status procs', () => {
  const world = { depth: 10, time: 0, dungeonAffixes: [] };
  const target = { team: 'enemy', dead: false, invuln: 0, hp: 100, maxHp: 100, world, res: {}, status: {}, curses: {}, rank: 'normal' };
  const source = { team: 'environment', isPlayer: false, world, level: 10 };
  const dealt = hit(source, target, 10, 'fire', { crit: false, noStatus: true, noVariance: true, damageCap: 10, dot: true, affixHazard: true });
  assert.ok(dealt > 0 && dealt <= 10);
  assert.deepEqual(target.status, {}, 'hazard damage does not create a second burn/poison/chill damage stream');
});

test('environmental scaling rises gradually and stays inside the approved caps', () => {
  assert.equal(trapDamageScale(1), 1);
  assert.ok(trapDamageScale(100) <= 1.35);
  assert.ok(trapDamageScale(101) >= trapDamageScale(100));
  assert.ok(trapDamageScale(1_000_000) <= 1.75);
  assert.equal(trapDamageAmount(1000, 1, 0.04), 40);
  assert.equal(trapDamageAmount(1000, 1, 0.075), 75);
  assert.equal(trapDamageAmount(1000, 1_000_000, 0.075), 100, 'direct hits respect the 10% maximum-health cap');
  assert.equal(trapDamageAmount(1000, 1, 0.075, true), 15, 'bosses take reduced but nonzero damage');
});

test('generated trap sites are deterministic, accessible, and separated from interactables', () => {
  const makeWorld = () => {
    const existingEnvironmentProp = { name: 'stone_scatter_altar_01', img: {}, sx: 0, sy: 0, w: 64, h: 64, ox: -32, oy: -64 };
    const world = {
      kind: 'dungeon', depth: 55, environmentTrapSeed: 445566, environmentVariant: 'moonwell', biome: { id: 'depths_edge' },
      tileset: { k: 0.4, scatter: [existingEnvironmentProp] },
      props: [{ x: 15, y: 15 }], chests: [{ x: 30, y: 30 }], npcs: [{ x: 20, y: 20 }], portals: [{ x: 40, y: 40 }], creatures: [], hazards: [{ x: 10, y: 12 }],
      map: { w: 56, h: 56, walkable: () => true, circleFree: () => true },
      add(creature) { creature.world = this; this.creatures.push(creature); return creature; },
      addHazard(hazard) { this.hazards.push(hazard); return hazard; },
    };
    return world;
  };
  const a = makeWorld(), b = makeWorld();
  const countA = setupEnvironmentalTraps(a, [5, 5]), countB = setupEnvironmentalTraps(b, [5, 5]);
  assert.ok(countA >= 3 && countA <= 12);
  assert.equal(countA, countB);
  assert.deepEqual(a.environmentTraps.map(({kind,x,y}) => [kind,x,y]), b.environmentTraps.map(({kind,x,y}) => [kind,x,y]));
  assert.equal(a.props.length, countA + 1, 'only the one pre-existing decorative prop is retained beside trap fixtures');
  for (const site of a.environmentTraps) {
    assert.equal(site.fixture.spr, a.tileset.scatter[0], 'trap fixtures reuse existing environment artwork');
    assert.equal(site.fixture.k, a.tileset.k, 'reused artwork keeps the environment scale');
    assert.ok(Math.hypot(site.x - 5, site.y - 5) >= 8);
    assert.ok(Math.hypot(site.x - 30, site.y - 30) >= 2.25);
    assert.ok(Math.hypot(site.x - 20, site.y - 20) >= 2.25);
    assert.ok(Math.hypot(site.x - 40, site.y - 40) >= 2.25);
    assert.ok(Math.hypot(site.x - 15, site.y - 15) >= 1.35);
    assert.ok(Math.hypot(site.x - 10, site.y - 12) >= 2.25);
    assert.ok(a.map.circleFree(site.x, site.y, 0.55));
  }
  assert.equal(setupEnvironmentalTraps(a, [5, 5]), 0, 'an initialized world must not receive duplicate sites');
});
