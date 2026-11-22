import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeTemporaryBuff, MAX_TEMPORARY_BUFF_SECONDS } from '../../src/game/buffduration.mjs';

assert.equal(MAX_TEMPORARY_BUFF_SECONDS, 120);
assert.equal(normalizeTemporaryBuff({ id: 'finite', t: 15, max: 15 }).t, 15);
assert.equal(normalizeTemporaryBuff({ id: 'long', t: 1e6, max: 1e6 }).t, 120);
assert.equal(normalizeTemporaryBuff({ id: 'invalid', t: Infinity }), null);
assert.equal(normalizeTemporaryBuff({ id: 'invalid', t: NaN }), null);
assert.equal(normalizeTemporaryBuff({ id: 'invalid', t: 0 }), null);
assert.equal(normalizeTemporaryBuff({ id: 'invalid', t: -1 }), null);

const loot = await readFile(new URL('../../src/game/loot.js', import.meta.url), 'utf8');
const chestDrop = loot.slice(loot.indexOf('export function dropChest('), loot.indexOf('/** Draw D2-style ground labels'));
assert.ok(chestDrop.includes("add('orb_hp'") && chestDrop.includes("add('orb_rejuv'"), 'chest healing orbs remain available');
assert.ok(!chestDrop.includes("add('orb_fury'"), 'treasure chests cannot drop Fury Orbs');
assert.ok(!chestDrop.includes('addBuff('), 'chest loot does not directly apply buffs');

const player = await readFile(new URL('../../src/game/player.js', import.meta.url), 'utf8');
assert.ok(player.includes('normalizeTemporaryBuff(b)'), 'player buff application validates finite durations');
assert.ok(player.includes('MAX_TEMPORARY_BUFF_SECONDS'), 'legacy overlong player timers are bounded');
const skillData = await readFile(new URL('../../src/data/skilldata.js', import.meta.url), 'utf8');
const skillModule = await readFile(new URL('../../src/data/skills.js', import.meta.url), 'utf8');
const buffSpecs = skillData.split('\n').filter((line) => line.includes('|buff|'));
assert.equal(buffSpecs.length, 78, 'the audited class buff catalog still contains all 78 buff abilities');
assert.ok(skillModule.includes('Math.min(skillDurationLimit(sk)'), 'rank-scaled skill buffs use a finite category cap');
assert.ok(skillModule.includes('Math.min(60, (d ?? 6)'), 'rank-scaled skill curses also have a finite cap');
const hud = await readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8');
assert.ok(hud.includes('s remaining'), 'buff tooltips show remaining duration');
assert.ok(!hud.includes('b.aura ? null'), 'aura buffs no longer suppress their countdown');

console.log('Temporary buff duration and chest reward regressions passed.');
