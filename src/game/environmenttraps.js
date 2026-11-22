// Environment-specific physical hazards. Fixtures reuse existing environment scatter sprites; no new art is generated.
import { hit } from './combat.js';
import { Clutter } from './clutter.js';
import { isoX, isoY } from '../core/view.js';
import { sfx } from '../core/audio.js';

export const ENVIRONMENT_TRAP_TYPES = Object.freeze({
  pressurePlate: { name: 'Pressure plate', fixture: 'plate', damage: 0.04, element: 'phys', mode: 'direct', trigger: 'pressure' },
  swingingBlade: { name: 'Swinging blade', fixture: 'blade', damage: 0.075, element: 'phys', mode: 'direct' },
  collapsingFloor: { name: 'Unstable floor', fixture: 'cracked', damage: 0.075, element: 'phys', mode: 'direct' },
  poisonVent: { name: 'Poison vent', fixture: 'vent', damage: 0.01, element: 'poison', mode: 'dot' },
  flameJet: { name: 'Flame jet', fixture: 'flame', damage: 0.075, element: 'fire', mode: 'direct' },
  magicalTurret: { name: 'Arcane turret', fixture: 'turret', damage: 0.04, element: 'arcane', mode: 'direct' },
  destructible: { name: 'Explosive obstacle', fixture: 'obstacle', damage: 0.075, element: 'fire', mode: 'direct', destructible: true },
  spikeTrap: { name: 'Retractable spikes', fixture: 'spikes', damage: 0.075, element: 'phys', mode: 'direct' },
  fallingIcicles: { name: 'Falling icicles', fixture: 'icicle', damage: 0.075, element: 'cold', mode: 'direct' },
  lightningHazard: { name: 'Storm conductor', fixture: 'conductor', damage: 0.075, element: 'light', mode: 'direct' },
  quicksand: { name: 'Quicksand sink', fixture: 'sand', damage: 0.04, element: 'phys', mode: 'direct', trigger: 'proximity' },
  unstableCrystal: { name: 'Unstable crystal', fixture: 'crystal', damage: 0.075, element: 'arcane', mode: 'direct', trigger: 'proximity' },
  lavaFissure: { name: 'Lava fissure', fixture: 'fissure', damage: 0.01, element: 'fire', mode: 'dot' },
  rollingBoulder: { name: 'Unstable boulder', fixture: 'boulder', damage: 0.075, element: 'phys', mode: 'direct' },
  poisonousPlant: { name: 'Venomous growth', fixture: 'plant', damage: 0.01, element: 'poison', mode: 'dot', trigger: 'proximity' },
  thornTrap: { name: 'Thorn snare', fixture: 'thorn', damage: 0.04, element: 'phys', mode: 'direct', trigger: 'proximity' },
  cursedAltar: { name: 'Cursed altar', fixture: 'altar', damage: 0.04, element: 'shadow', mode: 'direct' },
  boneSpikes: { name: 'Bone spikes', fixture: 'bone', damage: 0.075, element: 'shadow', mode: 'direct' },
  explosiveRune: { name: 'Explosive rune', fixture: 'rune', damage: 0.075, element: 'fire', mode: 'direct' },
  crackingIce: { name: 'Cracking ice', fixture: 'ice', damage: 0.075, element: 'cold', mode: 'direct' },
  freezingVent: { name: 'Freezing vent', fixture: 'frostVent', damage: 0.01, element: 'cold', mode: 'dot' },
});

// Profiles cover every combat biome, plus beta/special areas. Castle, tower, cavern, siege, and hunt variants
// inherit their parent environment profile and receive a color/material variation from their variant id.
const profiles = {};
const assign = (ids, traps) => ids.forEach((id) => { profiles[id] = Object.freeze([...traps]); });
assign(['catacombs','sunken','blood','ashen','gilded','shadow','obsidian','flesh','serpent','necropolis','cathedral'], ['pressurePlate','swingingBlade','collapsingFloor','boneSpikes','cursedAltar']);
assign(['castle_keep','castle','shattered','library','throne'], ['pressurePlate','swingingBlade','collapsingFloor','spikeTrap','destructible']);
assign(['ice_temple','frozen','snowy_summit'], ['fallingIcicles','crackingIce','freezingVent','spikeTrap','destructible']);
assign(['molten','forge','hell'], ['flameJet','lavaFissure','explosiveRune','magicalTurret','destructible']);
assign(['fungal','plague','sewers','overworld','dark_forest'], ['poisonVent','poisonousPlant','thornTrap','collapsingFloor','destructible']);
assign(['void','abyss','astral_plane','eternal_breach'], ['magicalTurret','unstableCrystal','explosiveRune','lightningHazard','collapsingFloor']);
assign(['crystal'], ['unstableCrystal','magicalTurret','pressurePlate','collapsingFloor','destructible']);
assign(['desert','amber','sea_of_sand','desert_temple','scorpion_king_pyramid'], ['quicksand','spikeTrap','rollingBoulder','pressurePlate','destructible']);
assign(['storm','skyship','mountainside','great_hunt'], ['lightningHazard','rollingBoulder','fallingIcicles','collapsingFloor','destructible']);
assign(['thorn'], ['thornTrap','poisonousPlant','collapsingFloor','pressurePlate','destructible']);
assign(['pirate_seas'], ['pressurePlate','collapsingFloor','poisonVent','magicalTurret','destructible']);
assign(['serpentine_tower'], ['swingingBlade','pressurePlate','spikeTrap','collapsingFloor','destructible']);
assign(['depths_edge'], ['rollingBoulder','fallingIcicles','collapsingFloor','unstableCrystal','destructible']);
assign(['heavenly'], ['lightningHazard','magicalTurret','pressurePlate','collapsingFloor','destructible']);
assign(['ghost_train'], ['pressurePlate','swingingBlade','lightningHazard','collapsingFloor','destructible']);
assign(['endless_siege'], ['swingingBlade','spikeTrap','explosiveRune','flameJet','destructible']);
assign(['deep_mines'], ['rollingBoulder','collapsingFloor','poisonVent','explosiveRune','destructible']);

export const ENVIRONMENT_TRAP_PROFILES = Object.freeze(profiles);
export const trapProfileFor = (biomeId) => ENVIRONMENT_TRAP_PROFILES[biomeId] || ENVIRONMENT_TRAP_PROFILES.catacombs;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
function seeded(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function trapDamageScale(depth) {
  const d = Math.max(1, Number(depth) || 1);
  if (d <= 100) return Math.min(1.35, 1 + 0.0035 * (d - 1));
  return Math.min(1.75, 1.35 * (1 + 0.025 * Math.log(1 + (d - 100) / 100)));
}

export function trapDamageAmount(maxHp, depth, ratio, boss = false) {
  const hp = Math.max(0, Number(maxHp) || 0);
  return Math.min(hp * 0.10, hp * Math.max(0, ratio) * trapDamageScale(depth) * (boss ? 0.2 : 1));
}

const ELEMENT_COLOR = { phys: '#b8a88a', fire: '#ff7138', cold: '#8edbff', light: '#ffe76a', poison: '#8ac55a', arcane: '#c786ff', shadow: '#a276c9' };
const VARIANT_TINT = { frost: '#a8dcff', hoarfrost: '#a8dcff', rime: '#a8dcff', solenne: '#d9d6c9', cinder: '#ff8150', blood: '#d35b57', blackfen: '#6d9870', mire: '#88a65b', thornwick: '#80a064', sunscar: '#d9ad60', goldspire: '#e0bd66', desert: '#d9ad60', obsidian: '#a276d2', hexenmere: '#a276d2', amethyst: '#a276d2', moonwell: '#82b4ed', river: '#73aeb8', rustvein: '#ce8066', verdigris: '#63c1a9', sunken_bell: '#c3a773', ironcrown: '#b2a58f' };
const tintFor = (variant, element) => {
  const id = String(variant || '').toLowerCase();
  return Object.entries(VARIANT_TINT).find(([key]) => id.includes(key))?.[1] || ELEMENT_COLOR[element] || ELEMENT_COLOR.phys;
};

function occupiedIndex(world) {
  const cell = 4, buckets = new Map();
  for (const list of [world.chests, world.npcs, world.portals, world.props, world.hazards, world.interactables, world.worldObjects, world.objectives, world.waystones, world.map?.doors]) for (const o of list || []) {
    if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
    const key = `${Math.floor(o.x / cell)},${Math.floor(o.y / cell)}`;
    const values = buckets.get(key) || [];
    values.push({ x: o.x, y: o.y, radius: list === world.props ? 1.35 : 2.25 });
    buckets.set(key, values);
  }
  return (x, y, start) => {
    if (start && Math.hypot(x - start[0], y - start[1]) < 8) return true;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let by = cy - 1; by <= cy + 1; by++) for (let bx = cx - 1; bx <= cx + 1; bx++) {
      for (const o of buckets.get(`${bx},${by}`) || []) if (Math.hypot(x - o.x, y - o.y) < o.radius) return true;
    }
    return false;
  };
}

function excluded(world, x, y, start, occupied) {
  if (!world.map.walkable(x, y) || !world.map.circleFree(x, y, 0.55)) return true;
  return occupied(x, y, start);
}

const FIXTURE_ART = {
  plate: /plate|grate|hatch|floor|rune|tile/i, blade: /blade|sword|spike|trap/i,
  cracked: /crack|rubble|broken|stone/i, vent: /grate|vent|drain|pipe/i,
  frostVent: /ice|frost|vent|grate|crystal/i, flame: /brazier|torch|fire|flame/i,
  turret: /statue|pedestal|crystal|obelisk/i, obstacle: /crate|barrel|rock|rubble/i,
  spikes: /spike|bone|teeth/i, icicle: /icicle|ice|crystal/i,
  conductor: /crystal|obelisk|metal|rod|statue/i, sand: /sand|dune|rock/i,
  crystal: /crystal|geode/i, fissure: /lava|rock|crack/i, boulder: /boulder|rock/i,
  plant: /thorn|plant|root|bush/i, thorn: /thorn|plant|root|bush/i,
  altar: /altar|obelisk|shrine|idol/i, bone: /bone|skull/i, rune: /rune|glyph|stone/i,
  ice: /ice|crack|stone/i,
};

function fixtureSprite(world, fixture) {
  const scatter = world.tileset?.scatter || [];
  if (!scatter.length || !world.tileset?.k) return null;
  const usable = scatter.filter((s) => s?.img && s.w > 0 && s.h > 0 && s.w <= 180 && s.h <= 180 && !/tree|canopy|wall|cliff|floor|large|giant/i.test(s.name || ''));
  const preferred = usable.filter((s) => FIXTURE_ART[fixture] && FIXTURE_ART[fixture].test(s.name || ''));
  const choices = preferred.length ? preferred : usable;
  if (!choices.length) return null;
  // Prefer a compact existing prop so repeated trap sites remain readable and do not obscure the scene.
  return choices.reduce((best, s) => {
    const score = Math.abs(Math.max(s.w, s.h) - 64) + Math.abs(s.w * s.h - 2304) / 256;
    const bestScore = Math.abs(Math.max(best.w, best.h) - 64) + Math.abs(best.w * best.h - 2304) / 256;
    return score < bestScore ? s : best;
  });
}

function makeSite(world, kind, x, y, id, rng, variant) {
  const type = ENVIRONMENT_TRAP_TYPES[kind];
  const tint = tintFor(variant, type.element);
  const spr = fixtureSprite(world, type.fixture);
  // Areas whose tileset has no reusable prop art simply receive fewer trap sites.
  if (!spr) return null;
  const fixture = { kind: 'environmentTrapFixture', trapKind: type.fixture, x, y, z: 0, tint, material: materialFor(variant), active: false, id, spr, k: world.tileset.k, flip: rng() < 0.5 };
  world.props.push(fixture);
  return { id, kind, type, x, y, fixture, tint, rng, next: 8 + rng() * 8, warning: 0, dotLeft: 0, dotTick: 0, dotHit: new Set(), disabled: false };
}

function damageTarget(world, site, target, ratio) {
  if (!target || target.dead) return;
  // Trap damage is not player-scaled, but enemy kills are credited normally so
  // the lure strategy still grants the encounter's usual XP and loot.
  const source = { team: target.team === 'enemy' ? 'player' : 'environment', isPlayer: false, isEnvironmentHazard: true, name: site.type.name, world, x: site.x, y: site.y, level: Math.max(1, world.depth || 1), rank: 'normal' };
  const isBoss = target.rank === 'boss' || target.isBoss || target.isVelscour;
  const bossScale = isBoss ? 0.2 : 1;
  const amount = trapDamageAmount(target.maxHp, world.depth, ratio, bossScale < 1);
  if (amount > 0) hit(source, target, amount, site.type.element, { crit: false, dot: ratio < 0.02, affixHazard: true, noArc: true, noStatus: true, noVariance: true, silent: true, damageCap: target.maxHp * (isBoss ? 0.03 : 0.10) });
}

function materialFor(variant) {
  const id = String(variant || '').toLowerCase();
  if (/frost|rime|ice|snow|hoarfrost|white_waste/.test(id)) return 'ice';
  if (/sand|desert|sunscar|amber|badlands/.test(id)) return 'sand';
  if (/cinder|molten|forge|burning|hell|ironcrown|goldspire|sunken_bell|iron|keep/.test(id)) return 'iron';
  if (/fen|mire|swamp|verdigris|blackfen|thorn|forest/.test(id)) return 'moss';
  if (/storm|crag|mountain|pass/.test(id)) return 'granite';
  if (/blood|bone|crypt|necropolis|mourncross/.test(id)) return 'bone';
  return 'stone';
}

function detonateObstacle(world, site, obstacle) {
  if (site.disabled) return;
  site.disabled = true;
  sfx('explode', 0.45);
  const radius = 2.6;
  for (const target of world.creatures) if (!target.dead && !target.clutter && target !== obstacle && Math.hypot(target.x - site.x, target.y - site.y) <= radius + (target.r || 0)) damageTarget(world, site, target, 0.075);
  site.fixture.active = true;
}

/** Attach one low-cost update/draw manager to an already generated, non-town world. */
export function setupEnvironmentalTraps(world, start) {
  if (!world || world.kind === 'town' || world.environmentTrapsInitialized) return 0;
  world.environmentTrapsInitialized = true;
  const profile = trapProfileFor(world.biome?.id);
  const seed = hash((Number(world.environmentTrapSeed) || 1) ^ hash((world.depth || 0) + 0x41c64e6d) ^ hash(String(world.biome?.id || '').split('').reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261)));
  const rng = seeded(seed);
  const floors = [], occupied = occupiedIndex(world);
  for (let y = 2; y < world.map.h - 2; y++) for (let x = 2; x < world.map.w - 2; x++) if (!excluded(world, x + 0.5, y + 0.5, start, occupied)) floors.push([x + 0.5, y + 0.5]);
  // Shuffle the valid candidates without touching the game's global random stream.
  for (let i = floors.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [floors[i], floors[j]] = [floors[j], floors[i]]; }
  const targetCount = clamp(Math.round(floors.length / 260), 3, 12);
  const sites = [];
  for (const [x, y] of floors) {
    if (sites.length >= targetCount) break;
    if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < 7)) continue;
    const kind = profile[Math.floor(rng() * profile.length)];
    const site = makeSite(world, kind, x, y, sites.length, rng, world.environmentVariant || world.biome?.id);
    if (site) sites.push(site);
  }
  for (const site of sites.filter((s) => s.type.destructible)) {
    const obstacle = new Clutter(world, site.fixture);
    obstacle.x = site.x; obstacle.y = site.y; obstacle.name = site.type.name;
    obstacle.environmentTrapObstacle = site;
    obstacle.world = world; // already validated as a free tile; skip ordinary enemy affix application
    world.creatures.push(obstacle);
  }
  world.environmentTraps = sites;
  world.environmentTrapObstacleDestroyed = (clutter, site) => detonateObstacle(world, site, clutter);
  world.addHazard({
    ground: true,
    update(dt) {
      for (const site of sites) {
        if (site.disabled) continue;
        if (site.flash > 0 && (site.flash -= dt) <= 0 && site.warning <= 0) site.fixture.active = false;
        if (site.type.destructible) continue; // damage-triggered objects do nothing until the player breaks them
        if (site.warning > 0) {
          site.warning -= dt;
          site.next -= dt;
          if (site.warning <= 0) {
            site.warning = 0; site.flash = 0.35; site.fixture.active = true;
            if (site.type.mode === 'dot') { site.dotLeft = 3; site.dotTick = 0; site.dotHit.clear(); }
            else for (const target of world.creatures) if (!target.dead && Math.hypot(target.x - site.x, target.y - site.y) <= (site.type.trigger === 'pressure' ? 0.9 : 1.5) + (target.r || 0)) damageTarget(world, site, target, site.type.damage);
          }
        } else {
          site.next -= dt;
          const triggerRadius = site.type.trigger === 'pressure' ? 0.58 : site.type.trigger === 'proximity' ? 1.0 : 0;
          const triggered = triggerRadius > 0 && world.creatures.some((target) => !target.dead && Math.hypot(target.x - site.x, target.y - site.y) <= triggerRadius + (target.r || 0));
          const periodic = site.type.trigger !== 'pressure' && site.type.trigger !== 'proximity';
          if (site.next <= 0 && (periodic || triggered)) {
            site.warning = 1.1; site.next = 8 + rng() * 8; site.fixture.active = true;
            sfx(({ fire: 'fire', cold: 'cold', light: 'light', poison: 'poison', arcane: 'arcane', shadow: 'shadow', phys: 'thud' })[site.type.element] || 'thud', 0.22);
          }
        }
        if (site.dotLeft > 0) {
          site.dotTick -= dt;
          if (site.dotTick <= 0) {
            for (const target of world.creatures) if (!target.dead && Math.hypot(target.x - site.x, target.y - site.y) <= 1.5 + (target.r || 0)) damageTarget(world, site, target, site.type.damage);
            site.dotLeft--; site.dotTick = 1;
          }
        }
      }
      return true;
    },
    draw(ctx) {
      for (const site of sites) if (site.warning > 0 && !site.disabled) {
        const x = isoX(site.x, site.y), y = isoY(site.x, site.y), t = 0.2 + 0.12 * Math.sin(world.time * 18);
        ctx.save(); ctx.globalAlpha = t; ctx.fillStyle = site.tint; ctx.strokeStyle = site.tint; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(x, y, 26, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      for (const site of sites) if (site.dotLeft > 0 && !site.disabled) {
        const x = isoX(site.x, site.y), y = isoY(site.x, site.y);
        ctx.save(); ctx.globalAlpha = 0.11; ctx.fillStyle = site.tint;
        ctx.beginPath(); ctx.ellipse(x, y, 25, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    },
  });
  return sites.length;
}
