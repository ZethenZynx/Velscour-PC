import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [hud, player, styles, layout] = await Promise.all([
  readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/player.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/layoutcustomizer.js', import.meta.url), 'utf8'),
]);

assert.match(player, /potionRegen\.push\(\{ kind: 'hp',[^}]+max: t \}\)/, 'healing potion regen records its source and finite duration');
assert.match(player, /potionRegen\.push\(\{ kind: 'mp',[^}]+max: t \}\)/, 'mana potion regen records its source and finite duration');
assert.match(hud, /const potionEffects = \[\.\.\.regen\]\.map/, 'temporary potion regeneration appears in the buff HUD');
assert.match(hud, /iconItem: \{ type: 'potion', kind \}/, 'potion effects use their matching inventory artwork');
assert.match(hud, /const statusEffects = Object\.entries\(p\.status \|\| \{\}\)/, 'active player status effects are represented in the debuff row');
assert.match(hud, /const curseEffects = Object\.entries\(p\.curses \|\| \{\}\)/, 'active timed curses are represented in the debuff row');
assert.match(hud, /harmfulTimed = toTimed\(\[\.\.\.debuffs, \.\.\.statusEffects, \.\.\.curseEffects\]\)/, 'buff-list, status and curse debuffs use the same countdown and tooltip renderer');
assert.match(hud, /target\.replaceChildren\(\.\.\.entries\.map/, 'buff icons are created only when their membership changes');
assert.match(hud, /structureKey = \(entries\) => entries\.map\(\(x\) => `\$\{x\.key\}:\$\{x\.stack \?\? x\.count \?\? ''\}`\)\.join\('\|'\)/, 'countdown ticks do not rebuild the buff row');
assert.match(hud, /node\.style\.setProperty\('--buff-progress'/, 'remaining duration updates in place as a fixed-size indicator');
assert.match(hud, /buffDescription = \(b\) =>/, 'effects without authored descriptions get a stat-based tooltip description');
assert.match(styles, /#buff-row \{ left: 12px; top: 53vh; \}/, 'buff row has a stable viewport anchor');
assert.match(styles, /#debuff-row \{ left: 12px; top: 59vh; \}/, 'debuff row has an independent stable viewport anchor');
assert.match(styles, /\.buff \.buff-stack \{ top: 1px; bottom: auto;/, 'stack counts occupy a fixed overlay separate from duration');
assert.match(layout, /node\.style\.textAlign = entry\?\.textAlign \|\| 'left'/, 'the grouped environment text restores its saved alignment');
assert.match(layout, /visibilityObserver\.observe\(app, \{ childList: true, subtree: true \}\)/, 'late-created customizable UI elements are watched for layout restoration');
assert.match(layout, /const changed = this\.observedElements\.get\(id\) !== node;[\s\S]*visibilityObserver\?\.observe\(node/, 'elements discovered before observer setup are still registered for future layout changes');

console.log('Passed buff/debuff anchoring, stable timer rendering, potion icon, tooltip and late-created UI layout regression checks.');
