import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { G } from '../../src/state.js';
import { BOSS_HEALTH_LAYOUT, DEFAULT_HEALTH_BAR_SETTINGS, HEALTH_BAR_CLASSES, drawHealthBarCanvas, healthBarCanvasLayout, healthBarClass, healthBarSettings, healthBarText, healthBarSummaryText, healthBarValueText, healthBarVisible, normalizeHealthBarSettings, overheadHealthBarEligible, preloadHealthBarArt } from '../../src/ui/healthbars.mjs';
import { TREASURE_IMPS } from '../../src/data/treasureimps.js';

globalThis.localStorage ||= { getItem: () => null, setItem: () => {} };

const defaults = normalizeHealthBarSettings();
assert.equal(defaults.theme, 'velscour', 'Velscour theme is the default');
assert.deepEqual(defaults.overhead, { ...DEFAULT_HEALTH_BAR_SETTINGS.overhead }, 'overhead settings have independent default dimensions and visibility');
assert.deepEqual(defaults.target, { ...DEFAULT_HEALTH_BAR_SETTINGS.target }, 'target settings have independent default dimensions and visibility');
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
assert.match(settings, /data-hb-info/);
assert.match(settings, /Reset to Defaults/);
assert.match(css, /healthbar-dialog/);
assert.match(css, /--hb-boss-frame-top:10\.1124%/);
assert.match(css, /--hb-boss-track-top:39\.7753%/);
assert.match(css, /--hb-boss-track-height:11\.6854%/);
assert.match(css, /#boss-bar\.healthbar-boss #boss-frame \{ z-index:1/);
assert.match(css, /#boss-bar\.healthbar-boss #boss-track \{ z-index:2/);
assert.match(css, /--hb-boss-emblem-center-x:14%/);
assert.match(css, /healthbar-preview-wrap \{ overflow:visible/);
assert.match(css, /healthbar-preview-heading > div\[hidden\] \{ display:none; \}/);
assert.match(settings, /<canvas data-hb-preview width="980" height="300"/);
assert.match(hud, /\$\('#boss-name'\)\.textContent = barTarget\.name \|\| ''/, 'boss names remain visible independently of overhead name labels');
assert.match(readFileSync(new URL('../../src/ui/healthbars.mjs', import.meta.url), 'utf8'), /drawHealthBarFrame/);
assert.doesNotMatch(creatureDraw, /e\.bc\s*=\s*col/, 'the old bar-color variable is not referenced after the health-bar renderer replaced it');
assert.match(creatureDraw, /\[health-bar\] overhead setup failed; continuing creature rendering/, 'health-bar setup failures are isolated from creature/world rendering');
assert.match(creatureDraw, /\[health-bar\] overhead bar failed; continuing world rendering/, 'deferred bar failures are isolated from the world render pass');
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
  set src(value) { this._src = value; }
}
globalThis.Image = TestImage;
preloadHealthBarArt();
function recordingContext() {
  return {
    globalAlpha: 1, calls: [], saves: 0, restores: 0, save() { this.saves++; }, restore() { this.saves--; this.restores++; }, beginPath() {}, rect() {}, clip() {},
    drawImage(img, ...args) { this.calls.push(img._src); }, fillRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    set fillStyle(value) {}, set shadowColor(value) {}, set shadowBlur(value) {},
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
for (const variant of TREASURE_IMPS) {
  G.settings.healthBars = normalizeHealthBarSettings();
  const imp = { team: 'enemy', goblin: true, impVariant: variant.id, rank: 'unique', hp: 100, maxHp: 100, targetable: false };
  assert.equal(healthBarClass(imp).id, 'imp', `${variant.id} Treasure Imp keeps its emerald classification despite its unique rank`);
  assert.equal(overheadHealthBarEligible(imp), true, `${variant.id} remains eligible for an overhead bar while fleeing/untargetable`);
  assert.equal(healthBarVisible(imp, 'overhead'), true, `${variant.id} follows the imp visibility setting`);
  for (const fraction of [1, 0.5, 0.08]) {
    imp.hp = imp.maxHp * fraction;
    const ctx = recordingContext();
    drawHealthBarCanvas(ctx, imp, 0, 0, 90, 12, { system: 'overhead', forceFraction: fraction });
    assert.ok(ctx.calls.includes('assets/ui/healthbars/fill-emerald.webp'), `${variant.id} renders emerald fill at ${Math.round(fraction * 100)}% health`);
    assert.ok(!ctx.calls.includes('assets/ui/healthbars/imp.webp'), `${variant.id} overhead bar has no classification emblem`);
  }
}
G.settings.healthBars.classes.imp = false;
assert.equal(healthBarVisible({ team: 'enemy', goblin: true, impVariant: 'treasure', hp: 50, maxHp: 100 }, 'overhead'), false, 'the Treasure Imp visibility setting is honored');
G.settings.healthBars.classes.imp = true;
const normalTargetLayout = healthBarCanvasLayout({ id: 'normal' }, 0, 0, 760, 155, 'target');
assert.ok(normalTargetLayout.emblem.centerX + normalTargetLayout.emblem.size / 2 < normalTargetLayout.track.x, 'normal target emblem clears the start of the health track');
assert.ok(normalTargetLayout.badge.centerX + normalTargetLayout.badge.radius * 2.45 < normalTargetLayout.track.x + normalTargetLayout.track.width, 'target badges remain inside the track end caps');
for (const [width, height] of [[456, 248], [1216, 93]]) {
  const resized = healthBarCanvasLayout({ id: 'normal' }, 0, 0, width, height, 'target');
  assert.ok(resized.emblem.centerX + resized.emblem.size / 2 < resized.track.x, `normal target emblem clears the fill at ${width}x${height}`);
}
const bossTargetLayout = healthBarCanvasLayout({ id: 'boss' }, 0, 0, 660, 178, 'target');
assert.ok(bossTargetLayout.emblem.centerX + bossTargetLayout.emblem.size / 2 < bossTargetLayout.track.x, 'boss emblem clears the health track');
assert.ok(Math.abs(bossTargetLayout.emblem.centerY - (bossTargetLayout.track.y + bossTargetLayout.track.height / 2)) < 1e-9, 'boss emblem is vertically centered on the actual health track');
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
assert.ok(bossFrameIndex >= 0 && bossFrameIndex < bossFillIndex, 'boss fill is painted after the frame so the frame cannot cover its endpoints');
const [, , , , bossFillX, bossFillY, bossFillW, bossFillH] = bossFillCall.args;
assert.equal(bossFillX, 10 + 660 * BOSS_HEALTH_LAYOUT.trackLeft);
assert.equal(bossFillY, 20 + 160 * BOSS_HEALTH_LAYOUT.trackTop);
assert.equal(bossFillW, 660 * (1 - BOSS_HEALTH_LAYOUT.trackLeft - BOSS_HEALTH_LAYOUT.trackRight) * 0.4);
assert.equal(bossFillH, 160 * BOSS_HEALTH_LAYOUT.trackHeight);
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
console.log('health bar models, visibility rules, settings and hook wiring passed');
