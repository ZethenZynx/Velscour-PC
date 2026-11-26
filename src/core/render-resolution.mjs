/** Static render scale policy. Adaptive Performance controls cosmetic quality only. */
export function renderResolutionScale(settings = {}) {
  return settings.graphicsPreset === 'extreme' ? 0.7 : 1;
}
