// The Altar of Heresy panel (docs/ENDGAME.md): the Heresies to switch on, the rank and what it pays, the milestones,
// and the Endgame's other doors (the Abyssal Rift gate, Velscour Unbound, the Infernal Marks). Every row is one big
// toggle (one column on a phone). The panel is only available after the campaign clear.
import { G } from '../state.js';
import { el, escapeHtml } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { UI } from './ui.js';
import { HERESIES, HERESY_MILESTONES, HERESY_MAX_RANK, heresyMods } from '../data/heresies.js';
import { heresiesOf, heresyRankOf, setHeresy, worldRank } from '../game/heresies.js';
import { campaignVictoryRecorded, endgameUnlocked } from '../game/endgame.js';
import { Marks } from './marks.js';

export function heresyModifierColumns(modifiers = HERESIES) {
  return [0, 1, 2].map((column) => modifiers.slice(column * 10, (column + 1) * 10));
}

/** The rank's rewards as chips: drops, magic find, gold, XP, Sigils, relics. */
function rewardChips(rank) {
  const M = heresyMods(rank);
  return [['Equipment drops', `x${M.loot.toFixed(2)}`], ['Magic find', `+${M.mf}%`], ['Gold', `x${M.gold.toFixed(2)}`], ['Experience', `+${Math.round((M.xp - 1) * 100)}%`], ['Sigils', `x${M.sigil.toFixed(2)}`], ['Relics', `x${M.relic.toFixed(2)}`]]
    .map(([k, v]) => `<span class="hx-chip"><i>${k}</i><b>${v}</b></span>`).join('');
}

export const Heresies = {
  active: false,
  open() {
    if (!campaignVictoryRecorded()) {
      UI.log('<b style="color:#20e0ff">The Altar of Heresy</b> remains sealed until Velscour is defeated at Depth 100.', '#a0f0ff');
      sfx('error');
      return false;
    }
    if (this.active && UI.isOpen('heresies') && UI.isOpen('marks')) return true;
    UI.closeAll();
    Marks.activePair = true;
    this.active = true;
    sfx('ui');
    UI.openPanel('heresies', 'Altar of Heresy', (b) => this.render(b), {
      onClose: () => {
        const pairedWindow = Marks.activePair;
        this.active = false; Marks.activePair = false;
        if (pairedWindow && UI.isOpen('marks')) UI.closePanel('marks');
      }, cls: 'heresy-panel', width: 'min(1040px, 96vw)', layoutManaged: true,
    });
    Marks.open({ keepExisting: true, paired: true });
    return true;
  },
  close() { UI.closePanel('heresies'); },
  render(body) {
    const c = G.char, on = heresiesOf(c), rank = heresyRankOf(c), w = G.world;
    const milestoneIcons = { 10: '\u2691', 20: '\u2726', 30: '\u269c', 40: '\u2694', 50: '\u25c8', 60: '\u2620' };
    body.innerHTML = '';
    // the rank, its bar and what it pays
    const head = el('div', 'hx-head');
    head.innerHTML = `<div class="hx-rank">Heresy rank <b>${rank}</b><span class="dim"> / ${HERESY_MAX_RANK}</span></div>
      <div class="hx-bar"><div style="width:${(100 * rank) / HERESY_MAX_RANK}%"></div>${HERESY_MILESTONES.map((m) => `<span class="hx-tick${rank >= m.rank ? ' done' : ''}${m.rank === HERESY_MILESTONES.find((q) => q.rank > rank)?.rank ? ' next' : ''}" style="left:${(100 * m.rank) / HERESY_MAX_RANK}%" title="Rank ${m.rank}: ${escapeHtml(m.name)}"><i>${milestoneIcons[m.rank] || (m.rank === HERESY_MAX_RANK ? '\u265b' : m.icon)}</i><b>${m.rank}</b></span>`).join('')}</div>
      <div class="hx-chips${rank ? '' : ' dim'}">${rewardChips(rank)}</div>`;
    body.appendChild(head);
    // when they take hold (a level already built keeps the set it was built with)
    const here = w && w.kind === 'dungeon' && !w.rift && !w.unbound ? worldRank(w) : null;
    const built = here !== null && (w.heresy ? w.heresy.ids : []).join() !== on.join();
    body.appendChild(el('div', 'hx-note', `Your choices take hold from the <b>next level</b> you enter (every depth, the Endless Torment and the Eternal Breach), never in Abyssal Rifts or Velscour Unbound.${built ? ` <span class="hx-warn">This level was built at Heresy ${here}: your changes wait for the next one.</span>` : ''}`));
    // Three fixed columns keep all thirty modifier toggles visible together.
    const scrollArea = el('div', 'hx-content');
    const list = el('div', 'hx-list');
    for (const columnData of heresyModifierColumns()) {
      const column = el('div', 'hx-column');
      for (const H of columnData) {
      const isOn = on.includes(H.id);
      const row = el('label', 'hx-row' + (isOn ? ' on' : ''));
      row.style.setProperty('--hc', H.color);
      row.dataset.id = H.id;
      row.innerHTML = `<input type="checkbox" ${isOn ? 'checked' : ''}><span class="hx-sw"></span><span class="hx-text"><span class="hx-name"><b>${escapeHtml(H.name)}</b><span class="hx-pips" title="Rank ${H.rank}">${'<i></i>'.repeat(H.rank)}</span></span><span class="hx-desc">${escapeHtml(H.desc)}</span></span>`;
      row.querySelector('input').addEventListener('change', (e) => {
        if (!setHeresy(H.id, e.target.checked)) { e.target.checked = heresiesOf(c).includes(H.id); sfx('error'); return; }
        sfx(e.target.checked ? 'boss' : 'ui', 0.6);
        if (G.game && G.game.autosave) G.game.autosave();
        UI.refresh();
      });
      row.querySelector('.hx-pips').title = `Adds ${H.rank} Heresy ranks`;
      column.appendChild(row);
      }
      list.appendChild(column);
    }
    scrollArea.appendChild(list);
    const milestoneRows = HERESY_MILESTONES.map((m) => `<div class="hx-mile${rank >= m.rank ? ' done' : ''}${m.rank === HERESY_MILESTONES.find((q) => q.rank > rank)?.rank ? ' next' : ''}"><span class="hx-mile-icon" title="${escapeHtml(m.name)}">${milestoneIcons[m.rank] || (m.rank === HERESY_MAX_RANK ? '\u265b' : m.icon)}</span><span><b>Rank ${m.rank} · ${escapeHtml(m.name)}</b><small>${escapeHtml(m.text)}</small></span></div>`).join('');
    const milestoneDetails = el('details', 'hx-milestone-details');
    milestoneDetails.innerHTML = `<summary>Milestone rewards <span>${HERESY_MILESTONES.filter((m) => rank >= m.rank).length} / ${HERESY_MILESTONES.length} reached</span></summary><div class="hx-miles">${milestoneRows}</div>`;
    milestoneDetails.addEventListener('toggle', () => {
      // Default paired positions are vertically centered against their content.
      // Keep manually dragged coordinates fixed when the disclosure changes size.
      const positions = G.settings.panelPositions || {};
      if (positions.heresies || positions.marks) return;
      requestAnimationFrame(() => {
        if (UI.isOpen('heresies') && UI.isOpen('marks')) UI.layoutPanels();
      });
    });
    scrollArea.appendChild(milestoneDetails);
    body.appendChild(scrollArea);
    const foot = el('div', 'hx-foot');
    if (rank) {
      const off = el('button', 'btn small hx-clear', 'Renounce all');
      off.onclick = () => { for (const id of heresiesOf(c)) setHeresy(id, false); sfx('ui'); if (G.game && G.game.autosave) G.game.autosave(); UI.refresh(); };
      foot.appendChild(off);
    }
    const throneReady = rank >= HERESY_MAX_RANK && campaignVictoryRecorded() && endgameUnlocked(c);
    const throne = el('button', `btn small hx-throne${throneReady ? '' : ' disabled'}`, throneReady ? 'Enter the Throne of Damnation' : `Throne of Damnation · Rank ${HERESY_MAX_RANK} + Endgame`);
    throne.disabled = !throneReady;
    throne.title = throneReady ? 'Begin the final Heresy challenge.' : `Requires Heresy rank ${HERESY_MAX_RANK} and unlocked endgame progression.`;
    throne.onclick = () => { if (throneReady) G.game?.enterHeresyThrone?.(); };
    foot.appendChild(throne);
    body.appendChild(foot);
  },
};
