import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deckTiltTransform, untiltPointerPoint } from '../../src/game/seascen/deck_tilt.mjs';

assert.equal(deckTiltTransform(0), '', 'zero tilt clears the canvas transform');
assert.equal(deckTiltTransform(8), 'rotate(8.00deg)', 'deck tilt does not add a zoom scale');
assert.equal(deckTiltTransform(-9.5), 'rotate(-9.50deg)', 'negative tilt also preserves scale');

const center = [800, 450], point = [1040, 220], angle = 9.5 * Math.PI / 180;
const dx = point[0] - center[0], dy = point[1] - center[1];
const tilted = [center[0] + dx * Math.cos(angle) - dy * Math.sin(angle), center[1] + dx * Math.sin(angle) + dy * Math.cos(angle)];
const restored = untiltPointerPoint(...tilted, ...center, 9.5);
assert.ok(Math.abs(restored[0] - point[0]) < 1e-9 && Math.abs(restored[1] - point[1]) < 1e-9, 'pointer coordinates reverse the visual rotation');

for (const file of ['harpoon_weather.js', 'three_chains.js']) {
  const source = await readFile(new URL(`../../src/game/seascen/${file}`, import.meta.url), 'utf8');
  assert.match(source, /deckTiltTransform\(deg\)/, `${file} uses the shared stable tilt transform`);
  assert.match(source, /untiltPointerPoint\(/, `${file} preserves pointer targeting under tilt`);
  assert.doesNotMatch(source, /scale\(\$\{k\.toFixed/, `${file} no longer scales the canvas with deck tilt`);
}

console.log('Deck tilt zoom and pointer regression checks passed for Harpoon Weather and Three Chains.');
