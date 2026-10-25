#!/usr/bin/env node
// Serves the production build like GitHub Pages: under a base path, with 404.html as the SPA fallback.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBaseHref } from './build-options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'local-tell', 'browser');
const base = resolveBaseHref(process.env.BASE_HREF);
const port = Number(process.env.PORT ?? 4300);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

async function file(path) {
  try {
    const info = await stat(path);
    return info.isFile() ? await readFile(path) : null;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  if (!pathname.startsWith(base)) {
    response.writeHead(302, { location: base }).end();
    return;
  }
  const relative = pathname.slice(base.length) || 'index.html';
  const target = normalize(join(root, relative));
  if (!target.startsWith(root + sep) && target !== root) {
    response.writeHead(400).end();
    return;
  }
  const body = await file(target);
  if (body) {
    response.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(body);
    return;
  }
  const fallback = await file(join(root, '404.html'));
  response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(fallback ?? 'Not found');
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}`));
