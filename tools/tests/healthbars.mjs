import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { G } from '../../src/state.js';
import { BOSS_HEALTH_LAYOUT, DEFAULT_HEALTH_BAR_SETTINGS, HEALTH_BAR_CLASSES, bossFrameTrackBounds, drawHealthBarCanvas, healthBarCanvasLayout, healthBarClass, healthBarSettings, healthBarText, healthBarSummaryText, healthBarValueText, healthBarVisible, isTreasureImpEntity, normalizeHealthBarSettings, overheadHealthBarDrawEligible, overheadHealthBarEligible, preloadHealthBarArt } from '../../src/ui/healthbars.mjs';
import { TREASURE_IMPS } from '../../src/data/treasureimps.js';
import { Creature, drawXray, xray } from '../../src/game/creature.js';
import { isoX } from '../../src/core/view.js';
import { createTreasureImp } from '../../src/game/happenings.js';
import { BIOME_BY_ID } from '../../src/data/biomes.js';

const storedSettings = new Map();
globalThis.localStorage = { getItem: (key) => storedSettings.get(key) || null, setItem: (key, value) => storedSettings.set(key, value) };
globalThis.document ||= { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) }) };

const defaults = normalizeHealthBarSettings();
assert.equal(defaults.theme, 'velscour', 'Velscour theme is the default');
assert.deepEqual(defaults.overhead, { ...DEFAULT_HEALTH_BAR_SETTINGS.overhead }, 'overhead settings have independent default dimensions and visibility');
assert.deepEqual(defaults.target, { ...DEFAULT_HEALTH_BAR_SETTINGS.target }, 'target settings have independent default dimensions and visibility');
assert.deepEqual(defaults.imp, { visibility: 'always' }, 'Treasure Imp visibility defaults to always independently of other creatures');
assert.equal(defaults.overhead.width, 60, 'new and reset overhead bars default to 60% width');
assert.equal(defaults.overhead.height, 100, 'overhead bar height remains at 100% by default');
assert.equal(defaults.target.width, 100, 'boss health bar width remains at 100% by default');
assert.equal(defaults.target.height, 100, 'boss health bar height remains at 100% by default');
assert.equal(normalizeHealthBarSettings({ overhead: { width: 112 } }).overhead.width, 112, 'existing customized overhead width is preserved');
assert.equal(normalizeHealthBarSettings({}).overhead.width, 60, 'reset normalization restores the new default width');
assert.equal(Object.keys(defaults.classes).length, 8, 'all seven creature groups and the player have visibility controls');
assert.equal(defaults.classes.player, false, 'player overhead bar defaults off');
assert.equal(defaults.info.showEnemyName, false, 'overhead creature names default off');
assert.equal(defaults.info.showEnemyLevel, false, 'overhead creature levels default off');
assert.equal(Object.keys(defaults.info).length, 7, 'all optional information switches are present');
assert.equal(defaults.info.showClassificationIconsOverhead, false, 'overhead classification icons default off');
assert.equal(normalizeHealthBarSettings({ info: {} }).info.showClassificationIconsOverhead, false, 'older saves inherit the icons-off default');
assert.equal(normalizeHealthBarSettings({ info: { showClassificationIconsOverhead: true } }).info.showClassificationIconsOverhead, true, 'saved icon preference is retained');
assert.equal(normalizeHealthBarSettings({ theme: 'classic' }).theme, 'classic');
assert.equal(normalizeHealthBarSettings({ overhead: { width: 900, visibility: 'bad' } }).overhead.width, 160, 'saved values are bounded');
assert.equal(normalizeHealthBarSettings({ overhead: { visibility: 'bad' } }).overhead.visibility, 'always', 'unknown visibility values normalize safely');
assert.equal(normalizeHealthBarSettings(null, false).overhead.visibility, 'damaged', 'old Life Bars off preference is preserved');

G.settings.healthBars = {
  overhead: { width: 88, visibility: 'damaged', opacity: 72 }, target: { width: 120 },
  classes: { normal: false, imp: false }, info: { showEnemyLevel: true },
  imp: { visibility: 'hidden', obsoleteFrameMode: 'basic' }, obsoleteImpBar: true,
};
G.settings.lifeBars = false;
const migratedImpSettings = healthBarSettings();
assert.equal(migratedImpSettings.classes.imp, true, 'legacy Imp visibility is reset once');
assert.equal(migratedImpSettings.imp.visibility, 'always', 'legacy Imp mode is reset to always visible');
assert.equal(migratedImpSettings.overhead.width, 88, 'migration preserves customized global width');
assert.equal(migratedImpSettings.overhead.opacity, 72, 'migration preserves customized global opacity');
assert.equal(migratedImpSettings.overhead.visibility, 'damaged', 'migration does not alter other creatures display mode');
assert.equal(migratedImpSettings.classes.normal, false, 'migration does not alter other class preferences');
assert.equal(migratedImpSettings.info.showEnemyLevel, true, 'migration does not alter information preferences');
assert.equal(migratedImpSettings.impPreferencesVersion, 1, 'migration completion is persisted in settings');
assert.equal(JSON.parse(storedSettings.get('velscour_settings_v1')).healthBars.impPreferencesVersion, 1, 'migration marker is written to browser settings storage');
assert.equal(Object.hasOwn(migratedImpSettings, 'obsoleteImpBar'), false, 'obsolete top-level health-bar keys are discarded');
assert.equal(Object.hasOwn(migratedImpSettings.imp, 'obsoleteFrameMode'), false, 'obsolete Imp-specific keys are discarded');
assert.equal(healthBarSettings().classes.imp, true, 'repeated settings reads do not rerun or undo the migration');
migratedImpSettings.imp.visibility = 'damaged';
G.settings.healthBars = normalizeHealthBarSettings(migratedImpSettings);
assert.equal(healthBarSettings().imp.visibility, 'damaged', 'subsequent Imp customization is retained');
G.settings.healthBars = normalizeHealthBarSettings();
G.settings.lifeBars = true;

const samples = [
  [{ rank: 'normal' }, 'normal'], [{ rank: 'champion' }, 'champion'], [{ rank: 'unique' }, 'unique'],
  [{ rank: 'boss' }, 'boss'], [{ rank: 'raid' }, 'boss'], [{ isRaid: true }, 'boss'], [{ nemesis: true }, 'nemesis'], [{ goblin: true }, 'imp'],
  [{ team: 'player', summon: true }, 'companion'], [{ isPlayer: true }, 'player'],
];
for (const [entity, id] of samples) assert.equal(healthBarClass(entity).id, id, `${id} classification resolves correctly`);
assert.equal(HEALTH_BAR_CLASSES.length, 7, 'all seven reference classes are defined');
assert.deepEqual(BOSS_HEALTH_LAYOUT, {
  frameTop: 18 / 178, frameHeight: 160 / 178,
  trackLeft: 0.224, trackRight: 0.084, trackTop: 18 / 178 + 0.33 * (160 / 178), trackHeight: 0.13 * (160 / 178),
  emblemCenterX: 0.14, emblemCenterY: 18 / 178 + 0.395 * (160 / 178), emblemWidth: 0.134, emblemHeight: 0.62 * (160 / 178),
  nameLeft: 0.224, nameRight: 0.084, nameTop: 0.005, nameHeight: 0.09,
  summaryTop: 18 / 178 + 0.70 * (160 / 178), extraTop: 18 / 178 + 0.83 * (160 / 178),
}, 'boss frame components share one relative layout');

G.settings.healthBars = normalizeHealthBarSettings();
G.settings.lifeBars = true;
G.world = { time: 20, _audioCombatUntil: 0 };
G.player = { attackTarget: null };
const monster = { rank: 'normal', hp: 100, maxHp: 100 };
assert.equal(healthBarVisible(monster, 'overhead'), true, 'always mode shows living enemies');
G.settings.healthBars.overhead.visibility = 'damaged';
assert.equal(healthBarVisible(monster, 'overhead'), false, 'damaged mode hides full health');
monster.hp = 99;
assert.equal(healthBarVisible(monster, 'overhead'), true, 'damaged mode shows injured enemies');
G.settings.healthBars.overhead.visibility = 'combat';
assert.equal(healthBarVisible(monster, 'overhead'), false, 'combat mode does not treat dungeon presence alone as combat');
G.world._audioCombatUntil = 21;
assert.equal(healthBarVisible(monster, 'overhead'), true, 'combat mode follows the active combat window');
G.world._audioCombatUntil = 0;
G.settings.healthBars.overhead.visibility = 'targeted';
assert.equal(healthBarVisible(monster, 'overhead'), false);
G.hover = monster;
assert.equal(healthBarVisible(monster, 'overhead'), true, 'targeted mode recognizes the hovered target');
G.settings.healthBars.classes.normal = false;
assert.equal(healthBarVisible(monster, 'overhead'), false, 'class visibility filters are honored');
G.hover = null;
const player = { isPlayer: true, hp: 100, maxHp: 100 };
G.settings.healthBars.classes.player = true;
G.settings.healthBars.overhead.visibility = 'damaged';
assert.equal(healthBarVisible(player, 'overhead'), false, 'player overhead follows damaged-only visibility');
player.hp = 99;
assert.equal(healthBarVisible(player, 'overhead'), true, 'player overhead appears after damage in damaged-only mode');
assert.equal(healthBarVisible(player, 'target'), false, 'player does not appear in the target creature bar');

const detailSettings = normalizeHealthBarSettings({ info: { showEnemyLevel: true, showHealthPercentage: true, showNumericalHealth: true } });
G.settings.healthBars = detailSettings;
assert.match(healthBarText({ rank: 'boss', level: 85, hp: 25, maxHp: 100 }), /Lv\. 85.*Boss.*25%.*25 \/ 100/);
assert.match(healthBarSummaryText({ rank: 'boss', level: 85 }, detailSettings), /Lv\. 85.*Boss/);
assert.equal(healthBarValueText({ hp: 89446, maxHp: 223747 }, detailSettings), '40%  ·  89,446 / 223,747');
assert.equal(healthBarValueText({ hp: 5, maxHp: 10 }, normalizeHealthBarSettings()), '', 'boss health values respect their independent visibility options');

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../../src/ui/hud.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../src/ui/healthbar-settings.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
const creatureDraw = readFileSync(new URL('../../src/game/creature.js', import.meta.url), 'utf8');
const worldRender = readFileSync(new URL('../../src/game/render.js', import.meta.url), 'utf8');
const impFactory = readFileSync(new URL('../../src/game/happenings.js', import.meta.url), 'utf8');
assert.match(html, /id="boss-emblem"/);
assert.match(html, /id="boss-health-text"/);
assert.match(html, /<canvas id="boss-frame"/);
assert.match(hud, /healthBarVisible\(.*'target'\)/);
assert.match(hud, /redrawTargetHealthBarFrame/);
assert.match(hud, /activeBoss \? 1 : 0/);
assert.match(hud, /healthBarClass\(ordinaryTarget\)\.id === 'boss'/, 'only boss-class targets can use the top banner');
assert.match(hud, /healthBarValueText\(barTarget, barSettings\)/, 'boss health values are placed in the bar track');
assert.match(settings, /data-hb-class-next/);
assert.match(settings, /option value="target">Boss Health Bar/);
assert.match(settings, /selectedClass = next === 'target' \? bossClassIndex : lastOverheadClass/);
assert.match(settings, /previewFraction = 1/);
assert.match(settings, /box\.querySelector\('\[data-hb-class-nav\]'\)\.hidden = selectedSystem === 'target'/);
assert.match(settings, /showClassificationIconsOverhead/);
assert.match(settings, /treasureImp: entry\.id === 'imp'/, 'the Imp preview uses the same authoritative family marker as live variants');
assert.match(impFactory, /name: variant\.name, treasureImp: true, impVariant: variant\.id/, 'the shared spawn factory marks every Treasure Imp variant');
assert.match(impFactory, /export function createTreasureImp/, 'automated coverage invokes the production Treasure Imp factory');
assert.match(creatureDraw, /const top = where\.y \+ dy/, 'custom art overhead bars use the rendered sprite ground anchor rather than optional spriteH');
assert.match(settings, /data-hb-info/);
assert.match(settings, /data-hb-imp-visibility/, 'the Imp-specific visibility setting is connected to the settings panel');
assert.match(settings, /Reset to Defaults/);
assert.match(css, /healthbar-dialog/);
assert.match(css, /--hb-boss-frame-top:10\.1124%/);
assert.match(css, /--hb-boss-track-top:39\.7753%/);
assert.match(css, /--hb-boss-track-height:11\.6854%/);
assert.match(css, /#boss-bar\.healthbar-boss #boss-frame \{ z-index:3/);
assert.match(css, /#boss-bar\.healthbar-boss #boss-track \{ z-index:2/);
assert.match(css, /#boss-bar\.healthbar-boss #boss-sub \{ left:var\(--hb-boss-name-left\);right:var\(--hb-boss-name-right\)/);
assert.match(css, /#boss-bar\.healthbar-boss #boss-extra \{ left:var\(--hb-boss-name-left\);right:var\(--hb-boss-name-right\)/);
assert.match(hud, /bossFrameTrackBounds\(rootRect\.width, rootRect\.height \* BOSS_HEALTH_LAYOUT\.frameHeight, emblemRight\)/, 'live HUD positions the track from actual frame and emblem dimensions');
assert.match(css, /--hb-boss-emblem-center-x:14%/);
assert.match(css, /healthbar-preview-wrap \{ overflow:visible/);
assert.match(css, /healthbar-preview-heading > div\[hidden\] \{ display:none; \}/);
assert.match(settings, /<canvas data-hb-preview width="980" height="300"/);
assert.match(hud, /\$\('#boss-name'\)\.textContent = barTarget\.name \|\| ''/, 'boss names remain visible independently of overhead name labels');
assert.match(readFileSync(new URL('../../src/ui/healthbars.mjs', import.meta.url), 'utf8'), /drawHealthBarFrame/);
assert.doesNotMatch(creatureDraw, /e\.bc\s*=\s*col/, 'the old bar-color variable is not referenced after the health-bar renderer replaced it');
assert.match(creatureDraw, /\[health-bar\] overhead setup failed; continuing creature rendering/, 'health-bar setup failures are isolated from creature/world rendering');
assert.match(creatureDraw, /\[health-bar\] overhead bar failed; continuing world rendering/, 'deferred bar failures are isolated from the world render pass');
assert.match(worldRender, /if \(!xray\.n && !xray\.barN && !walls\) return;/, 'the see-through pass runs even when a creature has a bar but no outline record');
let restoreCount = 0;
const throwingContext = {
  globalAlpha: 1,
  saves: 0,
  save() { this.saves++; },
  restore() { restoreCount++; this.saves--; },
  beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, clip() {}, stroke() {},
  fillRect() { throw new Error('intentional canvas failure'); },
  set fillStyle(value) {}, set strokeStyle(value) {}, set lineWidth(value) {},
};
G.settings.healthBars = normalizeHealthBarSettings({ theme: 'classic' });
assert.throws(() => drawHealthBarCanvas(throwingContext, { hp: 1, maxHp: 1 }, 0, 0, 20, 10), /intentional canvas failure/);
assert.equal(throwingContext.saves, 0, 'nested canvas state is restored even if overhead bar drawing fails');
assert.equal(restoreCount, 2, 'compact-bar and renderer canvas states are restored');

const assetRoot = new URL('../../assets/ui/healthbars/', import.meta.url);
for (const name of ['overhead-frame-left.webp', 'overhead-frame-tile.webp', 'overhead-frame-right.webp', 'overhead-empty.webp', 'overhead-boss-left.webp', 'overhead-boss-right.webp', ...['normal', 'champion', 'nemesis', 'imp', 'companion'].flatMap((id) => [`overhead-frame-${id}-left.webp`, `overhead-frame-${id}-right.webp`]), 'fill-red.webp', 'fill-blue.webp', 'fill-gold.webp', 'fill-crimson.webp', 'fill-purple.webp', 'fill-emerald.webp', 'fill-teal.webp']) {
  assert.equal(existsSync(new URL(name, assetRoot)), true, `${name} is packaged for overhead bars`);
}
class TestImage {
  complete = true;
  naturalWidth = 256;
  naturalHeight = 128;
  width = 256;
  height = 128;
  set src(value) { this._src = value; }
}
globalThis.Image = TestImage;
preloadHealthBarArt();
G.char ||= { level: 40, depth: 150 };
G.player ||= { st: { goldFind: 0, markGold: 0 } };
G.player.st ||= { goldFind: 0, markGold: 0 };
const impTestWorld = { depth: 150, biome: BIOME_BY_ID.catacombs, kind: 'dungeon', time: 0, creatures: [], happen: { imps: [] },
  add(entity) { entity.world = this; this.creatures.push(entity); } };
const actualImps = new Map();
function recordingContext() {
  return {
    globalAlpha: 1, calls: [], styles: [], saves: 0, restores: 0, save() { this.saves++; }, restore() { this.saves--; this.restores++; }, beginPath() {}, rect() {}, clip() {},
    drawImage(img, ...args) { this.calls.push(img._src); }, fillRect() {}, strokeRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    set fillStyle(value) { this.styles.push(value); }, set shadowColor(value) {}, set shadowBlur(value) {},
  };
}
G.settings.healthBars = normalizeHealthBarSettings();
for (const entry of HEALTH_BAR_CLASSES) {
  const ctx = recordingContext();
  drawHealthBarCanvas(ctx, { rank: entry.id, hp: 43, maxHp: 100 }, 0, 0, 110, 12, { system: 'overhead' });
  assert.ok(ctx.calls.some((src) => src.endsWith(`fill-${entry.fill}.webp`)), `${entry.id} uses its textured classification fill`);
  assert.ok(ctx.calls.includes('assets/ui/healthbars/overhead-frame-tile.webp'), `${entry.id} uses the illustrated, non-distorting center rail`);
  assert.ok(!ctx.calls.some((src) => /\/normal\.webp|\/champion\.webp|\/unique\.webp|\/boss\.webp|\/nemesis\.webp|\/imp\.webp|\/companion\.webp/.test(src)), `${entry.id} has no overhead classification emblem`);
  const capId = ['normal', 'champion', 'nemesis', 'imp', 'companion'].includes(entry.id) ? entry.id : null;
  const leftCap = entry.id === 'boss' ? 'overhead-boss-left.webp' : capId ? `overhead-frame-${capId}-left.webp` : 'overhead-frame-left.webp';
  const rightCap = entry.id === 'boss' ? 'overhead-boss-right.webp' : capId ? `overhead-frame-${capId}-right.webp` : 'overhead-frame-right.webp';
  assert.ok(ctx.calls.some((src) => src.endsWith(leftCap)), `${entry.id} uses its appropriate cached left cap`);
  assert.ok(ctx.calls.some((src) => src.endsWith(rightCap)), `${entry.id} uses its appropriate cached right cap`);
}
G.settings.healthBars = normalizeHealthBarSettings({ info: { showClassificationIconsOverhead: true } });
for (const entry of HEALTH_BAR_CLASSES) {
  const ctx = recordingContext();
  drawHealthBarCanvas(ctx, { rank: entry.id, hp: 50, maxHp: 100 }, 0, 0, 110, 12, { system: 'overhead' });
  assert.ok(ctx.calls.includes(`assets/ui/healthbars/${entry.icon}.webp`), `${entry.id} overhead classification artwork is shown when enabled`);
}
assert.equal(normalizeHealthBarSettings(null).info.showClassificationIconsOverhead, false, 'reset to defaults turns overhead classification icons off');
assert.equal(TREASURE_IMPS.length, 20, 'all registered Treasure Imp variants are included in the family audit');
const camT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function queuedBarContext() {
  const ctx = recordingContext();
  ctx.canvas = { width: 640, height: 480 };
  ctx.setTransform = () => {};
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.translate = ctx.rotate = ctx.scale = () => {};
  ctx.ellipse = ctx.arc = ctx.moveTo = ctx.lineTo = ctx.closePath = ctx.fill = ctx.stroke = ctx.fillText = () => {};
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.imageCalls = [];
  ctx.drawImage = (img, ...args) => ctx.imageCalls.push({ src: img._src, args });
  ctx.fillRects = [];
  ctx.fillRect = (...args) => ctx.fillRects.push({ color: ctx.currentFill, args });
  Object.defineProperty(ctx, 'fillStyle', { get() { return ctx.currentFill; }, set(value) { ctx.currentFill = value; ctx.styles.push(value); } });
  return ctx;
}
function exerciseLiveOverheadPath(variant, fraction, theme) {
  const imp = actualImps.get(variant.id) || createTreasureImp(impTestWorld, [100, 100], variant, { event: true });
  actualImps.set(variant.id, imp);
  imp.targetable = false; // mirrors the untargetable flee state that exposed the old outline coupling
  imp.hp = imp.maxHp * fraction;
  imp.spawnT = 1;
  G.settings.healthBars = normalizeHealthBarSettings({ theme, impPreferencesVersion: 1, overhead: { smoothHealthDepletion: false } });
  xray.on = true; xray.n = 0; xray.barN = 0;
  const ctx = queuedBarContext();
  // The production factory creates a Monster instance with its real variant
  // marker, custom sprite frame, health values, and Creature.draw path.
  imp.draw(ctx);
  assert.equal(xray.n, 0, `${variant.id} does not require an outline entry to queue its bar`);
  assert.equal(xray.barN, 1, `${variant.id} reaches the deferred overhead bar renderer`);
  const queued = xray.bars[0];
  assert.equal(queued.entity, imp, `${variant.id} queued entity is the live imp`);
  assert.equal(imp.spriteH, undefined, `${variant.id} factory-created custom-art creature reproduces the old missing spriteH field`);
  assert.equal(queued.alpha, 1, `${variant.id} bar receives visible opacity`);
  assert.ok(Number.isFinite(imp.barTop) && imp.barHeight > 0, `${variant.id} has finite screen-space health-bar bounds`);
  assert.ok(Number.isFinite(queued.x) && Number.isFinite(queued.y) && queued.w > 0 && queued.h > 0,
    `${variant.id} bar receives valid anchored coordinates and dimensions (${JSON.stringify({ x: queued.x, y: queued.y, w: queued.w, h: queued.h, top: imp.barTop, height: imp.barHeight, barN: xray.barN })})`);
  assert.equal(queued.x + queued.w / 2, isoX(imp.x, imp.y), `${variant.id} bar follows its actual projected creature position`);
  assert.equal(queued.entity.hp, imp.maxHp * fraction, `${variant.id} renderer retains its factory-created current health`);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  drawXray(ctx, camT, true, box, false);
  assert.equal(xray.barN, 0, `${variant.id} queue is released after rendering`);
  if (theme === 'velscour') {
    const fill = ctx.imageCalls.find(({ src, args }) => String(src || '').endsWith('fill-emerald.webp') && args.length === 8);
    const empty = ctx.imageCalls.find(({ src, args }) => String(src || '').endsWith('overhead-empty.webp') && args.length === 4);
    assert.ok(fill, `${variant.id} actual deferred renderer selects the textured green fill`);
    assert.ok(empty, `${variant.id} actual deferred renderer provides a health track`);
    assert.ok(Math.abs(fill.args[6] - empty.args[2] * fraction) < 1e-6,
      `${variant.id} actual renderer scales green fill for ${Math.round(fraction * 100)}% health`);
    assert.ok(!ctx.imageCalls.some(({ src }) => String(src || '').endsWith('/imp.webp')),
      `${variant.id} has no classification icon when the optional icon setting is off`);
  } else assert.ok(ctx.styles.includes('#28934E'), `${variant.id} Classic live renderer uses the approved emerald fill`);
  return { imp, ctx, queued };
}
for (const variant of TREASURE_IMPS) {
  for (const theme of ['velscour', 'classic']) {
    G.settings.healthBars = normalizeHealthBarSettings({ theme });
    const imp = { team: 'enemy', treasureImp: true, rank: 'unique', hp: 100, maxHp: 100, targetable: false };
    assert.equal(healthBarClass(imp).id, 'imp', `${variant.id} Treasure Imp keeps its emerald classification despite its unique rank`);
    assert.equal(isTreasureImpEntity(imp), true, `${variant.id} uses the shared Treasure Imp family classification`);
    assert.equal(overheadHealthBarEligible(imp), true, `${variant.id} remains eligible for an overhead bar while fleeing/untargetable`);
    assert.equal(healthBarVisible(imp, 'overhead'), true, `${variant.id} follows the imp visibility setting`);
    assert.equal(overheadHealthBarDrawEligible({ ...imp, noLifeBar: true }), true, `${variant.id} is not suppressed by a generic noLifeBar rendering flag`);
    assert.equal(overheadHealthBarDrawEligible({ ...imp, ghostDraw: true }), false, `${variant.id} still respects ghost rendering exclusions`);
    for (const fraction of [1, 0.5, 0.08]) {
      imp.hp = imp.maxHp * fraction;
      exerciseLiveOverheadPath(variant, fraction, theme);
      const ctx = recordingContext();
      drawHealthBarCanvas(ctx, imp, 0, 0, 90, 12, { system: 'overhead', forceFraction: fraction });
      if (theme === 'velscour') {
        assert.ok(ctx.calls.includes('assets/ui/healthbars/fill-emerald.webp'), `${variant.id} Velscour theme renders emerald fill at ${Math.round(fraction * 100)}% health`);
        assert.ok(!ctx.calls.includes('assets/ui/healthbars/imp.webp'), `${variant.id} overhead bar has no classification emblem by default`);
      } else assert.ok(ctx.styles.includes('#28934E'), `${variant.id} Classic theme retains emerald fill at ${Math.round(fraction * 100)}% health`);
    }
  }
}
const filteredLiveImp = Object.create(Creature.prototype);
Object.assign(filteredLiveImp, { team: 'enemy', treasureImp: true, impVariant: 'treasure', rank: 'unique',
  hp: 100, maxHp: 100, targetable: false, dead: false, status: {}, curses: {}, animT: 0, scale: 1 });
assert.equal(healthBarClass(filteredLiveImp).id, 'imp', 'the live family classification never selects the boss bar');
xray.on = true; xray.n = 0; xray.barN = 0;
G.settings.healthBars = normalizeHealthBarSettings({ classes: { imp: false }, impPreferencesVersion: 1 });
filteredLiveImp.drawOverhead(queuedBarContext(), 240, 120, 60);
assert.equal(xray.barN, 0, 'the live rendering path honors the Treasure Imp visibility checkbox');
G.settings.healthBars = normalizeHealthBarSettings({ impPreferencesVersion: 1, imp: { visibility: 'hidden' } });
filteredLiveImp.drawOverhead(queuedBarContext(), 240, 120, 60);
assert.equal(xray.barN, 0, 'the live rendering path honors the dedicated Imp visibility mode');
G.settings.healthBars = normalizeHealthBarSettings();
const escapedImp = { team: 'enemy', treasureImp: true, dungeonEventImpEscaped: true, targetable: false };
assert.equal(overheadHealthBarEligible(escapedImp), false, 'an escaped/despawned imp does not keep a stale health bar');
const visibilityProbeImp = { team: 'enemy', treasureImp: true, hp: 100, maxHp: 100, targetable: false };
G.settings.healthBars = normalizeHealthBarSettings({ overhead: { visibility: 'damaged' }, impPreferencesVersion: 1 });
assert.equal(healthBarVisible(visibilityProbeImp, 'overhead'), true, 'full-health Imps remain visible when other creatures use damaged-only mode');
G.settings.healthBars.imp.visibility = 'damaged';
assert.equal(healthBarVisible(visibilityProbeImp, 'overhead'), false, 'an explicitly selected Imp damaged-only mode hides a full-health imp');
visibilityProbeImp.hp = 99;
assert.equal(healthBarVisible(visibilityProbeImp, 'overhead'), true, 'damaged-only mode shows an injured imp');
G.settings.healthBars.imp.visibility = 'hidden';
assert.equal(healthBarVisible(visibilityProbeImp, 'overhead'), false, 'the dedicated Imp visibility mode can hide Imp bars');
G.settings.healthBars = normalizeHealthBarSettings();
G.settings.healthBars = normalizeHealthBarSettings({ info: { showClassificationIconsOverhead: true } });
const impIconContext = recordingContext();
drawHealthBarCanvas(impIconContext, { team: 'enemy', treasureImp: true, rank: 'unique', hp: 100, maxHp: 100 }, 0, 0, 90, 12, { system: 'overhead' });
assert.ok(impIconContext.calls.includes('assets/ui/healthbars/imp.webp'), 'the optional classification icon appears when enabled');
G.settings.healthBars.classes.imp = false;
assert.equal(healthBarVisible({ team: 'enemy', treasureImp: true, hp: 50, maxHp: 100 }, 'overhead'), false, 'the Treasure Imp visibility setting is honored for the canonical classification');
G.settings.healthBars.classes.imp = true;
const normalTargetLayout = healthBarCanvasLayout({ id: 'normal' }, 0, 0, 760, 155, 'target');
assert.ok(normalTargetLayout.emblem.centerX + normalTargetLayout.emblem.size / 2 < normalTargetLayout.track.x, 'normal target emblem clears the start of the health track');
assert.ok(normalTargetLayout.badge.centerX + normalTargetLayout.badge.radius * 2.45 < normalTargetLayout.track.x + normalTargetLayout.track.width, 'target badges remain inside the track end caps');
for (const [width, height] of [[456, 248], [1216, 93]]) {
  const resized = healthBarCanvasLayout({ id: 'normal' }, 0, 0, width, height, 'target');
  assert.ok(resized.emblem.centerX + resized.emblem.size / 2 < resized.track.x, `normal target emblem clears the fill at ${width}x${height}`);
}
const bossTargetLayout = healthBarCanvasLayout({ id: 'boss' }, 0, 0, 660, 178, 'target');
assert.ok(bossTargetLayout.emblem.centerX + bossTargetLayout.emblem.size / 2 <= bossTargetLayout.track.x, 'boss emblem meets but does not overlap the health track');
assert.ok(Math.abs(bossTargetLayout.emblem.centerY - (bossTargetLayout.track.y + bossTargetLayout.track.height / 2)) < 1e-9, 'boss emblem is vertically centered on the actual health track');
for (const widthScale of [0.6, 1, 1.5]) for (const heightScale of [0.6, 1, 1.5]) {
  const width = 660 * widthScale, height = 178 * heightScale;
  const layout = healthBarCanvasLayout({ id: 'boss' }, 0, 0, width, height, 'target');
  const aperture = bossFrameTrackBounds(width, height * BOSS_HEALTH_LAYOUT.frameHeight, layout.emblem.centerX + layout.emblem.size / 2);
  assert.ok(Math.abs(layout.track.x - aperture.left) < 1e-9, `boss track starts at the artwork aperture for ${widthScale * 100}% x ${heightScale * 100}%`);
  assert.ok(Math.abs(layout.track.x + layout.track.width - aperture.right) < 1e-9, `boss track ends at the artwork aperture for ${widthScale * 100}% x ${heightScale * 100}%`);
  assert.ok(layout.track.width > 0, 'boss track remains usable at configured sizes');
  const partialWidth = layout.track.width * 0.6;
  assert.ok(layout.track.x + partialWidth < aperture.right, 'partial health depletes from right to left');
  for (const fraction of [1, 0.6, 0.01]) {
    const ctx = recordingContext(), calls = [];
    ctx.drawImage = (img, ...args) => calls.push({ src: img._src, args });
    drawHealthBarCanvas(ctx, { rank: 'boss', hp: fraction * 100, maxHp: 100 }, 0, 0, width, height, { system: 'target', forceFraction: fraction });
    const fill = calls.find(({ src, args }) => src.endsWith('fill-crimson.webp') && args.length === 8);
    assert.ok(fill, 'boss texture is drawn at every tested fill amount');
    assert.equal(fill.args[4], layout.track.x, 'health changes preserve the measured left edge');
    assert.ok(Math.abs(fill.args[6] - layout.track.width * fraction) < 1e-8, 'health depletes from the right edge only');
  }
}
const maxPreviewWidth = 760 * 1.6;
const responsivePreviewWidth = Math.max(980, Math.ceil(maxPreviewWidth + 220));
assert.ok((responsivePreviewWidth - maxPreviewWidth) / 2 >= 110, 'preview canvas retains 110px safety margins at maximum target width');
const targetCtx = recordingContext(), targetCalls = [];
targetCtx.drawImage = (img, ...args) => targetCalls.push({ src: img._src, args });
G.settings.healthBars = normalizeHealthBarSettings({ info: { showHealthPercentage: true, showNumericalHealth: true } });
drawHealthBarCanvas(targetCtx, { rank: 'boss', hp: 40, maxHp: 100 }, 10, 20, 660, 160, { system: 'target', forceFraction: 0.4 });
const bossFillCall = targetCalls.find(({ src, args }) => src.endsWith('fill-crimson.webp') && args.length === 8);
assert.ok(bossFillCall, 'boss target preview uses the crimson texture');
const bossFrameIndex = targetCalls.findIndex(({ src }) => src.endsWith('frame-boss.webp'));
const bossFillIndex = targetCalls.findIndex(({ src }) => src.endsWith('fill-crimson.webp'));
assert.ok(bossFillIndex >= 0 && bossFrameIndex > bossFillIndex, 'boss frame overlays the fill at the measured aperture edge to mask subpixel seams');
const renderedBossLayout = healthBarCanvasLayout({ id: 'boss' }, 10, 20, 660, 160, 'target');
const [, , , , bossFillX, bossFillY, bossFillW, bossFillH] = bossFillCall.args;
assert.equal(bossFillX, renderedBossLayout.track.x);
assert.equal(bossFillY, 20 + 160 * BOSS_HEALTH_LAYOUT.trackTop);
assert.equal(bossFillW, renderedBossLayout.track.width * 0.4);
assert.equal(bossFillH, 160 * BOSS_HEALTH_LAYOUT.trackHeight);
const fullBossLayout = healthBarCanvasLayout({ id: 'boss' }, 0, 0, 660, 178, 'target');
assert.equal(fullBossLayout.track.x + fullBossLayout.track.width, bossFrameTrackBounds(660, 160).right, '100% health reaches the artwork interior right boundary');
const emblemCall = targetCalls.find(({ src }) => src.endsWith('/boss.webp'));
assert.ok(emblemCall, 'boss emblem remains part of the top banner');
const emblemSize = Math.min(660 * BOSS_HEALTH_LAYOUT.emblemWidth, 160 * BOSS_HEALTH_LAYOUT.emblemHeight);
assert.equal(emblemCall.args[0], 10 + 660 * BOSS_HEALTH_LAYOUT.emblemCenterX - emblemSize / 2);
assert.equal(emblemCall.args[1], 20 + 160 * BOSS_HEALTH_LAYOUT.emblemCenterY - emblemSize / 2);
const isolatedFailureContext = recordingContext();
isolatedFailureContext.drawImage = () => { throw new Error('intentional artwork draw failure'); };
assert.throws(() => drawHealthBarCanvas(isolatedFailureContext, { rank: 'normal', hp: 1, maxHp: 1 }, 0, 0, 100, 12, { system: 'overhead' }), /intentional artwork draw failure/);
assert.equal(isolatedFailureContext.saves, 0, 'image-backed bars restore nested canvas state after a draw failure');
assert.equal(isolatedFailureContext.restores, 2);
console.log(`Health-bar unit checks and actual factory/draw/X-ray-path regression passed for ${TREASURE_IMPS.length} Treasure Imp variants.`);
