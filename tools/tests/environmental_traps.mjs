import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hit } from '../../src/game/combat.js';
import { BIOMES, BETA_BIOMES, BREACH_BIOME, SCORPION_KING_PYRAMID_BIOME, TOWN_BIOME, ACT2_TOWN_BIOME } from '../../src/data/biomes.js';
import { ENVIRONMENT_TRAP_GROUND_FIXTURES, ENVIRONMENT_TRAP_PROFILES, ENVIRONMENT_TRAP_TYPES, setupEnvironmentalTraps, trapArtFor, trapDamageAmount, trapDamageScale } from '../../src/game/environmenttraps.js';
import { A } from '../../src/core/assets.js';

const ATLAS_DIMENSIONS = { mechanical: [1024, 1536, 6], elemental: [1024, 1536, 6], nature: [1182, 1330, 9], 'environment-variations': [724, 2172, 12], 'dart-wall': [1312, 1200, 4] };

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

test('flat trap fixtures and warnings use the intended ground and depth layers', async () => {
  const ground = new Set(ENVIRONMENT_TRAP_GROUND_FIXTURES);
  for (const type of ['pressurePlate', 'collapsingFloor', 'poisonVent', 'flameJet', 'spikeTrap', 'quicksand', 'lavaFissure', 'explosiveRune', 'crackingIce', 'freezingVent']) {
    assert.ok(ground.has(ENVIRONMENT_TRAP_TYPES[type].fixture), `${type} is drawn on the ground layer`);
  }
  for (const type of ['swingingBlade', 'magicalTurret', 'fallingIcicles', 'lightningHazard', 'rollingBoulder', 'poisonousPlant', 'thornTrap', 'cursedAltar', 'boneSpikes', 'unstableCrystal', 'dartTrap']) {
    assert.ok(!ground.has(ENVIRONMENT_TRAP_TYPES[type].fixture), `${type} remains depth-sorted as an elevated or moving object`);
  }
  const source = await readFile(new URL('../../src/game/render.js', import.meta.url), 'utf8');
  const groundFixtures = source.indexOf('if (!fixture?.groundTrapLayer) continue;');
  const groundWarnings = source.indexOf('if (h.drawAfterEffects) h.drawAfterEffects(ctx);');
  const groundEffects = source.indexOf("drawEffects(ctx, 'ground');");
  const actors = source.indexOf('enqueue(c.x + c.y + (c.fly ? 0.2 : 0), 6, c);');
  const sortedProps = source.indexOf('if (pr.groundTrapLayer) continue;');
  assert.ok(groundFixtures >= 0 && groundFixtures < actors, 'flat trap sprites are rendered before actors');
  assert.ok(groundEffects >= 0 && groundEffects < groundWarnings && groundWarnings < actors, 'warning shapes are above ground effects but below actors');
  assert.ok(sortedProps >= 0, 'ground fixtures are excluded from the later depth-sorted pass');
});

test('every trap uses a dedicated physical sprite atlas and environment variants use distinct art rows', () => {
  for (const id of Object.keys(ENVIRONMENT_TRAP_TYPES)) {
    const art = trapArtFor(id, 'catacombs');
    assert.ok(art && art.sheet && Number.isInteger(art.row), `${id} has a valid sprite atlas row`);
  }
  assert.notDeepEqual(trapArtFor('pressurePlate', 'frosted_keep'), trapArtFor('pressurePlate', 'sunscar_desert'));
  assert.notDeepEqual(trapArtFor('poisonVent', 'blackfen_swamp'), trapArtFor('poisonVent', 'sewers'));
  assert.notDeepEqual(trapArtFor('flameJet', 'infernal_hell'), trapArtFor('flameJet', 'molten_forge'));
  assert.notDeepEqual(trapArtFor('magicalTurret', 'crystal'), trapArtFor('magicalTurret', 'storm_crags'));
  assert.equal(trapArtFor('thornTrap', 'dark_forest').row, 3);
  assert.equal(trapArtFor('boneSpikes', 'catacombs').row, 4);
  assert.deepEqual(trapArtFor('dartTrap', 'castle_keep'), { sheet: 'dart-wall', row: 1, element: 'phys' });
  assert.deepEqual(trapArtFor('dartTrap', 'desert_temple'), { sheet: 'dart-wall', row: 2, element: 'poison' });
  assert.deepEqual(trapArtFor('dartTrap', 'catacombs'), { sheet: 'dart-wall', row: 3, element: 'poison' });
  for (const biome of ['catacombs', 'castle_keep', 'desert_temple']) assert.ok(ENVIRONMENT_TRAP_PROFILES[biome].includes('dartTrap'));
});

test('generated trap atlases are valid transparent PNGs with all referenced rows', async () => {
  for (const [sheet, [width, height, rows]] of Object.entries(ATLAS_DIMENSIONS)) {
    const bytes = await readFile(new URL(`../../assets/sprites/environment-traps/${sheet}.png`, import.meta.url));
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `${sheet} is PNG`);
    assert.equal(bytes.readUInt32BE(16), width, `${sheet} width`);
    assert.equal(bytes.readUInt32BE(20), height, `${sheet} height`);
    assert.equal(bytes[25], 6, `${sheet} preserves RGBA alpha`);
    for (const kind of Object.keys(ENVIRONMENT_TRAP_TYPES)) {
      const art = trapArtFor(kind, 'crystal');
      if (art.sheet === sheet) assert.ok(art.row >= 0 && art.row < rows, `${kind} row is inside ${sheet}`);
    }
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
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  const makeWorld = () => {
    const world = {
      kind: 'dungeon', depth: 55, environmentTrapSeed: 445566, environmentVariant: 'moonwell', biome: { id: 'depths_edge' },
      tileset: { k: 0.4, scatter: [] },
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
  assert.equal(a.props.length, countA + 1, 'every trap site uses its own physical sprite fixture beside the original prop');
  for (const site of a.environmentTraps) {
    assert.ok(A.environmentTrapAtlases[site.fixture.trapSheet], 'trap fixture references a loaded dedicated sprite atlas');
    assert.ok(['idle', 'warning', 'active', 'destroyed'].includes(site.fixture.trapState));
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

test('wall dart traps require a nearby wall, warn, and send a resistible projectile volley down a clear lane', () => {
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  let world, site, manager;
  for (let seed = 1; seed <= 100 && !site; seed++) {
    const w = 44, h = 44;
    const walkableTile = (x, y) => x >= 2 && y >= 2 && x < w - 2 && y < h - 2;
    world = {
      kind: 'dungeon', depth: 30, environmentTrapSeed: seed, environmentVariant: 'catacombs', biome: { id: 'catacombs' }, tileset: { k: 0.4 },
      props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w, h, walkableTile, walkable: (x, y) => walkableTile(Math.floor(x), Math.floor(y)), circleFree: () => true },
      addHazard(hazard) { this.hazards.push(hazard); return hazard; },
    };
    setupEnvironmentalTraps(world, [22, 22]);
    site = world.environmentTraps.find((item) => item.kind === 'dartTrap');
    manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  }
  assert.ok(site, 'a seeded catacomb layout can place a wall dart trap');
  assert.ok(site.fireRange >= 3.5 && Math.abs(site.fireX) + Math.abs(site.fireY) === 1, 'projectile direction points from its wall into a clear path');
  site.type = { ...site.type, trigger: 'periodic' };
  site.next = 0;
  manager.update(0.01);
  assert.equal(site.fixture.trapState, 'warning', 'the opening visibly warns before firing');
  manager.update(1.2);
  const darts = world.hazards.filter((hazard) => hazard !== manager && typeof hazard.draw === 'function');
  assert.equal(darts.length, 3, 'a warning launches a three-dart spread');
  const enemy = { id: 'dart-test-target', team: 'enemy', world, x: site.x + site.fireX * 0.7, y: site.y + site.fireY * 0.7, r: 0.36,
    hp: 1000, maxHp: 1000, dead: false, rank: 'normal', res: {}, status: {}, curses: {} };
  world.creatures.push(enemy);
  for (const dart of darts) dart.update(0.1);
  assert.ok(enemy.hp < 1000, 'a physical dart applies ordinary damage and mitigation');
  assert.equal(site.volleyHit.size, 1, 'one volley cannot multiply-hit the same actor with adjacent darts');

  enemy.dead = true;
  const player = { id: 'dart-test-player', team: 'player', isPlayer: true, world, x: site.x + site.fireX * 0.7, y: site.y + site.fireY * 0.7, r: 0.36,
    hp: 1000, maxHp: 1000, dead: false, st: { markEvasion: 0, block: 0, armor: 0, res: { fire: 0, cold: 0, light: 0, poison: 0, magic: 0 }, reduce: 0, markAffixReduce: 0, damageTakenPct: 0, legendary: { thorns: 0 } } };
  world.creatures.push(player);
  site.warning = 1.1;
  manager.update(1.2);
  const playerDarts = world.hazards.filter((hazard) => hazard !== manager && typeof hazard.draw === 'function' && !darts.includes(hazard));
  assert.equal(playerDarts.length, 3, 'a second warning creates another three-dart volley');
  for (const dart of playerDarts) dart.update(0.1);
  assert.ok(player.hp < 1000, 'the same physical dart volley can damage the player through the shared combat mitigation path');
});

test('trap fixture state advances from idle through warning and activation, then resets', () => {
  const world = {
    kind: 'dungeon', depth: 30, environmentTrapSeed: 17, biome: { id: 'deep_mines' }, tileset: { k: 0.4, scatter: [] },
    props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w: 40, h: 40, walkable: () => true, circleFree: () => true },
    addHazard(hazard) { this.hazards.push(hazard); return hazard; },
  };
  setupEnvironmentalTraps(world, [2, 2]);
  const site = world.environmentTraps.find((item) => item.type.trigger !== 'pressure' && item.type.trigger !== 'proximity' && item.type.mode === 'direct' && !item.type.destructible);
  assert.ok(site, 'deep mines has a periodic physical trap');
  const manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  site.next = 0; site.warning = 0;
  manager.update(0.01);
  assert.equal(site.fixture.trapState, 'warning');
  manager.update(1.2);
  assert.equal(site.fixture.trapState, 'active');
  manager.update(0.36);
  assert.equal(site.fixture.trapState, 'idle');
});
