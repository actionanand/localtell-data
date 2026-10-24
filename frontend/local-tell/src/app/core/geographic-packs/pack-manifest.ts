/** Port of Android `ManifestRepository.parse`, `PackModels` and `PackCatalog` presentation rules. */

export type CountryLayout = 'REGIONS' | 'FLAT';

export interface CountryManifestSource {
  readonly countryCode: string;
  readonly countryName: string;
  readonly packType: string;
  readonly layout: CountryLayout;
  readonly manifestUrl: string;
  readonly sourceOrder: number;
}

export interface RemotePack {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly region: string | null;
  readonly displayOrder: number;
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly compressedBytes: number | null;
  readonly uncompressedBytes: number | null;
  readonly countryCode: string;
  readonly countryName: string;
  readonly packType: string;
  readonly adminCode: string | null;
  readonly layout: CountryLayout;
  readonly sourceOrder: number;
}

export interface RemoteManifest {
  readonly schemaVersion: number;
  readonly generatedAt: string | null;
  readonly packs: readonly RemotePack[];
  readonly countryCode: string;
  readonly countryName: string;
  readonly packType: string;
  readonly layout: CountryLayout;
  readonly sourceOrder: number;
}

export interface InstalledPackInfo {
  readonly id: string;
  readonly version: number;
}

export interface IndiaRegion {
  readonly manifestKey: string;
  readonly displayName: string;
}

export const INDIA_REGIONS: readonly IndiaRegion[] = [
  { manifestKey: 'south', displayName: 'South India' },
  { manifestKey: 'west', displayName: 'West India' },
  { manifestKey: 'central', displayName: 'Central India' },
  { manifestKey: 'north', displayName: 'North India' },
  { manifestKey: 'east', displayName: 'East India' },
  { manifestKey: 'northeast', displayName: 'North-East India' },
];

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

const MAX_MANIFEST_PACKS = 1000;
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ManifestValidationError(message);
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: JsonRecord, key: string): string {
  const value = record[key];
  check(typeof value === 'string', `Missing or invalid "${key}"`);
  return value;
}

function optionalString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  check(typeof value === 'string', `Invalid "${key}"`);
  return value.trim().length > 0 ? value : null;
}

function requiredInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  check(typeof value === 'number' && Number.isSafeInteger(value), `Missing or invalid "${key}"`);
  return value;
}

function optionalPositiveInteger(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  check(typeof value === 'number' && Number.isSafeInteger(value), `Invalid "${key}"`);
  return value > 0 ? value : null;
}

export function parseManifest(text: string, source: CountryManifestSource): RemoteManifest {
  check(text.length <= MAX_MANIFEST_BYTES, 'Manifest is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ManifestValidationError('Manifest is not valid JSON');
  }
  check(isRecord(parsed), 'Manifest must be a JSON object');
  const schemaVersion = requiredInteger(parsed, 'schemaVersion');
  check(schemaVersion >= 1 && schemaVersion <= 3, `Unsupported manifest schema: ${schemaVersion}`);
  const countryCode = optionalString(parsed, 'countryCode')?.toUpperCase() ?? source.countryCode;
  const countryName = optionalString(parsed, 'countryName') ?? source.countryName;
  const packType = optionalString(parsed, 'packType') ?? source.packType;
  check(countryCode === source.countryCode, `Manifest country code does not match ${source.countryCode}`);
  check(packType === source.packType, `Manifest pack type does not match ${source.countryCode}`);
  const packsJson = parsed['packs'];
  check(Array.isArray(packsJson), 'Manifest "packs" must be an array');
  check(packsJson.length <= MAX_MANIFEST_PACKS, 'Manifest lists too many packs');

  const packs = packsJson.map((entry): RemotePack => {
    check(isRecord(entry), 'Pack entry must be an object');
    const id = requiredString(entry, 'id');
    const name = requiredString(entry, 'name').trim();
    const version = requiredInteger(entry, 'version');
    const region = optionalString(entry, 'region')?.trim().toLowerCase() ?? null;
    const displayOrder = requiredInteger(entry, 'displayOrder');
    const downloadUrl = requiredString(entry, 'downloadUrl');
    const sha256 = requiredString(entry, 'sha256').toLowerCase();
    check(/^[A-Za-z0-9._-]{1,64}$/.test(id), `Invalid pack id: ${id}`);
    check(name.length > 0 && name.length <= 120, `Invalid pack name for ${id}`);
    check(version >= 1, `Invalid pack version for ${id}`);
    if (source.layout === 'REGIONS') {
      check(source.countryCode === 'IN', `No regional catalog configured for ${source.countryCode}`);
      check(region !== null && INDIA_REGIONS.some((known) => known.manifestKey === region), `Unknown region for ${id}: ${region}`);
    } else {
      check(region === null, `Flat-country pack must not define a region: ${id}`);
    }
    check(displayOrder >= 0, `Invalid display order for ${id}`);
    let url: URL;
    try {
      url = new URL(downloadUrl);
    } catch {
      throw new ManifestValidationError(`Invalid pack URL: ${id}`);
    }
    check(url.protocol === 'https:', `Pack URL must use HTTPS: ${id}`);
    check(/^[0-9a-f]{64}$/.test(sha256), `Invalid SHA-256 for ${id}`);
    return {
      id,
      name,
      version,
      region,
      displayOrder,
      downloadUrl,
      sha256,
      compressedBytes: optionalPositiveInteger(entry, 'compressedBytes'),
      uncompressedBytes: optionalPositiveInteger(entry, 'uncompressedBytes'),
      countryCode: source.countryCode,
      countryName,
      packType,
      adminCode: optionalString(entry, 'adminCode'),
      layout: source.layout,
      sourceOrder: source.sourceOrder,
    };
  });
  check(new Set(packs.map((pack) => pack.id)).size === packs.length, `Duplicate pack ID within ${source.countryCode}`);
  return {
    schemaVersion,
    generatedAt: optionalString(parsed, 'generatedAt'),
    packs,
    countryCode: source.countryCode,
    countryName,
    packType,
    layout: source.layout,
    sourceOrder: source.sourceOrder,
  };
}

export interface ManifestFetchResult {
  readonly manifests: readonly RemoteManifest[];
  readonly failedSources: readonly { readonly source: CountryManifestSource; readonly error: string }[];
  readonly packs: readonly RemotePack[];
}

/** Android `fetchSources`: partial failure keeps successes; all failures or duplicate IDs fail. */
export async function fetchManifestSources(
  sources: readonly CountryManifestSource[],
  load: (source: CountryManifestSource) => Promise<RemoteManifest>,
  isCancellation: (error: unknown) => boolean = () => false,
): Promise<ManifestFetchResult> {
  const manifests: RemoteManifest[] = [];
  const failedSources: { source: CountryManifestSource; error: string }[] = [];
  for (const source of [...sources].sort((a, b) => a.sourceOrder - b.sourceOrder)) {
    try {
      manifests.push(await load(source));
    } catch (error) {
      if (isCancellation(error)) throw error;
      failedSources.push({ source, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
  check(manifests.length > 0, 'All country manifest requests failed');
  const packs = manifests.flatMap((manifest) => manifest.packs);
  check(new Set(packs.map((pack) => pack.id)).size === packs.length, 'Duplicate pack ID across country manifests');
  return { manifests, failedSources, packs };
}

export interface CountryPacks {
  readonly countryCode: string;
  readonly countryName: string;
  readonly packType: string;
  readonly packs: readonly RemotePack[];
  readonly layout: CountryLayout;
  readonly sourceOrder: number;
}

export interface RegionPacks {
  readonly region: IndiaRegion;
  readonly packs: readonly RemotePack[];
}

export interface PackTotals {
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/[ \t\n\u000B\f\r-]+/g, '');
}

function matches(value: string, normalizedQuery: string): boolean {
  return normalizeSearch(value).includes(normalizedQuery);
}

export const PackCatalog = {
  countries(packs: readonly RemotePack[]): CountryPacks[] {
    const groups = new Map<string, RemotePack[]>();
    for (const pack of packs) groups.set(pack.countryCode, [...(groups.get(pack.countryCode) ?? []), pack]);
    return [...groups.values()]
      .map((countryPacks): CountryPacks => {
        const first = countryPacks[0];
        return {
          countryCode: first.countryCode,
          countryName: first.countryName,
          packType: first.packType,
          packs: [...countryPacks].sort(
            (a, b) => a.displayOrder - b.displayOrder || compareText(a.name, b.name) || compareText(a.id, b.id),
          ),
          layout: first.layout,
          sourceOrder: first.sourceOrder,
        };
      })
      .sort(
        (a, b) =>
          Number(a.countryCode.toUpperCase() !== 'IN') - Number(b.countryCode.toUpperCase() !== 'IN') ||
          a.sourceOrder - b.sourceOrder ||
          compareText(a.countryCode.toUpperCase(), b.countryCode.toUpperCase()),
      );
  },

  regions(packs: readonly RemotePack[]): RegionPacks[] {
    return INDIA_REGIONS.flatMap((region) => {
      const regionPacks = packs
        .filter((pack) => pack.layout === 'REGIONS' && pack.countryCode === 'IN' && pack.region === region.manifestKey)
        .sort((a, b) => a.displayOrder - b.displayOrder || compareText(a.name, b.name));
      return regionPacks.length > 0 ? [{ region, packs: regionPacks }] : [];
    });
  },

  filterCountries(countries: readonly CountryPacks[], query: string): CountryPacks[] {
    const normalizedQuery = normalizeSearch(query);
    if (normalizedQuery.length === 0) return [...countries];
    return countries.flatMap((country) => {
      let matching: readonly RemotePack[];
      if (matches(country.countryName, normalizedQuery) || matches(country.countryCode, normalizedQuery)) matching = country.packs;
      else if (country.layout === 'REGIONS') matching = PackCatalog.filterRegions(PackCatalog.regions(country.packs), query).flatMap((r) => r.packs);
      else matching = PackCatalog.filterPacks(country.packs, query);
      return matching.length > 0 ? [{ ...country, packs: matching }] : [];
    });
  },

  filterPacks(packs: readonly RemotePack[], query: string): RemotePack[] {
    const normalizedQuery = normalizeSearch(query);
    if (normalizedQuery.length === 0) return [...packs];
    return packs.filter(
      (pack) =>
        matches(pack.name, normalizedQuery) ||
        matches(pack.id, normalizedQuery) ||
        matches(pack.countryName, normalizedQuery) ||
        matches(pack.region ?? '', normalizedQuery),
    );
  },

  filterRegions(regions: readonly RegionPacks[], query: string): RegionPacks[] {
    const normalizedQuery = normalizeSearch(query);
    if (normalizedQuery.length === 0) return [...regions];
    return regions.flatMap((regionPacks) => {
      const regionMatches =
        matches(regionPacks.region.displayName, normalizedQuery) || matches(regionPacks.region.manifestKey, normalizedQuery);
      const matchingPacks = regionMatches
        ? regionPacks.packs
        : regionPacks.packs.filter((pack) => matches(pack.name, normalizedQuery) || matches(pack.id, normalizedQuery));
      return matchingPacks.length > 0 ? [{ region: regionPacks.region, packs: matchingPacks }] : [];
    });
  },

  totals(packs: readonly RemotePack[]): PackTotals {
    return {
      compressedBytes: packs.reduce((sum, pack) => sum + (pack.compressedBytes ?? 0), 0),
      uncompressedBytes: packs.reduce((sum, pack) => sum + (pack.uncompressedBytes ?? 0), 0),
    };
  },

  needsDownload(pack: RemotePack, installed: ReadonlyMap<string, InstalledPackInfo>): boolean {
    const current = installed.get(pack.id);
    return current === undefined || current.version < pack.version;
  },

  requiredPacks(packs: readonly RemotePack[], installed: ReadonlyMap<string, InstalledPackInfo>): RemotePack[] {
    return packs.filter((pack) => PackCatalog.needsDownload(pack, installed));
  },

  installedPacks(packs: readonly RemotePack[], installed: ReadonlyMap<string, InstalledPackInfo>): RemotePack[] {
    return packs.filter((pack) => installed.has(pack.id));
  },

  batchFailureMessage(failures: readonly string[]): string | null {
    return failures.length === 0
      ? null
      : `Unable to download ${failures.join(', ')}. Successfully downloaded packs remain available offline.`;
  },

  /** Only successful sources contribute new counts; failed sources keep their last known count. */
  updateCounts(
    result: ManifestFetchResult,
    installed: ReadonlyMap<string, InstalledPackInfo>,
    previous: ReadonlyMap<string, number>,
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const failed of result.failedSources) counts.set(failed.source.countryCode, previous.get(failed.source.countryCode) ?? 0);
    for (const manifest of result.manifests) {
      counts.set(
        manifest.countryCode,
        manifest.packs.filter((pack) => {
          const current = installed.get(pack.id);
          return current !== undefined && current.version < pack.version;
        }).length,
      );
    }
    return counts;
  },
};

/** Android `formatPackBytes`. */
export function formatPackBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
