// Non-browser regression checks for the Iron Express notification whistle.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wav = await readFile(new URL('../../assets/audio/sfx/iron_express_whistle.wav', import.meta.url));
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
assert.equal(wav.readUInt16LE(20), 1, 'generated asset is uncompressed PCM');
assert.equal(wav.readUInt16LE(22), 1, 'generated asset is mono');
assert.equal(wav.readUInt32LE(24), 44_100, 'generated asset uses standard 44.1 kHz audio');
assert.ok(Math.abs(wav.readUInt32LE(40) / wav.readUInt32LE(28) - 1.4) < 0.001, 'whistle lasts approximately 1.4 seconds');

const manifest = JSON.parse(await readFile(new URL('../../assets/audio/audio.json', import.meta.url), 'utf8'));
assert.ok(manifest.sfx.includes('iron_express_whistle'), 'generated whistle is included in the audio manifest');

const audio = await readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8');
assert.match(audio, /iron_express_whistle: \{ s: \['iron_express_whistle'\], ext: 'wav',[^\n]*max: 1 \}/, 'whistle sample is loaded as a single-voice WAV');
assert.match(audio, /ironExpressWhistleUntil = ac\.currentTime \+ 1\.42/, 'rapid repeats are gated for the full sample duration');
assert.match(audio, /G\.settings\.sfx <= 0/, 'the shared SFX mute setting is respected');

const train = await readFile(new URL('../../src/game/ghosttrain.js', import.meta.url), 'utf8');
assert.equal([...train.matchAll(/sfx\(['"]bell['"]/g)].length, 0, 'Iron Express no longer triggers the old dong');
assert.equal([...train.matchAll(/ironExpressWhistleSfx\(/g)].length, 5, 'all five train notification sites use the whistle helper');

console.log('Iron Express whistle asset, audio manifest, mute/rate guard, and notification replacements passed.');
