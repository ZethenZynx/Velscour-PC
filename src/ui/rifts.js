// The Abyssal Rift dialogs (docs/ENDGAME.md): the tier to enter, the results of a closed rift, and the honour
// board (game/leaderboard.js).
import { G } from '../state.js';
import { escapeHtml } from '../core/util.js';
import { UI } from './ui.js';
import { CLASSES } from '../data/classes.js';
import { SKILLS } from '../data/skills.js';
import { RARITY, SLOTS, SLOT_NAMES, sigilCap } from '../data/items.js';
import { RIFT_QUOTA, riftLevel, fmtTime, normalizeRiftTier, riftQualityRange, riftRewardProgressionDepth, riftHpMul, riftDmgMul, riftReward } from '../data/rifts.js';
import { depthLevel } from '../data/depth.js';
import { riftOpen, riftTime } from '../game/rifts.js';
import { endgame } from '../game/endgame.js';
import { Board } from '../game/leaderboard.js';

const num = (v) => (Number.isFinite(+v) ? +v : 0);
/** A board entry's build (untrusted: everything is escaped, rarities clamped). */
function buildHtml(e) {
  const b = e.build && typeof e.build === 'object' ? e.build : {}, gear = b.gear && typeof b.gear === 'object' ? b.gear : {};
  const skills = (Array.isArray(b.bar) ? b.bar : []).slice(0, 15).map((id) => `<span>${escapeHtml(SKILLS[id] ? SKILLS[id].name : String(id))}</span>`).join('');
  const rows = [...SLOTS, ...Object.keys(gear).filter((s) => !SLOTS.includes(s))].filter((s) => gear[s] && typeof gear[s] === 'object').map((s) => {
    const g = gear[s], R = RARITY[Math.max(0, Math.min(RARITY.length - 1, num(g.rarity) | 0))];
    return `<div><span class="dim">${escapeHtml(SLOT_NAMES[s] || s)}</span><b style="color:${R.color}">${escapeHtml(String(g.name || '?'))}${num(g.upg) > 0 ? ` +${num(g.upg) | 0}` : ''}</b><i class="dim">${R.name} · ilvl ${num(g.ilvl) | 0}</i></div>`;
  }).join('');
  const at = num(e.at) ? new Date(num(e.at)).toLocaleDateString() : '';
  return `<div class="rb-bhead">Level ${num(e.level) | 0} · ${num(e.marks) | 0} Infernal Mark${(num(e.marks) | 0) === 1 ? '' : 's'}${at ? ` · ${at}` : ''}</div>
    <div class="rb-skills">${skills || '<span class="dim">no skills recorded</span>'}</div><div class="rb-gear">${rows || '<div class="dim">no gear recorded</div>'}</div>`;
}

export const Rifts = {
  /** Pick a tier (1 .. the tier the hero's wins opened) and step in. */
  open(tier, { onBack = null } = {}) {
    const c = G.char, top = riftOpen(c), selected = Math.min(top, normalizeRiftTier(tier || top)), r = c.rifts;
    const acc = endgame().bests[c.classId];
    const d = UI.dialog({
      title: 'ABYSSAL RIFT', cls: 'rift-dialog',
      html: `<p>The gate opens on <b style="color:#20e0ff">a rift torn in the abyss</b>: a short dungeon and its arena, against the clock.</p>
        <p class="dim">Slay ${Math.round(RIFT_QUOTA * 100)}% of the rift's monsters (a champion counts four, a unique eight) to wake the Guardian, then slay it before <b>${fmtTime(riftTime())}</b> runs out. Finish in half the time and the win opens three tiers; in 80%, two; else one. Falling here costs no Defiance and leaves your descent where it is.</p>
        <label class="velscour-message-label" for="rift-pick">Rift tier (1–${top})</label><input id="rift-pick" type="number" inputmode="numeric" min="1" max="${top}" step="1" value="${selected}" class="velscour-number-input">
        <div id="rift-tier-preview" class="rift-tier-preview" aria-live="polite"></div>
        <p class="breach-warn" id="rift-warn"></p>
        <p class="rb-stats dim">Best: ${r.best ? `Tier ${r.best}` : 'none yet'}${acc ? ` · your ${escapeHtml(CLASSES[c.classId]?.name || c.classId)}s' best Tier ${acc.tier} in ${fmtTime(acc.time)}` : ''} · ${r.runs | 0} run${r.runs === 1 ? '' : 's'}, ${Object.values(r.cleared).reduce((a, n) => a + n, 0)} closed, ${r.fails | 0} collapsed, ${r.deaths | 0} fallen</p>`,
      buttons: [{ label: onBack ? 'Back' : 'Not yet', fn: onBack || undefined }, { label: 'Honour Board', keepOpen: true, fn: () => this.board() }, { label: 'Enter the Rift', cls: 'red', fn: () => G.game.enterRift(normalizeRiftTier(d.box.querySelector('#rift-pick').value)) }],
    });
    const sel = d.box.querySelector('#rift-pick'), warn = d.box.querySelector('#rift-warn'), preview = d.box.querySelector('#rift-tier-preview');
    const fmtMul = (n) => n >= 1e6 ? `×${n.toExponential(2)}` : `×${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const upd = () => {
      const n = Math.min(top, normalizeRiftTier(sel.value || top)); sel.value = String(n);
      const range = riftQualityRange(n, c), rewardDepth = riftRewardProgressionDepth(n, c), reward = riftReward(n, !r.cleared[n]);
      const nextQualityDepth = RARITY[range.progressionMax]?.minDepth;
      const markBonus = Math.max(0, Number(G.player?.st?.markRiftRewards) || 0);
      const markRemainder = Number(endgame().marks.rewardRemainder) || 0;
      const potentialMarks = Math.floor(reward.marks * (1 + markBonus / 100) + markRemainder);
      const gemDepthLevel = depthLevel(rewardDepth) + 4;
      const gemCap = Math.max(1, Math.min(7, Math.floor(gemDepthLevel / 16), Math.floor(Math.max(1, c.level || 1) / 16)));
      const sigilRank = sigilCap(rewardDepth) + 1;
      const progressionNote = range.max < Math.min(20, 5 + Math.floor((n - 1) / 5))
        ? `Equipment quality is limited to Tier ${range.max} by normal dungeon progression (you have unlocked through Depth ${range.normalDepth}).`
        : 'Normal progression remains in force; Rift tier cannot bypass equipment, gem or sigil unlocks.';
      preview.innerHTML = `<strong>Tier ${n}</strong><div class="rift-preview-stats"><span>Enemy health <b>${fmtMul(riftHpMul(n))}</b></span><span>Enemy damage <b>${fmtMul(riftDmgMul(n))}</b></span><span>Equipment quality <b>Tier ${range.min}-${range.max}</b></span><span>Highest unlocked Rift tier <b>${top}</b></span><span>Potential Infernal Marks <b>${potentialMarks}${markBonus ? ` (${markBonus}% bonus)` : ''}</b></span><span>Gem cap <b>Grade ${gemCap}</b> (also limited by character level)</span><span>Sigil cap <b>Rank ${sigilRank}</b></span></div><p class="rift-progression-note">${progressionNote}</p>${nextQualityDepth ? `<p class="dim">Reach Depth ${nextQualityDepth} to unlock equipment quality Tier ${range.progressionMax + 1}.</p>` : '<p class="dim">All equipment qualities are unlocked through normal progression.</p>'}`;
      const L = riftLevel(n); warn.innerHTML = L > c.level + 4 ? `<b style="color:#ff6050">Monsters there are level ${L}; you are level ${c.level}. Expect to die.</b>` : '';
    };
    sel.addEventListener('input', upd); sel.addEventListener('change', upd); upd();
    return d;
  },
  /** A closed rift: what it paid, and on to the next tier or home. */
  results(R, o) {
    const r = R.result || {}, time = r.time ?? R.t, jump = r.jump || 1, marks = r.marks || 0;
    return UI.dialog({
      title: `Rift Tier ${R.tier} Closed`, cls: 'rift-dialog rift-results',
      html: `<div class="rr-time"><b>${fmtTime(time)}</b><span>of ${fmtTime(R.limit)} · ${Math.round((time / R.limit) * 100)}% of the clock</span></div>
        <ul class="rr-list"><li>+${jump} tier${jump > 1 ? 's' : ''} opened: <b>Tier ${o.next}</b> next</li><li>+${marks} Infernal Mark${marks === 1 ? '' : 's'}</li>${r.rarity !== undefined ? `<li>The Guardian's hoard: ${/^[AEIOU]/.test(RARITY[r.rarity].name) ? 'an' : 'a'} <b style="color:${RARITY[r.rarity].color}">${RARITY[r.rarity].name}</b> prize${r.first ? ' (first clear of the tier)' : ''}</li>` : ''}${r.best ? '<li><b style="color:#ffd860">A new best</b> for your class on this account' + (board ? `: ${board}` : '') + '</li>' : r.personal ? '<li>A new best time for this tier</li>' : ''}${r.board === 'barred' ? '<li class="dim">This hero took Velscour\'s gift: it is never listed on the Honour Board</li>' : ''}</ul>`,
      buttons: [{ label: 'Cancel' }, { label: 'Return to Town', fn: o.onTown }, { label: `On to Tier ${o.next}`, cls: 'red', fn: o.onNext }],
    });
  },
  /** The honour board shows archived online runs and this browser's own best. */
  board(cls = G.char ? G.char.classId : 'paladin') {
    const d = UI.dialog({
      title: 'HONOUR BOARD', cls: 'rift-dialog rift-board',
      html: `<p class="dim rb-note">Every hero's best Abyssal Rift: the highest tier, then the fastest. Saves live on each player's device, so it is a board of honour; every run is posted with its build.</p>
        <div class="rb-head"><select class="velscour-biome-select" id="rb-cls">${Object.entries(CLASSES).map(([id, C]) => `<option value="${id}"${id === cls ? ' selected' : ''}>${escapeHtml(C.name)}</option>`).join('')}</select></div>
        <div class="rb-you"></div><div class="rb-list"></div>`,
      buttons: [{ label: 'Close' }],
    });
    const list = d.box.querySelector('.rb-list'), you = d.box.querySelector('.rb-you'), sel = d.box.querySelector('#rb-cls');
    let seq = 0;
    const row = (e, i, own) => `<div class="rb-row${own ? ' rb-mine' : ''}" data-i="${i}" tabindex="0"><span class="rb-rank">${i + 1}</span><span class="rb-name">${escapeHtml(String(e.name || 'Hero'))}</span><b>Tier ${num(e.tier) | 0}</b><span class="rb-time">${fmtTime(num(e.time))}</span><i class="dim">lvl ${num(e.level) | 0}</i></div><div class="rb-build hidden">${buildHtml(e)}</div>`;
    const fill = async () => {
      const id = sel.value, n = ++seq, mine = endgame().bests[id];
      you.innerHTML = `<span>Your best on this browser</span><b>${mine ? `Tier ${mine.tier} · ${fmtTime(mine.time)}` : 'no rift closed yet'}</b><p class="dim">The online Honour Board is read-only.</p>`;
      list.innerHTML = '<div class="rb-msg dim">Loading…</div>';
      let rows = null;
      try { rows = await Board.top(id, 1000); } catch (e) { console.warn('Honour board:', e); }
      if (n !== seq || !list.isConnected) return; // another class was picked meanwhile, or the dialog closed
      if (!rows) { list.innerHTML = '<div class="rb-msg">Could not reach the board. Try again when you are online.</div>'; return; }
      if (!rows.length) { list.innerHTML = '<div class="rb-msg dim">Nobody listed yet.</div>'; return; }
      list.innerHTML = '<div class="rb-row rb-top"><span>#</span><span>Hero</span><b>Tier</b><span>Time</span><i>Level</i></div>'
        + rows.slice(0, 50).map((e, i) => row(e, i, false)).join('');
      list.querySelectorAll('.rb-row[data-i]').forEach((el) => {
        const open = () => { el.classList.toggle('open'); el.nextElementSibling.classList.toggle('hidden'); };
        el.addEventListener('click', open);
        el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
      });
    };
    sel.addEventListener('change', fill);
    d.ready = fill();
    return d;
  },
};
