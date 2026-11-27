import assert from 'node:assert/strict';
import { GAME_BUILD_ID, GAME_VERSION } from '../../src/data/build-version.js';
import { checkForGameUpdates, UPDATE_CHECK_INTERVAL_MS } from '../../src/game/updater.js';

const source = (version, buildId) => `export const GAME_VERSION = '${version}';\nexport const GAME_BUILD_ID = '${buildId}';`;
let deployed = source('0.1.6', 'deployed-newer');
let requestedUrl = '';
let requestOptions;
globalThis.fetch = async (url, options) => {
  requestedUrl = String(url); requestOptions = options;
  return { ok: true, status: 200, text: async () => deployed };
};

const available = await checkForGameUpdates();
assert.equal(available.status, 'available');
assert.equal(available.available, true);
assert.match(requestedUrl, /_update_check=/, 'deployment checks use a cache-busting query');
assert.equal(requestOptions.cache, 'no-store');
assert.equal(requestOptions.headers['Cache-Control'], 'no-cache');

deployed = source(GAME_VERSION, GAME_BUILD_ID);
const current = await checkForGameUpdates();
assert.equal(current.status, 'latest');
assert.equal(current.available, false);

deployed = source('0.1.3', 'older-deployment');
const ahead = await checkForGameUpdates();
assert.equal(ahead.status, 'ahead');
assert.equal(ahead.available, false);

globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
const unavailable = await checkForGameUpdates();
assert.equal(unavailable.status, 'unavailable');
assert.ok(UPDATE_CHECK_INTERVAL_MS > 0);

console.log('GitHub Pages update checks passed: newer deployment, matching build, older deployment, cache bypass, and fetch failure.');
