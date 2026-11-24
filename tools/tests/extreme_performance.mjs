import assert from 'node:assert/strict';
import { allowParticleType, observeAdaptivePerformance, particleBudget, performanceTier, resetAdaptivePerformance } from '../../src/core/performancequality.mjs';
import { G } from '../../src/state.js';
import { addLight, applyPerformanceQuality, clearVfx, lights, particles, spawn } from '../../src/gfx/vfx.js';

assert.equal(particleBudget(false, 0), 3000);
assert.equal(particleBudget(false, 1), 1400);
assert.equal(particleBudget(false, 2), 700);
assert.equal(particleBudget(true, 2), 300);
assert.equal(allowParticleType('smoke', 1), false);
assert.equal(allowParticleType('flame', 1), true);
assert.equal(allowParticleType('flame', 2), false);
assert.equal(allowParticleType('dot', 2), true, 'simple combat particles remain available in the strongest adaptive tier');
assert.equal(performanceTier({ graphicsPreset: 'extreme' }), 2);

resetAdaptivePerformance();
let transition = null;
for (let i = 0; i < 100; i++) {
  const result = observeAdaptivePerformance(0.1, { adaptivePerformance: true }, i * 100);
  if (result.changed) transition = result;
}
assert.equal(transition?.tier, 2, 'sustained 10 FPS conditions quickly select the strongest adaptive tier');
assert.equal(performanceTier({ adaptivePerformance: true }), 2);

resetAdaptivePerformance();
let recommendation = false;
for (let i = 0; i < 120; i++) {
  const result = observeAdaptivePerformance(0.1, { adaptivePerformance: false, performanceRecommendationShown: false }, i * 100);
  recommendation ||= result.recommend;
}
assert.equal(recommendation, true, 'very poor sustained pacing prompts a nonmodal one-time preset recommendation even with auto quality disabled');
assert.equal(performanceTier({ adaptivePerformance: false }), 0, 'automatic visual changes stay disabled when the player has not enabled adaptive performance');

resetAdaptivePerformance();
let tier = 0;
for (let i = 0; i < 160; i++) tier = observeAdaptivePerformance(1 / 60, { adaptivePerformance: true }, 10000 + i * 17).tier;
assert.equal(tier, 0, 'quality remains or recovers at a stable 60 FPS');

const priorQuality = G.performanceQualityTier;
try {
  clearVfx(); G.performanceQualityTier = 0;
  for (let i = 0; i < 400; i++) {
    spawn({ type: 'dot', x: i, y: 0, life: 1 });
    spawn({ type: 'glow', x: i, y: 0, life: 1 });
  }
  assert.equal(particles.length, 800);
  G.performanceQualityTier = 2; applyPerformanceQuality();
  assert.equal(particles.length, 400, 'quality transition immediately releases disallowed cosmetic particles');
  assert.ok(particles.every((particle) => particle.type === 'dot'));
  for (let i = 0; i < 60; i++) addLight(i, 0, 1, 1, 0, '#fff', true);
  assert.equal(lights.length, 32, 'priority lights cannot exceed the strict extreme-tier cap');
} finally {
  clearVfx(); G.performanceQualityTier = priorQuality;
}

console.log('Extreme preset particle budgets, cosmetic shedding, adaptive hysteresis, light bounds, and nonmodal recommendation checks passed.');
