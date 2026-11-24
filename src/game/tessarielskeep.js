// The Act IV home uses the original Tessariel's Keep bake and furnishings,
// while its portals, merchants and storage call the Velscour-PC systems.
import { G } from '../state.js';
import { World } from './world.js';
import { TOWN_BIOME } from '../data/biomes.js';
import { KEEP_NAME, CASTELLAN, EMBER_COLOR, KINDLE, TROPHY_BY_ID, defaultDecor } from '../data/keep.js';
import { VENDORS } from '../world/town.js';
import { generateKeep, keepProps, keepDressTile } from '../world/keepworld.js';
import { loadKeepArt, KEEP_DIR } from '../gfx/keepart.js';
import { loadBaked } from '../gfx/castle3dart.js';
import { biomeTileSet } from '../core/assets.js';
import { addLight } from '../gfx/vfx.js';
import { preloadTownSheets } from './render.js';
import { campaignVictoryRecorded } from './endgame.js';
import { findReachableInteractableSpot } from '../core/interactable-hit.js';
import { KeepUI } from '../ui/keep.js';
import { startKeepFolk } from './keepfolk.js';
import { keepState, checkProgress, kindle, kindled, kindleReadyIn } from './keep.js';
import { addEffect, Ring, sparkle, floatText } from '../gfx/vfx.js';

export const TESSARIEL_KEEP_BIOME = {
  id: 'tkeep', name: KEEP_NAME, pack: 'town', palette: TOWN_BIOME.palette,
  wallPalette: TOWN_BIOME.wallPalette, dark: 0.28, light: 10,
  ambient: { type: 'firefly', color: '#c8f060' }, mon: { hue: 0, sat: 1, light: 0 },
  blood: '#8a0b08', torch: '#ffb050', fog: '#06080a', keep: true,
};

const KEEP_FOLK = [CASTELLAN.sprite, '41_friar', '09_knight_silver_censer', '14_knight_dusk_lancer', '42_priest', '13_knight_frostbound'];

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
  const keep = keepState(G.char);
  world.props = keepProps(world, keep.decor || defaultDecor(), keep.have);
  world.npcs = [];
  const folk = startKeepFolk(world, A);
  folk.castellan.use = () => KeepUI.open('sagas');
  world.keepFolk = folk;
  world.npcs.push({ hidden: true, name: '', x: -9, y: -9, update: (dt) => folk.update(dt) });
  const mark = (o) => world.npcs.push({ keepMarker: true, reach: 1.7, flip: false, ...o });
  mark({ name: 'The War Table', x: A.warTable[0], y: A.warTable[1], h: 34, use: () => KeepUI.open('war') });
  mark({ name: 'The Chronicle of Deeds', x: A.chronicle[0], y: A.chronicle[1], h: 40, use: () => KeepUI.open('chronicle') });
  mark({ name: 'The Vault of the Flame', x: A.vault[0], y: A.vault[1], h: 30, use: () => KeepUI.open('vault') });
  A.pedestals.forEach((p, i) => mark({ pedestal: i, x: p.x, y: p.y, h: 26, reach: 1.9,
    get name() { const id = keepState()?.decor?.pedestal?.[i]; return id ? TROPHY_BY_ID[id]?.name : 'An empty pedestal'; },
    use: () => KeepUI.open('furnish', { pedestal: i }) }));

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
  // The old waygate anchor sat behind the high front battlement in the normal camera view.
  // Keep it one aisle inward, where its label, sprite and interaction radius stay unobstructed.
  const portalDepthsAt = reachableKeepSpot(map, generated.start, [17.5, 27.5], occupied.concat([portalActsAt])) || A.waygate.slice(0, 2);
  world.portals = [
    { x: portalActsAt[0], y: portalActsAt[1], active: true, color: '#3a8aff', reach: 2, label: 'Portal to the Acts', use: () => game.openActSelection() },
    { x: portalDepthsAt[0], y: portalDepthsAt[1], active: true, color: '#ff6020', reach: 2, label: `Portal - Depth ${game.maxPortalFloor(G.char)}`, use: () => game.confirmDungeon() },
  ];
  if (campaignVictoryRecorded()) {
    // A.vault is the physical treasury chest anchor. Put the altar on the clear
    // central floor below the dais so it has its own ground contact and sits well
    // clear of both that chest and the east colonnade pillar.
    const at = reachableKeepSpot(map, generated.start, [21, 14.5], occupied);
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
  const flame = { keepFlame: true, name: 'The Sacred Flame', x: A.flame[0], y: A.flame[1], lv: A.flame[2], reach: 2.3, flip: false };
  flame.use = () => {
    const c = G.char, p = world.player;
    if (kindled(c)) { floatText(p.x, p.y, 60, 'The Flame already burns in you', EMBER_COLOR, 12); return; }
    const wait = kindleReadyIn(c);
    if (wait > 0) { floatText(p.x, p.y, 60, `The Flame rests (${Math.ceil(wait / 60000)} min)`, '#b8c0a0', 12); return; }
    if (!kindle(c)) return;
    p.recompute(); addEffect(new Ring(flame.x, flame.y, 0.3, 3.2, 1, '#9cff5a', 4)); sparkle(p.x, p.y, 24, '#c8f060', 18, 0.65);
    G.ui?.log?.(`Tessariel's fire burns in you: <b style="color:${EMBER_COLOR}">Kindled</b> for ${KINDLE.minutes} minutes.`, '#d8f0a0');
    G.game?.autosave?.();
  };
  world.npcs.push(flame);
  checkProgress(G.char);

  await preloadTownSheets(KEEP_FOLK.map((n) => n.sprite));
  return { world, start: generated.start };
}
