export const FRAME_BUDGET_MS = 1000 / 60;

const TIMING_KEYS = [
  'renderSetupMs', 'floorDrawMs', 'groundDrawMs', 'renderSortMs', 'depthDrawMs',
  'effectDrawMs', 'ambientTopDrawMs', 'particleDrawMs', 'topHazardDrawMs',
  'topEffectDrawMs', 'lightingMs', 'screenOverlayMs', 'skyFrontMs', 'seeThroughMs',
  'screenFeedbackMs', 'hudLabelsMs', 'combatTextMs', 'cinematicOverlayMs', 'automapMs',
  'worldMs', 'aiMs', 'pathMs', 'collisionMs', 'hazardMs', 'lootMs', 'vfxMs', 'uiMs',
  'enemyHistoryMs', 'minimapMs', 'eventsMs', 'environmentMs',
];

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
