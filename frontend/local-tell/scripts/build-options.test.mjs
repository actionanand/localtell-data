import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_BASE_HREF, resolveBaseHref } from './build-options.mjs';

test('defaults to the repository Pages path', () => {
  assert.equal(resolveBaseHref(undefined), DEFAULT_BASE_HREF);
  assert.equal(resolveBaseHref('  '), '/localtell-data/');
});

test('normalizes leading and trailing slashes', () => {
  assert.equal(resolveBaseHref('custom'), '/custom/');
  assert.equal(resolveBaseHref('/a/b'), '/a/b/');
  assert.equal(resolveBaseHref('/'), '/');
});

test('rejects unsafe values', () => {
  for (const value of ['/../x/', 'a//b', '/x?y', '$(rm)', 'C:\\x']) assert.throws(() => resolveBaseHref(value));
});

test('package scripts use no POSIX-only shell syntax', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  for (const [name, command] of Object.entries(scripts)) {
    assert.doesNotMatch(command, /\$\{|\bcp\b|\brm -|\bexport\b/, `script ${name} is not cross-platform: ${command}`);
  }
});
