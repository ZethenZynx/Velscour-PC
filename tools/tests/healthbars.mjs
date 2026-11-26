import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { G } from '../../src/state.js';
import { DEFAULT_HEALTH_BAR_SETTINGS, HEALTH_BAR_CLASSES, drawHealthBarCanvas, healthBarClass, healthBarSettings, healthBarText, healthBarVisible, normalizeHealthBarSettings } from '../../src/ui/healthbars.mjs';

globalThis.localStorage ||= { getItem: () => null, setItem: () => {} };

const defaults = normalizeHealthBarSettings();
assert.equal(defaults.theme, 'velscour', 'Velscour theme is the default');
assert.deepEqual(defaults.overhead, { ...DEFAULT_HEALTH_BAR_SETTINGS.overhead }, 'overhead settings have independent default dimensions and visibility');
assert.deepEqual(defaults.target, { ...DEFAULT_HEALTH_BAR_SETTINGS.target }, 'target settings have independent default dimensions and visibility');
assert.equal(Object.keys(defaults.classes).length, 8, 'all seven creature groups and the player have visibility controls');
assert.equal(Object.keys(defaults.info).length, 6, 'all requested optional information switches are present');
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

G.settings.healthBars = normalizeHealthBarSettings({ info: { showHealthPercentage: true, showNumericalHealth: true } });
assert.match(healthBarText({ rank: 'boss', level: 85, hp: 25, maxHp: 100 }), /Lv\. 85.*Boss.*25%.*25 \/ 100/);

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../../src/ui/hud.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../src/ui/healthbar-settings.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../css/style.css', import.meta.url), 'utf8');
const creatureDraw = readFileSync(new URL('../../src/game/creature.js', import.meta.url), 'utf8');
assert.match(html, /id="boss-emblem"/);
assert.match(html, /<canvas id="boss-frame"/);
assert.match(hud, /healthBarVisible\(.*'target'\)/);
assert.match(hud, /redrawTargetHealthBarFrame/);
assert.match(hud, /activeBoss \? 1 : 0/);
assert.match(settings, /data-hb-class-next/);
assert.match(settings, /Reset to Defaults/);
assert.match(css, /healthbar-dialog/);
assert.match(readFileSync(new URL('../../src/ui/healthbars.mjs', import.meta.url), 'utf8'), /drawHealthBarFrame/);
assert.doesNotMatch(creatureDraw, /e\.bc\s*=\s*col/, 'the old bar-color variable is not referenced after the health-bar renderer replaced it');
assert.match(creatureDraw, /\[health-bar\] overhead setup failed; continuing creature rendering/, 'health-bar setup failures are isolated from creature/world rendering');
assert.match(creatureDraw, /\[health-bar\] overhead bar failed; continuing world rendering/, 'deferred bar failures are isolated from the world render pass');
let restoreCount = 0;
const throwingContext = {
  globalAlpha: 1,
  save() {},
  restore() { restoreCount++; },
  fillRect() { throw new Error('intentional canvas failure'); },
};
G.settings.healthBars = normalizeHealthBarSettings({ theme: 'classic' });
assert.throws(() => drawHealthBarCanvas(throwingContext, { hp: 1, maxHp: 1 }, 0, 0, 20, 10), /intentional canvas failure/);
assert.equal(restoreCount, 1, 'canvas state is restored even if health-bar drawing fails');
console.log('health bar models, visibility rules, settings and hook wiring passed');
