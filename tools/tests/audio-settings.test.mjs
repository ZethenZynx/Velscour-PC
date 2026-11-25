import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_SECTIONS, AUDIO_VOLUME_GROUPS, AUDIO_PRESETS, DEFAULT_AUDIO_SETTINGS, applyAudioPreset, audioGroupForSound, isCombatAudioCategory, normalizeAudioSettings } from '../../src/core/audio-settings.js';
import { G, SETTINGS_KEY, loadSettings } from '../../src/state.js';

test('all volume groups appear exactly once in the collapsible settings sections', () => {
  const expected = AUDIO_VOLUME_GROUPS.map(({ id }) => id).sort();
  const actual = AUDIO_SECTIONS.flatMap(({ groups }) => groups).sort();
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  assert.ok(AUDIO_VOLUME_GROUPS.every(({ id, label }) => id && label));
});

test('audio defaults and migrated values stay within the displayed 0–100 slider range', () => {
  const normalized = normalizeAudioSettings({ volumes: { master: 130, music: -4, playerSpell: 'bad' }, muted: { master: 1 } });
  assert.equal(normalized.volumes.master, 100);
  assert.equal(normalized.volumes.music, 0);
  assert.equal(normalized.volumes.playerSpell, DEFAULT_AUDIO_SETTINGS.volumes.playerSpell);
  assert.equal(normalized.muted.master, false);
  assert.ok(Object.values(normalized.volumes).every((value) => Number.isInteger(value) && value >= 0 && value <= 100));
});

test('approved audio presets configure the supported channel limits and preserve complete volume maps', () => {
  assert.deepEqual(Object.keys(AUDIO_PRESETS).sort(), ['Balanced Combat', 'Default', 'Immersive', 'Minimal', 'Performance', 'Quiet Combat'].sort());
  for (const [name, preset] of Object.entries(AUDIO_PRESETS)) {
    const selected = applyAudioPreset(normalizeAudioSettings(), name);
    assert.equal(selected.preset, name);
    assert.ok([16, 32, 48, 64, 96].includes(selected.maxCombatSounds));
    assert.ok(selected.maxIdenticalSounds >= 1 && selected.maxIdenticalSounds <= 5);
    assert.deepEqual(Object.keys(selected.volumes).sort(), AUDIO_VOLUME_GROUPS.map(({ id }) => id).sort());
    assert.ok(Object.values(selected.volumes).every((value) => value >= 0 && value <= 100));
  }
  assert.equal(applyAudioPreset({}, 'Performance').maxCombatSounds, 32);
  assert.equal(applyAudioPreset({}, 'Minimal').maxCombatSounds, 16);
  assert.equal(applyAudioPreset({ stereoPositioning: true, muteWhenUnfocused: true }, 'Default').stereoPositioning, false);
});

test('the sound router assigns player, enemy, boss, impact, UI and positional steps to their intended controls', () => {
  assert.equal(audioGroupForSound('swing'), 'playerAttack');
  assert.equal(audioGroupForSound('fire'), 'playerSpell');
  assert.equal(audioGroupForSound('step_stone'), 'playerMovement');
  assert.equal(isCombatAudioCategory(audioGroupForSound('step_stone')), false, 'player footsteps do not consume combat sound slots');
  assert.equal(isCombatAudioCategory('weaponImpact'), true);
  assert.equal(audioGroupForSound('swing', { actor: 'enemy' }), 'enemyAttack');
  assert.equal(audioGroupForSound('fire', { actor: 'enemy' }), 'enemySpell');
  assert.equal(audioGroupForSound('roar', { actor: 'enemy', boss: true }), 'boss');
  assert.equal(audioGroupForSound('crit'), 'critical');
  assert.equal(audioGroupForSound('ui'), 'interface');
  assert.equal(audioGroupForSound('arbitrary', { category: 'portal' }), 'portal');
});

test('performance and advanced settings normalize supported options without losing persisted choices', () => {
  const value = normalizeAudioSettings({ maxCombatSounds: 1000, maxIdenticalSounds: 9, repetitiveSuppression: 'Impossible', environmentalDensity: 'Tiny', stereoPositioning: true, musicFadeSeconds: 0, duckAmount: 0 });
  assert.equal(value.maxCombatSounds, DEFAULT_AUDIO_SETTINGS.maxCombatSounds);
  assert.equal(value.maxIdenticalSounds, 5);
  assert.equal(value.repetitiveSuppression, 'Low');
  assert.equal(value.environmentalDensity, 'Full');
  assert.equal(value.stereoPositioning, true);
  assert.equal(value.musicFadeSeconds, 0);
  assert.equal(value.duckAmount, 0);
});

test('legacy volume preferences migrate to visible category sliders without changing loudness', () => {
  const prior = globalThis.localStorage;
  const data = new Map([[SETTINGS_KEY, JSON.stringify({ sfx: 0.25, music: 0.6, amb: 0, zoom: 1.1 })]]);
  globalThis.localStorage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  try {
    loadSettings();
    assert.equal(G.settings.audio.volumes.interface, 25);
    assert.equal(G.settings.audio.volumes.playerSpell, 25);
    assert.equal(G.settings.audio.volumes.music, 60);
    assert.equal(G.settings.audio.volumes.ambient, 0);
    assert.equal(G.settings.sfx, 1);
    assert.equal(G.settings.music, 1);
    assert.equal(G.settings.amb, 1);
    assert.equal(G.settings.zoom, 1.1);
  } finally {
    if (prior === undefined) delete globalThis.localStorage; else globalThis.localStorage = prior;
  }
});
