import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const bytes = readFileSync(new URL('public/geography/boundaries.ltgz', root));
const provenance = JSON.parse(readFileSync(new URL('public/geography/provenance.json', root)));
const source = readFileSync(new URL('src/app/core/geography/boundary-index.ts', root), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { BoundaryIndex } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const index = BoundaryIndex.read(gunzipSync(bytes));

test('bundles the exact pinned Android index and inventory', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.generated.sha256);
  assert.equal(index.polygons.length, provenance.generated.polygons);
  assert.deepEqual([...new Set(index.polygons.filter(p => p.kind === 0).map(p => p.code))].sort(), provenance.generated.countryCodes);
  assert.deepEqual([...new Set(index.polygons.filter(p => p.kind === 1).map(p => p.code))].sort(), provenance.generated.indiaAdminCodes);
});

test('Android country and state golden vectors work without locality packs', () => {
  for (const [code, latitude, longitude] of [['IN-KA',12.971598,77.594566],['IN-TN',8.181910,77.352330],['IN-TN',8.1833,77.4119],['IN-KL',10.5276,76.2144],['IN-MH',18.5204,73.8567],['IN-DL',28.6139,77.2090],['IN-PY',11.934,79.812],['IN-AN',11.6234,92.7265],['IN-LD',10.5667,72.6417]]) {
    assert.equal(index.identify(latitude,longitude,20)?.adminCode, code);
  }
  for (const [code, latitude, longitude] of [['LK',7.2906,80.6337],['NP',27.7172,85.324],['BD',23.8103,90.4125],['DE',52.52,13.405],['AU',-35.2809,149.13],['JP',35.6762,139.65],['BR',-15.7939,-47.8828],['ZA',-25.7479,28.2293],['US',38.9072,-77.0369],['LS',-29.5,28.5]]) {
    assert.equal(index.identify(latitude,longitude,20)?.countryCode,code);
  }
});

test('Android ocean, border, dispute and unreliable-accuracy vectors remain unknown', () => {
  for (const [latitude,longitude] of [[0,0],[-30,-30],[20,65],[49,-100],[34.08,74.79],[-89,0],[90,0]]) assert.equal(index.identify(latitude,longitude,20),null);
  assert.equal(index.identify(52.52,13.405,null),null);
  assert.equal(index.identify(52.52,13.405,100000),null);
  assert.deepEqual(index.identify(28.6139,77.209,25000), {countryCode:'IN',countryName:'India',adminCode:null,adminName:null});
});