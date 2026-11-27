import { RECENT_CHANGES } from '../data/recent-changes.js';
import { GAME_BUILD_ID, GAME_VERSION } from '../data/build-version.js';
import { UI } from '../ui/ui.js';
import { escapeHtml } from '../core/util.js';

const ACKNOWLEDGED_UPDATES_KEY = 'velscour_update_acknowledged_v1';
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const changeKey = ({ date, title }) => `${date || ''}\u0000${String(title || '').trim().toLocaleLowerCase()}`;
const bundledChanges = new Set(RECENT_CHANGES.map(changeKey));
let updateState = { status: 'unknown', available: false, runningBuildId: GAME_BUILD_ID, runningVersion: GAME_VERSION, deployedBuildId: null, deployedVersion: null, deployedCommit: null, checkedAt: 0 };
let checkInFlight = null;
let monitorTimer = null;

function acknowledgedChanges() {
  try {
    const value = JSON.parse(localStorage.getItem(ACKNOWLEDGED_UPDATES_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((key) => typeof key === 'string') : []);
  } catch (_) { return new Set(); }
}

/** Changes merged into main after this game's bundled history was created. */
export function changesAfterBundledBuild(items) {
  if (!Array.isArray(items)) return [];
  const acknowledged = acknowledgedChanges();
  return items.filter((item) => item?.title && !bundledChanges.has(changeKey(item)) && !acknowledged.has(changeKey(item)));
}

export function getGameUpdateStatus() { return { ...updateState }; }

function publishUpdateState(next) {
  updateState = { ...updateState, ...next, checkedAt: Date.now() };
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('velscour-update-status', { detail: getGameUpdateStatus() }));
  }
  return getGameUpdateStatus();
}

function compareVersions(a, b) {
  const parse = (v) => String(v || '').split('.').map((part) => Number.parseInt(part, 10));
  const left = parse(a), right = parse(b);
  if (!left.length || !right.length || left.some((part) => !Number.isFinite(part)) || right.some((part) => !Number.isFinite(part))) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

/** Compare this running build with the identity embedded in the live Pages artifact. */
export async function checkForGameUpdates() {
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    try {
      // Resolve from the Pages root rather than from this module URL. The latter may
      // carry a build query, and the version endpoint must always be a fresh request.
      const buildUrl = new URL('src/data/build-version.js', document.baseURI);
      buildUrl.searchParams.set('_update_check', String(Date.now()));
      const response = await fetch(buildUrl.href, {
        cache: 'no-store',
        headers: { Accept: 'text/javascript', 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' },
        credentials: 'same-origin',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`GitHub Pages returned HTTP ${response.status}`);
      const source = await response.text();
      const match = source.match(/export\s+const\s+GAME_BUILD_ID\s*=\s*(['"])(.*?)\1/);
      const versionMatch = source.match(/export\s+const\s+GAME_VERSION\s*=\s*(['"])(.*?)\1/);
      const commitMatch = source.match(/export\s+const\s+GAME_GIT_COMMIT\s*=\s*(['"])(.*?)\1/);
      if (!match || !match[2]) throw new Error('The deployed build identity is missing or invalid');
      const deployedBuildId = match[2];
      const deployedVersion = versionMatch?.[2] || null;
      const deployedCommit = commitMatch?.[2] || (deployedBuildId.startsWith('pages-') ? deployedBuildId.slice(6) : null);
      if (deployedBuildId.startsWith('pages-') && !/^[0-9a-f]{40}$/i.test(deployedCommit || '')) {
        throw new Error('The deployed build commit identifier is invalid');
      }
      const versionOrder = compareVersions(deployedVersion, GAME_VERSION);
      const available = versionOrder == null ? deployedBuildId !== GAME_BUILD_ID
        : versionOrder > 0 || (versionOrder === 0 && deployedBuildId !== GAME_BUILD_ID);
      return publishUpdateState({
        status: available ? 'available' : versionOrder < 0 ? 'ahead' : 'latest',
        available,
        deployedBuildId,
        deployedVersion,
        deployedCommit,
        error: null,
      });
    } catch (error) {
      // A temporary network failure must not hide an update already confirmed.
      return publishUpdateState({ status: 'unavailable', available: updateState.available, error: String(error?.message || error) });
    } finally {
      checkInFlight = null;
    }
  })();
  return checkInFlight;
}

/** Start one launch check and a low-frequency check that continues during gameplay. */
export function startGameUpdateMonitor() {
  if (monitorTimer == null && typeof window !== 'undefined') {
    void checkForGameUpdates();
    monitorTimer = window.setInterval(() => { void checkForGameUpdates(); }, UPDATE_CHECK_INTERVAL_MS);
  }
  return getGameUpdateStatus();
}

export function showUpdateDialog(items = []) {
  const updates = changesAfterBundledBuild(items);
  const list = updates.slice(0, 8).map(({ title, summary, date }) =>
    `<li><strong>${escapeHtml(title)}</strong>${summary ? `<span>${escapeHtml(summary)}</span>` : ''}${date ? `<time>${escapeHtml(date)}</time>` : ''}</li>`
  ).join('');
  UI.dialog({
    title: 'GitHub Pages Update Available',
    html: `<p>A newer game build is available on GitHub Pages. Reload when convenient to apply it. Your saved game data is kept in this browser.</p>${list ? `<ul class="update-change-list">${list}</ul>` : ''}`,
    buttons: [
      { label: 'Later' },
      { label: 'Reload to Update', cls: 'red', fn: () => reloadGameForUpdate(updates) },
    ],
  });
}

/** Refreshes the hosted Pages response and loads the newly versioned module graph. */
export async function reloadGameForUpdate(updates = []) {
  if (typeof window === 'undefined') return;
  const stamp = String(Date.now());
  const url = new URL(window.location.href);
  url.searchParams.set('_velscour_update', stamp);
  const freshPage = new URL(window.location.pathname, window.location.origin);
  freshPage.searchParams.set('_velscour_update', stamp);
  try {
    const response = await fetch(freshPage.href, { cache: 'reload', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`The latest game page returned HTTP ${response.status}`);
  } catch (_) { /* navigating still retries the latest published page */ }
  try {
    const acknowledged = acknowledgedChanges();
    for (const item of updates) acknowledged.add(changeKey(item));
    localStorage.setItem(ACKNOWLEDGED_UPDATES_KEY, JSON.stringify([...acknowledged].slice(-500)));
  } catch (_) { /* update can still proceed when browser storage is unavailable */ }
  window.location.replace(url.href);
}
