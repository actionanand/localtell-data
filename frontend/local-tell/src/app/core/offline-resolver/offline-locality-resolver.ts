import { kotlinIsBlank } from '../location-code/local-tell-location-code';
import {
  boundingBoxArea,
  comparePolygonOrder,
  haversineMetres,
  NEAREST_PLACE_TYPES,
  polygonContains,
  polygonOrder,
  POLYGON_PLACE_TYPES,
  type PolygonOrder,
} from './geometry';

/** Android `LocalityMatch`. */
export interface LocalityMatch {
  readonly localityName: string;
  readonly localityType: string | null;
  readonly subDistrict: string | null;
  readonly district: string | null;
  readonly state: string | null;
  readonly stateCode: string | null;
  readonly sourceQuality: 'polygon' | 'nearest-place';
  readonly packId: string;
  readonly packVersion: number;
}

export type SqlValue = number | string | Uint8Array | null;

/** Minimal synchronous SQLite surface; implemented with sql.js in the worker and in tests. */
export interface PackDatabase {
  query(sql: string, params?: readonly SqlValue[]): SqlValue[][];
}

export interface ResolverPack {
  readonly id: string;
  readonly version: number;
}

/** Android `OfflinePackSchema`: only schema 3 is geographic; the browser has no cellular identity. */
export const GEOGRAPHIC_SCHEMA_VERSION = 3;
export const GEOGRAPHIC_REQUIRED_TABLES = ['place', 'place_geometry'] as const;
const LEGACY_SCHEMAS: Readonly<Record<number, string>> = { 1: 'legacy cell (schema 1)', 2: 'tower cell (schema 2)' };

export class PackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackValidationError';
  }
}

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(',');
}

function asText(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
}

function nonBlank(value: SqlValue | undefined): string | null {
  const text = asText(value);
  return text === null || kotlinIsBlank(text) ? null : text;
}

/** `SELECT value FROM pack_meta WHERE key='schema_version'` parsed with Kotlin `toIntOrNull`. */
export function schemaVersion(db: PackDatabase): number | null {
  const rows = db.query("SELECT value FROM pack_meta WHERE key='schema_version'");
  if (rows.length === 0) return null;
  const text = asText(rows[0][0]);
  return text !== null && /^[+-]?\d{1,10}$/.test(text) && Math.abs(Number(text)) <= 2 ** 31 - 1 ? Number(text) : null;
}

export function hasTables(db: PackDatabase, ...tables: string[]): boolean {
  return tables.every(
    (table) => db.query("SELECT 1 FROM sqlite_master WHERE type IN ('table','virtual table') AND name=?", [table]).length > 0,
  );
}

export function hasColumn(db: PackDatabase, table: string, column: string): boolean {
  return db.query(`PRAGMA table_info(${table})`).some((row) => row[1] === column);
}

export interface ValidatedPack {
  readonly schemaVersion: number;
  readonly meta: Readonly<Record<string, string>>;
  /** Level-4 state/province boundary rings used to skip packs that cannot contain a coordinate. */
  readonly stateRings: readonly string[];
}

/** Android `PackDownloader.validateDatabase` plus the resolver's schema-v3 column contract. */
export function validateGeographicPack(db: PackDatabase): ValidatedPack {
  let integrity: SqlValue[][];
  try {
    integrity = db.query('PRAGMA integrity_check');
  } catch (error) {
    throw new PackValidationError(`Downloaded SQLite database failed integrity check: ${String(error)}`);
  }
  if (integrity.length === 0 || integrity[0][0] !== 'ok') {
    throw new PackValidationError('Downloaded SQLite database failed integrity check');
  }
  if (!hasTables(db, 'pack_meta')) throw new PackValidationError('Offline pack schema is missing');
  const version = schemaVersion(db);
  if (version === null) throw new PackValidationError('Offline pack schema is missing');
  if (version !== GEOGRAPHIC_SCHEMA_VERSION) {
    const legacy = LEGACY_SCHEMAS[version];
    throw new PackValidationError(
      legacy ? `This pack uses the ${legacy} format, which needs Android cellular data and cannot be used in a browser.` : 'Unsupported offline pack schema',
    );
  }
  for (const table of GEOGRAPHIC_REQUIRED_TABLES) {
    if (!hasTables(db, table)) throw new PackValidationError(`Offline pack is missing required table: ${table}`);
  }
  if (!hasColumn(db, 'place', 'admin_level')) throw new PackValidationError('Offline pack is missing place.admin_level');
  const meta: Record<string, string> = {};
  for (const [key, value] of db.query('SELECT key, value FROM pack_meta')) {
    if (typeof key === 'string' && typeof value === 'string') meta[key] = value;
  }
  return { schemaVersion: version, meta, stateRings: stateRings(db) };
}

export function stateRings(db: PackDatabase): string[] {
  return db
    .query(
      `SELECT g.geometry
       FROM place_geometry g
       JOIN place p ON p.id=g.place_id
       WHERE lower(p.place_type)='administrative_boundary' AND p.admin_level='4'
       ORDER BY g.id ASC`,
    )
    .map((row) => asText(row[0]) ?? '');
}

/** Android `isInsidePackState`: a schema-v3 pack only resolves inside its level-4 extent. */
export function isInsidePackState(rings: readonly string[], latitude: number, longitude: number): boolean {
  return rings.some((ring) => polygonContains(latitude, longitude, ring));
}

function toMatch(row: SqlValue[], pack: ResolverPack, quality: LocalityMatch['sourceQuality'], offset: number): LocalityMatch {
  return {
    localityName: asText(row[offset]) ?? '',
    localityType: nonBlank(row[offset + 1]),
    subDistrict: nonBlank(row[offset + 2]),
    district: nonBlank(row[offset + 3]),
    state: nonBlank(row[offset + 4]),
    stateCode: nonBlank(row[offset + 5]),
    sourceQuality: quality,
    packId: pack.id,
    packVersion: pack.version,
  };
}

/** Android `resolvePolygon`: scan settlement rings without the optional RTree module. */
export function resolvePolygon(db: PackDatabase, pack: ResolverPack, latitude: number, longitude: number): LocalityMatch | null {
  const rows = db.query(
    `SELECT p.id,g.id,p.name,p.place_type,p.sub_district,p.district,p.state,p.state_code,g.geometry
     FROM place_geometry g
     JOIN place p ON p.id=g.place_id
     WHERE lower(p.place_type) IN (${sqlList(POLYGON_PLACE_TYPES)})
     ORDER BY p.id ASC, g.id ASC`,
  );
  let bestMatch: LocalityMatch | null = null;
  let bestOrder: PolygonOrder | null = null;
  for (const row of rows) {
    const geometry = asText(row[8]);
    if (!polygonContains(latitude, longitude, geometry)) continue;
    const order = polygonOrder(asText(row[3]), boundingBoxArea(geometry), Number(row[1]), Number(row[0]));
    if (bestOrder === null || comparePolygonOrder(order, bestOrder) < 0) {
      bestOrder = order;
      bestMatch = toMatch(row, pack, 'polygon', 2);
    }
  }
  return bestMatch;
}

/** Android `resolveNearestPlace`: 16 planar candidates, then haversine with an ID tie-break. */
export function resolveNearestPlace(db: PackDatabase, pack: ResolverPack, latitude: number, longitude: number): LocalityMatch | null {
  const rows = db.query(
    `SELECT id,name,place_type,sub_district,district,state,state_code,latitude,longitude
     FROM place
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       AND lower(place_type) IN (${sqlList(NEAREST_PLACE_TYPES)})
     ORDER BY ((latitude-?)*(latitude-?))+((longitude-?)*(longitude-?)), id
     LIMIT 16`,
    [latitude, latitude, longitude, longitude],
  );
  let nearest: LocalityMatch | null = null;
  let nearestDistance = Number.MAX_VALUE;
  let nearestId = Number.MAX_SAFE_INTEGER;
  for (const row of rows) {
    const id = Number(row[0]);
    const distance = haversineMetres(latitude, longitude, Number(row[7]), Number(row[8]));
    if (distance < nearestDistance || (distance === nearestDistance && id < nearestId)) {
      nearestDistance = distance;
      nearestId = id;
      nearest = toMatch(row, pack, 'nearest-place', 1);
    }
  }
  return nearest;
}

export interface ResolverCandidate extends ResolverPack {
  readonly stateRings: readonly string[];
}

/**
 * Android `OfflineLocalityResolver.resolve`: packs are visited in ID order (PackStore sorts by ID);
 * the first pack whose state contains the point and yields a polygon or nearest place wins.
 */
export async function resolveLocality(
  packs: readonly ResolverCandidate[],
  latitude: number,
  longitude: number,
  open: (pack: ResolverCandidate) => Promise<PackDatabase>,
): Promise<LocalityMatch | null> {
  if (!(latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180)) throw new RangeError('Invalid coordinate');
  const ordered = [...packs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const pack of ordered) {
    if (!isInsidePackState(pack.stateRings, latitude, longitude)) continue;
    const db = await open(pack);
    const match = resolvePolygon(db, pack, latitude, longitude) ?? resolveNearestPlace(db, pack, latitude, longitude);
    if (match !== null) return match;
  }
  return null;
}

export function coveringPackIds(packs: readonly ResolverCandidate[], latitude: number, longitude: number): string[] {
  return packs.filter((pack) => isInsidePackState(pack.stateRings, latitude, longitude)).map((pack) => pack.id);
}
