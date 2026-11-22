import { G, saveSettings } from '../state.js';
import { el, escapeHtml } from '../core/util.js';
import { UI } from './ui.js';
import {
  activeLayoutMap, characterLayoutId, cloneLayoutValue, createDefaultLayoutState, snapUILayoutPosition,
  exportLayoutProfile, importLayoutProfile, normalizeLayoutEntry, normalizeLayoutState,
} from './ui-layout.mjs';

const DEFINITIONS = [
  ['character-portrait', 'Character portrait', '.character-portrait-hud', .02, .04],
  ['health', 'Health orb', '#life-cover', .25, .85], ['health-value', 'Health value', '#life-text', .25, .86],
  ['mana', 'Mana orb', '#mana-cover', .72, .85], ['mana-value', 'Mana value', '#mana-text', .72, .86],
  ['class-resource', 'Class resource', '#gauge-box', .5, .75],
  ['ability-hotbar', 'Ability and consumable slots', '#hud-slots', .5, .84], ['special-actions', 'Special ability buttons', '#special-actions', .5, .68],
  ['experience', 'Experience bar', '#xp-track', .5, .95], ['experience-value', 'Experience value', '#xp-text', .5, .95],
  ['buff-icons', 'Buff and debuff icons', '#buff-row', .02, .53], ['statistics', 'Character stats and damage meter', '#hero-stats', .02, .19],
  ['current-enemy', 'Current / previous enemy', '#target-box', .02, .36], ['minimap', 'Minimap and markers', '#minimap-row', .84, .03],
  ['boss-health', 'Boss health bar', '#boss-bar', .5, .03], ['quest-tracker', 'Objective and event tracker', '#sand-objective', .77, .28],
  ['rift-tracker', 'Rift tracker', '#rift-bar', .76, .2], ['area-affixes', 'Area affixes', '#area-affixes', .77, .37],
  ['notifications', 'Notifications and event announcements', '#center-msg', .5, .42], ['adventurers-log', "Adventurer's Log", '#game-chat', .02, .58],
  ['game-log', 'Combat and loot messages', '#log', .02, .69], ['hud-buttons', 'HUD menu buttons', '#hud-buttons', .96, .62],
  ['greed-control', 'Greed and hoard display', '#greed', .84, .48], ['sealed-loot', 'Sealed loot indicator', '#sealed-btn', .9, .58],
  ['damage-numbers', 'Floating damage numbers', null, .5, .5, 'canvas'],
  ['panel-vendor', 'Vendor window', '[data-panel="vendor"]', .18, .12], ['panel-character', 'Character & Stats window', '[data-panel="character"]', .22, .16],
  ['panel-inventory', 'Backpack window', '[data-panel="inventory"]', .58, .14], ['panel-quest', 'Quest Log window', '[data-panel="quest"]', .06, .16],
  ['panel-tree', 'Skill Tree window', '[data-panel="tree"]', .18, .12], ['panel-book', 'Skill Book window', '[data-panel="book"]', .2, .15],
  ['panel-talents', 'Passive Talents window', '[data-panel="talents"]', .2, .12], ['panel-macros', 'Macros window', '[data-panel="macros"]', .2, .15],
  ['panel-stash', 'Storage Chest window', '[data-panel="stash"]', .14, .12], ['panel-jewelbox', 'Jewel Box window', '[data-panel="jewelbox"]', .14, .12],
  ['panel-reliquary', 'Reliquary window', '[data-panel="reliquary"]', .14, .12], ['panel-heresies', 'Altar of Heresy window', '[data-panel="heresies"]', .18, .12],
  ['panel-marks', 'Infernal Marks window', '[data-panel="marks"]', .18, .12],
];
const DEFAULTS = new Map(DEFINITIONS.map(([id, label, selector, x, y, mode]) => [id, { id, label, selector, x, y, mode }]));
const clone = cloneLayoutValue;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const STYLE_PROPS = ['translate', 'scale', 'opacity', 'width', 'height', 'transform-origin'];
const nativeStyles = new WeakMap();
const managedStyles = new WeakMap();

function nativeStyle(node) {
  let original = nativeStyles.get(node);
  if (!original) {
    original = Object.fromEntries(STYLE_PROPS.map((prop) => [prop, { value: node.style.getPropertyValue(prop), priority: node.style.getPropertyPriority(prop) }]));
    nativeStyles.set(node, original);
  }
  return original;
}
function restoreStyle(node, prop, entry) {
  if (entry?.value) node.style.setProperty(prop, entry.value, entry.priority || '');
  else node.style.removeProperty(prop);
}
function setManagedStyle(node, prop, value, enabled) {
  let managed = managedStyles.get(node);
  if (!managed) { managed = new Set(); managedStyles.set(node, managed); }
  if (enabled) { node.style.setProperty(prop, value); managed.add(prop); }
  else if (managed.has(prop)) { restoreStyle(node, prop, nativeStyle(node)[prop]); managed.delete(prop); }
}

function layoutState() {
  if (!G.settings.uiLayouts || typeof G.settings.uiLayouts !== 'object') G.settings.uiLayouts = createDefaultLayoutState();
  else G.settings.uiLayouts = normalizeLayoutState(G.settings.uiLayouts);
  return G.settings.uiLayouts;
}

function stableProfileKey(name, source = layoutState()) {
  const base = String(name || 'Layout').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'layout';
  let key = base, n = 2; while (source.profiles[key]) key = `${base}-${n++}`;
  return key;
}

function fileName(name) { return String(name || 'velscour-ui-layout').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'velscour-ui-layout'; }

export const UILayoutCustomizer = {
  dialog: null, stage: null, toolbox: null, working: null, original: null, selected: 'character-portrait', visibilityObserver: null,
  undoStack: [], redoStack: [], overlayNodes: new Map(), guides: null, pointer: null, toolboxDrag: null, pauseScreen: null,
  get state() { return this.working || layoutState(); },
  get map() { return activeLayoutMap(this.state, characterLayoutId(G.char)); },

  registerElement({ id, label, selector = null, x = .5, y = .5, mode = 'dom' } = {}) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(String(id || ''))) throw new TypeError('UI layout elements need a short, stable identifier.');
    const descriptor = { id: String(id), label: String(label || id), selector, x: clamp(Number(x) || 0, 0, 1), y: clamp(Number(y) || 0, 0, 1), mode };
    DEFAULTS.set(descriptor.id, descriptor);
    const index = DEFINITIONS.findIndex((entry) => entry[0] === descriptor.id);
    const tuple = [descriptor.id, descriptor.label, descriptor.selector, descriptor.x, descriptor.y, descriptor.mode];
    if (index < 0) DEFINITIONS.push(tuple); else DEFINITIONS[index] = tuple;
    const node = selector ? document.querySelector(selector) : null;
    if (node && this.visibilityObserver) this.visibilityObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
    if (this.dialog) { this.renderAll(); this.renderSelection(); }
    return descriptor.id;
  },
  hasElement(id) { return DEFAULTS.has(id); },

  entry(id) { const map = this.map; return map[id] ||= normalizeLayoutEntry(); },
  effective(id) { return this.map[id] || normalizeLayoutEntry(); },
  node(id) { const def = DEFAULTS.get(id); return def?.selector ? document.querySelector(def.selector) : null; },
  recordPosition(id, node = this.node(id), includeSize = false) {
    if (!node || this.working) return;
    const rect = node.getBoundingClientRect(); if (!rect || !rect.width || !rect.height) return;
    const entry = this.entry(id); entry.x = clamp(rect.left / innerWidth, 0, 1); entry.y = clamp(rect.top / innerHeight, 0, 1);
    if (includeSize) { const scale = entry.scale / 100; entry.width = rect.width / scale; entry.height = rect.height / scale; }
    saveSettings(); this.applyElement(id, node);
  },
  resetElementPosition(id) {
    const entry = this.map[id]; if (entry) { entry.x = null; entry.y = null; if (!this.working) saveSettings(); }
    this.applyElement(id);
    if (this.dialog) { this.renderAll(); this.renderSelection(); }
  },
  resetElementSize(id) {
    const entry = this.map[id]; if (entry) { entry.width = null; entry.height = null; if (!this.working) saveSettings(); }
    this.applyElement(id);
    if (this.dialog) { this.renderAll(); this.renderSelection(); }
  },
  baseRect(node) {
    if (!node) return null;
    const style = node.style, saved = Object.fromEntries(STYLE_PROPS.map((prop) => [prop, { value: style.getPropertyValue(prop), priority: style.getPropertyPriority(prop) }]));
    const original = nativeStyle(node);
    for (const prop of managedStyles.get(node) || []) restoreStyle(node, prop, original[prop]);
    const rect = node.getBoundingClientRect();
    for (const prop of STYLE_PROPS) restoreStyle(node, prop, saved[prop]);
    return rect;
  },
  applyElement(id, node = this.node(id)) {
    const def = DEFAULTS.get(id), entry = this.map[id];
    if (def.mode === 'canvas') {
      G.settings.uiFloatingText = entry ? { scale: entry.scale, opacity: entry.opacity, visible: entry.visible } : null;
      return;
    }
    if (!node) return;
    this.visibilityObserver?.observe(node, { attributes: true, attributeFilter: ['class'] });
    nativeStyle(node);
    node.classList.toggle('ui-layout-hidden', !!entry && !entry.visible);
    if (!entry) { for (const prop of managedStyles.get(node) || []) setManagedStyle(node, prop, '', false); return; }
    const rect = this.baseRect(node); if (!rect || !rect.width || !rect.height) return;
    const k = entry.scale / 100;
    const w = Math.min(entry.width || rect.width, innerWidth / k), h = Math.min(entry.height || rect.height, innerHeight / k);
    const targetX = clamp(entry.x == null ? rect.left : entry.x * innerWidth, 0, Math.max(0, innerWidth - w * k));
    const targetY = clamp(entry.y == null ? rect.top : entry.y * innerHeight, 0, Math.max(0, innerHeight - h * k));
    const ox = w * (1 - k) / 2, oy = h * (1 - k) / 2;
    setManagedStyle(node, 'translate', `${targetX - rect.left - ox}px ${targetY - rect.top - oy}px`, entry.x != null || entry.y != null);
    setManagedStyle(node, 'scale', String(k), entry.scale !== 100);
    setManagedStyle(node, 'opacity', String(entry.opacity / 100), entry.opacity !== 100);
    setManagedStyle(node, 'transform-origin', 'center center', entry.scale !== 100);
    setManagedStyle(node, 'width', `${w}px`, !!entry.width);
    setManagedStyle(node, 'height', `${h}px`, !!entry.height);
  },
  applyAll() { for (const [id] of DEFINITIONS) this.applyElement(id); },

  open() {
    if (this.dialog) return;
    this.original = clone(layoutState()); this.working = clone(this.original); this.undoStack = []; this.redoStack = [];
    this.selected = 'character-portrait';
    this.pauseScreen = UI.screensEl?.querySelector('.pause-dialog')?.closest('.screen') || null;
    this.pauseScreen?.classList.add('ui-layout-pause-hidden');
    const d = UI.dialog({ title: '', html: '<div class="ui-layout-stage" aria-label="UI layout preview"></div><aside class="ui-layout-toolbox"></aside>', cls: 'ui-layout-dialog', closable: false, buttons: [
      { label: 'Save & Apply', cls: 'blue ui-layout-save', fn: () => this.save() },
      { label: 'Undo', fn: () => this.undo() }, { label: 'Redo', fn: () => this.redo() },
      { label: 'Reset Selected Element', fn: () => this.resetSelected() },
      { label: 'Reset All', cls: 'red', fn: () => this.confirmResetAll() },
      { label: 'Cancel', cls: 'ui-layout-cancel', fn: () => this.cancel() },
    ] });
    this.dialog = d; d.wrap.classList.add('ui-layout-screen');
    d.box.setAttribute('role', 'application'); d.box.setAttribute('aria-label', 'Customize UI');
    this.stage = d.box.querySelector('.ui-layout-stage'); this.toolbox = d.box.querySelector('.ui-layout-toolbox');
    this.guides = el('div', 'ui-layout-guides'); this.stage.appendChild(this.guides);
    this.bind(); this.renderAll(); this.applyAll(); this.renderSelection();
    const escape = (e) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopImmediatePropagation(); this.cancel(); };
    d.wrap.addEventListener('keydown', escape, true); d.box.tabIndex = -1; d.box.focus(); this.escapeHandler = escape;
    this.resizeHandler = () => { this.renderAll(); this.applyAll(); this.clampToolbox(); };
    window.addEventListener('resize', this.resizeHandler);
    this.toolboxPointerMove = (event) => this.moveToolbox(event);
    this.toolboxPointerEnd = (event) => this.endToolboxDrag(event);
    window.addEventListener('pointermove', this.toolboxPointerMove);
    window.addEventListener('pointerup', this.toolboxPointerEnd);
    window.addEventListener('pointercancel', this.toolboxPointerEnd);
    window.addEventListener('blur', this.toolboxPointerEnd);
    return d;
  },

  close(cleanup = true) {
    if (!this.dialog) return;
    if (cleanup) {
      window.removeEventListener('resize', this.resizeHandler);
      this.dialog.wrap.removeEventListener('keydown', this.escapeHandler, true);
      this.stage?.removeEventListener('pointerdown', this.stageDown);
      window.removeEventListener('pointermove', this.pointerMove);
      window.removeEventListener('pointerup', this.pointerUp);
      window.removeEventListener('pointercancel', this.pointerUp);
      window.removeEventListener('blur', this.pointerUp);
      window.removeEventListener('pointermove', this.toolboxPointerMove);
      window.removeEventListener('pointerup', this.toolboxPointerEnd);
      window.removeEventListener('pointercancel', this.toolboxPointerEnd);
      window.removeEventListener('blur', this.toolboxPointerEnd);
      this.applyAll();
    }
    this.dialog.close(); this.dialog = this.stage = this.toolbox = this.guides = null;
    this.pauseScreen?.classList.remove('ui-layout-pause-hidden');
    this.pauseScreen = null;
    this.working = this.original = null; this.pointer = this.toolboxDrag = null;
    for (const node of this.overlayNodes.values()) node.remove();
    this.overlayNodes.clear();
  },

  bind() {
    this.stageDown = (event) => {
      const item = event.target.closest('[data-layout-id]'); if (!item || !this.stage.contains(item)) return;
      event.preventDefault(); event.stopPropagation();
      const id = item.dataset.layoutId; this.selected = id; this.renderSelection();
      for (const [otherId, box] of this.overlayNodes) box.classList.toggle('selected', otherId === id);
      if (DEFAULTS.get(id)?.mode === 'canvas') return;
      if (this.effective(id).locked) { this.renderAll(); this.renderSelection(); return; }
      if (event.target.closest('.ui-layout-resize')) {
        const r = item.getBoundingClientRect(), entry = this.entry(id), scale = entry.scale / 100;
        this.pointer = { id, mode: 'resize', pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: r.width / scale, height: r.height / scale, before: clone(this.state), changed: false };
      } else {
        const r = item.getBoundingClientRect();
        this.pointer = { id, mode: 'move', pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: r.left, top: r.top, before: clone(this.state), changed: false };
      }
      item.setPointerCapture?.(event.pointerId);
    };
    this.pointerMove = (event) => {
      const p = this.pointer; if (!p || p.pointerId !== event.pointerId) return;
      if (event.buttons !== undefined && (event.buttons & 1) === 0) { this.finishPointer(event); return; }
      if (!p.changed && (event.clientX !== p.x || event.clientY !== p.y)) { this.pushUndo(p.before); p.changed = true; }
      const entry = this.entry(p.id), def = DEFAULTS.get(p.id), node = this.node(p.id), rect = node && this.baseRect(node);
      if (p.mode === 'move') {
        const width = this.overlayNodes.get(p.id)?.offsetWidth || (rect?.width || 180) * entry.scale / 100;
        const height = this.overlayNodes.get(p.id)?.offsetHeight || (rect?.height || 54) * entry.scale / 100;
        let x = p.left + event.clientX - p.x, y = p.top + event.clientY - p.y;
        ({ x, y } = this.snap(x, y, width, height, p.id));
        entry.x = clamp(x / innerWidth, 0, Math.max(0, innerWidth - Math.min(width, innerWidth)) / innerWidth);
        entry.y = clamp(y / innerHeight, 0, Math.max(0, innerHeight - Math.min(height, innerHeight)) / innerHeight);
      } else {
        entry.width = clamp(p.width + event.clientX - p.x, 80, innerWidth / (entry.scale / 100));
        entry.height = clamp(p.height + event.clientY - p.y, 28, innerHeight / (entry.scale / 100));
      }
      this.applyElement(p.id); this.updateOverlay(p.id, false); this.renderGuides();
    };
    this.pointerUp = (event) => this.finishPointer(event);
    this.stage.addEventListener('pointerdown', this.stageDown);
    window.addEventListener('pointermove', this.pointerMove); window.addEventListener('pointerup', this.pointerUp); window.addEventListener('pointercancel', this.pointerUp);
    window.addEventListener('blur', this.pointerUp);
  },

  finishPointer(event) {
    if (!this.pointer || (event?.pointerId != null && this.pointer.pointerId !== event.pointerId)) return;
    this.pointer = null;
    this.renderAll(); this.renderSelection();
  },

  startToolboxDrag(event) {
    if (event.button !== 0 || event.target.closest('button, input, select, a')) return;
    const r = this.toolbox.getBoundingClientRect();
    this.toolboxDrag = { pointerId: event.pointerId, x: event.clientX - r.left, y: event.clientY - r.top };
    this.toolbox.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  },
  moveToolbox(event) {
    const drag = this.toolboxDrag; if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.buttons !== undefined && (event.buttons & 1) === 0) { this.endToolboxDrag(event); return; }
    const width = this.toolbox.offsetWidth, height = this.toolbox.offsetHeight;
    const left = clamp(event.clientX - drag.x, 8, Math.max(8, innerWidth - width - 8));
    const top = clamp(event.clientY - drag.y, 8, Math.max(8, innerHeight - height - 8));
    Object.assign(this.toolbox.style, { left: `${left}px`, top: `${top}px`, right: 'auto', transform: 'none' });
  },
  clampToolbox() {
    if (!this.toolbox || this.toolbox.style.left === '') return;
    const width = this.toolbox.offsetWidth, height = this.toolbox.offsetHeight;
    const left = clamp(parseFloat(this.toolbox.style.left) || 0, 8, Math.max(8, innerWidth - width - 8));
    const top = clamp(parseFloat(this.toolbox.style.top) || 0, 8, Math.max(8, innerHeight - height - 8));
    Object.assign(this.toolbox.style, { left: `${left}px`, top: `${top}px` });
  },
  endToolboxDrag(event) {
    if (!this.toolboxDrag || (event?.pointerId != null && this.toolboxDrag.pointerId !== event.pointerId)) return;
    this.toolboxDrag = null;
  },

  snap(x, y, width, height, id) {
    const s = this.state, neighbors = [];
    for (const [otherId, node] of this.overlayNodes) if (otherId !== id) {
      const r = node.getBoundingClientRect(); neighbors.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    }
    const result = snapUILayoutPosition(x, y, width, height, { width: innerWidth, height: innerHeight }, s, neighbors);
    if (this.guides) this.guides.innerHTML = result.guides.map((g) => `<i class="${g.axis === 'horizontal' ? 'x' : 'y'}" style="${g.axis === 'horizontal' ? 'top' : 'left'}:${g.position}px"></i>`).join('');
    return result;
  },

  updateOverlay(id, refresh = false) {
    if (!this.stage) return null;
    const tuple = DEFINITIONS.find((entry) => entry[0] === id); if (!tuple) return null;
    const [, label, selector, dx, dy, mode] = tuple;
    const node = selector ? document.querySelector(selector) : null, rect = node && this.baseRect(node), entry = this.effective(id);
    const present = !!(rect && rect.width > 0 && rect.height > 0 && !node.classList.contains('hidden') && getComputedStyle(node).display !== 'none');
    let box = this.overlayNodes.get(id);
    if (!this.state.showHidden && !present) { box?.remove(); this.overlayNodes.delete(id); return null; }
    if (!box) {
      box = el('button', 'ui-layout-item'); box.type = 'button'; box.dataset.layoutId = id;
      this.stage.appendChild(box); this.overlayNodes.set(id, box);
    }
    box.className = `ui-layout-item${id === this.selected ? ' selected' : ''}${!present ? ' placeholder' : ''}${entry.locked ? ' locked' : ''}${mode === 'canvas' ? ' world-positioned' : ''}`;
    box.title = `${label}${entry.locked ? ' (locked)' : ''}`;
    const contentKey = `${label}|${mode}|${present}|${entry.locked}`;
    if (box.dataset.contentKey !== contentKey) {
      box.innerHTML = `<span>${escapeHtml(label)}${mode === 'canvas' ? ' (world-positioned)' : present ? '' : ' (placeholder)'}</span>${entry.locked ? '<b class="ui-layout-lock-mark">LOCK</b>' : ''}${mode === 'canvas' ? '' : '<i class="ui-layout-resize" aria-label="Resize"></i>'}`;
      box.dataset.contentKey = contentKey;
    }
    const banner = id === 'notifications', scale = entry.scale / 100;
    const width = Math.min(entry.width || (banner ? 360 : present ? rect.width : 156), innerWidth / scale);
    const height = Math.min(entry.height || (banner ? 58 : present ? rect.height : 38), innerHeight / scale);
    const defaultLeft = banner ? innerWidth / 2 - width / 2 : present ? rect.left : innerWidth * dx;
    const left = clamp(entry.x == null ? defaultLeft : entry.x * innerWidth, 0, Math.max(0, innerWidth - width * scale));
    const top = clamp(entry.y == null ? present ? rect.top : innerHeight * dy : entry.y * innerHeight, 0, Math.max(0, innerHeight - height * scale));
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(68, width * scale)}px`, height: `${Math.max(26, height * scale)}px`, opacity: String(entry.opacity / 100) });
    if (refresh && present) this.applyElement(id, node);
    return box;
  },

  renderAll(refresh = true) {
    if (!this.stage) return;
    const active = new Set();
    for (const [id] of DEFINITIONS) { this.updateOverlay(id, refresh); if (this.overlayNodes.has(id)) active.add(id); }
    for (const [id, box] of this.overlayNodes) if (!active.has(id)) { box.remove(); this.overlayNodes.delete(id); }
    this.renderGuides();
  },

  renderGuides() {
    if (!this.guides) return;
    const selected = this.overlayNodes.get(this.selected); if (!selected) return;
    const r = selected.getBoundingClientRect(), xs = [r.left, r.right, r.left + r.width / 2], ys = [r.top, r.bottom, r.top + r.height / 2];
    this.guides.innerHTML = `<i class="x" style="top:${ys[2]}px"></i><i class="y" style="left:${xs[2]}px"></i>`;
  },

  renderSelection() {
    if (!this.toolbox) return;
    const entry = this.effective(this.selected), selected = DEFAULTS.get(this.selected), profile = this.state.profiles[this.state.activeProfile];
    const options = Object.entries(this.state.profiles).map(([key, p]) => `<option value="${escapeHtml(key)}" ${key === this.state.activeProfile ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
    this.toolbox.innerHTML = `
      <header class="ui-layout-toolbox-title"><b>Customize UI</b><button type="button" data-layout-close aria-label="Close">×</button></header>
      <label>Layout profile<select data-profile>${options}</select></label>
      <div class="ui-layout-profile-actions"><button data-profile-action="create">New</button><button data-profile-action="rename">Rename</button><button data-profile-action="duplicate">Duplicate</button><button data-profile-action="delete" ${this.state.activeProfile === 'default' ? 'disabled' : ''}>Delete</button></div>
      <label class="ui-layout-check"><input type="checkbox" data-character ${this.state.characterSpecific ? 'checked' : ''}> Character-specific override</label>
      <label>Element<select data-element>${DEFINITIONS.map(([id, name]) => `<option value="${id}" ${id === this.selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>
      <div class="ui-layout-selected">${escapeHtml(selected?.label || this.selected)}</div>
      <label>Scale <output data-out="scale">${entry.scale}%</output><input type="range" data-field="scale" min="50" max="200" step="5" value="${entry.scale}"></label>
      <label>Opacity <output data-out="opacity">${entry.opacity}%</output><input type="range" data-field="opacity" min="10" max="100" step="5" value="${entry.opacity}"></label>
      ${selected?.mode === 'canvas' ? '<p class="ui-layout-world-note">World-positioned text follows its target. Its scale, opacity and visibility are customizable here.</p>' : `<div class="ui-layout-dimensions"><label>Width <input type="number" data-field="width" min="80" max="2400" value="${entry.width || ''}" placeholder="Auto"></label><label>Height <input type="number" data-field="height" min="28" max="1600" value="${entry.height || ''}" placeholder="Auto"></label></div>`}
      <label class="ui-layout-check"><input type="checkbox" data-field="visible" ${entry.visible ? 'checked' : ''}> Show element</label>
      <label class="ui-layout-check"><input type="checkbox" data-field="locked" ${entry.locked ? 'checked' : ''}> Lock position</label>
      <hr><label class="ui-layout-check"><input type="checkbox" data-setting="snapGrid" ${this.state.snapGrid ? 'checked' : ''}> Snap to grid</label>
      <label>Grid size <input type="range" data-setting="grid" min="4" max="64" step="4" value="${this.state.grid}"></label>
      <label class="ui-layout-check"><input type="checkbox" data-setting="snapEdges" ${this.state.snapEdges ? 'checked' : ''}> Snap to screen edges</label>
      <label class="ui-layout-check"><input type="checkbox" data-setting="snapNeighbors" ${this.state.snapNeighbors ? 'checked' : ''}> Snap to neighbors</label>
      <label class="ui-layout-check"><input type="checkbox" data-setting="showHidden" ${this.state.showHidden ? 'checked' : ''}> Show hidden placeholders</label>
      <div class="ui-layout-profile-actions"><button data-profile-action="export">Export</button><button data-profile-action="import">Import</button><button data-profile-action="default">Restore Default Profile</button></div>
      <input type="file" data-layout-file accept="application/json,.json" hidden>
      <small>Drag an outline to move it. Drag its corner to resize. Positions adapt to the current screen.</small>`;
    const titlebar = this.toolbox.querySelector('.ui-layout-toolbox-title');
    titlebar.onpointerdown = (event) => this.startToolboxDrag(event);
    this.toolbox.querySelector('[data-layout-close]').onclick = () => this.cancel();
    this.toolbox.querySelector('[data-profile]').onchange = (e) => { this.pushUndo(); this.state.activeProfile = e.target.value; this.selected = 'character-portrait'; this.renderAll(); this.applyAll(); this.renderSelection(); };
    this.toolbox.querySelector('[data-element]').onchange = (e) => { this.selected = e.target.value; this.renderAll(); this.renderSelection(); };
    this.toolbox.querySelector('[data-character]').onchange = (e) => { this.pushUndo(); this.state.characterSpecific = e.target.checked; this.renderAll(); this.applyAll(); this.renderSelection(); };
    this.toolbox.querySelectorAll('[data-field]').forEach((control) => control.addEventListener('input', () => {
      if (!control.dataset.undoStarted) { this.pushUndo(); control.dataset.undoStarted = '1'; }
      const field = control.dataset.field, value = control.type === 'checkbox' ? control.checked : control.type === 'number' && control.value === '' ? null : Number(control.value);
      this.entry(this.selected)[field] = value;
      const output = this.toolbox.querySelector(`[data-out="${field}"]`); if (output) output.textContent = `${value}%`;
      this.applyElement(this.selected); this.renderAll(false);
    }));
    this.toolbox.querySelectorAll('[data-field]').forEach((control) => control.addEventListener('change', () => { delete control.dataset.undoStarted; this.renderAll(); this.renderSelection(); }));
    this.toolbox.querySelectorAll('[data-setting]').forEach((control) => control.onchange = () => {
      const key = control.dataset.setting; this.state[key] = control.type === 'checkbox' ? control.checked : Number(control.value); this.renderAll(); this.renderSelection();
    });
    this.toolbox.querySelectorAll('[data-profile-action]').forEach((button) => button.onclick = () => this.profileAction(button.dataset.profileAction));
    this.toolbox.querySelector('[data-layout-file]').onchange = (e) => this.importFile(e.target.files?.[0]);
  },

  pushUndo(snapshot = this.state) { this.undoStack.push(clone(snapshot)); if (this.undoStack.length > 40) this.undoStack.shift(); this.redoStack.length = 0; },
  undo() { if (!this.undoStack.length) return; this.redoStack.push(clone(this.state)); this.working = this.undoStack.pop(); this.applyAll(); this.renderAll(); this.renderSelection(); },
  redo() { if (!this.redoStack.length) return; this.undoStack.push(clone(this.state)); this.working = this.redoStack.pop(); this.applyAll(); this.renderAll(); this.renderSelection(); },
  resetSelected() {
    const node = this.node(this.selected), map = this.map; this.pushUndo(); delete map[this.selected];
    if (node) node.classList.remove('ui-layout-hidden');
    this.applyAll(); this.renderAll(); this.renderSelection();
  },
  confirmResetAll() {
    UI.confirm('Reset interface layout?', 'Reset every element in this profile to its defaults? This will discard its customized positions, sizes, scale, opacity, visibility and locks.', () => {
      this.pushUndo(); const p = this.state.profiles[this.state.activeProfile];
      if (this.state.characterSpecific) p.characterOverrides[characterLayoutId(G.char)] = {}; else p.layouts = {};
      this.applyAll(); this.renderAll(); this.renderSelection();
    }, 'Reset All');
  },
  save() {
    G.settings.uiLayouts = normalizeLayoutState(this.working); saveSettings(); this.close();
    UI.dialog({ title: 'Layout Saved', html: '<p>Your interface layout has been saved and applied.</p>', buttons: [{ label: 'Done' }] });
  },
  cancel() { this.working = clone(this.original || layoutState()); this.applyAll(); this.close(); },
  profileAction(action) {
    const state = this.state, active = state.activeProfile, profile = state.profiles[active];
    if (['create', 'rename', 'duplicate', 'delete'].includes(action)) this.pushUndo();
    if (action === 'create') { const name = prompt('Name the new UI layout profile:'); if (!name?.trim()) return; const key = stableProfileKey(name, state); state.profiles[key] = { name: name.trim().slice(0,32), layouts: {}, characterOverrides: {} }; state.activeProfile = key; }
    else if (action === 'rename') { const name = prompt('Rename this UI layout profile:', profile.name); if (!name?.trim()) return; profile.name = name.trim().slice(0,32); }
    else if (action === 'duplicate') { const key = stableProfileKey(`${profile.name} copy`, state); state.profiles[key] = clone(profile); state.profiles[key].name = `${profile.name} Copy`.slice(0,32); state.activeProfile = key; }
    else if (action === 'delete') { if (active === 'default' || !confirm(`Delete the “${profile.name}” layout profile?`)) return; delete state.profiles[active]; state.activeProfile = 'default'; }
    else if (action === 'default') {
      UI.confirm('Restore default layout?', 'This will reset the Default profile and all of its customized interface elements.', () => {
        this.pushUndo(); state.activeProfile = 'default'; state.characterSpecific = false; state.profiles.default = { name: 'Default', layouts: {}, characterOverrides: {} };
        this.applyAll(); this.renderAll(); this.renderSelection();
      }, 'Restore Default');
      return;
    }
    else if (action === 'export') { const data = JSON.stringify(exportLayoutProfile(state, active), null, 2); const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${fileName(profile.name)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0); return; }
    else if (action === 'import') { this.toolbox.querySelector('[data-layout-file]').click(); return; }
    this.applyAll(); this.renderAll(); this.renderSelection();
  },
  async importFile(file) {
    if (!file) return;
    try {
      const profile = importLayoutProfile(await file.text());
      const key = stableProfileKey(profile.name, this.state); this.pushUndo(); this.state.profiles[key] = profile; this.state.activeProfile = key; this.applyAll(); this.renderAll(); this.renderSelection();
    } catch (error) { UI.dialog({ title: 'Could not import layout', html: `<p>${escapeHtml(error.message || 'The selected file could not be read.')}</p>`, buttons: [{ label: 'OK' }] }); }
  },
};

export function openCustomizeUI() { return UILayoutCustomizer.open(); }

let initialized = false;
export function applyUILayoutSettings() {
  G.uiLayoutCustomizer = UILayoutCustomizer;
  UILayoutCustomizer.applyAll();
  if (!initialized) {
    initialized = true;
    window.addEventListener('resize', () => UILayoutCustomizer.applyAll());
    UILayoutCustomizer.visibilityObserver = new MutationObserver((records) => {
      for (const record of records) {
        const id = DEFINITIONS.find(([, , selector]) => selector && record.target.matches(selector))?.[0];
        if (id) UILayoutCustomizer.applyElement(id, record.target);
      }
    });
    for (const [, , selector] of DEFINITIONS) {
      const node = selector ? document.querySelector(selector) : null;
      if (node) UILayoutCustomizer.visibilityObserver.observe(node, { attributes: true, attributeFilter: ['class'] });
    }
  }
}
