import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { G } from '../../src/state.js';

const store = new Map();
globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) };
store.set('velscour_endgame_v1', JSON.stringify({
  marksResetVersion: 2, unlocked: 1,
  marks: { pts: 0, xp: 0, spentValue: 0, spent: {} },
}));

const { resetEndgameCache } = await import('../../src/game/endgame.js');
resetEndgameCache();
const marks = await import('../../src/game/marks.js');
const vfx = await import('../../src/gfx/vfx.js');
const { infernalMarkRewardSfx } = await import('../../src/core/audio.js');
G.char = { level: 100 };
G.world = { kind: 'dungeon', depth: 101 };
G.player = { x: 4, y: 6, recompute() {} };
G.ui = null;

const effectsBeforeDirectReward = vfx.effects.length, particlesBeforeDirectReward = vfx.particles.length;
assert.equal(marks.grantMarks(1, 'direct activity', G.world), 1);
assert.equal(vfx.effects.length, effectsBeforeDirectReward, 'non-XP Mark rewards do not play the XP celebration');
assert.equal(vfx.particles.length, particlesBeforeDirectReward, 'direct grants do not create celebration particles');
vfx.effects.length = 0; vfx.particles.length = 0; vfx.texts.length = 0;

const count = marks.gainMarkXp(marks.markXp() * 2 + 5, G.world);
assert.equal(count, 2, 'multiple Marks from one XP award are credited together');
assert.equal(vfx.effects.filter((effect) => effect.constructor.name === 'Sigil').length, 1, 'one crimson-gold sigil is created for the combined award');
assert.equal(vfx.effects.filter((effect) => effect.constructor.name === 'Ring').length, 1, 'one expanding energy ring is created for the combined award');
assert.equal(vfx.effects.filter((effect) => effect.constructor.name === 'Column').length, 1, 'one brief upward energy pulse is created for the combined award');
assert.equal(vfx.particles.length, 10, 'the celebration uses a small, fixed ember particle burst');
assert.equal(vfx.texts.length, 1, 'a combined XP award creates one floating label');
assert.equal(vfx.texts[0].text, '+2 Infernal Marks');
assert.deepEqual(vfx.texts[0].gradient, [[0, '#c33b3d'], [0.48, '#f4cb75'], [1, '#b52c32']], 'the label blends crimson and gold');
assert.ok(vfx.effects.every((effect) => effect.dur > 0 && effect.dur <= 1.85), 'every visual effect has a finite lifetime under two seconds');
assert.ok(vfx.particles.every((particle) => particle.life > 0 && particle.life <= 0.7), 'all embers expire quickly');
assert.equal(vfx.texts[0].max, 1.85, 'the floating reward label fades within two seconds');
assert.equal(infernalMarkRewardSfx(), false, 'audio remains safely silent when no AudioContext is available');

vfx.effects.length = 0; vfx.particles.length = 0; vfx.texts.length = 0;
G.settings.reduceFlashing = true;
assert.equal(marks.gainMarkXp(marks.markXp(), G.world), 1);
assert.equal(vfx.effects.length, 2, 'reduced-flashing mode keeps only the gentle ground sigil and expanding ring');
assert.equal(vfx.particles.length, 0, 'reduced-flashing mode omits rising particles and the energy column');

const marksSource = await readFile(new URL('../../src/game/marks.js', import.meta.url), 'utf8');
const audioSource = await readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8');
assert.match(marksSource, /announce\(n, 'from the abyss', true\)/, 'the celebration is connected only to successful XP threshold awards');
assert.match(marksSource, /infernalMarkRewardSfx\(\)/, 'the celebration uses its dedicated sound');
assert.match(audioSource, /infernal_mark: \(t, p\) =>/, 'the sound is procedural and does not require an external asset');
assert.match(audioSource, /infernalMarkChimeUntil = ac\.currentTime \+ 0\.9/, 'repeated chimes cannot overlap');
assert.match(audioSource, /src\.stop\(t \+ dur \+ 0\.05\)/, 'procedural audio sources are stopped immediately after their finite envelopes');

console.log('Infernal Mark XP celebration trigger, combined rewards, reduced-flashing behavior, visual cleanup lifetimes and chime guards passed.');
