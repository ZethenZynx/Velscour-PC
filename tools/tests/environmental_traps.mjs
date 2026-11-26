import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hit } from '../../src/game/combat.js';
import { BIOMES, BETA_BIOMES, BREACH_BIOME, SCORPION_KING_PYRAMID_BIOME, TOWN_BIOME, ACT2_TOWN_BIOME } from '../../src/data/biomes.js';
import { DART_TRAP_VARIANTS, ENVIRONMENT_TRAP_GROUND_FIXTURES, ENVIRONMENT_TRAP_PROFILES, ENVIRONMENT_TRAP_TYPES, selectDartTrapVariant, setupEnvironmentalTraps, trapArtFor, trapDamageAmount, trapDamageScale } from '../../src/game/environmenttraps.js';
import { generateDungeon } from '../../src/world/dungeon.js';
import { A } from '../../src/core/assets.js';

const ATLAS_DIMENSIONS = { mechanical: [1024, 1536, 6], elemental: [1024, 1536, 6], nature: [1182, 1330, 9], 'environment-variations': [724, 2172, 12], 'dart-wall': [1312, 1200, 4] };

test('all playable non-town environments have three to six valid hazard types', () => {
  const biomes = [...new Map([TOWN_BIOME, ACT2_TOWN_BIOME, ...BIOMES, ...BETA_BIOMES, BREACH_BIOME, SCORPION_KING_PYRAMID_BIOME].map((b) => [b.id, b])).values()];
  for (const biome of biomes.filter((b) => !b.town && !['town', 'act2_town'].includes(b.id))) {
    const profile = ENVIRONMENT_TRAP_PROFILES[biome.id];
    assert.ok(profile, `missing trap profile for ${biome.id}`);
    assert.ok(profile.length >= 3 && profile.length <= 6, `${biome.id} has ${profile.length} trap types`);
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
  const traps = await readFile(new URL('../../src/game/environmenttraps.js', import.meta.url), 'utf8');
  assert.ok(traps.includes("ctx.fillStyle = '#ff2828'"), 'warnings pulse as translucent red ground tiles');
  assert.ok(traps.includes('for (const tile of site.damageTiles)'), 'warning cells use the same footprint as damage');
  assert.ok(source.includes('Math.round(frame * img.naturalWidth / columns)'), 'atlas frames use integer crop boundaries');
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
  assert.equal(trapDamageAmount(1000, 1, 0.075, false, 1.5), 112.5, 'ordinary traps apply the approved 50% increase');
  assert.equal(trapDamageAmount(1000, 1, 0.075, false, 1.75), 131.25, 'swinging traps apply the approved 75% increase');
  assert.equal(trapDamageAmount(1000, 1, 0.075, false, 2), 150, 'boulders apply the approved 100% increase over their base damage');
  assert.equal(trapDamageAmount(1000, 1, 0.03, false, 1.5), 45, 'wall darts apply the approved 50% increase');
  assert.ok(Math.abs(trapDamageAmount(1000, 100, 0.075, false, 1.5) - 150) < 1e-8, 'ordinary direct traps cap at 15% of maximum health');
  assert.ok(Math.abs(trapDamageAmount(1000, 100, 0.075, false, 1.75) - 175) < 1e-8, 'swinging traps retain the full 75% increase after depth scaling');
  assert.ok(Math.abs(trapDamageAmount(1000, 100, 0.075, false, 2) - 200) < 1e-8, 'boulders retain the full 100% increase without becoming a one-hit kill');
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
  const expectedProps = 1 + countA + a.environmentTraps.filter((site) => site.triggerFixture).length;
  assert.equal(a.props.length, expectedProps, 'every trap site uses its physical fixture and pressure-trigger plates are counted separately');
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
    const expectedTiles = site.kind === 'dartTrap' ? 5 : ['rollingBoulder','swingingBlade'].includes(site.kind) ? 3 : 9;
    assert.equal(site.damageTiles.length, expectedTiles, `${site.kind} uses the requested tile footprint`);
  }
  assert.equal(setupEnvironmentalTraps(a, [5, 5]), 0, 'an initialized world must not receive duplicate sites');
});

test('dart atlas loading races leave the trap manager retryable instead of permanently empty', () => {
  const loaded = Object.fromEntries(['mechanical', 'elemental', 'nature', 'environment-variations'].map((id) => [id, { naturalWidth: 1024, naturalHeight: 1200 }]));
  A.environmentTrapAtlases = loaded;
  const w = 44, h = 44, walkableTile = (x, y) => x >= 2 && y >= 2 && x < w - 2 && y < h - 2;
  const world = {
    kind: 'dungeon', depth: 30, environmentTrapSeed: 91, biome: { id: 'catacombs' }, tileset: { k: 0.4 },
    props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w, h, walkableTile, walkable: (x, y) => walkableTile(Math.floor(x), Math.floor(y)), circleFree: () => true },
    addHazard(hazard) { this.hazards.push(hazard); return hazard; },
  };
  assert.equal(setupEnvironmentalTraps(world, [22, 22]), 0);
  assert.equal(world.environmentTrapsInitialized, false, 'a not-yet-loaded dart atlas does not lock the world as initialized');
  A.environmentTrapAtlases = { ...loaded, 'dart-wall': { naturalWidth: 1312, naturalHeight: 1200 } };
  assert.ok(setupEnvironmentalTraps(world, [22, 22]) > 0, 'the normal setup call can retry once the atlas is ready');
  assert.ok(world.environmentTraps.some((site) => site.kind === 'dartTrap'));
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
  assert.equal(site.fireRange, 4.5, 'the wall dart path covers five complete tiles from the wall');
  assert.equal(site.damageTiles.length, 5, 'the dart warning and hit lane are exactly five tiles long');
  assert.ok(Math.abs(site.fireX) + Math.abs(site.fireY) === 1, 'projectile direction points from its wall into a clear path');
  const player = { id: 'dart-entry-player', team: 'player', isPlayer: true, world, x: site.x + site.fireX * 2.5, y: site.y + site.fireY * 2.5, r: 0.2, dead: false };
  world.creatures.push(player);
  site.next = 0;
  manager.update(0.01);
  assert.equal(site.fixture.trapState, 'warning', 'entering the damage lane visibly warns before firing');
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
  const firingPlayer = { id: 'dart-test-player', team: 'player', isPlayer: true, world, x: site.x + site.fireX * 0.7, y: site.y + site.fireY * 0.7, r: 0.36,
    hp: 1000, maxHp: 1000, dead: false, st: { markEvasion: 0, block: 0, armor: 0, res: { fire: 0, cold: 0, light: 0, poison: 0, magic: 0 }, reduce: 0, markAffixReduce: 0, damageTakenPct: 0, legendary: { thorns: 0 } } };
  world.creatures.splice(world.creatures.indexOf(player), 1, firingPlayer);
  site.warning = 1.1;
  manager.update(1.2);
  const playerDarts = world.hazards.filter((hazard) => hazard !== manager && typeof hazard.draw === 'function' && !darts.includes(hazard));
  assert.equal(playerDarts.length, 3, 'a second warning creates another three-dart volley');
  for (const dart of playerDarts) dart.update(0.1);
  assert.ok(firingPlayer.hp < 1000, 'the same physical dart volley can damage the player through the shared combat mitigation path');
});

test('eligible generated dungeons consistently place visible wall darts across biomes and depths', () => {
  const atlas = { naturalWidth: 1312, naturalHeight: 1200 };
  A.environmentTrapAtlases = Object.fromEntries(['mechanical', 'elemental', 'nature', 'environment-variations', 'dart-wall'].map((id) => [id, atlas]));
  const tileSet = { k: 0.4, scatter: [], floors: [{ lum: 0.5, name: 'stone' }], bases: [0], features: [0], families: [] };
  const eligibleBiomes = [...new Map([...BIOMES, ...BETA_BIOMES, BREACH_BIOME, SCORPION_KING_PYRAMID_BIOME].map((b) => [b.id, b])).values()]
    .filter((biome) => !biome.town && ENVIRONMENT_TRAP_PROFILES[biome.id]?.includes('dartTrap'));
  const biomeIds = eligibleBiomes.map((biome) => biome.id);
  const depths = [1, 25, 100, 250];
  const summary = Object.fromEntries(DART_TRAP_VARIANTS.map((variant) => [variant.id, 0]));
  const rejected = {};
  let dungeons = 0, placedDartSites = 0, mountAttempts = 0, acceptedMounts = 0;
  for (const biome of eligibleBiomes) {
    const biomeId = biome.id;
    assert.ok(ENVIRONMENT_TRAP_PROFILES[biomeId].includes('dartTrap'), `${biomeId} is eligible`);
    for (const depth of depths) for (let seed = 1; seed <= 5; seed++) {
      const environmentTrapSeed = (depth * 100_000 + seed * 17 + biomeIds.indexOf(biomeId)) >>> 0;
      const generated = generateDungeon(depth, biome, tileSet, environmentTrapSeed);
      const world = {
        kind: 'dungeon', depth, environmentTrapSeed, environmentVariant: generated.variant?.id || biomeId, biome,
        tileset: { k: 0.4, scatter: [] }, map: generated.map, props: generated.props || [], chests: generated.chests || [],
        npcs: [], portals: [{ x: generated.exit[0], y: generated.exit[1] }], creatures: [], hazards: [],
        environmentTrapDiagnostics: {}, addHazard(hazard) { this.hazards.push(hazard); return hazard; },
      };
      setupEnvironmentalTraps(world, generated.start);
      const darts = world.environmentTraps.filter((site) => site.kind === 'dartTrap');
      assert.equal(darts.length, 2, `${biomeId} depth ${depth}, seed ${environmentTrapSeed} places two separated darts`);
      assert.ok(world.environmentTrapDiagnostics.dartCandidateTiles > 0, 'wall-side candidates are considered separately from body-radius safe sites');
      assert.ok(world.environmentTrapDiagnostics.validMounts > 0, 'a five-tile clear lane is confirmed before placement');
      for (const site of darts) {
        assert.equal(site.damageTiles.length, 5);
        assert.ok(site.fixture.trapSheet === 'dart-wall' && Number.isInteger(site.fixture.trapRow));
        assert.ok(DART_TRAP_VARIANTS.some((variant) => variant.id === site.type.id));
        summary[site.type.id]++;
      }
      dungeons++; placedDartSites += darts.length;
      mountAttempts += world.environmentTrapDiagnostics.mountAttempts || 0;
      acceptedMounts += world.environmentTrapDiagnostics.validMounts || 0;
      for (const [reason, count] of Object.entries(world.environmentTrapDiagnostics.rejected || {})) rejected[reason] = (rejected[reason] || 0) + count;
    }
  }
  assert.ok(Object.values(summary).every((count) => count > 0), 'normal generation can produce every element variant');
  assert.equal(dungeons, eligibleBiomes.length * depths.length * 5);
  console.log(`Dart spawn simulation: ${dungeons}/${dungeons} eligible dungeons; ${placedDartSites} darts (1.00 to 2.00 per dungeon; previous baseline 1.00); mount candidates ${acceptedMounts + Object.values(rejected).reduce((a, b) => a + b, 0)}; valid mounts ${acceptedMounts}; rejected ${JSON.stringify(rejected)}; variants ${JSON.stringify(summary)}`);
});

test('dart variant selector covers all five explicit variants without forced gameplay overrides', () => {
  for (let i = 0; i < DART_TRAP_VARIANTS.length; i++) {
    const selected = selectDartTrapVariant(() => (i + 0.25) / DART_TRAP_VARIANTS.length);
    assert.equal(selected.id, DART_TRAP_VARIANTS[i].id);
  }
  assert.deepEqual(DART_TRAP_VARIANTS.map(({ id, element }) => [id, element]), [
    ['arrow', 'phys'], ['poison', 'poison'], ['fire', 'fire'], ['frost', 'cold'], ['electric', 'light'],
  ]);
});

test('all five naturally generated dart variants warn, launch visible colored projectiles, and apply their element effect', () => {
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  for (const variant of DART_TRAP_VARIANTS) {
    let world, site, manager;
    for (let seed = 1; seed <= 250 && !site; seed++) {
      const w = 44, h = 44, walkableTile = (x, y) => x >= 2 && y >= 2 && x < w - 2 && y < h - 2;
      world = {
        kind: 'dungeon', depth: 60, environmentTrapSeed: seed, environmentVariant: 'catacombs', biome: { id: 'catacombs' }, tileset: { k: 0.4 },
        props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w, h, walkableTile, walkable: (x, y) => walkableTile(Math.floor(x), Math.floor(y)), circleFree: () => true },
        addHazard(hazard) { this.hazards.push(hazard); return hazard; },
      };
      setupEnvironmentalTraps(world, [22, 22]);
      site = world.environmentTraps.find((item) => item.kind === 'dartTrap' && item.type.id === variant.id);
      manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
    }
    assert.ok(site, `${variant.name} is naturally selectable`);
    const player = { id: `dart-${variant.id}-trigger`, team: 'player', isPlayer: true, world,
      x: site.damageTiles[2].x, y: site.damageTiles[2].y, r: 0.2, dead: false };
    world.creatures.push(player);
    site.next = 0;
    manager.update(0.01);
    assert.equal(site.fixture.trapState, 'warning', `${variant.name} gives a warning before firing`);
    assert.equal(site.damageTiles.length, 5, `${variant.name} warning covers its 5x1 attack lane`);
    manager.update(1.2);
    const volley = world.hazards.filter((hazard) => hazard !== manager && typeof hazard.draw === 'function');
    assert.equal(volley.length, 3, `${variant.name} launches a three-dart projectile volley`);
    const colors = [];
    const ctx = { save(){}, restore(){}, translate(){}, rotate(){}, fillRect(){ colors.push(this.fillStyle); }, beginPath(){}, moveTo(){}, lineTo(){}, closePath(){}, fill(){ colors.push(this.fillStyle); } };
    volley[0].draw(ctx);
    assert.ok(colors.includes(variant.color), `${variant.name} has a visible, element-colored projectile`);
    const target = { id: `dart-${variant.id}-target`, team: 'enemy', world, x: site.x + site.fireX * 0.7, y: site.y + site.fireY * 0.7, r: 0.36,
      hp: 1000, maxHp: 1000, dead: false, rank: 'normal', res: {}, status: {}, curses: {} };
    world.creatures.push(target);
    for (const dart of volley) dart.update(0.1);
    assert.ok(target.hp < 1000, `${variant.name} deals damage through the normal combat path`);
    if (variant.id === 'poison') assert.ok(target.status.poison?.t > 0, 'poison darts apply poison');
    if (variant.id === 'fire') assert.ok(target.status.burn?.t > 0, 'fire darts apply burn');
    if (variant.id === 'frost') assert.ok(target.status.chill?.t > 0, 'frost darts apply the existing temporary slow');
    if (variant.id === 'electric') assert.ok(target.status.stun?.t > 0, 'electric darts apply the existing stun status');
  }
});

test('dart lane activation matches each of the five warned tiles and never activates off-lane or repeats while occupied', () => {
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  let world, site, manager;
  for (let seed = 1; seed <= 100 && !site; seed++) {
    world = { kind: 'dungeon', depth: 30, environmentTrapSeed: seed, environmentVariant: 'catacombs', biome: { id: 'catacombs' }, tileset: { k: 0.4 },
      props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w: 44, h: 44, walkable: () => true, circleFree: () => true },
      addHazard(hazard) { this.hazards.push(hazard); return hazard; } };
    setupEnvironmentalTraps(world, [22, 22]);
    site = world.environmentTraps.find((entry) => entry.kind === 'dartTrap');
    manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  }
  assert.ok(site, 'test dungeon contains a dart trap');
  const player = { id: 'dart-lane-player', team: 'player', isPlayer: true, world, x: site.x + site.fireY * 3, y: site.y - site.fireX * 3, r: 0.12, dead: false };
  world.creatures.push(player);
  manager.update(0.016);
  assert.equal(site.fixture.trapState, 'idle', 'standing outside all five tiles does not activate the trap');
  for (const [index, tile] of site.damageTiles.entries()) {
    player.x = site.x + site.fireY * 3; player.y = site.y - site.fireX * 3;
    manager.update(0.016);
    site.warning = 0; site.next = 0; site.dartPlayerInLane = false;
    player.x = tile.x; player.y = tile.y;
    manager.update(0.016);
    assert.equal(site.fixture.trapState, 'warning', `entering warned tile ${index + 1} triggers the warning`);
    assert.equal(site.warning, 1.1, 'lane entry grants the full warning interval');
    manager.update(1.2);
    manager.update(0.4);
    manager.update(12);
    assert.equal(site.fixture.trapState, 'idle', 'remaining in the lane does not continuously retrigger the trap');
    player.x = site.x + site.fireY * 3; player.y = site.y - site.fireX * 3;
    manager.update(0.016);
    site.next = 0;
    player.x = tile.x; player.y = tile.y;
    manager.update(0.016);
  }
});

test('dart projectiles stop at solid terrain and cannot damage targets beyond a wall', () => {
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  let world, site, manager;
  for (let seed = 1; seed <= 100 && !site; seed++) {
    world = { kind: 'dungeon', depth: 30, environmentTrapSeed: seed, environmentVariant: 'catacombs', biome: { id: 'catacombs' }, tileset: { k: 0.4 },
      props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w: 44, h: 44, walkable: () => true, circleFree: () => true },
      addHazard(hazard) { this.hazards.push(hazard); return hazard; } };
    setupEnvironmentalTraps(world, [22, 22]);
    site = world.environmentTraps.find((entry) => entry.kind === 'dartTrap');
    manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  }
  assert.ok(site, 'test dungeon contains a dart trap');
  const player = { team: 'player', isPlayer: true, world, x: site.damageTiles[0].x, y: site.damageTiles[0].y, r: 0.2, dead: false };
  world.creatures.push(player);
  site.next = 0; manager.update(0.016); manager.update(1.2);
  const darts = world.hazards.filter((hazard) => hazard !== manager && typeof hazard.draw === 'function');
  assert.equal(darts.length, 3, 'entering the lane launches the volley');
  const blockedAt = 1.5;
  const wallX = site.x + site.fireX * blockedAt, wallY = site.y + site.fireY * blockedAt;
  world.map.walkable = (x, y) => Math.floor(x) !== Math.floor(wallX) || Math.floor(y) !== Math.floor(wallY);
  const target = { team: 'enemy', world, x: site.x + site.fireX * 3, y: site.y + site.fireY * 3, r: 0.2, hp: 1000, maxHp: 1000, dead: false, rank: 'normal', res: {}, status: {}, curses: {} };
  world.creatures = [target];
  for (const dart of darts) {
    let active = true;
    for (let step = 0; step < 20 && active; step++) active = dart.update(0.2);
    assert.equal(active, false, 'a projectile stops as soon as its next path segment reaches solid terrain');
  }
  assert.equal(target.hp, 1000, 'no target behind the blocked tile can be struck');
});

test('trap fixture state advances from idle through warning and activation, then resets', () => {
  const world = {
    kind: 'dungeon', depth: 30, environmentTrapSeed: 17, biome: { id: 'deep_mines' }, tileset: { k: 0.4, scatter: [] },
    props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w: 40, h: 40, walkable: () => true, circleFree: () => true },
    addHazard(hazard) { this.hazards.push(hazard); return hazard; },
  };
  setupEnvironmentalTraps(world, [2, 2]);
  const site = world.environmentTraps.find((item) => item.kind !== 'dartTrap' && item.type.trigger !== 'pressure' && item.type.trigger !== 'proximity' && item.type.mode === 'direct' && !item.type.destructible);
  assert.ok(site, 'deep mines has a periodic physical trap');
  const manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  site.next = 0; site.warning = 0;
  manager.update(0.01);
  assert.equal(site.fixture.trapState, 'warning');
  manager.update(1.2);
  assert.equal(site.fixture.trapState, 'active');
  manager.update(0.36);
  if (site.kind === 'rollingBoulder') {
    assert.equal(site.fixture.trapState, 'active', 'the boulder remains active while rolling through its warned lane');
    manager.update(0.36);
  }
  assert.equal(site.fixture.trapState, 'idle');
});

test('rolling boulder sweeps its warned three-tile lane and damages a target only once', () => {
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  let world, site, manager;
  for (let seed = 1; seed <= 200 && !site; seed++) {
    world = { kind: 'dungeon', depth: 20, environmentTrapSeed: seed, biome: { id: 'deep_mines' }, tileset: { k: 0.4 },
      props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w: 40, h: 40, walkable: () => true, circleFree: () => true },
      addHazard(hazard) { this.hazards.push(hazard); return hazard; } };
    setupEnvironmentalTraps(world, [2,2]);
    site = world.environmentTraps.find((item) => item.kind === 'rollingBoulder');
    manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  }
  assert.ok(site, 'deep-mine layouts can generate a boulder on a clear straight lane');
  assert.equal(site.damageTiles.length, 3, 'the warning shows three tiles in one lane');
  assert.equal(Math.abs(site.fireX) + Math.abs(site.fireY), 1, 'the boulder follows one straight cardinal direction');
  site.type = { ...site.type, trigger: 'periodic' }; site.next = 0;
  manager.update(0.01); assert.equal(site.fixture.trapState, 'warning');
  manager.update(1.2); assert.ok(site.boulderRun, 'the boulder begins rolling after the warning ends');
  const target = { team: 'enemy', world, x: site.x + site.fireX, y: site.y + site.fireY, hp: 1000, maxHp: 1000, dead: false, rank: 'normal', res: {}, status: {}, curses: {} };
  world.creatures.push(target);
  manager.update(0.2);
  assert.ok(target.hp < 1000, 'a moving boulder damages a target along its swept path');
  const afterFirstHit = target.hp;
  manager.update(0.2);
  assert.equal(target.hp, afterFirstHit, 'one boulder run cannot repeatedly damage a target');
});

test('explosive obstacles show the same one-second tile warning before their 3x3 blast', () => {
  A.environmentTrapAtlases = Object.fromEntries(Object.entries(ATLAS_DIMENSIONS).map(([id, [naturalWidth, naturalHeight]]) => [id, { naturalWidth, naturalHeight }]));
  let world, site, manager;
  for (let seed = 1; seed <= 100 && !site; seed++) {
    world = { kind: 'dungeon', depth: 20, environmentTrapSeed: seed, biome: { id: 'deep_mines' }, tileset: { k: 0.4 },
      props: [], chests: [], npcs: [], portals: [], creatures: [], hazards: [], map: { w: 40, h: 40, walkable: () => true, circleFree: () => true },
      addHazard(hazard) { this.hazards.push(hazard); return hazard; } };
    setupEnvironmentalTraps(world, [2,2]);
    site = world.environmentTraps.find((item) => item.type.destructible);
    manager = world.hazards.find((hazard) => hazard.ground && hazard.update);
  }
  assert.ok(site, 'deep mines produce breakable explosive obstacles');
  assert.equal(site.damageTiles.length, 9, 'the blast warning covers a centered 3x3 footprint');
  const target = { team: 'enemy', world, x: site.x, y: site.y, hp: 1000, maxHp: 1000, dead: false, rank: 'normal', res: {}, status: {}, curses: {} };
  world.creatures.push(target);
  world.environmentTrapObstacleDestroyed(site.obstacle, site);
  assert.equal(site.fixture.trapState, 'warning');
  manager.update(0.6);
  assert.equal(target.hp, 1000, 'the obstacle does not damage before its telegraph completes');
  manager.update(0.6);
  assert.ok(target.hp < 1000, 'the warned explosion damages targets inside its matching tiles');
});
