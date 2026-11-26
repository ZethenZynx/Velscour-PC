export const FRAME_BUDGET_MS = 1000 / 60;

const TIMING_KEYS = [
  'renderSetupMs', 'floorDrawMs', 'groundDrawMs', 'renderSortMs', 'depthDrawMs',
  'effectDrawMs', 'ambientTopDrawMs', 'particleDrawMs', 'topHazardDrawMs',
  'topEffectDrawMs', 'lightingMs', 'screenOverlayMs', 'skyFrontMs', 'seeThroughMs',
  'screenFeedbackMs', 'hudLabelsMs', 'combatTextMs', 'cinematicOverlayMs', 'automapMs',
  'worldMs', 'aiMs', 'playerUpdateMs', 'creatureUpdateMs', 'townLifeUpdateMs', 'keepDirectorUpdateMs',
  'keepCompanionUpdateMs', 'keepFolkUpdateMs', 'keepLightingUpdateMs', 'townAgentUpdateMs', 'otherNpcUpdateMs',
  'doorUpdateMs', 'aiSlowestCallbackMs', 'pathMs', 'collisionMs', 'hazardMs', 'lootMs', 'vfxMs', 'uiMs',
  'enemyHistoryMs', 'minimapMs', 'eventsMs', 'environmentMs', 'saveMs',
];

const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;

/** Export-time aggregation only: split frame metrics by environment and render scale. */
export function summarizeFrameGroups(frames) {
  const groups = new Map();
  for (const frame of frames) {
    const scale = Number.isFinite(frame.resolutionScale) ? frame.resolutionScale : 1;
    const key = JSON.stringify([frame.worldKind || '', frame.environment || '', scale]);
    let group = groups.get(key);
    if (!group) {
      group = { worldKind: frame.worldKind || '', environment: frame.environment || '', resolutionScale: scale, frameCount: 0,
      frameMs: [], gapMs: [], updateMs: [], renderMs: [], framesOverBudget: 0 };
      groups.set(key, group);
    }
    group.frameCount++;
    for (const metric of ['frameMs', 'gapMs', 'updateMs', 'renderMs']) group[metric].push(Number(frame[metric]) || 0);
    if ((Number(frame.frameMs) || 0) >= FRAME_BUDGET_MS || (Number(frame.gapMs) || 0) >= FRAME_BUDGET_MS) group.framesOverBudget++;
  }
  return [...groups.values()].map((group) => {
    const result = { worldKind: group.worldKind, environment: group.environment, resolutionScale: group.resolutionScale, frameCount: group.frameCount,
      framesOver60HzBudget: group.framesOverBudget, percentOver60HzBudget: Number((group.framesOverBudget * 100 / group.frameCount).toFixed(2)) };
    for (const metric of ['frameMs', 'gapMs', 'updateMs', 'renderMs']) {
      const values = group[metric].sort((a, b) => a - b);
      result[metric] = { median: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99), worst: values.at(-1) || 0 };
    }
    return result;
  });
}

export function summarizeFrameSpikes(frames, budgetMs = FRAME_BUDGET_MS, limit = 100) {
  return frames.filter((frame) => frame.frameMs >= budgetMs || frame.gapMs >= budgetMs)
    .map((frame) => {
      const workMs = frame.updateMs + frame.renderMs;
      return {
        timestampUtc: frame.timestampUtc,
        elapsedSeconds: frame.elapsedSeconds,
        gapMs: frame.gapMs,
        frameMs: frame.frameMs,
        updateMs: frame.updateMs,
        renderMs: frame.renderMs,
        workVsGap: frame.gapMs > 0 ? Number((workMs / frame.gapMs).toFixed(3)) : null,
        kind: frame.frameMs >= budgetMs ? 'game-processing' : 'callback-gap',
        pageVisible: frame.pageVisible,
        pageFocused: frame.pageFocused,
        aiSlowestCallback: frame.aiSlowestCallback || '',
        expensiveSubsystems: TIMING_KEYS
          .map((key) => [key, frame[key] || 0])
          .filter(([, ms]) => ms >= 0.5)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([subsystem, ms]) => ({ subsystem: subsystem.slice(0, -2), ms })),
      };
    })
    .sort((a, b) => Math.max(b.gapMs, b.frameMs) - Math.max(a.gapMs, a.frameMs))
    .slice(0, limit);
}
