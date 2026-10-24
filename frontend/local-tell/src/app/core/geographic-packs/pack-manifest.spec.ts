import {
  fetchManifestSources,
  formatPackBytes,
  INDIA_REGIONS,
  PackCatalog,
  parseManifest,
  type CountryManifestSource,
  type InstalledPackInfo,
  type RemotePack,
} from './pack-manifest';
import { resolveDownloadUrl } from './download-mirror';

const india: CountryManifestSource = {
  countryCode: 'IN',
  countryName: 'India',
  packType: 'state_ut',
  layout: 'REGIONS',
  manifestUrl: 'https://example.com/in.json',
  sourceOrder: 0,
};
const sriLanka: CountryManifestSource = {
  countryCode: 'LK',
  countryName: 'Sri Lanka',
  packType: 'province',
  layout: 'FLAT',
  manifestUrl: 'https://example.com/lk.json',
  sourceOrder: 1,
};

function manifest(source: CountryManifestSource, change: (root: Record<string, unknown>, pack: Record<string, unknown>) => void = () => undefined): string {
  const regional = source.layout === 'REGIONS';
  const pack: Record<string, unknown> = {
    id: regional ? 'TN' : 'LK-1',
    name: regional ? 'Tamil Nadu' : 'Western Province',
    version: 3,
    displayOrder: 7,
    downloadUrl: 'https://example.com/pack.db.gz',
    sha256: 'a'.repeat(64),
  };
  if (regional) pack['region'] = 'south';
  else pack['adminCode'] = 'LK-1';
  const root: Record<string, unknown> = { schemaVersion: 1, packs: [pack] };
  if (!regional) Object.assign(root, { countryCode: 'LK', countryName: 'Sri Lanka', packType: 'province' });
  change(root, pack);
  return JSON.stringify(root);
}

function remote(id: string, name: string, region: string | null, displayOrder: number, extra: Partial<RemotePack> = {}): RemotePack {
  return {
    id,
    name,
    version: 1,
    region,
    displayOrder,
    downloadUrl: `https://example.com/${id}`,
    sha256: 'a'.repeat(64),
    compressedBytes: 100,
    uncompressedBytes: 200,
    countryCode: 'IN',
    countryName: 'India',
    packType: 'state_ut',
    adminCode: null,
    layout: 'REGIONS',
    sourceOrder: 0,
    ...extra,
  };
}

function flat(countryCode: string, countryName: string, id: string, name: string, sourceOrder: number): RemotePack {
  return remote(id, name, null, 1, { countryCode, countryName, packType: 'division', layout: 'FLAT', sourceOrder });
}

const installed = (entries: [string, number][]) => new Map<string, InstalledPackInfo>(entries.map(([id, version]) => [id, { id, version }]));

describe('Manifest parsing (Android ManifestRepositoryTest parity)', () => {
  it('gives legacy India manifests country metadata from configuration', () => {
    const result = parseManifest(manifest(india), { ...india, sourceOrder: 4 });
    expect(result).toMatchObject({ countryCode: 'IN', countryName: 'India', packType: 'state_ut', layout: 'REGIONS', sourceOrder: 4 });
    expect(result.packs[0]).toMatchObject({ region: 'south', countryName: 'India', layout: 'REGIONS', sourceOrder: 4 });
  });

  it('accepts Sri Lanka province metadata without a region', () => {
    const result = parseManifest(manifest(sriLanka), sriLanka);
    expect(result.packs[0]).toMatchObject({ region: null, adminCode: 'LK-1', displayOrder: 7, layout: 'FLAT', sourceOrder: 1 });
  });

  it('rejects mismatched country, pack type, checksums, HTTP URLs and region rules', () => {
    const bad: [CountryManifestSource, (root: Record<string, unknown>, pack: Record<string, unknown>) => void][] = [
      [sriLanka, (root) => (root['countryCode'] = 'IN')],
      [sriLanka, (root) => (root['packType'] = 'state_ut')],
      [india, (_, pack) => (pack['sha256'] = 'invalid')],
      [india, (_, pack) => (pack['downloadUrl'] = 'http://example.com/pack')],
      [sriLanka, (_, pack) => (pack['region'] = 'south')],
      [india, (_, pack) => delete pack['region']],
      [india, (_, pack) => (pack['region'] = 'unknown')],
      [india, (_, pack) => (pack['id'] = '../escape')],
      [india, (_, pack) => (pack['version'] = 0)],
      [india, (root) => (root['schemaVersion'] = 4)],
      [india, (root) => (root['packs'] = [(root['packs'] as unknown[])[0], (root['packs'] as unknown[])[0]])],
    ];
    for (const [source, change] of bad) expect(() => parseManifest(manifest(source, change), source)).toThrow();
    expect(() => parseManifest('not json', india)).toThrow();
  });

  it('keeps partial successes, records failures and rejects all-failed or duplicate catalogs', async () => {
    for (const failed of [india, sriLanka]) {
      const result = await fetchManifestSources([sriLanka, india], async (source) => {
        if (source === failed) throw new Error('unavailable');
        return parseManifest(manifest(source), source);
      });
      expect(result.failedSources.map((entry) => entry.source)).toEqual([failed]);
      expect(result.packs.map((pack) => pack.id)).toEqual([failed === india ? 'LK-1' : 'TN']);
    }
    await expect(fetchManifestSources([india, sriLanka], () => Promise.reject(new Error('x')))).rejects.toThrow(
      'All country manifest requests failed',
    );
    await expect(
      fetchManifestSources([india, sriLanka], async (source) => parseManifest(manifest(source, (_, pack) => (pack['id'] = 'shared')), source)),
    ).rejects.toThrow();
  });

  it('does not report cancellation as a failed country', async () => {
    const cancel = new DOMException('cancelled', 'AbortError');
    await expect(
      fetchManifestSources([india], () => Promise.reject(cancel), (error) => error instanceof DOMException && error.name === 'AbortError'),
    ).rejects.toBe(cancel);
  });

  it('counts updates without downgrading and keeps failed source counts', async () => {
    const both = await fetchManifestSources([india, sriLanka], async (source) => parseManifest(manifest(source), source));
    const current = installed([
      ['TN', 1],
      ['LK-1', 2],
    ]);
    expect(Object.fromEntries(PackCatalog.updateCounts(both, current, new Map()))).toEqual({ IN: 1, LK: 1 });
    expect(Object.fromEntries(PackCatalog.updateCounts(both, installed([['TN', 4], ['LK-1', 2]]), new Map()))).toEqual({ IN: 0, LK: 1 });
    const partial = await fetchManifestSources([india, sriLanka], async (source) => {
      if (source === india) throw new Error('down');
      return parseManifest(manifest(source), source);
    });
    expect(PackCatalog.updateCounts(partial, current, new Map([['IN', 2]])).get('IN')).toBe(2);
  });
});

describe('PackCatalog (Android PackCatalogTest parity)', () => {
  const catalogRegions = () =>
    PackCatalog.regions([
      remote('tn', 'Tamil Nadu', 'south', 2),
      remote('kl', 'Kerala', 'south', 1),
      remote('ka', 'Karnataka', 'south', 3),
      remote('mp', 'Madhya Pradesh', 'central', 1),
      remote('up', 'Uttar Pradesh', 'central', 2),
      remote('hp', 'Himachal Pradesh', 'north', 1),
      remote('ar', 'Arunachal Pradesh', 'northeast', 1),
    ]);

  it('uses the fixed India region order and manifest display order', () => {
    const regions = PackCatalog.regions([
      remote('goa', 'Goa', 'west', 2),
      remote('tn', 'Tamil Nadu', 'south', 4),
      remote('kl', 'Kerala', 'south', 1),
      remote('ar', 'Arunachal Pradesh', 'northeast', 1),
    ]);
    expect(regions.map((entry) => entry.region.displayName)).toEqual(['South India', 'West India', 'North-East India']);
    expect(regions[0].packs.map((pack) => pack.name)).toEqual(['Kerala', 'Tamil Nadu']);
    expect(INDIA_REGIONS).toHaveLength(6);
  });

  it('totals sizes and selects only missing or stale packs', () => {
    expect(PackCatalog.totals([remote('tn', 'TN', 'south', 1, { compressedBytes: 1024, uncompressedBytes: 4096 }), remote('kl', 'KL', 'south', 2, { compressedBytes: 2048, uncompressedBytes: 8192 })])).toEqual({
      compressedBytes: 3072,
      uncompressedBytes: 12288,
    });
    const current = remote('tn', 'TN', 'south', 1, { version: 3 });
    const stale = remote('kl', 'KL', 'south', 2, { version: 3 });
    const missing = remote('ka', 'KA', 'south', 3, { version: 3 });
    const state = installed([
      ['tn', 3],
      ['kl', 2],
    ]);
    expect(PackCatalog.requiredPacks([current, stale, missing], state).map((pack) => pack.id)).toEqual(['kl', 'ka']);
    expect(PackCatalog.needsDownload(remote('tn', 'TN', 'south', 1, { version: 3 }), installed([['tn', 4]]))).toBe(false);
    expect(PackCatalog.installedPacks([current, stale, missing], installed([['tn', 1]])).map((pack) => pack.id)).toEqual(['tn']);
  });

  it('formats bytes and batch failures', () => {
    expect(formatPackBytes(512)).toBe('512 B');
    expect(formatPackBytes(1536)).toBe('1.5 KB');
    expect(formatPackBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(PackCatalog.batchFailureMessage(['Kerala', 'Goa'])).toBe(
      'Unable to download Kerala, Goa. Successfully downloaded packs remain available offline.',
    );
    expect(PackCatalog.batchFailureMessage([])).toBeNull();
  });

  it('searches regions partially and case-insensitively', () => {
    const regions = catalogRegions();
    expect(PackCatalog.filterRegions(regions, '  ')).toEqual(regions);
    expect(PackCatalog.filterRegions(regions, 'TAMIL NADU')[0].packs.map((pack) => pack.name)).toEqual(['Tamil Nadu']);
    expect(PackCatalog.filterRegions(regions, 'kar')[0].packs.map((pack) => pack.name)).toEqual(['Karnataka']);
    expect(PackCatalog.filterRegions(regions, 'South')[0].packs.map((pack) => pack.name)).toEqual(['Kerala', 'Tamil Nadu', 'Karnataka']);
    for (const query of ['North East', 'north-east', 'northeast']) {
      expect(PackCatalog.filterRegions(regions, query)[0].region.displayName).toBe('North-East India');
    }
    const results = PackCatalog.filterRegions(regions, 'pradesh');
    expect(results.map((entry) => entry.region.displayName)).toEqual(['Central India', 'North India', 'North-East India']);
    expect(PackCatalog.filterRegions(regions, 'no such place')).toEqual([]);
  });

  it('puts India first and orders other countries by source order then code', () => {
    const countries = PackCatalog.countries([
      flat('NP', 'Nepal', 'NP-1', 'Bagmati Province', 2),
      remote('tn', 'Tamil Nadu', 'south', 1, { sourceOrder: 99 }),
      flat('LK', 'Sri Lanka', 'LK-1', 'Western Province', 2),
      flat('MV', 'Maldives', 'MV-1', 'Malé', 1),
    ]);
    expect(countries.map((country) => country.countryCode)).toEqual(['IN', 'MV', 'LK', 'NP']);
  });

  it('searches flat and regional countries and supports future flat countries', () => {
    const west = flat('LK', 'Sri Lanka', 'LK-1', 'Western Province', 1);
    const central = { ...west, id: 'LK-2', name: 'Central Province', displayOrder: 2 };
    const source = PackCatalog.countries([central, remote('TN', 'Tamil Nadu', 'south', 1), west]);
    expect(source[1].packs.map((pack) => pack.id)).toEqual(['LK-1', 'LK-2']);
    expect(PackCatalog.filterCountries(source, 'Western')[0].packs.map((pack) => pack.id)).toEqual(['LK-1']);
    expect(PackCatalog.filterCountries(source, 'lk-2')[0].packs.map((pack) => pack.id)).toEqual(['LK-2']);
    expect(PackCatalog.filterCountries(source, 'South')[0].packs.map((pack) => pack.id)).toEqual(['TN']);
    expect(PackCatalog.filterCountries(source, 'no such pack')).toEqual([]);
    const future = flat('ZZ', 'Example Country', 'ZZ-1', 'Example Division', 0);
    expect(PackCatalog.regions([future])).toEqual([]);
    expect(PackCatalog.filterCountries(PackCatalog.countries([future]), 'Example Division')[0].packs).toEqual([future]);
  });
});

describe('resolveDownloadUrl', () => {
  const mirrors = [{ from: 'https://github.com/actionanand/localtell-data/releases/download/', to: 'data-mirror/' }];

  it('maps configured release URLs to the same-origin mirror', () => {
    expect(resolveDownloadUrl('https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/TN.db.gz', mirrors, 'https://x.github.io/localtell-data/')).toBe(
      'https://x.github.io/localtell-data/data-mirror/cell-data-v3/TN.db.gz',
    );
  });

  it('leaves other URLs untouched and refuses path escapes', () => {
    expect(resolveDownloadUrl('https://example.com/a.gz', mirrors, 'https://x/')).toBe('https://example.com/a.gz');
    expect(() => resolveDownloadUrl('https://github.com/actionanand/localtell-data/releases/download/../x', mirrors, 'https://x/')).toThrow();
    expect(() => resolveDownloadUrl('https://github.com/actionanand/localtell-data/releases/download/a/b?c=d', mirrors, 'https://x/')).toThrow();
  });
});
