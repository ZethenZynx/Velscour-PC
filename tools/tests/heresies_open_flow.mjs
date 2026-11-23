// Non-browser lifecycle regression test for opening/closing the paired Altar and Marks panels.
// Run: node tools/tests/heresies_open_flow.mjs
import assert from 'node:assert/strict';

const storage = new Map([['velscour_endgame_v1', JSON.stringify({ marksResetVersion: 2, unlocked: 1, marks: { pts: 0, xp: 0, spentValue: 0, spent: {} } })]]);
globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) };

const { G } = await import('../../src/state.js');
const Endgame = await import('../../src/game/endgame.js');
const { UI } = await import('../../src/ui/ui.js');
const { Heresies } = await import('../../src/ui/heresies.js');
const { Marks } = await import('../../src/ui/marks.js');
const { UILayoutCustomizer } = await import('../../src/ui/layoutcustomizer.js');
Endgame.resetEndgameCache();
G.settings.panelPositions = { vendor: { x: 0.2, y: 0.1 } };

const original = { closeAll: UI.closeAll, closePanel: UI.closePanel, openPanel: UI.openPanel, layoutPanels: UI.layoutPanels };
const opened = [];
let layoutPasses = 0;
UI.closePanel = (name) => {
  const panel = UI.panels.get(name);
  if (!panel) return;
  UI.panels.delete(name);
  panel.opts.onClose?.();
  UI.layoutPanels();
};
UI.closeAll = () => { for (const name of [...UI.panels.keys()]) UI.closePanel(name); };
UI.layoutPanels = () => { layoutPasses++; assert.ok(layoutPasses < 200, 'panel layout does not recurse or run away'); };
UI.openPanel = (name, title, _render, opts = {}) => {
  const panel = {
    root: { isConnected: false, style: { setProperty() {} } },
    head: { addEventListener() {} }, opts,
  };
  UI.panels.set(name, panel);
  opened.push(name);
  UI.layoutPanels();
  return panel;
};

try {
  const originalPanelsEl = UI.panelsEl;
  let classRemovals = 0;
  UI.panelsEl = { classList: { contains: (name) => name === 'heresy-marks-pair' } };
  UILayoutCustomizer.applyElement('panel-marks', { classList: { remove() { classRemovals++; } } });
  assert.equal(classRemovals, 0, 'the layout observer guard does not mutate the observed class');
  UI.panelsEl = originalPanelsEl;

  for (let cycle = 0; cycle < 10; cycle++) {
    assert.equal(Heresies.open(), true);
    assert.deepEqual([...UI.panels.keys()], ['heresies', 'marks'], 'opening the Altar creates one panel of each type');
    assert.deepEqual(opened.slice(-2), ['heresies', 'marks'], 'Altar opens before Infernal Marks');
    const count = opened.length;
    assert.equal(Heresies.open(), true, 'repeated activation while open is idempotent');
    assert.equal(opened.length, count, 'repeated activation does not reopen or relayout panels');
    UI.closeAll();
    assert.equal(UI.panels.size, 0, 'closing the pair closes both windows');
    assert.equal(Heresies.active, false);
    assert.equal(Marks.activePair, false);
  }
  assert.equal(opened.length, 20, 'ten open cycles create exactly twenty panels');
  G.settings.panelPositions = { vendor: { x: 0.2, y: 0.1 }, heresies: { x: 0.8, y: 0.4 }, marks: { x: 0.1, y: 0.3 } };
  UI.resetPairedPanelPositions();
  assert.deepEqual(G.settings.panelPositions, { vendor: { x: 0.2, y: 0.1 } }, 'resetting paired positions clears both defaults but preserves other panel preferences');
  UI.openPanel('vendor', 'Vendor', () => {}, {});
  assert.deepEqual([...UI.panels.keys()], ['vendor'], 'another interface still opens after the pair closes');
  UI.closeAll();
  assert.ok(layoutPasses < 100, 'repeated cycles use bounded layout work');
  console.log(`Altar/Marks open-close lifecycle passed: ${opened.length} panel opens, ${layoutPasses} bounded layout passes.`);
} finally {
  UI.closeAll = original.closeAll;
  UI.closePanel = original.closePanel;
  UI.openPanel = original.openPanel;
  UI.layoutPanels = original.layoutPanels;
  UI.panels.clear();
  Heresies.active = false;
  Marks.active = false;
  Marks.activePair = false;
}
