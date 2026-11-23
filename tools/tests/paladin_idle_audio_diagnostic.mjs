import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [skillrun, skilldata, audio, paladin, augments] = await Promise.all([
  readFile(new URL('../../src/game/skillrun.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/data/skilldata.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/core/audio.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/sigs/paladin.js', import.meta.url), 'utf8'),
  readFile(new URL('../../src/game/augments.js', import.meta.url), 'utf8'),
]);

// Temporary, non-browser trace model: records the sound request, source event,
// active one-shot count, and its bounded playback interval. No trace code ships
// in the game runtime.
function traceScenario(events) {
  const log = [];
  const active = new Map();
  let maxActive = 0;
  for (const event of events) {
    if (event.type === 'play') {
      log.push({ type: 'play', asset: event.asset, source: event.source, trigger: event.trigger, sourceActive: event.sourceActive, active: active.size });
      const id = `${event.asset}:${log.length}`;
      active.set(id, event.stopAt);
      maxActive = Math.max(maxActive, active.size);
      log.push({ type: 'start', asset: event.asset, source: event.source, at: event.at, active: active.size });
    }
    for (const [id, stopAt] of active) if (stopAt <= event.at) {
      const asset = id.slice(0, id.lastIndexOf(':'));
      active.delete(id);
      log.push({ type: 'stop', asset, at: event.at, active: active.size });
    }
  }
  return { log, active: active.size, maxActive };
}

test('diagnostic identifies the Fist of the Heavens sound path and verifies one finite cue per cast', () => {
  assert.match(skilldata, /'Fist of the Heavens\|strike\|holy\|lightning\|n=4/);
  const strikeStart = skillrun.indexOf("    case 'strike': {");
  const strikeEnd = skillrun.indexOf("    case 'fissure': {", strikeStart);
  const strike = skillrun.slice(strikeStart, strikeEnd);
  assert.match(strike, /p\.classId === 'paladin' && fx === 'lightning'/);
  assert.match(strike, /if \(paladinLightningStrikes\) playCastSfx\('light', 0\.6\)/);
  assert.match(strike, /strikeFx\(x, y, fx, E, !paladinLightningStrikes\)/);
  assert.match(strike, /if \(p\.dead \|\| p\.world !== w\) return/);
  const lightningFx = skillrun.slice(skillrun.indexOf('function strikeFx('));
  assert.match(lightningFx, /if \(playSfx\) sfx\('light', 0\.6\)/);
  assert.match(audio, /o\.stop\(t \+ 0\.25\)/, 'the shared procedural lightning cue has a finite 0.25-second source');

  const events = [{ type: 'play', asset: 'light', source: 'Paladin / Fist of the Heavens', trigger: 'cast', sourceActive: true, at: 0, stopAt: 0.25 }];
  for (let i = 0; i < 4; i++) events.push({ type: 'impact', at: i * 0.09, sourceActive: true });
  events.push({ type: 'idle', at: 10, sourceActive: false });
  const trace = traceScenario(events);
  assert.equal(trace.log.filter((e) => e.type === 'play').length, 1);
  assert.equal(trace.log.filter((e) => e.type === 'stop').length, 1);
  assert.equal(trace.active, 0);
  assert.equal(trace.maxActive, 1);
  console.log('Diagnostic trace:', trace.log.map((e) => `${e.type}:${e.asset || 'strike'}@${e.at ?? ''}`).join(' → '));
});

test('Judgement, Blessed Hammer and Storm Tether have no idle audio producer', () => {
  const update = paladin.slice(paladin.indexOf('  update(p, s, dt) {'), paladin.indexOf('  fill:'));
  assert.match(update, /if \(s\.ready[\s\S]*?if \(toughest\(p, 8\)\) this\.fire\(p, s\)/);
  assert.doesNotMatch(update, /sfx\(/, 'Judgement only reaches its sound paths when a valid enemy allows it to fire');
  const impact = paladin.slice(paladin.indexOf('function impact('), paladin.indexOf('\nclass Consecration'));
  assert.match(impact, /sfx\('judgement_impact'/);
  const fire = paladin.slice(paladin.indexOf('  fire(p, s) {'), paladin.indexOf('\n  draw(ctx, p, s, t)'));
  assert.match(fire, /sfx\('judgement_cast'/);
  const tetherStart = augments.indexOf('function tether(');
  const tetherEnd = augments.indexOf('function tetherArc(', tetherStart);
  assert.doesNotMatch(augments.slice(tetherStart, tetherEnd), /sfx\(/);
  const orbitStart = skillrun.indexOf("    case 'orbit': {");
  const orbitEnd = skillrun.indexOf("    case 'cyclone': {", orbitStart);
  assert.match(skillrun.slice(orbitStart, orbitEnd), /sfx\('swing'\)/, 'Blessed Hammer retains its single cast sound');
});
