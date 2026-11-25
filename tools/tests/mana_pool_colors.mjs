import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLASSES } from '../../src/data/classes.js';
import { MANA_POOL_COLORS, manaPoolColor, manaPoolTintFilter } from '../../src/data/mana-pool-colors.js';

const expected = {
  paladin: '#FFD860', ranger: '#228B22', wizard: '#4169E1', necromancer: '#A070FF',
  barbarian: '#B87333', dragoon: '#0088CC', totem_master: '#40E0D0', death_knight: '#A5E8FF',
  arcane_sorcerer: '#302B80', carrion_witch: '#9BAE32', bard: '#FF6A9D', slime_lord: '#7FFF00',
  boomerang_knight: '#00A86B', lancer: '#C0C0D0', dragon_knight: '#FF4500', gunner: '#708090',
  monk: '#FFE4B5', rogue: '#800020', ninja: '#49275E',
};

assert.deepEqual(MANA_POOL_COLORS, expected);
assert.deepEqual(Object.keys(MANA_POOL_COLORS).sort(), Object.keys(CLASSES).sort(), 'every playable class has exactly one mana tint');
assert.equal(manaPoolColor('arcane_sorcerer'), '#302B80', 'Astronomer resolves through its existing saved class id');
assert.equal(manaPoolColor('unknown'), '#4169E1', 'unknown classes use a readable blue fallback');
for (const classId of Object.keys(expected)) assert.match(manaPoolTintFilter(classId), /^hue-rotate\(-?\d+\.\d{2}deg\) saturate\(\d+\.\d{3}\)$/, `${classId} receives a calculated non-overlay texture tint`);
assert.equal(manaPoolTintFilter('wizard'), 'hue-rotate(0.00deg) saturate(1.000)', 'Royal Blue preserves the original mana art without a filter shift');
assert.equal(CLASSES.ranger.color, '#7ccf5a', 'existing interface class colors are not changed');

const hud = await readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8');
assert.match(hud, /set\('manaPoolColorClass', p\.classId[\s\S]*manaPoolTintFilter\(classId\)/, 'HUD updates tint immediately when the selected character class changes');
const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
assert.match(html, /id="mana-cover"><div class="orb-tint"[^>]*><\/div><div class="orb-empty"><\/div><\/div>/, 'tint stays inside the existing clipped mana liquid and under the depleted overlay');
const css = await readFile(new URL('../../css/style.css', import.meta.url), 'utf8');
assert.match(css, /\.orb-tint[^\n]*backdrop-filter:\s*var\(--mana-pool-filter/, 'tint filters existing orb texture instead of covering it with flat color');
assert.doesNotMatch(css, /\.orb-tint[^\n]*mix-blend-mode/, 'the previous flat overlay blend is removed');

console.log('All 19 class-specific mana pool color checks passed.');
