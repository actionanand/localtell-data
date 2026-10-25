import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('uses public OSM HTTPS tiles with visible copyright and a Referer-preserving policy', () => {
  const environment = read('src/environments/environment.ts');
  assert.ok(environment.includes('https://tile.openstreetmap.org/{z}/{x}/{y}.png'));
  assert.ok(environment.includes('https://www.openstreetmap.org/copyright'));
  assert.match(read('src/index.html'), /name="referrer" content="strict-origin-when-cross-origin"/);
  const map = read('src/app/shared/components/map-view.ts');
  assert.ok(map.includes('attribution: this.config.tiles.attribution'));
  assert.doesNotMatch(map, /attributionControl:\s*false|no-cache|prefetch|caches\.open/);
});

test('the service worker caches app assets, not public tiles or geographic databases', () => {
  const config = JSON.parse(read('ngsw-config.json'));
  assert.equal(config.dataGroups?.length ?? 0, 0);
  for (const group of config.assetGroups) {
    assert.equal(group.resources.urls?.length ?? 0, 0);
    assert.ok(group.resources.files.every((pattern) => !/openstreetmap|data-mirror|\.db/.test(pattern)));
  }
});