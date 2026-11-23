// The Reliquary: a vault in Herrington Hollow shared by every hero on this browser (six tabs of 96 slots, two open
// at first), and its Codex of every Heirloom, Covenant piece, Glyphword and Sigil any hero has found. It lives in its
// own localStorage key, beside the heroes' saves (game/save.js), so deleting a hero keeps the collection.
// Tabs open by collecting (25% and 80% of the Codex) and by Town Commission lines finished (1 and 3; game/commissions.js).
import { G } from '../state.js';
import { GEMS, SIGILS, itemName, itemColor } from '../data/items.js';
import { codexKey, CODEX_TOTAL, HEIRLOOMS, GLYPHWORDS, PIECE_BY_ID, makeHeirloom, maybeRelic } from '../data/relics.js';

const KEY = 'velscour_reliquary_v1';
export const VAULT_TABS = 6, VAULT_SIZE = 96;
export const MILESTONES = [
  { pct: 25, text: 'Vault III opens' },
  { pct: 40, text: '+3% Magic Find for every hero', mf: 3 },
  { pct: 60, text: '+5% Magic Find for every hero (in all)', mf: 5 },
  { pct: 80, text: 'Vault VI opens' },
  { pct: 100, text: 'The title "Keeper of Relics" and a golden aura', title: 'Keeper of Relics' },
];
let R = null;

function blank() { return { tabs: Array.from({ length: VAULT_TABS }, () => Array(VAULT_SIZE).fill(null)), codex: {}, lines: 0 }; }
function collectLegacyHeirlooms(value, found, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 10) return;
  if (value.type === 'gear' && value.relic === 'heir' && HEIRLOOMS.some((h) => h.id === value.rid)) found.add('h:' + value.rid);
  for (const child of Object.values(value)) collectLegacyHeirlooms(child, found, depth + 1);
}
function migrateLegacyHeirloomDiscoveries(r) {
  if (r.heirloomCodexMigrationV1) return;
  const found = new Set();
  let canFinish = true;
  try {
    const raw = localStorage.getItem('velscour_saves_v1');
    if (raw) { try { collectLegacyHeirlooms(JSON.parse(raw), found); } catch { canFinish = false; } }
    // Also preserve discoveries from recoverable save snapshots created by the game's own safety backups.
    // A malformed unrelated backup must not prevent migration from the live save. If its
    // save payload itself is unreadable, keep retrying so a later recovery can still count.
    let backup = null;
    try { backup = JSON.parse(localStorage.getItem('velscour_campaign_overhaul_backup_v1') || 'null'); } catch { /* ignore malformed wrapper */ }
    if (typeof backup?.saves === 'string') { try { collectLegacyHeirlooms(JSON.parse(backup.saves), found); } catch { canFinish = false; } }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('velscour_saves_v1_unreadable_')) continue;
      try { collectLegacyHeirlooms(JSON.parse(localStorage.getItem(key) || 'null'), found); } catch { /* preserved unreadable text is not overwritten */ }
    }
  } catch { canFinish = false; }
  for (const tab of r.tabs || []) collectLegacyHeirlooms(tab, found);
  if (!canFinish) return; // Keep retrying rather than marking an unreadable character store migrated.
  let changed = false;
  for (const key of found) if (!r.codex[key]) { r.codex[key] = Date.now(); changed = true; }
  r.heirloomCodexMigrationV1 = true;
  if (changed || canFinish) saveReliquary();
}
/** The shared Reliquary (loaded once). */
export function reliquary() {
  if (R) return R;
  try { R = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { R = null; }
  if (!R || !Array.isArray(R.tabs)) R = blank();
  while (R.tabs.length < VAULT_TABS) R.tabs.push([]);
  for (const t of R.tabs) while (t.length < VAULT_SIZE || t.length % 12 !== 0) t.push(null);
  R.codex = R.codex || {};
  R.lines = R.lines || 0;
  migrateLegacyHeirloomDiscoveries(R);
  return R;
}
export function saveReliquary() { try { localStorage.setItem(KEY, JSON.stringify(reliquary())); } catch (e) { /* storage full or blocked: the vault lives on for this visit */ } }
/** Tests: forget the cached copy (the next call reads localStorage again). */
export function resetReliquaryCache() { R = null; }
if (typeof addEventListener === 'function') addEventListener('velscour-overhaul-reset-complete', resetReliquaryCache);

/** Codex progress: {by: {h, c, g, s}, have, total, pct}. */
export function codexProgress() {
  const r = reliquary(), by = { h: 0, c: 0, g: 0, s: 0 };
  for (const k of Object.keys(r.codex)) if (by[k[0]] !== undefined) by[k[0]]++;
  const total = CODEX_TOTAL.h + CODEX_TOTAL.c + CODEX_TOTAL.g + CODEX_TOTAL.s;
  const have = by.h + by.c + by.g + by.s;
  return { by, have, total, pct: Math.floor((have / total) * 100) };
}
/** How many vault tabs are open. */
export function openTabs() {
  const pct = codexProgress().pct, lines = reliquary().lines;
  return 2 + (pct >= 25) + (lines >= 1) + (lines >= 3) + (pct >= 80);
}
/** Magic find every hero gets from the Codex. */
export function codexMf() { const pct = codexProgress().pct; return pct >= 60 ? 5 : pct >= 40 ? 3 : 0; }
export function codexTitle() { return codexProgress().pct >= 100 ? 'Keeper of Relics' : null; }

/** The codex key of anything collectable (relics, and Sigils by rank). */
export function findKey(it) {
  if (!it) return null;
  if (it.type === 'gem' && GEMS[it.gem] && GEMS[it.gem].sigil) return 's:' + it.tier;
  return codexKey(it);
}
/** Record a find in the Codex; true when it's new (with a log line and any milestone it reached). */
export function noteFind(it) {
  const k = findKey(it);
  if (!k) return false;
  const r = reliquary();
  if (r.codex[k]) return false;
  const before = codexProgress().pct, tabs = openTabs();
  r.codex[k] = Date.now();
  saveReliquary();
  const after = codexProgress();
  if (G.ui && G.ui.log) {
    G.ui.log(`New in the Codex: <span style="color:${itemColor(it)}">${itemName(it)}</span> <span class="dim">(${after.have}/${after.total})</span>`, '#e8d8a0');
    for (const m of MILESTONES) if (before < m.pct && after.pct >= m.pct) G.ui.log(`<b style="color:#ffe2a0">Codex ${m.pct}%:</b> ${m.text}.`, '#ffe2a0');
    if (openTabs() > tabs) G.ui.log('A new vault opens in the Reliquary.', '#ffe2a0');
  }
  if (G.player && codexMf() !== (G.player.codexMf || 0)) G.player.recompute();
  return true;
}
/** Undiscovered account Heirlooms eligible for a particular equipment slot. */
export function undiscoveredHeirlooms(slot = null, unboundOnly = false) {
  const known = reliquary().codex;
  return HEIRLOOMS.filter((h) => (!slot || h.slot === slot) && (!unboundOnly || (h.unbound && !h.crown)) && !known['h:' + h.id]);
}
/** Create and account-unlock a one-time Heirloom drop. Ordinary loot can use this at any level/depth. */
export function makeAccountHeirloom(ilvl, opts = {}) {
  const pool = undiscoveredHeirlooms(opts.slot || null, !!opts.unboundOnly);
  if (opts.id) {
    const H = pool.find((h) => h.id === opts.id);
    if (!H) return null;
    const item = makeHeirloom(1, { id: H.id });
    if (item) noteFind(item);
    return item;
  }
  if (!pool.length) return null;
  const item = makeHeirloom(1, { id: pool[Math.floor(Math.random() * pool.length)].id });
  if (item) noteFind(item);
  return item;
}
/** Apply the existing relic odds while ensuring a Heirloom can only be generated once account-wide. */
export function maybeAccountRelic(item, boost = 1) {
  const eligible = undiscoveredHeirlooms().map((h) => h.id);
  const result = maybeRelic(item, boost, eligible);
  if (result !== item && result?.relic === 'heir') noteFind(result);
  return result;
}
/** A Town Commission line finished (by any hero): may open a vault. */
export function noteLineDone() {
  const r = reliquary(), tabs = openTabs();
  r.lines++;
  saveReliquary();
  if (openTabs() > tabs && G.ui && G.ui.log) G.ui.log('A new vault opens in the Reliquary.', '#ffe2a0');
}
/** Every collectable entry for the Codex page: [{key, kind, name, slot}]. */
export function codexEntries() {
  return [
    ...HEIRLOOMS.map((h) => ({ key: 'h:' + h.id, kind: 'h', name: h.name, slot: h.slot })),
    ...Object.values(PIECE_BY_ID).map((p) => ({ key: 'c:' + p.id, kind: 'c', name: p.name, slot: p.slot, set: p.set })),
    ...GLYPHWORDS.map((g) => ({ key: 'g:' + g.id, kind: 'g', name: g.name, slot: g.slots[0], sig: g.sig, slots: g.slots })),
    ...SIGILS.map((s, i) => ({ key: 's:' + i, kind: 's', name: s.name + ' Sigil', rank: i })),
  ];
}
/** Put an item in the first free slot of an open vault tab (gems stack). */
export function addToVault(it, tab = null) {
  const r = reliquary(), n = openTabs();
  const order = tab != null ? [tab] : [...Array(n).keys()];
  if (it.type === 'gem') for (const t of order) { const same = r.tabs[t].find((b) => b && b.type === 'gem' && b.gem === it.gem && b.tier === it.tier); if (same) { same.count = (same.count || 1) + (it.count || 1); saveReliquary(); return true; } }
  for (const t of order) {
    if (t >= n) continue;
    const i = r.tabs[t].findIndex((b) => !b);
    if (i >= 0) { r.tabs[t][i] = it; saveReliquary(); return true; }
  }
  return false;
}
