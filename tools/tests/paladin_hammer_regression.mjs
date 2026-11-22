import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const paladin = await readFile(new URL('../../src/game/sigs/paladin.js', import.meta.url), 'utf8');
const hazards = await readFile(new URL('../../src/game/hazards.js', import.meta.url), 'utf8');
const skillrun = await readFile(new URL('../../src/game/skillrun.js', import.meta.url), 'utf8');
const world = await readFile(new URL('../../src/game/world.js', import.meta.url), 'utf8');
const skills = await readFile(new URL('../../src/data/skilldata.js', import.meta.url), 'utf8');

assert.match(skills, /'Blessed Hammer\|orbit\|holy\|hammer\|spiral n=2 dur=2\.8 pow=0\.82'/, 'Blessed Hammer mechanics remain unchanged');
assert.match(paladin, /return this\.t < this\.fall \+ 0\.35;/, 'Judgement hammer has a finite fall and fade lifetime');
assert.match(paladin, /glow\(ctx, GOLD, px, py - 34, 42, 0\.24 \* a\)/, 'Judgement uses a bounded, attached outer glow');
assert.match(paladin, /glow\(ctx, '#ffffff', px, cy - 3, 14, 0\.22 \* a\)/, 'Judgement uses a restrained white core');
assert.doesNotMatch(paladin, /glow\(ctx, GOLD, cx, cy, RX/, 'the Paladin charge no longer paints an additive disk over the head');

const orbitStart = hazards.indexOf('export class Orbit {');
const orbitEnd = hazards.indexOf('// ===================================================================== Whirlwind', orbitStart);
assert.ok(orbitStart >= 0 && orbitEnd > orbitStart, 'Orbit class boundaries are present');
const orbit = hazards.slice(orbitStart, orbitEnd);
assert.match(orbit, /if \(this\.src\.dead\) return false;/, 'orbit hammers end when their source is removed');
assert.match(orbit, /if \(this\.t > this\.dur\) return false;/, 'orbit hammers end at their configured duration');
assert.doesNotMatch(orbit, /sfx\(/, 'the orbit update/draw path does not replay cast audio');
assert.match(world, /if \(h\.update\(dt\) === false \|\| h\.dead\) this\.hazards\.splice\(i, 1\);/, 'expired hazards are removed from the world');

const orbitCast = skillrun.slice(skillrun.indexOf("case 'orbit':"), skillrun.indexOf("case 'cyclone':"));
assert.match(orbitCast, /sfx\('swing'\);/, 'Blessed Hammer retains its cast sound');
console.log('Paladin hammer visual, finite lifetime, cleanup, and cast-only sound checks passed.');
