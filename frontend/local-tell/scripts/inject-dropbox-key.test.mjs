import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { injectKey, verifyBundle, validatedKey, PLACEHOLDER } from './inject-dropbox-key.mjs';

test('validates keys without exposing invalid values', () => {
  assert.equal(validatedKey(undefined), '');
  assert.throws(() => validatedKey('', true), /required/);
  for (const value of [PLACEHOLDER, ' ', 'short', 'a'.repeat(33), "abc'123456", 'abcdefgh\n']) {
    assert.throws(() => validatedKey(value), { message: 'DROPBOX_APP_KEY has an invalid format.' });
  }
});

test('changes only the exact placeholder; no secret disables optional builds; required builds fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'localtell-inject-'));
  const file = join(directory, 'environment.ts');
  const source = `const config = { appKey: '${PLACEHOLDER}', other: 'unchanged' };`;
  try {
    await writeFile(file, source);
    await assert.rejects(injectKey(file, undefined, true), /required/);
    assert.equal(await readFile(file, 'utf8'), source);
    await injectKey(file, 'example123456');
    assert.equal(await readFile(file, 'utf8'), source.replace(`'${PLACEHOLDER}'`, '"example123456"'));
    await assert.rejects(injectKey(file, 'example123456'), /exactly one/);
    await writeFile(file, source);
    await injectKey(file, undefined);
    assert.equal(await readFile(file, 'utf8'), source.replace(`'${PLACEHOLDER}'`, '""'));
    await writeFile(file, source + ` '${PLACEHOLDER}'`);
    await assert.rejects(injectKey(file, 'example123456'), /exactly one/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('checks built JavaScript for injected keys and unresolved placeholders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'localtell-bundle-'));
  const file = join(directory, 'main.js');
  try {
    await assert.rejects(verifyBundle(directory), /does not contain/);
    await writeFile(file, `const key="${PLACEHOLDER}";`);
    await assert.rejects(verifyBundle(directory, 'example123456', true), /Unresolved/);
    await writeFile(file, 'const key="example123456";');
    await verifyBundle(directory, 'example123456', true);
    await writeFile(file, 'const key=`example123456`;');
    await verifyBundle(directory, 'example123456', true);
    await assert.rejects(verifyBundle(directory, 'different1234', true), /does not contain/);
    await writeFile(file, 'const key="";');
    await verifyBundle(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});