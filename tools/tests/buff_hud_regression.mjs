import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { effectRemainingSeconds, formatEffectDuration, potionRegenBuffs } from '../../src/ui/buff-state.mjs';

const [hud, player, styles, layout] = await Promise.all([
  readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/player.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/layoutcustomizer.js', import.meta.url), 'utf8'),
]);

assert.match(player, /potionRegen\.push\(\{ id: \+\+this\.potionRegenSequence, kind: 'hp',[^}]+max: t \}\)/, 'healing potion regen records a unique source and finite duration');
assert.match(player, /potionRegen\.push\(\{ id: \+\+this\.potionRegenSequence, kind: 'mp',[^}]+max: t \}\)/, 'mana potion regen records a unique source and finite duration');
assert.match(hud, /const potionEffects = potionRegenBuffs\(p\.potionRegen\)/, 'temporary potion regeneration appears in the buff HUD');
assert.deepEqual(potionRegenBuffs([{ kind: 'hp', t: 1, max: 2 }])[0].iconItem, { type: 'potion', kind: 'hp' }, 'potion effects use their matching inventory artwork');
assert.match(hud, /const statusEffects = Object\.entries\(p\.status \|\| \{\}\)/, 'active player status effects are represented in the debuff row');
assert.match(hud, /const curseEffects = Object\.entries\(p\.curses \|\| \{\}\)/, 'active timed curses are represented in the debuff row');
assert.match(hud, /harmfulTimed = toTimed\(\[\.\.\.debuffs, \.\.\.statusEffects, \.\.\.curseEffects\]\)/, 'buff-list, status and curse debuffs use the same countdown and tooltip renderer');
assert.match(hud, /target\.replaceChildren\(\.\.\.entries\.map/, 'buff icons are created only when their membership changes');
assert.match(hud, /structureKey = \(entries\) => entries\.map\(\(x\) => `\$\{x\.key\}:\$\{x\.stack \?\? x\.count \?\? ''\}`\)\.join\('\|'\)/, 'countdown ticks do not rebuild the buff row');
assert.match(hud, /node\.style\.setProperty\('--buff-progress'/, 'remaining duration updates in place as a fixed-size indicator');
assert.match(hud, /const duration = x\.t != null \? formatEffectDuration\(x\.t\) : ''/, 'timed effects display a live compact countdown and permanent effects have no timer');
assert.match(hud, /buffDescription = \(b\) =>/, 'effects without authored descriptions get a stat-based tooltip description');
assert.match(styles, /#buff-row \{ left: 12px; top: 53vh; \}/, 'buff row has a stable viewport anchor');
assert.match(styles, /#debuff-row \{ left: 12px; top: 59vh; \}/, 'debuff row has an independent stable viewport anchor');
assert.match(styles, /#buff-row, #debuff-row[^\n]*min-height: 32px/, 'empty persistent rows remain measurable for saved position restoration');
assert.match(styles, /\.buff \.buff-stack \{ top: 1px; bottom: auto;/, 'stack counts occupy a fixed overlay separate from duration');
assert.match(layout, /node\.style\.textAlign = entry\?\.textAlign \|\| 'left'/, 'the grouped environment text restores its saved alignment');
assert.match(layout, /visibilityObserver\.observe\(app, \{ childList: true, subtree: true \}\)/, 'late-created customizable UI elements are watched for layout restoration');
assert.match(layout, /const changed = this\.observedElements\.get\(id\) !== node;[\s\S]*visibilityObserver\?\.observe\(node/, 'elements discovered before observer setup are still registered for future layout changes');
assert.match(layout, /const changedRows = new Set\(\);[\s\S]*record\.target\?\.id === 'buff-row'[\s\S]*for \(const id of changedRows\) UILayoutCustomizer\.applyElement\(id\)/, 'first and last effects restore position on stable buff/debuff roots');

const hpAndMp = potionRegenBuffs([
  { id: 1, kind: 'hp', t: 1.6, max: 2, hp: 12 },
  { id: 2, kind: 'hp', t: 0.8, max: 2, hp: 12 },
  { id: 3, kind: 'mp', t: 1.25, max: 2, mp: 10 },
  { id: 4, kind: 'hp', t: 0, max: 2, hp: 12 },
]);
assert.equal(hpAndMp.length, 3, 'each concurrent potion effect is represented and expired effects are omitted');
assert.deepEqual(hpAndMp.map((effect) => effect.id), ['potion-hp-1', 'potion-hp-2', 'potion-mp-3']);
assert.deepEqual(hpAndMp.map((effect) => effect.t), [1.6, 0.8, 1.25], 'each icon uses its own current gameplay timer');
assert.equal(formatEffectDuration(hpAndMp[0].t), '2s');
assert.equal(formatEffectDuration(59.1), '1:00');
assert.equal(formatEffectDuration(0), '', 'expired effects do not retain a countdown');
assert.equal(effectRemainingSeconds({ name: 'permanent blessing' }), null, 'permanent effects do not receive fabricated timers');
assert.equal(effectRemainingSeconds({ t: 12.4 }), 12.4, 'temporary buffs use their authoritative timer');

console.log('Passed potion countdown, concurrent potion, permanent-effect, stable buff/debuff container, layout restore, tooltip and UI initialization regression checks.');
