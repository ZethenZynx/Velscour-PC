// Environment-specific physical hazards. Their dedicated atlas fixtures are visual-only; gameplay remains in this module.
import { hit } from './combat.js';
import { Clutter } from './clutter.js';
import { isoX, isoY, HW, HH } from '../core/view.js';
import { sfx } from '../core/audio.js';
import { sparkle, screenAngle } from '../gfx/vfx.js';
import { A } from '../core/assets.js';

export const ENVIRONMENT_TRAP_TYPES = Object.freeze({
  pressurePlate: { name: 'Pressure plate', fixture: 'plate', damage: 0.04, element: 'phys', mode: 'direct', trigger: 'pressure' },
  swingingBlade: { name: 'Swinging blade', fixture: 'blade', damage: 0.075, damageMultiplier: 1.75, element: 'phys', mode: 'direct' },
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
  rollingBoulder: { name: 'Unstable boulder', fixture: 'boulder', damage: 0.075, damageMultiplier: 2, element: 'phys', mode: 'direct' },
  poisonousPlant: { name: 'Venomous growth', fixture: 'plant', damage: 0.01, element: 'poison', mode: 'dot', trigger: 'proximity' },
  thornTrap: { name: 'Thorn snare', fixture: 'thorn', damage: 0.04, element: 'phys', mode: 'direct', trigger: 'proximity' },
  cursedAltar: { name: 'Cursed cage trap', fixture: 'altar', damage: 0.04, element: 'shadow', mode: 'direct' },
  boneSpikes: { name: 'Bone spikes', fixture: 'bone', damage: 0.075, element: 'shadow', mode: 'direct' },
  explosiveRune: { name: 'Explosive rune', fixture: 'rune', damage: 0.075, element: 'fire', mode: 'direct' },
  crackingIce: { name: 'Cracking ice', fixture: 'ice', damage: 0.075, element: 'cold', mode: 'direct' },
  freezingVent: { name: 'Freezing vent', fixture: 'frostVent', damage: 0.01, element: 'cold', mode: 'dot' },
  dartTrap: { name: 'Wall Dart Trap', fixture: 'dartWall', damage: 0.03, damageMultiplier: 1.5, element: 'phys', mode: 'direct', trigger: 'periodic' },
});

// Each atlas row is one physical trap and each column is idle, warning, active, destroyed.
// The variation atlas supplies material-specific pressure plates, spike beds, vents, flame nozzles and turrets.
const TRAP_ART = Object.freeze({
  pressurePlate: { sheet: 'environment-variations', row: 0, variantRows: { ice: 1, frost: 1, snow: 1, sand: 2, desert: 2, sunscar: 2, amber: 2, goldspire: 2, badlands: 2 } },
  swingingBlade: { sheet: 'mechanical', row: 1 },
  collapsingFloor: { sheet: 'mechanical', row: 2 },
  poisonVent: { sheet: 'environment-variations', row: 6, variantRows: { sewers: 7 } },
  flameJet: { sheet: 'environment-variations', row: 8, variantRows: { molten: 9, forge: 9, volcanic: 9 } },
  magicalTurret: { sheet: 'environment-variations', row: 10, variantRows: { storm: 11, crag: 11, mountain: 11 } },
  destructible: { sheet: 'elemental', row: 3 },
  spikeTrap: { sheet: 'mechanical', row: 3, variantRows: { desert: { sheet: 'environment-variations', row: 5 }, sand: { sheet: 'environment-variations', row: 5 }, sunscar: { sheet: 'environment-variations', row: 5 }, amber: { sheet: 'environment-variations', row: 5 }, badlands: { sheet: 'environment-variations', row: 5 } } },
  fallingIcicles: { sheet: 'elemental', row: 4 },
  lightningHazard: { sheet: 'elemental', row: 5 },
  quicksand: { sheet: 'mechanical', row: 4 },
  unstableCrystal: { sheet: 'nature', row: 8 },
  lavaFissure: { sheet: 'nature', row: 7 },
  rollingBoulder: { sheet: 'mechanical', row: 5 },
  poisonousPlant: { sheet: 'nature', row: 0 },
  thornTrap: { sheet: 'nature', row: 1, variantRows: { forest: { sheet: 'environment-variations', row: 3 }, thornwick: { sheet: 'environment-variations', row: 3 } } },
  cursedAltar: { sheet: 'nature', row: 2 },
  boneSpikes: { sheet: 'nature', row: 3, variantRows: { catacomb: { sheet: 'environment-variations', row: 4 }, cathedral: { sheet: 'environment-variations', row: 4 }, crypt: { sheet: 'environment-variations', row: 4 } } },
  explosiveRune: { sheet: 'nature', row: 4 },
  crackingIce: { sheet: 'nature', row: 5 },
  freezingVent: { sheet: 'nature', row: 6 },
  dartTrap: { sheet: 'dart-wall', row: 0, element: 'phys', variantRows: {
    castle: { sheet: 'dart-wall', row: 1, element: 'phys' }, keep: { sheet: 'dart-wall', row: 1, element: 'phys' },
    desert: { sheet: 'dart-wall', row: 2, element: 'poison' }, tomb: { sheet: 'dart-wall', row: 2, element: 'poison' },
    catacomb: { sheet: 'dart-wall', row: 3, element: 'poison' }, crypt: { sheet: 'dart-wall', row: 3, element: 'poison' },
    necropolis: { sheet: 'dart-wall', row: 3, element: 'poison' }, cathedral: { sheet: 'dart-wall', row: 3, element: 'poison' },
  } },
});

const artVariantKey = (variant) => String(variant || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
export function trapArtFor(kind, variant = '') {
  const art = TRAP_ART[kind];
  if (!art) return null;
  const id = artVariantKey(variant);
  for (const [needle, override] of Object.entries(art.variantRows || {})) {
    if (id.includes(needle)) return typeof override === 'number' ? { sheet: art.sheet, row: override, element: art.element } : override;
  }
  return { sheet: art.sheet, row: art.row, element: art.element };
}

// Profiles cover every combat biome, plus beta/special areas. Castle, tower, cavern, siege, and hunt variants
// inherit their parent environment profile and receive a color/material variation from their variant id.
const profiles = {};
const assign = (ids, traps) => ids.forEach((id) => { profiles[id] = Object.freeze([...traps]); });
// These fixtures lie flat in the walkable plane. Draw them beneath actors so
// their broad atlas cells cannot paint over feet or sprites in the depth pass.
export const ENVIRONMENT_TRAP_GROUND_FIXTURES = Object.freeze(['plate', 'cracked', 'vent', 'flame', 'spikes', 'sand', 'fissure', 'rune', 'ice', 'frostVent']);
const GROUND_TRAP_FIXTURES = new Set(ENVIRONMENT_TRAP_GROUND_FIXTURES);
assign(['catacombs','sunken','blood','ashen','gilded','shadow','obsidian','flesh','serpent','necropolis','cathedral'], ['pressurePlate','dartTrap','swingingBlade','boneSpikes','cursedAltar']);
assign(['castle_keep','castle','shattered','library','throne'], ['pressurePlate','dartTrap','swingingBlade','spikeTrap','destructible']);
assign(['ice_temple','frozen','snowy_summit'], ['fallingIcicles','crackingIce','freezingVent','spikeTrap','destructible','dartTrap']);
assign(['molten','forge','hell'], ['flameJet','lavaFissure','explosiveRune','magicalTurret','destructible','dartTrap']);
assign(['fungal','plague','sewers'], ['poisonVent','poisonousPlant','thornTrap','collapsingFloor','destructible','dartTrap']);
assign(['overworld','dark_forest'], ['poisonVent','poisonousPlant','thornTrap','collapsingFloor','destructible']);
assign(['void','abyss','astral_plane','eternal_breach'], ['magicalTurret','unstableCrystal','explosiveRune','lightningHazard','collapsingFloor','dartTrap']);
assign(['crystal'], ['unstableCrystal','magicalTurret','pressurePlate','collapsingFloor','destructible','dartTrap']);
assign(['desert','amber','sea_of_sand','scorpion_king_pyramid'], ['quicksand','spikeTrap','rollingBoulder','pressurePlate','destructible']);
assign(['desert_temple'], ['quicksand','spikeTrap','pressurePlate','destructible','dartTrap']);
assign(['storm','skyship','mountainside','great_hunt'], ['lightningHazard','rollingBoulder','fallingIcicles','collapsingFloor','destructible']);
assign(['thorn'], ['thornTrap','poisonousPlant','collapsingFloor','pressurePlate','destructible']);
assign(['pirate_seas'], ['pressurePlate','collapsingFloor','poisonVent','magicalTurret','destructible','dartTrap']);
assign(['serpentine_tower'], ['swingingBlade','pressurePlate','spikeTrap','collapsingFloor','destructible','dartTrap']);
assign(['depths_edge'], ['rollingBoulder','fallingIcicles','collapsingFloor','unstableCrystal','destructible','dartTrap']);
assign(['heavenly'], ['lightningHazard','magicalTurret','pressurePlate','collapsingFloor','destructible']);
assign(['ghost_train'], ['pressurePlate','swingingBlade','lightningHazard','collapsingFloor','destructible','dartTrap']);
assign(['endless_siege'], ['swingingBlade','spikeTrap','explosiveRune','flameJet','destructible']);
assign(['deep_mines'], ['rollingBoulder','collapsingFloor','poisonVent','explosiveRune','destructible','dartTrap']);

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

export function trapDamageAmount(maxHp, depth, ratio, boss = false, multiplier = 1) {
  const hp = Math.max(0, Number(maxHp) || 0);
  multiplier = Math.max(0, Number(multiplier) || 0);
  const cap = hp * (boss ? 0.03 : multiplier > 1 ? Math.min(0.20, 0.10 * multiplier) : 0.10);
  return Math.min(cap, hp * Math.max(0, ratio) * trapDamageScale(depth) * (boss ? 0.2 : 1) * multiplier);
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

function dartWallMount(world, x, y, rng) {
  const map = world.map, tx = Math.floor(x), ty = Math.floor(y), choices = [];
  for (const [wallX, wallY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const wallTile = (ty + wallY) * map.w + tx + wallX;
    const wallIsWalkable = typeof map.walkableTile === 'function'
      ? map.walkableTile(tx + wallX, ty + wallY)
      : map.walkable(tx + wallX + 0.5, ty + wallY + 0.5);
    if (wallIsWalkable || map.clutter?.[wallTile]) continue;
    const fireX = -wallX, fireY = -wallY;
    let range = 0;
    for (let d = 0.25; d <= 4.5; d += 0.25) {
      if (!map.walkable(x + fireX * d, y + fireY * d)) break;
      range = d;
    }
    if (range >= 4.5) choices.push({ wallX, wallY, fireX, fireY, range: 4.5 });
  }
  return choices.length ? choices[Math.floor(rng() * choices.length)] : null;
}

function makeSite(world, kind, x, y, id, rng, variant, mount = null) {
  const baseType = ENVIRONMENT_TRAP_TYPES[kind];
  const art = trapArtFor(kind, variant);
  const image = A.environmentTrapAtlases?.[art.sheet];
  if (!image?.naturalWidth) return null;
  const columns = 4;
  const rows = art.sheet === 'mechanical' || art.sheet === 'elemental' ? 6 : art.sheet === 'nature' ? 9 : art.sheet === 'dart-wall' ? 4 : 12;
  const element = art.element || baseType.element;
  const type = kind === 'dartTrap' ? {
    ...baseType, element, damage: element === 'poison' ? 0.024 : baseType.damage,
    trigger: ['periodic', 'proximity', 'pressure'][Math.floor(rng() * 3)],
  } : baseType;
  const tint = tintFor(variant, type.element);
  const fixture = {
    kind: 'environmentTrapFixture', trapKind: type.fixture,
    x: x + (mount?.wallX || 0) * 0.38, y: y + (mount?.wallY || 0) * 0.38, z: 0, tint, material: materialFor(variant),
    groundTrapLayer: GROUND_TRAP_FIXTURES.has(type.fixture),
    active: false, trapState: 'idle', id, trapSheet: art.sheet, trapRow: art.row,
    trapColumns: columns, trapRows: rows,
    k: world.tileset?.k || 0.4, flip: mount ? (mount.wallX === 1 || mount.wallY === -1) : rng() < 0.5,
  };
  world.props.push(fixture);
  const intervalScale = world.heresyTrapIntervalMul || 1;
  const site = { id, kind, type, x, y, fixture, tint, rng, next: (8 + rng() * 8) * intervalScale, warning: 0, dotLeft: 0, dotTick: 0, dotHit: new Set(), disabled: false,
    wallX: mount?.wallX || 0, wallY: mount?.wallY || 0, fireX: mount?.fireX || 0, fireY: mount?.fireY || 0, fireRange: mount?.range || 0 };
  if (kind === 'dartTrap' && type.trigger === 'pressure') {
    const plateArt = trapArtFor('pressurePlate', variant), plateImage = A.environmentTrapAtlases?.[plateArt.sheet];
    if (plateImage?.naturalWidth) {
      const plateRows = plateArt.sheet === 'mechanical' || plateArt.sheet === 'elemental' ? 6 : plateArt.sheet === 'nature' ? 9 : 12;
      site.triggerFixture = {
        kind: 'environmentTrapFixture', trapKind: 'plate', x, y, z: 0, tint, material: materialFor(variant), active: false,
        groundTrapLayer: true,
        trapState: 'idle', trapSheet: plateArt.sheet, trapRow: plateArt.row,
        trapColumns: 4, trapRows: plateRows,
        k: world.tileset?.k || 0.4, flip: false,
      };
      world.props.push(site.triggerFixture);
    }
  }
  return site;
}

function laneDirection(world, x, y, rng, length) {
  const choices = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy]) => {
    for (let i = 0; i < length; i++) if (!world.map.walkable(x + dx * i, y + dy * i)) return false;
    return true;
  });
  return choices.length ? choices[Math.floor(rng() * choices.length)] : null;
}

function tileLine(x, y, dx, dy, length, centered = false) {
  const before = centered ? Math.floor((length - 1) / 2) : 0;
  return Array.from({ length }, (_, i) => ({ x: x + dx * (i - before), y: y + dy * (i - before) }));
}

function setDamageTiles(world, site) {
  if (site.kind === 'dartTrap') site.damageTiles = tileLine(site.x, site.y, site.fireX, site.fireY, 5);
  else if (site.kind === 'rollingBoulder' || site.kind === 'swingingBlade') site.damageTiles = tileLine(site.x, site.y, site.fireX, site.fireY, 3, site.kind === 'swingingBlade');
  else site.damageTiles = Array.from({ length: 9 }, (_, i) => ({ x: site.x + i % 3 - 1, y: site.y + Math.floor(i / 3) - 1 }));
}

function traceGroundTile(ctx, tile) {
  ctx.beginPath();
  ctx.moveTo(isoX(tile.x, tile.y - 0.5), isoY(tile.x, tile.y - 0.5));
  ctx.lineTo(isoX(tile.x + 0.5, tile.y), isoY(tile.x + 0.5, tile.y));
  ctx.lineTo(isoX(tile.x, tile.y + 0.5), isoY(tile.x, tile.y + 0.5));
  ctx.lineTo(isoX(tile.x - 0.5, tile.y), isoY(tile.x - 0.5, tile.y));
  ctx.closePath();
}

function inDamageTiles(site, target) {
  const pad = Math.max(0, target.r || 0) * 0.35;
  return site.damageTiles.some((tile) => Math.abs(target.x - tile.x) <= 0.5 + pad && Math.abs(target.y - tile.y) <= 0.5 + pad);
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  const t = length2 ? clamp(((px - ax) * dx + (py - ay) * dy) / length2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function updateBoulderRun(world, site, dt) {
  const run = site.boulderRun;
  if (!run) return;
  const oldProgress = run.progress, nextProgress = Math.min(1, oldProgress + dt / run.duration);
  const steps = Math.max(1, Math.ceil(2 * (nextProgress - oldProgress) / 0.12));
  for (let i = 1; i <= steps; i++) {
    const progress = oldProgress + (nextProgress - oldProgress) * i / steps;
    const nx = site.x + site.fireX * 2 * progress, ny = site.y + site.fireY * 2 * progress;
    if (!world.map.walkable(nx, ny)) { run.blocked = true; break; }
    const fromX = run.x, fromY = run.y;
    run.x = nx; run.y = ny; run.progress = progress;
    site.fixture.x = nx; site.fixture.y = ny;
    for (const target of world.creatures) {
      if (!target || target.dead || target.clutter || !['player', 'enemy'].includes(target.team) || run.hit.has(target)) continue;
      if (segmentDistance(target.x, target.y, fromX, fromY, nx, ny) > 0.5 + Math.max(0, target.r || 0) * 0.35) continue;
      run.hit.add(target);
      damageTarget(world, site, target, site.type.damage);
    }
  }
  if (run.progress >= 1 || run.blocked) {
    site.fixture.trapState = 'active';
    site.fixture.x = site.x; site.fixture.y = site.y;
    site.boulderRun = null;
  }
}

function setSiteVisualState(site, state, active = site.fixture.active) {
  site.fixture.trapState = state; site.fixture.active = active;
  if (site.triggerFixture) { site.triggerFixture.trapState = state; site.triggerFixture.active = active; }
}

function targetOnDartLane(site, target) {
  const dx = target.x - site.x, dy = target.y - site.y;
  const along = dx * site.fireX + dy * site.fireY;
  const across = Math.abs(dx * site.fireY - dy * site.fireX);
  return along >= 0 && along <= site.fireRange && across <= 0.5 + (target.r || 0);
}

class DartProjectile {
  constructor(world, site, lane, delay) {
    this.world = world; this.site = site; this.x = site.x + site.fireY * lane; this.y = site.y - site.fireX * lane;
    this.dx = site.fireX; this.dy = site.fireY;
    this.range = site.fireRange; this.speed = 13; this.wait = delay; this.traveled = 0; this.dead = false;
    this.depth = this.x + this.y + 0.03; this.ground = false;
  }
  update(dt) {
    if (this.wait > 0) { this.wait -= dt; return true; }
    const move = Math.min(this.speed * dt, this.range - this.traveled);
    const steps = Math.max(1, Math.ceil(move / 0.12));
    for (let i = 0; i < steps; i++) {
      const step = move / steps, nx = this.x + this.dx * step, ny = this.y + this.dy * step;
      if (!this.world.map.walkable(nx, ny)) { this.dead = true; return false; }
      const fromX = this.x, fromY = this.y;
      for (const target of this.world.creatures) {
        if (!target || target.dead || target.clutter || !['player', 'enemy'].includes(target.team)) continue;
        if (this.site.volleyHit?.has(target)) continue;
      if (segmentDistance(target.x, target.y, fromX, fromY, nx, ny) > 0.5 + Math.max(0, target.r || 0) * 0.35) continue;
        this.site.volleyHit?.add(target);
        damageTarget(this.world, this.site, target, this.site.type.damage);
        sparkle(nx, ny, 3, this.site.type.element === 'poison' ? '#8ac55a' : '#d6d0c0', 4, 0.12);
        this.dead = true; return false;
      }
      this.x = nx; this.y = ny; this.traveled += step;
      this.depth = this.x + this.y + 0.03;
    }
    if (this.traveled >= this.range) { this.dead = true; return false; }
    return true;
  }
  draw(ctx) {
    const x = isoX(this.x, this.y), y = isoY(this.x, this.y) - 3;
    ctx.save(); ctx.translate(x, y); ctx.rotate(screenAngle(Math.atan2(this.dy, this.dx)));
    ctx.fillStyle = this.site.type.element === 'poison' ? '#77933d' : '#6d5540';
    ctx.fillRect(-8, -1.2, 13, 2.4);
    ctx.fillStyle = this.site.type.element === 'poison' ? '#a8c56a' : '#c8c3b5';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -2.2); ctx.lineTo(3, 2.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = this.site.type.element === 'poison' ? '#b7d653' : '#c69355';
    ctx.fillRect(-9, -2.1, 2.5, 1); ctx.fillRect(-9, 1.1, 2.5, 1);
    ctx.restore();
  }
}

function fireDartVolley(world, site) {
  site.volleyHit = new Set();
  for (let i = 0; i < 3; i++) world.addHazard(new DartProjectile(world, site, 0, i * 0.07));
}

function damageTarget(world, site, target, ratio) {
  if (!target || target.dead) return;
  // Trap damage is not player-scaled, but enemy kills are credited normally so
  // the lure strategy still grants the encounter's usual XP and loot.
  const source = { team: target.team === 'enemy' ? 'player' : 'environment', isPlayer: false, isEnvironmentHazard: true, name: site.type.name, world, x: site.x, y: site.y, level: Math.max(1, world.depth || 1), rank: 'normal' };
  const isBoss = target.rank === 'boss' || target.isBoss || target.isVelscour;
  const bossScale = isBoss ? 0.2 : 1;
  const amount = trapDamageAmount(target.maxHp, world.depth, ratio, bossScale < 1, site.type.damageMultiplier ?? 1.5);
  if (amount > 0) hit(source, target, amount, site.type.element, { crit: false, dot: ratio < 0.02, affixHazard: true, noArc: true, noStatus: true, noVariance: true, silent: true, damageCap: target.maxHp * (isBoss ? 0.03 : Math.min(0.20, 0.10 * (site.type.damageMultiplier ?? 1.5))) });
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
  if (site.disabled || site.pendingDetonation) return;
  site.pendingDetonation = true;
  site.obstacle = obstacle;
  site.warning = 1.1;
  setSiteVisualState(site, 'warning', true);
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
  // Wall darts were previously a one-in-five roll at each random site, then silently
  // replaced if the chosen floor tile lacked a long, unobstructed wall lane. Seed one
  // guaranteed dart in suitable profiles when the generated layout has a valid mount.
  if (profile.includes('dartTrap')) for (const [x,y] of floors) {
    if (sites.length >= targetCount) break;
    if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < 7)) continue;
    const mount = dartWallMount(world, x, y, rng);
    if (!mount) continue;
    const site = makeSite(world, 'dartTrap', x, y, sites.length, rng, world.environmentVariant || world.biome?.id, mount);
    if (site) { setDamageTiles(world, site); sites.push(site); break; }
  }
  for (const [x, y] of floors) {
    if (sites.length >= targetCount) break;
    if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < 7)) continue;
    let kind = profile[Math.floor(rng() * profile.length)], mount = null;
    if (kind === 'dartTrap') {
      mount = dartWallMount(world, x, y, rng);
      if (!mount) continue;
    }
    const site = makeSite(world, kind, x, y, sites.length, rng, world.environmentVariant || world.biome?.id, mount);
    if (!site) continue;
    if (kind === 'dartTrap') setDamageTiles(world, site);
    else if (kind === 'rollingBoulder' || kind === 'swingingBlade') {
      const direction = laneDirection(world, x, y, rng, 3);
      if (!direction) { world.props.pop(); continue; }
      [site.fireX,site.fireY] = direction;
      if (kind === 'swingingBlade') {
        // Keep the isometric blade's attack lane aligned in all four cardinal directions.
        if (site.fireX < 0) site.fixture.flip = true;
        else if (site.fireX > 0) site.fixture.flip = false;
        else {
          site.fixture.flip = false;
          const base = Math.atan2(HH, HW);
          site.fixture.trapRotation = Math.atan2((site.fireX + site.fireY) * HH, (site.fireX - site.fireY) * HW) - base;
        }
      }
      setDamageTiles(world, site);
    } else setDamageTiles(world, site);
    sites.push(site);
  }
  for (const site of sites.filter((s) => s.type.destructible)) {
    const obstacle = new Clutter(world, site.fixture);
    obstacle.x = site.x; obstacle.y = site.y; obstacle.name = site.type.name;
    obstacle.environmentTrapObstacle = site;
    obstacle.world = world; // already validated as a free tile; skip ordinary enemy affix application
    obstacle._worldRenderOrder = ++world._creatureSerial;
    world.creatures.push(obstacle);
    if (world.lifecycle) world.lifecycle.creaturesCreated++;
  }
  world.environmentTraps = sites;
  world.environmentTrapObstacleDestroyed = (clutter, site) => detonateObstacle(world, site, clutter);
  world.addHazard({
    ground: true,
    update(dt) {
      for (const site of sites) {
        if (site.disabled) continue;
        if (site.boulderRun) updateBoulderRun(world, site, dt);
        if (site.flash > 0 && (site.flash -= dt) <= 0 && site.warning <= 0 && !site.boulderRun) {
          if (!site.disabled && site.dotLeft <= 0) setSiteVisualState(site, 'idle', false);
        }
        if (site.pendingDetonation) {
          site.warning -= dt;
          if (site.warning <= 0) {
            site.warning = 0; site.pendingDetonation = false; site.disabled = true;
            site.fixture.active = true; site.fixture.trapState = 'destroyed';
            sfx('explode', 0.45);
            for (const target of world.creatures) if (!target.dead && !target.clutter && target !== site.obstacle && inDamageTiles(site, target)) damageTarget(world, site, target, site.type.damage);
          }
          continue;
        }
        if (site.type.destructible) continue; // damage-triggered objects do nothing until the player breaks them
        if (site.warning > 0) {
          site.warning -= dt;
          site.next -= dt;
          if (site.warning <= 0) {
            site.warning = 0; site.flash = 0.35; setSiteVisualState(site, 'active', true);
            if (site.type.mode === 'dot') { site.dotLeft = 3; site.dotTick = 0; site.dotHit.clear(); }
            else if (site.kind === 'dartTrap') fireDartVolley(world, site);
            else if (site.kind === 'rollingBoulder') {
              site.boulderRun = { x: site.x, y: site.y, progress: 0, duration: 0.58, hit: new Set() };
              site.flash = 0.7;
            } else for (const target of world.creatures) if (!target.dead && !target.clutter && inDamageTiles(site, target)) damageTarget(world, site, target, site.type.damage);
          }
        } else {
          site.next -= dt;
          const triggerRadius = site.type.trigger === 'pressure' ? 0.58 : site.type.trigger === 'proximity' ? (site.kind === 'dartTrap' ? 0 : 1.0) : 0;
          const triggered = triggerRadius > 0 && world.creatures.some((target) => !target.dead && Math.hypot(target.x - site.x, target.y - site.y) <= triggerRadius + (target.r || 0));
          const dartApproached = site.kind === 'dartTrap' && site.type.trigger === 'proximity' && world.creatures.some((target) => !target.dead && targetOnDartLane(site, target));
          const periodic = site.type.trigger !== 'pressure' && site.type.trigger !== 'proximity';
          if (site.next <= 0 && (periodic || triggered || dartApproached)) {
            site.warning = 1.1; site.next = (8 + rng() * 8) * (world.heresyTrapIntervalMul || 1); setSiteVisualState(site, 'warning', true);
            sfx(({ fire: 'fire', cold: 'cold', light: 'light', poison: 'poison', arcane: 'arcane', shadow: 'shadow', phys: 'thud' })[site.type.element] || 'thud', 0.22);
          }
        }
        if (site.dotLeft > 0) {
          site.fixture.trapState = 'active';
          site.dotTick -= dt;
          if (site.dotTick <= 0) {
            for (const target of world.creatures) if (!target.dead && !target.clutter && inDamageTiles(site, target)) damageTarget(world, site, target, site.type.damage);
            site.dotLeft--; site.dotTick = 1;
            if (site.dotLeft <= 0) { site.fixture.trapState = 'idle'; site.fixture.active = false; }
          }
        }
      }
      return true;
    },
    draw(ctx) {
      for (const site of sites) if (site.dotLeft > 0 && !site.disabled) {
        ctx.save(); ctx.globalAlpha = 0.11; ctx.fillStyle = site.tint;
        for (const tile of site.damageTiles) { traceGroundTile(ctx, tile); ctx.fill(); }
        ctx.restore();
      }
    },
    // Draw warnings over spell decals and ground auras, but before the sorted
    // actor pass. The marker uses the same radius or firing lane as collision.
    drawAfterEffects(ctx) {
      for (const site of sites) {
        if (site.warning <= 0 || site.disabled) continue;
        ctx.save();
        const pulse = 0.5 + 0.5 * Math.sin(world.time * 18);
        for (const tile of site.damageTiles) {
          ctx.globalAlpha = 0.22 + pulse * 0.2;
          ctx.fillStyle = '#ff2828';
          traceGroundTile(ctx, tile); ctx.fill();
          ctx.globalAlpha = 0.58 + pulse * 0.34;
          ctx.strokeStyle = '#ff4a3d'; ctx.lineWidth = 2.2;
          traceGroundTile(ctx, tile); ctx.stroke();
        }
        ctx.restore();
      }
    },
  });
  return sites.length;
}
