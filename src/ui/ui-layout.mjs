// Pure layout/profile helpers shared by the UI editor and its non-browser tests.
export const UI_LAYOUT_VERSION = 1;
export const UI_LAYOUT_SCALE_MIN = 50;
export const UI_LAYOUT_SCALE_MAX = 200;

export function cloneLayoutValue(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeLayoutEntry(value = {}) {
  const number = (v, fallback, min, max) => v === null || v === undefined || v === '' ? fallback : Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
  const anchor = ['left', 'right', 'center'].includes(value.anchor) ? value.anchor : 'left';
  const attachment = value.attachment === 'detached' ? 'detached' : 'attached';
  return {
    x: number(value.x, null, 0, 1), y: number(value.y, null, 0, 1),
    width: number(value.width, null, 80, 2400), height: number(value.height, null, 28, 1600),
    scale: number(value.scale, 100, UI_LAYOUT_SCALE_MIN, UI_LAYOUT_SCALE_MAX),
    opacity: number(value.opacity, 100, 10, 100),
    visible: value.visible !== false, locked: !!value.locked,
    anchor, attachment,
  };
}

export function normalizeProfile(profile = {}, key = 'default') {
  const layouts = {};
  for (const [id, entry] of Object.entries(profile.layouts || {})) layouts[id] = normalizeLayoutEntry(entry);
  const characterOverrides = {};
  for (const [characterId, entries] of Object.entries(profile.characterOverrides || {})) {
    characterOverrides[characterId] = {};
    for (const [id, entry] of Object.entries(entries || {})) characterOverrides[characterId][id] = normalizeLayoutEntry(entry);
  }
  return { name: String(profile.name || (key === 'default' ? 'Default' : key)).slice(0, 32), layouts, characterOverrides };
}

export function createDefaultLayoutState() {
  return { version: UI_LAYOUT_VERSION, activeProfile: 'default', characterSpecific: false, grid: 16, snapGrid: true, snapEdges: true, snapNeighbors: true, showHidden: true, profiles: { default: normalizeProfile({}, 'default') } };
}

export function normalizeLayoutState(value = {}) {
  const state = createDefaultLayoutState();
  for (const [key, profile] of Object.entries(value.profiles || {})) state.profiles[key] = normalizeProfile(profile, key);
  if (!state.profiles.default) state.profiles.default = normalizeProfile({}, 'default');
  state.activeProfile = state.profiles[value.activeProfile] ? value.activeProfile : 'default';
  state.characterSpecific = !!value.characterSpecific;
  state.grid = Math.round(Math.max(4, Math.min(128, Number(value.grid) || 16)));
  for (const key of ['snapGrid', 'snapEdges', 'snapNeighbors', 'showHidden']) if (key in value) state[key] = !!value[key];
  return state;
}

/** Preserve the former independently positioned area-affix block when it joins environment information. */
export function migrateEnvironmentInfoLayout(state) {
  let changed = false;
  for (const profile of Object.values(state?.profiles || {})) {
    const migrate = (layouts) => {
      if (!layouts || layouts['environment-info'] || !layouts['area-affixes']) return;
      layouts['environment-info'] = cloneLayoutValue(layouts['area-affixes']);
      changed = true;
    };
    migrate(profile.layouts);
    for (const layouts of Object.values(profile.characterOverrides || {})) migrate(layouts);
  }
  return changed;
}

/** Keep legacy HUD preferences while the formerly independent hotbar and orb pieces join their visual groups. */
export function migrateGroupedHudLayout(state) {
  let changed = false;
  for (const profile of Object.values(state?.profiles || {})) {
    const migrate = (layouts) => {
      if (!layouts) return;
      if (!layouts['main-action-bar'] && (layouts['ability-hotbar'] || layouts.experience || layouts['experience-value'])) {
        layouts['main-action-bar'] = cloneLayoutValue(layouts['ability-hotbar'] || layouts.experience || layouts['experience-value']); changed = true;
      }
      for (const [newId, oldIds] of [['health-orb', ['health', 'health-value']], ['mana-orb', ['mana', 'mana-value']]]) {
        if (layouts[newId]) continue;
        const old = oldIds.map((id) => layouts[id]).find(Boolean);
        if (old) { layouts[newId] = { ...cloneLayoutValue(old), attachment: 'detached' }; changed = true; }
      }
      for (const id of ['buff-icons', 'debuff-icons']) {
        if (layouts[id] && !['left', 'right', 'center'].includes(layouts[id].anchor)) { layouts[id].anchor = 'left'; changed = true; }
      }
    };
    migrate(profile.layouts);
    for (const layouts of Object.values(profile.characterOverrides || {})) migrate(layouts);
  }
  return changed;
}

export function characterLayoutId(character) {
  if (!character) return '';
  return String(character.id || character.uuid || character.created || `${character.name || ''}:${character.class || character.classId || ''}`);
}

export function activeLayoutMap(state, characterId = '') {
  const profile = state.profiles[state.activeProfile] || state.profiles.default;
  return state.characterSpecific && characterId
    ? (profile.characterOverrides[characterId] ||= {})
    : profile.layouts;
}

/** Apply grid, edge, and sibling alignment snapping and keep a panel reachable on-screen. */
export function snapUILayoutPosition(x, y, width, height, viewport, settings = {}, neighbors = []) {
  let left = Number(x) || 0, top = Number(y) || 0;
  const w = Math.max(0, Number(width) || 0), h = Math.max(0, Number(height) || 0);
  const vw = Math.max(1, Number(viewport?.width) || 1), vh = Math.max(1, Number(viewport?.height) || 1);
  const guides = [];
  if (settings.snapGrid) {
    const grid = Math.max(4, Math.min(128, Number(settings.grid) || 16));
    left = Math.round(left / grid) * grid; top = Math.round(top / grid) * grid;
  }
  if (settings.snapEdges) {
    const right = vw - w, bottom = vh - h, threshold = 10;
    if (Math.abs(left) < threshold) left = 0;
    else if (Math.abs(left - right) < threshold) left = right;
    if (Math.abs(top) < threshold) top = 0;
    else if (Math.abs(top - bottom) < threshold) top = bottom;
  }
  if (settings.snapNeighbors) for (const r of neighbors) {
    const xCandidates = [r.left, r.right, r.left - w, r.right - w, r.left + r.width / 2 - w / 2];
    const yCandidates = [r.top, r.bottom, r.top - h, r.bottom - h, r.top + r.height / 2 - h / 2];
    for (const candidate of xCandidates) if (Math.abs(left - candidate) <= 8) { left = candidate; guides.push({ axis: 'vertical', position: r.left + r.width / 2 }); break; }
    for (const candidate of yCandidates) if (Math.abs(top - candidate) <= 8) { top = candidate; guides.push({ axis: 'horizontal', position: r.top + r.height / 2 }); break; }
  }
  return { x: Math.max(0, Math.min(left, Math.max(0, vw - w))), y: Math.max(0, Math.min(top, Math.max(0, vh - h))), guides };
}

export function exportLayoutProfile(state, profileKey = state.activeProfile) {
  const profile = state.profiles[profileKey];
  if (!profile) throw new Error('The selected layout profile does not exist.');
  return { format: 'velscour-ui-layout', version: UI_LAYOUT_VERSION, profile: cloneLayoutValue(profile) };
}

export function importLayoutProfile(data, key = 'imported') {
  const value = typeof data === 'string' ? JSON.parse(data) : data;
  if (value?.format !== 'velscour-ui-layout' || value?.version !== UI_LAYOUT_VERSION || !value.profile || typeof value.profile !== 'object') throw new Error('This is not a supported Velscour UI layout file.');
  return normalizeProfile(value.profile, key);
}
