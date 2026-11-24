// The Act IV home uses the original Tessariel's Keep bake and furnishings,
// while its portals, merchants and storage call the Velscour-PC systems.
import { G } from '../state.js';
import { World } from './world.js';
import { TOWN_BIOME } from '../data/biomes.js';
import { KEEP_NAME, defaultDecor } from '../data/tessarielskeep.js';
import { VENDORS } from '../world/town.js';
import { generateKeep, keepProps, keepDressTile } from '../world/keepworld.js';
import { loadKeepArt, KEEP_DIR } from '../gfx/keepart.js';
import { loadBaked } from '../gfx/castle3dart.js';
import { biomeTileSet } from '../core/assets.js';
import { addLight } from '../gfx/vfx.js';
import { preloadTownSheets } from './render.js';
import { campaignVictoryRecorded } from './endgame.js';
import { findReachableInteractableSpot } from '../core/interactable-hit.js';

export const TESSARIEL_KEEP_BIOME = {
  id: 'tkeep', name: KEEP_NAME, pack: 'town', palette: TOWN_BIOME.palette,
  wallPalette: TOWN_BIOME.wallPalette, dark: 0.28, light: 10,
  ambient: { type: 'firefly', color: '#c8f060' }, mon: { hue: 0, sat: 1, light: 0 },
  blood: '#8a0b08', torch: '#ffb050', fog: '#06080a', keep: true,
};

const KEEP_FOLK = [
  { name: 'Castellan Elsabet', role: 'Keeper of the Flame', sprite: '07_knight_ivory_mantle', x: 21, y: 10.8, greet: "Welcome to Tessariel's Keep. The roads below are open to those who have earned them." },
  { name: 'Brother Cael', role: 'Tends the Flame', sprite: '41_friar', x: 17.2, y: 20.4, greet: 'May the Sacred Flame keep your path bright.' },
  { name: 'Ser Cassius', role: 'Knight of the Silver Censer', sprite: '09_knight_silver_censer', x: 24.8, y: 20.2, greet: 'The Keep stands ready. Take what aid you need before descending.' },
  { name: 'Kestrel', role: 'Dusk Lancer', sprite: '14_knight_dusk_lancer', x: 14.5, y: 29.1, greet: 'I have walked these halls for years. The eastern stair is the quickest way up.' },
  { name: 'Mother Agatha', role: 'Keeper of the Chronicle', sprite: '42_priest', x: 27.5, y: 13.5, greet: 'Every road leaves a mark in the Chronicle.' },
  { name: 'Halvard', role: 'the Frostbound', sprite: '13_knight_frostbound', x: 18.2, y: 30, greet: 'The gate is watched. The road below is yours.' },
];

const SERVICE_SPOTS = [
  [11.5, 13.5], [11.5, 17.5], [11.5, 22.5], [11.5, 27.5],
  [30.5, 13.5], [30.5, 17.5], [30.5, 22.5], [30.5, 27.5],
];

export function reachableKeepSpot(map, start, requested, occupied = []) {
  const [x, y] = requested;
  const candidates = [];
  for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const px = Math.floor(x) + dx + 0.5, py = Math.floor(y) + dy + 0.5;
    if (!map.walkable(px, py) || !map.circleFree(px, py, 0.38)) continue;
    if (occupied.some(([ox, oy]) => Math.hypot(px - ox, py - oy) < 2.05)) continue;
    const at = findReachableInteractableSpot(map, start, px, py, 1.4, 0.38, 0.42);
    if (at) candidates.push({ at, score: Math.hypot(px - x, py - y) });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.at || null;
}

function makeKeepFolk(map, start) {
  const occupied = [];
  return KEEP_FOLK.map((record) => {
    const at = reachableKeepSpot(map, start, [record.x, record.y], occupied);
    if (!at) return null;
    occupied.push(at);
    return {
      name: record.name, role: record.role, townsfolkSpriteId: record.sprite, frameCount: 10,
      x: at[0], y: at[1], reach: 1.6, flip: false, animT: 0, idleH: 172,
      update(dt) { this.animT += dt; this.talkT = Math.max(0, (this.talkT || 0) - dt); },
      use() {
        this.talkText = record.greet; this.talkT = 5; this.talkAge = 0;
        this.emotion = 'happy'; this.emotionT = 2.5;
      },
    };
  }).filter(Boolean);
}

/** Load the original bake once and assemble the Keep around fork-native services. */
export async function buildTessarielKeep(game, services) {
  await Promise.all([loadBaked(KEEP_DIR), loadKeepArt()]);
  const generated = generateKeep(), { map, anchors: A } = generated;
  const world = new World('town', {
    map, tileset: biomeTileSet(TOWN_BIOME), biome: TESSARIEL_KEEP_BIOME, depth: 0,
    townId: 'act4_town', buildings: [], wallHangings: [], props: [],
  });
  world.keep = true;
  world.layout = generated.layout;
  world.anchors = A;
  map.dressTile = keepDressTile(world);
  world.props = keepProps(world, defaultDecor(), { trophy: [] });
  world.npcs = makeKeepFolk(map, generated.start);

  const occupied = world.npcs.map((n) => [n.x, n.y]);
  const vendorPositions = [];
  for (const requested of SERVICE_SPOTS) {
    const at = reachableKeepSpot(map, generated.start, requested, occupied.concat(vendorPositions));
    if (at) vendorPositions.push(at);
  }
  VENDORS.forEach((vendor, i) => {
    const at = vendorPositions[i];
    if (!at) return;
    world.npcs.push({ vendor, x: at[0], y: at[1], reach: 1.8, flip: false, animT: 0,
      update(dt) { this.animT += dt; this.talkT = Math.max(0, (this.talkT || 0) - dt); },
      use: () => services.openVendor(vendor.id),
    });
  });
  occupied.push(...vendorPositions);

  const addStorage = (point, opts) => {
    const at = reachableKeepSpot(map, generated.start, point, occupied);
    if (!at) return;
    occupied.push(at);
    world.npcs.push({ ...opts, x: at[0], y: at[1], reach: 1.7, flip: false });
  };
  addStorage(A.stash, { stash: true, name: 'Storage Chest', use: services.openStash });
  addStorage(A.reliquary, { stash: true, reliquary: true, name: 'The Reliquary', use: services.openReliquary });
  addStorage(A.jewelBox, { stash: true, jewelBox: true, name: 'Jewel Box', use: services.openJewelBox });

  const portalActsAt = reachableKeepSpot(map, generated.start, A.townPortal, occupied) || A.townPortal.slice(0, 2);
  const portalDepthsAt = reachableKeepSpot(map, generated.start, A.waygate, occupied.concat([portalActsAt])) || A.waygate.slice(0, 2);
  world.portals = [
    { x: portalActsAt[0], y: portalActsAt[1], active: true, color: '#8fd45a', reach: 2, keepGate: true, label: 'Portal to the Acts', use: () => game.openActSelection() },
    { x: portalDepthsAt[0], y: portalDepthsAt[1], active: true, color: '#ff6020', reach: 2, label: `Portal - Depth ${game.maxPortalFloor(G.char)}`, use: () => game.confirmDungeon() },
  ];
  if (campaignVictoryRecorded()) {
    const at = reachableKeepSpot(map, generated.start, A.vault, occupied);
    if (at) world.npcs.push({ altar: true, name: 'Altar of Heresy', x: at[0], y: at[1], reach: 1.8, flip: false, use: services.openHeresies });
  }

  // Keep lighting is emitted by one town-owned updater and remains bounded.
  world.npcs.push({ hidden: true, x: -9, y: -9, update(dt) {
    this.animT = (this.animT || 0) + dt;
    const t = this.animT;
    addLight(A.flame[0], A.flame[1], 5.2 + Math.sin(t * 2.1) * 0.25, 0.82, 34, '#9cff68', true);
    for (const [x, y] of A.braziers) addLight(x, y, 2.6 + Math.sin(t * 3 + x) * 0.12, 0.65, 22, '#ffb060');
    for (const portal of world.portals) addLight(portal.x, portal.y, 2.4, 0.65, 28, portal.color);
  } });
  world.npcs.push({ keepFlame: true, name: 'The Sacred Flame', x: A.flame[0], y: A.flame[1], lv: A.flame[2], reach: 1.8, flip: false,
    use: () => services.describeFlame() });

  await preloadTownSheets(KEEP_FOLK.map((n) => n.sprite));
  return { world, start: generated.start };
}
