import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('World Wiki contains the shared environmental hazard catalog and valid module syntax', () => {
  const html = readFileSync(resolve(root, 'world.html'), 'utf8');
  assert.match(html, /data-tab="hazards"/);
  assert.match(html, /id="panel-hazards"/);
  assert.match(html, /ENVIRONMENT_TRAP_TYPES/);
  assert.match(html, /ENVIRONMENT_TRAP_PROFILES|trapProfileFor/);
  assert.match(html, /Wall apertures warn before firing three physical projectiles/);
  assert.match(html, /lane proximity, or periodic trigger/);
  const start = html.indexOf('<script type="module">');
  assert.notEqual(start, -1, 'World Wiki module script exists');
  const bodyStart = html.indexOf('>', start) + 1;
  const end = html.indexOf('</script>', bodyStart);
  assert.ok(end > bodyStart, 'World Wiki module script closes');
  const checkPath = resolve(root, 'tools/tests/out/wiki-environmental-traps-syntax.mjs');
  mkdirSync(dirname(checkPath), { recursive: true });
  writeFileSync(checkPath, html.slice(bodyStart, end));
  try {
    const result = spawnSync(process.execPath, ['--check', checkPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    unlinkSync(checkPath);
  }
});
