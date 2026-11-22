import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  appendEnemyHistory, ENEMY_HISTORY_LIMIT, ENEMY_HISTORY_STORAGE_KEY,
  loadEnemyHistory, normalizeEnemyHistory, saveEnemyHistory,
} from '../../src/ui/enemyhistory.js';

const history = [];
for (let i = 0; i < 105; i++) appendEnemyHistory(history, {
  key: `enemy-${i}`, name: `Enemy ${i}`, art: `art-${i}`, level: i + 1,
  maxHp: 100 + i, hp: 75 + i, dmg: 12 + i, affixes: ['strong'],
  dungeonAffixes: ['fortified'], res: { fire: 0.4 }, thumbnail: 'data:image/png;base64,abc',
});
assert.equal(history.length, ENEMY_HISTORY_LIMIT, 'history retains no more than 100 encounters');
assert.equal(history[0].key, 'enemy-5', 'oldest encounter is discarded first');
assert.equal(history.at(-1).key, 'enemy-104', 'newest encounter remains last');
assert.equal(appendEnemyHistory(history, { key: 'enemy-104', name: 'Repeated target' }).added, false, 'the same enemy cannot create duplicate history entries');

const stored = new Map();
const storage = { getItem: (key) => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
assert.equal(saveEnemyHistory(history, storage), true, 'history persists to local storage');
const restored = loadEnemyHistory(storage);
assert.equal(restored.length, 100, 'saved history restores with its bound');
assert.equal(restored[4].art, 'art-9', 'artwork reference survives saving');
assert.equal(restored[4].maxHp, 109, 'enemy statistics survive saving');
assert.deepEqual(restored[4].affixes, ['strong'], 'elite affixes survive saving');
assert.deepEqual(restored[4].dungeonAffixes, ['fortified'], 'dungeon affixes survive saving');
assert.deepEqual(restored[4].res, { fire: 0.4 }, 'resistances survive saving');
assert.equal(restored[4].thumbnail, 'data:image/png;base64,abc', 'recorded artwork thumbnail survives saving');
assert.equal(stored.has(ENEMY_HISTORY_STORAGE_KEY), true);
assert.deepEqual(normalizeEnemyHistory('invalid'), [], 'invalid stored data safely falls back to empty history');

const hud = await readFile(new URL('../../src/ui/hud.js', import.meta.url), 'utf8');
assert.match(hud, /if \(cur\) this\.recordEnemy\(cur\)/, 'encounters are recorded during target updates');
assert.match(hud, /if \(cur && !this\.enemyHistoryReviewing\) this\.tb = cur/, 'new targets do not interrupt history review');
assert.match(hud, /tb-history-position/, 'history position is displayed');
const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
assert.match(html, /id="tb-previous"[^>]*aria-label="Previous enemy"[^>]*>◀<\/button>/, 'previous control uses an accessible arrow-only button');
assert.match(html, /id="tb-history-position"[^>]*>0 of 0<\/span>/, 'history counter sits between navigation controls');
assert.match(html, /id="tb-next"[^>]*aria-label="Next enemy"[^>]*>▶<\/button>/, 'next control uses an accessible arrow-only button');
const css = await readFile(new URL('../../css/style.css', import.meta.url), 'utf8');
assert.match(css, /#tb-history-controls\s*\{[^}]*justify-content:\s*center/s, 'history footer centers its controls');
assert.match(css, /#tb-history-controls button\s*\{[^}]*flex:\s*0 0 26px[^}]*width:\s*26px[^}]*height:\s*22px/s, 'arrow buttons share compact fixed dimensions');
assert.match(css, /#target-box\s*\{[^}]*width:\s*min\(190px,[^}]*height:\s*auto/s, 'normal enemy window is narrower and grows with its content');
assert.match(css, /#tb-pic\s*\{[^}]*width:\s*96px[^}]*height:\s*96px/s, 'normal portrait size remains unchanged');
assert.match(css, /#tb-name\s*\{[^}]*14px[^}]*overflow-wrap:\s*anywhere/s, 'enemy names are larger and can wrap without clipping');
assert.match(css, /#tb-history-details\s*\{[^}]*10px\/1\.3[^}]*overflow-wrap:\s*anywhere/s, 'statistics, affixes, and resistances use larger wrapping text');
assert.match(css, /body\.touch #tb-history-details\s*\{[^}]*font-size:\s*9px/s, 'small-screen history text stays readable');
assert.match(css, /body\.touch\.portrait #target-box\s*\{[^}]*width:\s*min\(190px, 47vw\)/s, 'portrait layout stays within the left HUD width');
console.log('Enemy history retention, deduplication, persistence, data fidelity, and review checks passed.');
