import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requiredStatuses = [
  'cloud-synced',
  'cloud-only',
  'cloud-load-failed',
  'local-only',
  'save-failed',
];

test('hero exposes a sync status badge next to the reset button', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const heroActions = html.match(/<div\s+class="hero-actions">[\s\S]*?<\/div>/);

  assert.ok(heroActions, 'expected a .hero-actions container in the header');
  assert.match(
    heroActions[0],
    /<span\s+id="sync-status"\s+class="sync-status"\s+data-status="local-only">本地暂存<\/span>/,
    'expected sync status badge with local-only initial state',
  );
  assert.match(
    heroActions[0],
    /<button\s+id="reset-demo"\s+type="button">重置进度<\/button>/,
    'expected reset control to remain a semantic button',
  );
});

test('stylesheet defines sync status layout and all persistence status variants', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.hero-actions\s*\{/, 'expected .hero-actions layout styles');
  assert.match(css, /\.sync-status\s*\{/, 'expected base .sync-status badge styles');

  for (const status of requiredStatuses) {
    assert.match(
      css,
      new RegExp(`\\.sync-status\\[data-status="${status}"\\]\\s*\\{`),
      `expected .sync-status[data-status="${status}"] variant styles`,
    );
  }
});
