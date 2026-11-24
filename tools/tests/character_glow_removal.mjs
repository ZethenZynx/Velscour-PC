import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const sources = Object.fromEntries(await Promise.all([
  ['classfx', '../../src/gfx/classfx.js'],
  ['paladin', '../../src/game/sigs/paladin.js'],
  ['consecration', '../../src/game/sigs/paladin.js'],
  ['monk', '../../src/game/sigs/monk.js'],
  ['slime', '../../src/game/sigs/slime.js'],
  ['wizard', '../../src/game/sigs/wizard.js'],
  ['necromancer', '../../src/game/sigs/necromancer.js'],
  ['ninja', '../../src/game/sigs/ninja.js'],
  ['ranger', '../../src/game/sigs/ranger.js'],
  ['lancer', '../../src/game/sigs/lancer.js'],
  ['dragonknight', '../../src/game/sigs/dragonknight.js'],
  ['barbarian', '../../src/game/sigs/barbarian.js'],
  ['astronomer', '../../src/game/astronomer.js'],
  ['render', '../../src/game/render.js'],
  ['hazards', '../../src/game/hazards.js'],
  ['vfx', '../../src/gfx/vfx.js'],
].map(async ([name, path]) => [name, await read(path)])));

const body = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing source section: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing source section end: ${end}`);
  return source.slice(from, to);
};

test('shared class casts no longer create or process the hero glow effect', () => {
  assert.doesNotMatch(sources.classfx, /HeroGlow|_classGlow|glowSprite/);
  const cast = body(sources.classfx, 'export function classCastFx(', 'let hitBudget');
  assert.match(cast, /T\.fx\(p\.x, p\.y/);
  assert.match(cast, /new Ring\(p\.x, p\.y/);
});

test('no class signature retains the removed circular-glow renderer', async () => {
  const dir = new URL('../../src/game/sigs/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.js'));
  const signatures = await Promise.all(files.map(async (name) => [name, await readFile(new URL(name, dir), 'utf8')]));
  for (const [name, source] of signatures) {
    assert.doesNotMatch(source, /glow\(ctx\s*,/, `${name} still invokes the circular glow helper`);
    assert.doesNotMatch(source, /\bglow\s*,\s*[^}]*\}\s*from\s*['"]\.\/common\.js['"]/, `${name} still imports the removed helper`);
  }
  assert.doesNotMatch(await readFile(new URL('../../src/game/sigs/common.js', import.meta.url), 'utf8'), /export function glow\(/);
});

test('Paladin halo blooms and floor halo are gone while Judgement gameplay remains', () => {
  assert.doesNotMatch(sources.paladin, /glow\(ctx/);
  assert.doesNotMatch(sources.paladin, /ground\s*\(ctx,\s*p,\s*s/);
  assert.match(sources.paladin, /drawGreatHammer\(ctx/);
  assert.match(sources.paladin, /aoe\(w, p, this\.x, this\.y, this\.r/);
  assert.match(sources.paladin, /p\.heal\(p\.maxHp \* 0\.012, true\)/);
  assert.match(sources.paladin, /for \(let i = 0; i < RUNES; i\+\+\)/);
});

test('persistent class indicators retain their shapes without diffuse head blooms', () => {
  for (const name of ['monk', 'slime', 'wizard', 'ninja', 'ranger', 'lancer', 'dragonknight', 'barbarian']) {
    assert.doesNotMatch(sources[name], /glow\(ctx/, `${name} retains an unwanted diffuse signature glow`);
  }
  const necroDraw = sources.necromancer.slice(sources.necromancer.indexOf('  draw(ctx, p, s, t) {'));
  assert.doesNotMatch(necroDraw, /glow\(ctx/);
  assert.match(necroDraw, /skull\(ctx/);
  assert.match(sources.slime, /ctx\.fillStyle = 'rgba\(10,30,80,0\.7\)'/);
  assert.match(sources.wizard, /ctx\.arc\(x, y, r/);
  assert.match(sources.ranger, /drawPhoenix3D\(ctx/);
});

test('Astronomer keeps the star and boon markers without the constant head ring or flash wash', () => {
  const orrery = sources.astronomer.slice(sources.astronomer.indexOf('class OrreryFx {'));
  assert.doesNotMatch(orrery, /ctx\.ellipse\(cx, cy, RX, RY/);
  assert.doesNotMatch(orrery, /glowSprite\('#ffffff'\)/);
  assert.match(orrery, /drawChartStar\(ctx, x, y/);
  assert.match(orrery, /ctx\.arc\(x, y, 2\.4/);
});

test('ordinary environment lighting and functional hazard warnings are unchanged', () => {
  assert.match(sources.render, /function drawLighting\(/);
  assert.match(sources.render, /if \(G\.settings\.glow !== false\)/);
  assert.match(sources.vfx, /export class Telegraph/);
});
