import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasm from 'sql.js/dist/sql-wasm-browser.wasm';

let sql: Promise<SqlJsStatic> | null = null;

export function testSqlJs(): Promise<SqlJsStatic> {
  sql ??= initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  return sql;
}

export interface FixturePlace {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly adminLevel?: string | null;
  readonly district?: string | null;
  readonly state?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly rings?: readonly string[];
}

/** Builds a schema-v3 geographic pack with the same DDL as published LocalTell packs. */
export async function buildFixturePack(options: {
  packId: string;
  schemaVersion?: string;
  places: readonly FixturePlace[];
  omitGeometryTable?: boolean;
}): Promise<Database> {
  const SQL = await testSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE pack_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  db.run(
    'CREATE TABLE place (id INTEGER PRIMARY KEY, name TEXT NOT NULL, place_type TEXT NOT NULL, admin_level TEXT NULL, sub_district TEXT, district TEXT, state TEXT, state_code TEXT, latitude REAL, longitude REAL)',
  );
  if (!options.omitGeometryTable) {
    db.run(
      'CREATE TABLE place_geometry (id INTEGER PRIMARY KEY, place_id INTEGER NOT NULL, geometry TEXT NOT NULL, FOREIGN KEY(place_id) REFERENCES place(id))',
    );
  }
  db.run("INSERT INTO pack_meta VALUES ('schema_version', ?), ('pack_id', ?)", [options.schemaVersion ?? '3', options.packId]);
  let geometryId = 1;
  for (const place of options.places) {
    db.run('INSERT INTO place VALUES (?,?,?,?,?,?,?,?,?,?)', [
      place.id,
      place.name,
      place.type,
      place.adminLevel ?? null,
      null,
      place.district ?? 'District',
      place.state ?? 'State',
      'ST',
      place.latitude ?? null,
      place.longitude ?? null,
    ]);
    if (!options.omitGeometryTable) {
      for (const ring of place.rings ?? []) db.run('INSERT INTO place_geometry VALUES (?,?,?)', [geometryId++, place.id, ring]);
    }
  }
  return db;
}

export const square = (minLat: number, minLng: number, maxLat: number, maxLng: number) =>
  `${minLat},${minLng};${minLat},${maxLng};${maxLat},${maxLng};${maxLat},${minLng};${minLat},${minLng}`;
