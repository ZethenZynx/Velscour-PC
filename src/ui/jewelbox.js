// The Jewel Box: 300-slot dedicated vault in town strictly for gems and runes (Sigil stones).
import { G } from '../state.js';
import { el, fmtInt } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { UI, draggable, droppable } from './ui.js';
import { itemCell, itemTooltip, rarityClass } from './itemui.js';
import { changed, renderInventory } from './inventory.js';
import { addToBag } from '../game/player.js';
import { itemName, GEM_TIERS } from '../data/items.js';
import { jewelBoxRows, nextJewelBoxRowCost, canBuyJewelBoxRow, buyJewelBoxRow, storageExpansionUnlocked, JEWEL_BOX_MAX_ROWS } from '../data/bag.js';
import { jewelBoxAccount, saveJewelBoxAccount, sameStackableJewelGem } from '../game/jewelboxstorage.mjs';

export const JEWEL_BOX_SIZE = 300;

/** Put a gem or sigil into the Jewel Box (identical gems stack). Returns false if not a gem or if full. */
export function addToJewelBox(c, item) {
  if (!item || item.type !== 'gem') return false;
  if (!c.jewelBox) c.jewelBox = Array(JEWEL_BOX_SIZE).fill(null);
  const same = c.jewelBox.find((b) => sameStackableJewelGem(b, item));
  if (same) {
    same.count = (same.count || 1) + (item.count || 1);
    return true;
  }
  const i = c.jewelBox.findIndex((b) => !b);
  if (i < 0) return false;
  c.jewelBox[i] = item;
  return true;
}

/** Sort the Jewel Box: by kind (Sigils -> Prisms -> Gems -> Tier -> Count) or by grade (Tier -> Kind). */
export function sortJewelBox(c, by = 'kind') {
  if (!c) return;
  if (!Array.isArray(c.jewelBox)) c.jewelBox = Array(JEWEL_BOX_SIZE).fill(null);
  const gemTypeOrder = (it) => {
    if (!it) return 99;
    if (it.gem === 'sig') return 1;
    if (it.gem === 'prism') return 2;
    return 3;
  };

  const items = (c.jewelBox || []).filter(Boolean).sort((a, b) => {
    if (by === 'grade') {
      const td = (b.tier || 0) - (a.tier || 0);
      if (td !== 0) return td;
      const kd = gemTypeOrder(a) - gemTypeOrder(b);
      if (kd !== 0) return kd;
      return (a.gem || '').localeCompare(b.gem || '') || (b.count || 1) - (a.count || 1);
    }
    // Default: by kind
    const kd = gemTypeOrder(a) - gemTypeOrder(b);
    if (kd !== 0) return kd;
    const kindCmp = (a.gem || '').localeCompare(b.gem || '');
    if (kindCmp !== 0) return kindCmp;
    return (b.tier || 0) - (a.tier || 0) || (b.count || 1) - (a.count || 1);
  });

  c.jewelBox = c.jewelBox.map((_, i) => items[i] || null);
}

export const JewelBox = {
  active: false,
  filter: 'all',
  query: '',
  selected: null,
  lastScrollTop: 0,

  open() {
    if (!jewelBoxAccount()) {
      UI.log('The shared Jewel Box is not ready. Your stored items remain protected; reload to retry its migration.', '#ffb85c');
      return false;
    }
    UI.closeAll();
    this.active = true;
    this.lastScrollTop = 0;
    sfx('ui');
    UI.openPanel('jewelbox', 'Jewel Box', (b) => this.render(b), {
      onClose: () => {
        this.active = false;
        UI.closePanel('inventory');
      },
      cls: 'stash-panel jewelbox-panel',
    });
    UI.openPanel('inventory', 'Your Inventory', renderInventory);
    return true;
  },

  /** Store an item from gemBag, bag, or stash into Jewel Box. */
  store(idx, where = 'gemBag') {
    const c = G.char;
    let container = c.gemBag;
    if (where === 'bag') container = c.bag;
    else if (where === 'stash') container = c.stash;
    else if (where === 'gemBag') container = c.gemBag;

    if (!container) return false;
    const it = container[idx];
    if (!it) return false;

    if (it.type !== 'gem') {
      UI.log('Only gems and runes can be stored in the Jewel Box.', '#ff8080');
      sfx('error');
      return false;
    }

    const account = jewelBoxAccount();
    if (!account) return false;
    const previous = JSON.stringify(account.jewelBox);
    if (!addToJewelBox(account, it)) {
      UI.log('The Jewel Box is full.', '#ff8080');
      sfx('error');
      return false;
    }
    if (!saveJewelBoxAccount(account)) {
      account.jewelBox = JSON.parse(previous);
      UI.log('The shared Jewel Box could not be saved. The gem remains in your inventory.', '#ff8080');
      sfx('error');
      return false;
    }

    container[idx] = null;
    sfx('pickup');
    UI.selected = null;
    changed();
    return true;
  },

  /** Take an item from Jewel Box -> player Gem Bag. */
  take(idx) {
    const c = G.char, account = jewelBoxAccount(), it = account?.jewelBox?.[idx];
    if (!it) return false;
    const oldBox = JSON.stringify(account.jewelBox), oldBag = JSON.stringify(c.gemBag), oldItems = JSON.stringify(c.bag);
    if (!addToBag(c, it)) {
      UI.log('Gem Bag full.', '#ff8080');
      sfx('error');
      return false;
    }
    account.jewelBox[idx] = null;
    if (!saveJewelBoxAccount(account)) {
      account.jewelBox = JSON.parse(oldBox); c.gemBag = JSON.parse(oldBag); c.bag = JSON.parse(oldItems);
      UI.log('The shared Jewel Box could not be saved. The gem was returned to storage.', '#ff8080'); sfx('error');
      return false;
    }
    if (this.selected === idx) this.selected = null;
    sfx('pickup');
    changed();
    return true;
  },
  /** Deposit unlocked gems from both inventory bags into the Jewel Box. */
  depositAll() {
    const c = G.char, account = jewelBoxAccount();
    if (!c || !account) return;
    const oldBox = JSON.stringify(account.jewelBox), oldBag = JSON.stringify(c.bag), oldGemBag = JSON.stringify(c.gemBag);
    let moved = 0, full = false;
    const moveGems = (arr) => {
      if (!Array.isArray(arr) || full) return;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!it || it.type !== 'gem' || it.locked) continue;
        if (!addToJewelBox(account, it)) { full = true; continue; }
        arr[i] = null;
        moved++;
      }
    };
    moveGems(c.bag);
    moveGems(c.gemBag);
    if (moved) {
      if (!saveJewelBoxAccount(account)) {
        account.jewelBox = JSON.parse(oldBox); c.bag = JSON.parse(oldBag); c.gemBag = JSON.parse(oldGemBag);
        UI.log('The shared Jewel Box could not be saved. Your inventory was restored.', '#ff8080'); sfx('error');
        return;
      }
      this.selected = null; UI.selected = null; sfx('pickup'); changed();
      UI.log(`Deposited ${moved} gem stack${moved === 1 ? '' : 's'} in the Jewel Box${full ? '; the box is full' : ''}.`, full ? '#ff8080' : '#80ff80');
    } else if (full) {
      UI.log('The Jewel Box is full.', '#ff8080'); sfx('error');
    } else {
      const hasLocked = [c.bag, c.gemBag].some((arr) => Array.isArray(arr) && arr.some((it) => it && it.type === 'gem' && it.locked));
      UI.log(hasLocked ? 'All gems in your inventory are locked.' : 'No gems in your inventory to deposit.', hasLocked ? '#ffd860' : undefined);
      sfx('ui');
    }
  },
  /** Withdraw every gem stack that fits into the Gem Bag. */
  withdrawAll() {
    const c = G.char, account = jewelBoxAccount();
    if (!c || !account || !Array.isArray(account.jewelBox)) return;
    const oldBox = JSON.stringify(account.jewelBox), oldBag = JSON.stringify(c.bag), oldGemBag = JSON.stringify(c.gemBag);
    let moved = 0, full = false;
    for (let i = 0; i < account.jewelBox.length; i++) {
      const it = account.jewelBox[i];
      if (!it || it.type !== 'gem') continue;
      if (!addToBag(c, it)) { full = true; continue; }
      account.jewelBox[i] = null;
      moved++;
    }
    if (moved) {
      if (!saveJewelBoxAccount(account)) {
        account.jewelBox = JSON.parse(oldBox); c.bag = JSON.parse(oldBag); c.gemBag = JSON.parse(oldGemBag);
        UI.log('The shared Jewel Box could not be saved. Your inventory was restored.', '#ff8080'); sfx('error');
        return;
      }
      this.selected = null; UI.selected = null; sfx('pickup'); changed();
      UI.log(`Withdrew ${moved} gem stack${moved === 1 ? '' : 's'} from the Jewel Box${full ? '; Gem Bag is full' : ''}.`, full ? '#ff8080' : '#80ff80');
    } else if (full) {
      UI.log('Gem Bag is full.', '#ff8080'); sfx('error');
    } else {
      UI.log('The Jewel Box is empty.'); sfx('ui');
    }
  },

  render(body) {
    const c = G.char;
    if (!c) return;
    const account = jewelBoxAccount();
    if (!account) { body.textContent = 'The shared Jewel Box is unavailable. Your stored items have not been changed.'; return; }
    const box = account.jewelBox;
    const self = this || JewelBox;

    const prevGridScroll = body.querySelector('.stash-grid')?.scrollTop ?? self.lastScrollTop ?? 0;
    const prevBodyScroll = body.scrollTop;
    body.innerHTML = '';

    const used = box.filter(Boolean).length;
    const capacity = { jewelBox: box };
    const purchase = { gold: c.gold, jewelBox: box };
    const rows = jewelBoxRows(capacity);
    const head = el('div', 'row storage-toolbar jewelbox-toolbar', `<strong>${fmtInt(used)} / ${fmtInt(box.length)}</strong><span class="dim">gems stored (${fmtInt(rows)} rows)</span>`);
    const depositAllBtn = el('button', 'btn small', 'Deposit All');
    depositAllBtn.title = 'Move all unlocked gems and runes from your inventory into the Jewel Box';
    depositAllBtn.onclick = () => { sfx('ui'); self.depositAll(); };
    head.appendChild(depositAllBtn);
    const withdrawAllBtn = el('button', 'btn small', 'Withdraw All');
    withdrawAllBtn.title = 'Move all gems and runes that fit from the Jewel Box into your Gem Bag';
    withdrawAllBtn.onclick = () => { sfx('ui'); self.withdrawAll(); };
    head.appendChild(withdrawAllBtn);

    for (const [by, label] of [['kind', 'Sort by kind'], ['grade', 'Sort by grade']]) {
      const b = el('button', 'btn small', label);
      b.onclick = () => {
        sortJewelBox(account, by);
        if (!saveJewelBoxAccount(account)) { UI.log('The shared Jewel Box could not be saved.', '#ff8080'); return; }
        self.selected = null;
        sfx('ui');
        UI.selected = null;
        changed();
      };
      head.appendChild(b);
    }
    if (rows < JEWEL_BOX_MAX_ROWS) {
      const cost = nextJewelBoxRowCost(purchase);
      const unlocked = storageExpansionUnlocked();
      const can = canBuyJewelBoxRow(purchase);
      const buyRowBtn = el('button', 'btn small' + (can ? '' : ' poor'), unlocked ? `+ Row (<span style="color:#ffd860" aria-hidden="true">◉</span> ${fmtInt(cost)} gold)` : '+ Row (Endgame only)');
      buyRowBtn.title = unlocked ? `Add 1 row (10 slots) to Jewel Box for ${fmtInt(cost)} gold` : 'Jewel Box expansions unlock after Velscour is defeated.';
      buyRowBtn.onclick = () => {
        sfx('ui');
        if (!storageExpansionUnlocked()) {
          UI.log('Jewel Box expansions unlock after Velscour is defeated.', '#ffb85c');
          return;
        }
        if (!canBuyJewelBoxRow(purchase)) {
          UI.log(`You need ${fmtInt(cost)} gold to expand the Jewel Box.`, '#ff8080');
          return;
        }
        UI.dialog({
          title: `Expand Jewel Box (${rows + 1} of ${JEWEL_BOX_MAX_ROWS})`,
          html: `<p>Add 10 gem slots (row ${rows + 1}) to your Jewel Box for <b style="color:#ffd860"><span aria-hidden="true">◉</span> ${fmtInt(cost)} gold</b>?</p>`,
          buttons: [
            { label: 'Cancel' },
            { label: `Buy for ${fmtInt(cost)} gold`, cls: 'red', fn: () => {
              const oldBox = JSON.stringify(account.jewelBox);
              if (buyJewelBoxRow(purchase, cost) && saveJewelBoxAccount(account)) {
                c.gold = purchase.gold;
                changed();
                this.render(body);
              } else {
                account.jewelBox = JSON.parse(oldBox);
                UI.log('The Jewel Box expansion could not be saved; no purchase was completed.', '#ff8080');
              }
            }},
          ],
        });
      };
      head.appendChild(buyRowBtn);
    }
    body.appendChild(head);

    const tools = el('div', 'storage-filters');
    const kind = el('select', 'storage-select', '<option value="all">All gems & runes</option><option value="sigil">Sigil Stones</option><option value="prism">Prisms</option><option value="standard">Standard Gems</option>');
    kind.value = self.filter || 'all';
    const search = el('input', 'storage-search');
    search.type = 'search';
    search.placeholder = 'Search stored gems & runes';
    search.value = self.query || '';
    tools.append(kind, search);
    body.appendChild(tools);

    const transfer = el('div', 'storage-dropzone jewelbox-dropzone', 'Drop a gem or rune here to store it · Right-click a stored gem to take it');
    droppable(
      transfer,
      (data) => {
        if (data.type === 'item') return self.store(data.idx, data.where);
        if (data.type === 'stash') return self.store(data.idx, 'stash');
        return false;
      },
      (data) => data.type === 'item' || data.type === 'stash'
    );
    body.appendChild(transfer);

    const grid = el('div', 'bag stash-grid jewelbox-grid');
    grid.addEventListener('scroll', () => { self.lastScrollTop = grid.scrollTop; }, { passive: true });

    box.forEach((it, i) => {
      const d = el('div', 'bslot ' + rarityClass(it));
      if (self.selected === i) d.classList.add('sel');
      if (it) d.appendChild(itemCell(it));
      d.dataset.kind = it?.gem === 'sig' ? 'sigil' : it?.gem === 'prism' ? 'prism' : it ? 'standard' : 'empty';
      d.dataset.name = it ? itemName(it).toLowerCase() : '';

      draggable(d, {
        key: 'jewelbox:' + i,
        data: () => (box[i] ? { type: 'jewelbox', idx: i } : null),
        icon: () => d.querySelector('img') && d.querySelector('img').src,
        onClick: () => {
          if (box[i]) {
            self.selected = i;
            self.render(body);
          }
        },
        onRight: () => self.take(i),
        onDouble: () => self.take(i),
      });

      droppable(
        d,
        (data) => {
          if (data.type === 'item') return self.store(data.idx, data.where);
          if (data.type === 'stash') return self.store(data.idx, 'stash');
          return false;
        },
        (data) => data.type === 'item' || data.type === 'stash'
      );

      if (it) UI.tip(d, () => itemTooltip(box[i], { hint: 'Right-click to take' }));
      grid.appendChild(d);
    });
    body.appendChild(grid);

    const selected = box[self.selected];
    let detail;
    if (selected) {
      detail = el('div', 'storage-detail', itemTooltip(selected));
      const take = el('button', 'btn small', 'Take to Gem Bag');
      take.onclick = () => self.take(self.selected);
      detail.appendChild(take);
      body.appendChild(detail);
    }

    const applyFilter = () => {
      const filterMode = self.filter || 'all';
      const queryStr = self.query || '';
      const filtered = filterMode !== 'all' || !queryStr;
      for (const cell of grid.children) {
        const match = cell.dataset.kind !== 'empty' && (filterMode === 'all' || cell.dataset.kind === filterMode) && cell.dataset.name.includes(queryStr);
        cell.hidden = filtered && !match;
      }
      grid.classList.toggle('filtered', filtered);
      if (detail && selected) {
        detail.hidden = filtered && (
          (filterMode !== 'all' && (
            (filterMode === 'sigil' && selected.gem !== 'sig') ||
            (filterMode === 'prism' && selected.gem !== 'prism') ||
            (filterMode === 'standard' && (selected.gem === 'sig' || selected.gem === 'prism'))
          )) ||
          !itemName(selected).toLowerCase().includes(queryStr)
        );
      }
    };

    kind.onchange = () => { self.filter = kind.value; applyFilter(); };
    search.oninput = () => { self.query = search.value.trim().toLowerCase(); applyFilter(); };
    applyFilter();

    if (prevGridScroll > 0) {
      grid.scrollTop = prevGridScroll;
      requestAnimationFrame(() => { if (grid && prevGridScroll > 0) grid.scrollTop = prevGridScroll; });
    }
    if (prevBodyScroll > 0) {
      body.scrollTop = prevBodyScroll;
      requestAnimationFrame(() => { if (body && prevBodyScroll > 0) body.scrollTop = prevBodyScroll; });
    }
  },
};

