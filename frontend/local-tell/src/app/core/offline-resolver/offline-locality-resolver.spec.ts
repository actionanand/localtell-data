import { buildFixturePack, square, testSqlJs } from '../../../testing/sqljs-fixtures';
import { wrapDatabase } from './sqljs-database';
import {
  isInsidePackState,
  PackValidationError,
  resolveLocality,
  stateRings,
  validateGeographicPack,
  type PackDatabase,
  type ResolverCandidate,
} from './offline-locality-resolver';
import { boundingBoxArea, comparePolygonOrder, haversineMetres, NEAREST_PLACE_TYPES, polygonContains, polygonOrder, POLYGON_PLACE_TYPES } from './geometry';
import { preparePack } from '../geographic-packs/prepare-pack';
import type { RemotePack } from '../geographic-packs/pack-manifest';
import { sha256HexOfBytes } from '../backup/sha256';

describe('geometry (Android LocalityArchitectureTest parity)', () => {
  it('handles interior and exterior points and bounding boxes', () => {
    const ring = '0,0;0,10;10,10;10,0';
    expect(polygonContains(5, 5, ring)).toBe(true);
    expect(polygonContains(12, 5, ring)).toBe(false);
    expect(boundingBoxArea(ring)).toBeCloseTo(100, 6);
    expect(polygonContains(1, 1, '0,0;bad;0,10')).toBe(false);
    expect(boundingBoxArea('')).toBe(Number.MAX_VALUE);
  });

  it('lets coordinates outside one state continue to another', () => {
    const tamilNadu = '8,77;8,79;11,79;11,77;8,77';
    const kerala = '8,75;8,77;11,77;11,75;8,75';
    expect(polygonContains(9, 76, tamilNadu)).toBe(false);
    expect(polygonContains(9, 76, kerala)).toBe(true);
  });

  it('orders polygons by priority, area, geometry and place IDs', () => {
    expect(comparePolygonOrder(polygonOrder('neighbourhood', 1, 1, 1), polygonOrder('village', 0.1, 0, 0))).toBeLessThan(0);
    expect(comparePolygonOrder(polygonOrder('Village', 1, 1, 1), polygonOrder('village', 2, 0, 0))).toBeLessThan(0);
    expect(comparePolygonOrder(polygonOrder('village', 1, 1, 9), polygonOrder('village', 1, 2, 0))).toBeLessThan(0);
    expect(polygonOrder('administrative_boundary', 1, 1, 1).priority).toBe(POLYGON_PLACE_TYPES.length + 1);
  });

  it('never treats administrative boundaries or districts as localities', () => {
    expect(NEAREST_PLACE_TYPES).not.toContain('administrative_boundary');
    expect(NEAREST_PLACE_TYPES).not.toContain('district');
    expect(NEAREST_PLACE_TYPES).toContain('city');
  });

  it('computes haversine distances in metres', () => {
    expect(haversineMetres(0, 0, 0, 1)).toBeCloseTo(111_194.9, 0);
  });
});

describe('offline locality resolver over SQLite packs', () => {
  const openPacks = new Map<string, PackDatabase>();

  async function pack(id: string, places: Parameters<typeof buildFixturePack>[0]['places']): Promise<ResolverCandidate> {
    const db = wrapDatabase(await buildFixturePack({ packId: id, places }));
    openPacks.set(id, db);
    return { id, version: 3, stateRings: stateRings(db) };
  }

  const open = async (candidate: ResolverCandidate) => openPacks.get(candidate.id) as PackDatabase;

  async function standardPack(id = 'TN'): Promise<ResolverCandidate> {
    return pack(id, [
      { id: 1, name: 'Tamil Nadu', type: 'administrative_boundary', adminLevel: '4', rings: [square(0, 0, 10, 10)] },
      { id: 2, name: 'District', type: 'administrative_boundary', adminLevel: '5', rings: [square(0, 0, 9, 9)] },
      { id: 3, name: 'Big Village', type: 'village', rings: [square(1, 1, 6, 6)] },
      { id: 4, name: 'Small Neighbourhood', type: 'neighbourhood', rings: [square(2, 2, 3, 3)] },
      { id: 5, name: 'Town Centre', type: 'Town', latitude: 8, longitude: 8 },
      { id: 6, name: 'Far City', type: 'city', latitude: 9.5, longitude: 0.5 },
    ]);
  }

  it('validates published schema-v3 contracts and extracts level-4 boundaries', async () => {
    const db = wrapDatabase(await buildFixturePack({ packId: 'TN', places: [{ id: 1, name: 'S', type: 'administrative_boundary', adminLevel: '4', rings: [square(0, 0, 1, 1)] }] }));
    const validated = validateGeographicPack(db);
    expect(validated.schemaVersion).toBe(3);
    expect(validated.meta['pack_id']).toBe('TN');
    expect(validated.stateRings).toHaveLength(1);
  });

  it('rejects cellular schemas, unknown schemas and missing tables', async () => {
    const cell = wrapDatabase(await buildFixturePack({ packId: 'X', schemaVersion: '2', places: [] }));
    expect(() => validateGeographicPack(cell)).toThrow(/cannot be used in a browser/);
    const unknown = wrapDatabase(await buildFixturePack({ packId: 'X', schemaVersion: '4', places: [] }));
    expect(() => validateGeographicPack(unknown)).toThrow(PackValidationError);
    const missing = wrapDatabase(await buildFixturePack({ packId: 'X', places: [], omitGeometryTable: true }));
    expect(() => validateGeographicPack(missing)).toThrow(/place_geometry/);
    const SQL = await testSqlJs();
    expect(() => validateGeographicPack(wrapDatabase(new SQL.Database()))).toThrow(/schema is missing/);
  });

  it('prefers the neighbourhood polygon, then the village polygon', async () => {
    const tn = await standardPack();
    expect(await resolveLocality([tn], 2.5, 2.5, open)).toMatchObject({ localityName: 'Small Neighbourhood', sourceQuality: 'polygon', packId: 'TN' });
    expect(await resolveLocality([tn], 5, 5, open)).toMatchObject({ localityName: 'Big Village', localityType: 'village' });
  });

  it('falls back to the nearest named settlement inside the state and never returns boundaries', async () => {
    const tn = await standardPack();
    const match = await resolveLocality([tn], 7.9, 7.9, open);
    expect(match).toMatchObject({ localityName: 'Town Centre', localityType: 'Town', sourceQuality: 'nearest-place', district: 'District' });
  });

  it('returns null outside every installed state boundary', async () => {
    const tn = await standardPack();
    expect(await resolveLocality([tn], 20, 20, open)).toBeNull();
    expect(isInsidePackState(tn.stateRings, 20, 20)).toBe(false);
  });

  it('visits packs in ID order and continues past packs that do not contain the point', async () => {
    const kerala = await pack('KL', [
      { id: 1, name: 'Kerala', type: 'administrative_boundary', adminLevel: '4', rings: [square(10, 10, 20, 20)] },
      { id: 2, name: 'Kerala Village', type: 'village', rings: [square(11, 11, 12, 12)] },
    ]);
    const overlapping = await pack('AA', [
      { id: 1, name: 'Overlap', type: 'administrative_boundary', adminLevel: '4', rings: [square(0, 0, 10, 10)] },
      { id: 2, name: 'Overlap Village', type: 'village', rings: [square(4, 4, 6, 6)] },
    ]);
    const tn = await standardPack('TN');
    expect(await resolveLocality([tn, kerala], 11.5, 11.5, open)).toMatchObject({ localityName: 'Kerala Village', packId: 'KL' });
    expect(await resolveLocality([tn, overlapping], 5, 5, open)).toMatchObject({ packId: 'AA', localityName: 'Overlap Village' });
  });

  it('rejects invalid coordinates', async () => {
    await expect(resolveLocality([], 91, 0, open)).rejects.toThrow(RangeError);
  });
});

describe('preparePack', () => {
  async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }).pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (let result = await reader.read(); !result.done; result = await reader.read()) chunks.push(result.value);
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  async function fixture(): Promise<{ pack: RemotePack; compressed: Uint8Array }> {
    const db = await buildFixturePack({ packId: 'TN', places: [{ id: 1, name: 'TN', type: 'administrative_boundary', adminLevel: '4', rings: [square(0, 0, 1, 1)] }] });
    const raw = db.export();
    const compressed = await gzip(raw);
    const pack: RemotePack = {
      id: 'TN',
      name: 'Tamil Nadu',
      version: 3,
      region: 'south',
      displayOrder: 1,
      downloadUrl: 'https://example.com/TN.db.gz',
      sha256: await sha256HexOfBytes(compressed),
      compressedBytes: compressed.byteLength,
      uncompressedBytes: raw.byteLength,
      countryCode: 'IN',
      countryName: 'India',
      packType: 'state_ut',
      adminCode: null,
      layout: 'REGIONS',
      sourceOrder: 0,
    };
    return { pack, compressed };
  }

  const openDatabase = async (bytes: Uint8Array) => {
    const SQL = await testSqlJs();
    const db = new SQL.Database(bytes);
    return { db: wrapDatabase(db), close: () => db.close() };
  };

  it('verifies, decompresses and validates a pack', async () => {
    const { pack, compressed } = await fixture();
    const phases: string[] = [];
    const prepared = await preparePack(pack, pack.downloadUrl, {
      signal: new AbortController().signal,
      onPhase: (phase) => phases.push(phase),
      fetchBytes: async () => compressed,
      openDatabase,
    });
    expect(prepared.bytes.byteLength).toBe(pack.uncompressedBytes);
    expect(prepared.validated.stateRings).toHaveLength(1);
    expect(new Set(phases)).toEqual(new Set(['download', 'verify', 'decompress', 'validate']));
  });

  it('rejects checksum mismatches before decompression', async () => {
    const { pack, compressed } = await fixture();
    const opened = vi.fn(openDatabase);
    await expect(
      preparePack({ ...pack, sha256: 'b'.repeat(64) }, pack.downloadUrl, {
        signal: new AbortController().signal,
        onPhase: () => undefined,
        fetchBytes: async () => compressed,
        openDatabase: opened,
      }),
    ).rejects.toThrow(/SHA-256 mismatch/);
    expect(opened).not.toHaveBeenCalled();
  });

  it('rejects decompression beyond the declared size and invalid gzip', async () => {
    const { pack, compressed } = await fixture();
    const deps = { signal: new AbortController().signal, onPhase: () => undefined, fetchBytes: async () => compressed, openDatabase };
    await expect(preparePack({ ...pack, uncompressedBytes: 10 }, pack.downloadUrl, deps)).rejects.toThrow(/larger than declared/);
    const garbage = new Uint8Array([1, 2, 3, 4]);
    await expect(
      preparePack({ ...pack, sha256: await sha256HexOfBytes(garbage) }, pack.downloadUrl, { ...deps, fetchBytes: async () => garbage }),
    ).rejects.toThrow(/gzip/);
  });

  it('stops when cancelled', async () => {
    const { pack, compressed } = await fixture();
    const controller = new AbortController();
    await expect(
      preparePack(pack, pack.downloadUrl, {
        signal: controller.signal,
        onPhase: () => undefined,
        fetchBytes: async () => {
          controller.abort();
          return compressed;
        },
        openDatabase,
      }),
    ).rejects.toThrow();
  });

  it('rejects packs whose metadata ID differs from the manifest', async () => {
    const { pack, compressed } = await fixture();
    await expect(
      preparePack({ ...pack, id: 'KL' }, pack.downloadUrl, {
        signal: new AbortController().signal,
        onPhase: () => undefined,
        fetchBytes: async () => compressed,
        openDatabase,
      }),
    ).rejects.toThrow(/does not match/);
  });
});
