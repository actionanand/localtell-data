import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProxyConfig, rewriteRedirectLocation } from './dev-proxy.mjs';

test('rewrites signed release asset redirects to the same-origin proxy', () => {
  assert.equal(
    rewriteRedirectLocation('https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r&sig=x'),
    '/data-mirror-assets/github-production-release-asset/1/abc?sp=r&sig=x',
  );
  assert.equal(rewriteRedirectLocation('https://objects.githubusercontent.com/a/b?x=1'), '/data-mirror-objects/a/b?x=1');
  assert.equal(
    rewriteRedirectLocation('https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/TN.db.gz'),
    '/data-mirror/cell-data-v3/TN.db.gz',
  );
});

test('leaves unrelated redirects untouched', () => {
  assert.equal(rewriteRedirectLocation('https://evil.example/x'), 'https://evil.example/x');
  assert.equal(rewriteRedirectLocation('https://release-assets.githubusercontent.com.evil.example/x'), 'https://release-assets.githubusercontent.com.evil.example/x');
  assert.equal(rewriteRedirectLocation(undefined), undefined);
});

test('maps mirror paths onto the GitHub release path and asset hosts', () => {
  const config = createProxyConfig();
  assert.equal(config['/data-mirror/'].rewrite('/data-mirror/cell-data-v3/manifest.json'), '/actionanand/localtell-data/releases/download/cell-data-v3/manifest.json');
  assert.equal(config['/data-mirror-assets/'].rewrite('/data-mirror-assets/a/b?c=1'), '/a/b?c=1');
  assert.equal(config['/data-mirror-assets/'].target, 'https://release-assets.githubusercontent.com');
  for (const entry of Object.values(config)) assert.equal(entry.secure, true);
});
