import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DUNGEON_AFFIXES } from '../../src/data/dungeonaffixes.js';
import { SKILLS } from '../../src/data/skills.js';
import { dungeonAffixSkill } from '../../src/ui/dungeonaffixicons.js';

for (const affix of DUNGEON_AFFIXES) {
  const skill = dungeonAffixSkill(affix.id);
  assert.ok(skill && SKILLS[skill.id] === skill, `${affix.id} has an existing spell icon source`);
}

assert.equal(dungeonAffixSkill('wildfire').el, 'fire', 'fire affixes use fire spell art');
assert.equal(dungeonAffixSkill('chain_lightning').fx, 'lightning', 'lightning affixes use lightning spell art');
assert.equal(dungeonAffixSkill('frostburst').el, 'cold', 'frost effects use cold spell art');
assert.equal(dungeonAffixSkill('poison_pools').el, 'poison', 'poison effects use poison spell art');
assert.equal(dungeonAffixSkill('fortified').fx, 'shield', 'defensive stat affixes use protective spell art');

const [hudSource, gameSource, styleSource, layoutSource] = await Promise.all([
  readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/layoutcustomizer.js', import.meta.url), 'utf8'),
]);
assert.match(hudSource, /area-affix-heading.*Active Affixes/);
assert.match(hudSource, /dungeonAffixIconURL\(affix\.id\)/, 'HUD affix rows use the spell icon mapping');
assert.match(hudSource, /UI\.tip\(row, \(\) =>[\s\S]*affix\.description/, 'hovering an affix exposes its complete description');
assert.match(hudSource, /\.slice\(0, 5\)/, 'the environment panel shows at most five active affixes');
assert.match(hudSource, /af\.replaceChildren\(\)[\s\S]*af\.classList\.toggle\('hidden', !active\.length\)/, 'empty affix lists leave no blank rows and hide the section');
assert.match(gameSource, /world\.dungeonAffixes \|\| \[\]/, 'the HUD receives the affixes active in the generated world');
assert.doesNotMatch(gameSource, /greedIconByCategory|greed-affix-icon[^\n]*\?/, 'Greed preview has no placeholder category icons');
assert.match(styleSource, /\.area-affix-list \{ display: inline-grid/);
assert.match(layoutSource, /Environment Information.*\.hud-environment-info/, 'the affix rows remain inside the existing customizable group');

console.log(`Affix icon and environment display checks passed for ${DUNGEON_AFFIXES.length} affixes.`);
