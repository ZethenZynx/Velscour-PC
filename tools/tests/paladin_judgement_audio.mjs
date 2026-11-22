import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [audio, combat, paladin] = await Promise.all([
  readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/combat.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/sigs/paladin.js', import.meta.url), 'utf8'),
]);

test('Paladin Judgement uses separate divine cast and impact cues', () => {
  assert.match(audio, /judgement_cast:\s*\(t, p\)\s*=>/);
  assert.match(audio, /judgement_impact:\s*\(t, p\)\s*=>/);
  const cast = audio.match(/judgement_cast:\s*\(t, p\)\s*=>\s*\{([\s\S]*?)\n  \},/)[1];
  const impact = audio.match(/judgement_impact:\s*\(t, p\)\s*=>\s*\{([\s\S]*?)\n  \},/)[1];
  assert.match(cast, /f0:\s*110\s*\*\s*p,\s*f1:\s*196\s*\*\s*p/);
  assert.match(impact, /f0:\s*620,\s*f1:\s*38/);
  assert.match(impact, /f0:\s*5200,\s*f1:\s*850/);
  const level = (source) => [...source.matchAll(/vol:\s*([0-9.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  assert.ok(level(impact) > level(cast), 'impact layers have greater combined mix level than the cast cue');
});

test('impact cue starts in the same update as Judgement damage and casting remains separate', () => {
  const impact = paladin.slice(paladin.indexOf('function impact('), paladin.indexOf('\nclass Consecration'));
  const fire = paladin.slice(paladin.indexOf('  fire(p, s) {'), paladin.indexOf('\n  draw(ctx, p, s, t)'));
  assert.ok(impact.indexOf("sfx('judgement_impact'") < impact.indexOf('const P = power(p)'));
  assert.match(fire, /sfx\('judgement_cast'/);
  assert.doesNotMatch(impact, /sfx\('(holy|thud)'/);
  assert.match(impact, /sigO\(\{ stun: true, knock: 1\.2, noHitSound: true \}\)/);
  assert.match(impact, /sigO\(\{ noHitSound: true \}\)/);
  const consecration = paladin.slice(paladin.indexOf('class Consecration'), paladin.indexOf('/** A rune of the halo'));
  assert.match(consecration, /sigO\(\{ crit: false, noHitSound: true \}\)/);
});

test('Judgement-specific hit sound suppression does not remove ordinary combat hit sounds', () => {
  assert.match(combat, /if \(!o\.dot && !o\.silent && !o\.noHitSound\) sfx\(crit \? 'crit' : 'hit', 0\.5\)/);
});
