#!/usr/bin/env node
// Mirrors published manifests and SHA-256-verified packs into the static site, because
// GitHub Release downloads do not send CORS headers and cannot be fetched by the browser.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_PREFIX = 'https://github.com/actionanand/localtell-data/releases/download/';
const SAFE_PATH = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const MAX_PACK_BYTES = 256 * 1024 * 1024;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const countryFilter = process.argv.slice(2).find((arg) => arg.startsWith('--countries='))?.slice('--countries='.length).split(',');
const outDir = resolve(root, positional[0] ?? 'dist/local-tell/browser/data-mirror');
const sources = JSON.parse(await readFile(join(root, 'src/config/manifest-sources.json'), 'utf8')).filter(
  (source) => !countryFilter || countryFilter.includes(source.countryCode),
);

function relativePath(url) {
  if (!url.startsWith(RELEASE_PREFIX)) throw new Error(`Not a mirrored release URL: ${url}`);
  const rest = url.slice(RELEASE_PREFIX.length);
  if (!SAFE_PATH.test(rest)) throw new Error(`Unexpected release path: ${rest}`);
  return rest;
}

async function download(url, maxBytes) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`Too large: ${url}`);
  return bytes;
}

async function save(path, bytes) {
  const target = join(outDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

let total = 0;
for (const source of sources) {
  const manifestBytes = await download(source.manifestUrl, 2 * 1024 * 1024);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (!Array.isArray(manifest.packs)) throw new Error(`Manifest without packs: ${source.manifestUrl}`);
  for (const pack of manifest.packs) {
    const bytes = await download(pack.downloadUrl, MAX_PACK_BYTES);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== String(pack.sha256).toLowerCase()) throw new Error(`SHA-256 mismatch for ${pack.id}`);
    await save(relativePath(pack.downloadUrl), bytes);
    total += bytes.byteLength;
    console.log(`mirrored ${source.countryCode}/${pack.id} (${bytes.byteLength} bytes)`);
  }
  // Written last so a partially mirrored country never advertises missing packs.
  await save(relativePath(source.manifestUrl), manifestBytes);
}
console.log(`Mirror complete: ${(total / 1024 / 1024).toFixed(1)} MiB in ${outDir}`);
