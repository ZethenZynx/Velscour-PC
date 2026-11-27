import assert from 'node:assert/strict';
import { checkForGameUpdates, compareBuildIdentity, UPDATE_CHECK_INTERVAL_MS } from '../../src/game/updater.js';

const buildA = `pages-${'a'.repeat(40)}`, buildB = `pages-${'b'.repeat(40)}`;
const source = (version, buildId, commit = buildId.slice(6)) => `export const GAME_VERSION = '${version}';\nexport const GAME_BUILD_ID = '${buildId}';\nexport const GAME_GIT_COMMIT = '${commit}';`;
globalThis.document = { baseURI: 'https://zethenzynx.github.io/Velscour-PC/', dispatchEvent() {} };
let deployed = source('0.1.8', buildB);
let requestedUrl = '';
let requestOptions;
globalThis.fetch = async (url, options) => {
  requestedUrl = String(url); requestOptions = options;
  return { ok: true, status: 200, text: async () => deployed };
};

const available = await checkForGameUpdates({ runningBuildId: buildA, runningVersion: '0.1.8', runningCommit: 'a'.repeat(40) });
assert.equal(available.status, 'available');
assert.equal(available.available, true);
assert.match(requestedUrl, /_update_check=/, 'deployment checks use a cache-busting query');
assert.equal(requestOptions.cache, 'no-store');
assert.equal(requestOptions.headers['Cache-Control'], 'no-cache, no-store');

deployed = source('0.1.7', buildA);
const current = await checkForGameUpdates({ runningBuildId: buildA, runningVersion: '0.1.8', runningCommit: 'a'.repeat(40) });
assert.equal(current.status, 'latest');
assert.equal(current.available, false);

deployed = source('0.1.8', 'deployed-newer');
const invalid = await checkForGameUpdates({ runningBuildId: buildA });
assert.equal(invalid.status, 'unavailable', 'an un-stamped or malformed deployment identity is not treated as current');

deployed = source('0.1.8', buildB, 'c'.repeat(40));
const mismatchedCommit = await checkForGameUpdates({ runningBuildId: buildA });
assert.equal(mismatchedCommit.status, 'unavailable', 'the manifest commit must match its stamped build ID');

globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' });
const unavailable = await checkForGameUpdates({ runningBuildId: buildA });
assert.equal(unavailable.status, 'unavailable');
assert.equal(unavailable.lastSuccessfulCheckAt, mismatchedCommit.lastSuccessfulCheckAt, 'failed checks do not replace the last successful check time');
assert.ok(UPDATE_CHECK_INTERVAL_MS > 0);
assert.deepEqual(compareBuildIdentity(buildA, buildA), { valid: true, available: false, status: 'latest' });
assert.deepEqual(compareBuildIdentity(buildA, buildB), { valid: true, available: true, status: 'available' });
assert.equal(compareBuildIdentity(buildA, 'dev-build').valid, false);

console.log('GitHub Pages update checks passed: exact commit identities, malformed manifests, display-version independence, cache bypass, and fetch failure.');
