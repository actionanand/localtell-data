#!/usr/bin/env node
// Cross-platform GitHub Pages build: `BASE_HREF=/x/ npm run build:gh` or `npm run build:gh -- --base-href=/x/`.
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBaseHref } from './build-options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.slice(2).find((arg) => arg.startsWith('--base-href='));
const baseHref = resolveBaseHref(argument ? argument.slice('--base-href='.length) : process.env.BASE_HREF);
const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');

console.log(`Building for GitHub Pages with base href ${baseHref}`);
const result = spawnSync(process.execPath, [ng, 'build', '--configuration', 'production', '--base-href', baseHref], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

// GitHub Pages serves 404.html for unknown paths, which boots the SPA for deep links and OAuth callbacks.
const browser = join(root, 'dist', 'local-tell', 'browser');
copyFileSync(join(browser, 'index.html'), join(browser, '404.html'));
