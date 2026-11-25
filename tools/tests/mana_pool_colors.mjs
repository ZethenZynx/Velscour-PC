import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLASSES } from '../../src/data/classes.js';
import { MANA_POOL_COLORS, manaPoolColor } from '../../src/data/mana-pool-colors.js';
import { hsl, MANA_ART_GEOMETRY, recolorManaPixels } from '../../src/ui/mana-pool-texture.mjs';

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
assert.equal(CLASSES.ranger.color, '#7ccf5a', 'existing interface class colors are not changed');

const source = [65, 105, 225, 173];
const colorTexel = (color) => {
  const pixels = new Uint8ClampedArray([
    12, 40, 220, 255, 65, 105, 225, 255, 0, 20, 255, 77,
    180, 30, 40, 255, ...source, 255, 255, 255, 255, 20, 30, 40, 255,
    20, 30, 40, 255, 20, 30, 40, 255, 20, 30, 40, 255,
  ]);
  recolorManaPixels(pixels, 3, 3, color, { cx: 1, cy: 1, radius: 1 });
  return pixels;
};
for (const [classId, color] of Object.entries(expected)) {
  const pixels = colorTexel(color), center = [...pixels.slice(16, 20)], target = hsl(color), result = hsl(`#${center.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  const originalLight = hsl('#4169E1').light;
  assert.equal(center[3], source[3], `${classId} recoloring preserves source alpha`);
  assert.ok(Math.abs(result.light - originalLight) < 0.006, `${classId} recoloring preserves the liquid texel's lightness`);
  assert.ok(Math.abs(result.hue - target.hue) < 2 || target.saturation < 0.03, `${classId} recoloring reaches its assigned hue`);
  assert.deepEqual([...pixels.slice(0, 4)], [12, 40, 220, 255], `${classId} leaves art outside the orb untouched`);
  assert.deepEqual([...pixels.slice(20, 24)], [255, 255, 255, 255], `${classId} preserves white reflections`);
}
assert.deepEqual(MANA_ART_GEOMETRY['assets/ui/hud.webp'], { cx: 1768, cy: 144, radius: 93 });
assert.deepEqual(MANA_ART_GEOMETRY['assets/ui/hud-orb-mana.webp'], { cx: 115, cy: 144, radius: 93 });

const hud = await readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8');
assert.match(hud, /set\('manaPoolColorClass', p\.classId[\s\S]*refreshManaPoolTexture\(classId\)/, 'HUD recolors the original image when the selected character class changes');
assert.match(hud, /this\.refreshManaPoolTexture\(G\.player\.classId\)/, 'layout changes reapply tint after restoring the base sprite');
const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
assert.match(html, /id="mana-cover"><div class="orb-empty"><\/div><\/div>/, 'original mana-orb markup and fill overlay remain unchanged');
const css = await readFile(new URL('../../css/style.css', import.meta.url), 'utf8');
const orbCss = css.split(/\r?\n/).filter((line) => line.includes('.orb-cover') || line.includes('.orb-empty')).join('\n');
assert.doesNotMatch(orbCss, /orb-tint|orb-liquid-texture|backdrop-filter|mix-blend-mode/, 'color is applied to the original sprite pixels, without overlays or filters');
const texture = await readFile(new URL('../../src/ui/mana-pool-texture.mjs', import.meta.url), 'utf8');
assert.match(texture, /tintedTextures = new Map/, 'recolored full-resolution artwork is cached');
assert.match(texture, /context\.putImageData\(pixels, 0, 0\)/, 'the recoloring is written directly into the source artwork raster');

console.log('All 19 class-specific mana pool color checks passed.');
