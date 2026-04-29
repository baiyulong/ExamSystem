import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('service worker precaches the current module graph with a bumped cache name', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  const cachePrefix = source.match(/const\s+CACHE_PREFIX\s*=\s*'([^']+)'/)?.[1];
  const cacheVersion = source.match(/const\s+CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}([^`]+)`/)?.[1];

  assert.equal(cachePrefix, 'architect-exam-study-');
  assert.ok(cacheVersion, 'expected CACHE_NAME version constant');
  assert.notEqual(`${cachePrefix}${cacheVersion}`, 'architect-exam-study-v1');
  for (const asset of [
    '/src/app.js',
    '/src/data.js',
    '/src/studyEngine.js',
    '/src/persistence.js',
    '/src/startupLoad.js',
    '/src/stateSchema.js',
  ]) {
    assert.match(source, new RegExp(`'${asset.replaceAll('/', '\\/')}'`), `expected ${asset} to be precached`);
  }
});

test('service worker deletes old caches during activation', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

  assert.match(source, /CACHE_PREFIX/);
  assert.match(source, /addEventListener\('activate'/);
  assert.match(source, /caches\.keys\(\)/);
  assert.match(source, /caches\.delete\(/);
  assert.match(source, /cacheName\.startsWith\(CACHE_PREFIX\)/);
  assert.match(source, /cacheName\s*!==\s*CACHE_NAME/);
});
