// Shared pointer-targeting regression across the complete registered monster catalog.
// Run without a browser: node tools/tests/enemy_click_targeting.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ARCH } from '../../src/data/enemies.js';
import { isPlayerTargetable, pickPlayerTarget, setCreatureTargetBounds } from '../../src/game/targeting.js';

assert.ok(Object.keys(ARCH).length >= 20, 'the registered monster catalog is present');
for (const [id, archetype] of Object.entries(ARCH)) {
  for (const rank of ['normal', 'champion', 'unique', 'boss']) for (const variant of [0, 1]) {
    const enemy = { arch: id, team: 'enemy', ai: archetype.ai, rank, variant, targetable: true, targetBox: null };
    // This represents the screen bounds produced from the creature's actual rendered frame,
    // including custom artFrame, pet atlas and animated slime paths.
    setCreatureTargetBounds(enemy, [83, 37, 157, 131], [120, 131]);
    assert.equal(pickPlayerTarget([enemy], 120, 76), enemy, `${id} ${rank} variant ${variant} is directly clickable on its visible body`);
    assert.equal(pickPlayerTarget([enemy], 120, 150), null, `${id} ${rank} variant ${variant} is not clickable outside its visible hit box`);
  }
}

const eventFoe = { team: 'event_raider', eventFoe: true, targetBox: [50, 50, 100, 100], targetAnchor: [75, 100] };
const summonedEnemy = { team: 'enemy', summon: true, targetBox: [50, 50, 100, 100], targetAnchor: [75, 100] };
assert.equal(pickPlayerTarget([eventFoe], 75, 75), eventFoe, 'registered event foes use the shared pointer path');
assert.equal(pickPlayerTarget([summonedEnemy], 75, 75), summonedEnemy, 'summoned hostile enemies use the shared pointer path');

const hidden = { team: 'enemy', alpha: 0, targetBox: [0, 0, 100, 100] };
const phased = { team: 'enemy', targetable: false, targetBox: [0, 0, 100, 100] };
const dead = { team: 'enemy', dead: true, targetBox: [0, 0, 100, 100] };
const clutter = { team: 'enemy', clutter: true, targetBox: [0, 0, 100, 100] };
for (const excluded of [hidden, phased, dead, clutter]) {
  assert.equal(isPlayerTargetable(excluded), false, 'hidden, scripted untargetable, dead and clutter entities remain unselectable');
  assert.equal(pickPlayerTarget([excluded], 50, 50), null, 'excluded entities cannot be selected by pointer');
}

const near = { team: 'enemy', targetBox: [0, 0, 100, 100], targetAnchor: [45, 100] };
const far = { team: 'enemy', targetBox: [0, 0, 100, 100], targetAnchor: [95, 100] };
assert.equal(pickPlayerTarget([far, near], 50, 90), near, 'overlapping enemy bodies select the one nearest the pointer at its ground anchor');

const [controls, renderer, creature, happenings, slimeArt] = await Promise.all([
  'src/game/controls.js', 'src/game/render.js', 'src/game/creature.js', 'src/game/happenings.js', 'src/gfx/slimeart.js',
].map(path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')));
assert.match(controls, /pickPlayerTarget\(w\?\.creatures, sx, sy\)/, 'mouse hover uses the centralized hostile picker');
assert.ok(controls.indexOf('else if (isPlayerTargetable(G.hover))') < controls.indexOf('else if (it && !shift)'), 'a directly hovered hostile takes priority over overlapping scenery');
assert.match(renderer, /setCreatureTargetBounds\(o, \[x0, y0, x1, y1\], anchor\)/, 'rendering projects actual custom sprite bounds into the hit box');
assert.match(creature, /lastTargetBounds = transformedSpriteBounds/, 'custom art and animated creature renderers publish their visible bounds');
assert.match(happenings, /m\.artFrame\s*=\s*\(\)\s*=>/, 'event Treasure Imp variants use custom rendered art covered by the shared hit-box path');
assert.match(slimeArt, /m\.lastTargetBounds\s*=\s*\[x0, y0, x1, y1\]/, 'animated slime art publishes bounds matching its frame and deformation');

console.log(`OK - direct click targeting for ${Object.keys(ARCH).length} archetypes across normal/champion/unique/boss and base/variant looks, plus event/summoned foes, visibility states and overlap selection`);
