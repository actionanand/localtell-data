/// <reference lib="webworker" />
import type { Database } from 'sql.js';
import { getAll, getOne } from '../storage/idb';
import { loadSqlJs, wrapDatabase } from './sqljs-database';
import { coveringPackIds, resolveLocality, type PackDatabase, type ResolverCandidate } from './offline-locality-resolver';
import type { InstalledPackRecord, PackFileRecord, ResolverWorkerRequest, ResolverWorkerResponse } from '../geographic-packs/pack-records';

const MAX_OPEN_DATABASES = 3;
const open = new Map<string, { db: Database; wrapped: PackDatabase }>();

function cacheKey(record: InstalledPackRecord): string {
  return `${record.id}:${record.version}:${record.installedAt}`;
}

function invalidate(): void {
  for (const entry of open.values()) entry.db.close();
  open.clear();
}

async function openPack(record: InstalledPackRecord, wasmUrl: string): Promise<PackDatabase> {
  const key = cacheKey(record);
  const cached = open.get(key);
  if (cached) {
    open.delete(key);
    open.set(key, cached);
    return cached.wrapped;
  }
  const file = await getOne<PackFileRecord>('packFiles', record.id);
  if (!file || file.version !== record.version || file.installedAt !== record.installedAt) {
    throw new Error(`Installed pack ${record.name} is missing its database. Remove and download it again.`);
  }
  const SQL = await loadSqlJs(wasmUrl);
  const db = new SQL.Database(new Uint8Array(file.bytes));
  const entry = { db, wrapped: wrapDatabase(db) };
  open.set(key, entry);
  while (open.size > MAX_OPEN_DATABASES) {
    const [oldestKey, oldest] = open.entries().next().value as [string, { db: Database }];
    oldest.db.close();
    open.delete(oldestKey);
  }
  return entry.wrapped;
}

addEventListener('message', ({ data }: MessageEvent<ResolverWorkerRequest>) => {
  if (data.type === 'invalidate') {
    invalidate();
    return;
  }
  void (async () => {
    try {
      const records = await getAll<InstalledPackRecord>('installedPacks');
      const byId = new Map(records.map((record) => [record.id, record]));
      const candidates: ResolverCandidate[] = records.map((record) => ({ id: record.id, version: record.version, stateRings: record.stateRings }));
      const match = await resolveLocality(candidates, data.latitude, data.longitude, (pack) =>
        openPack(byId.get(pack.id) as InstalledPackRecord, data.wasmUrl),
      );
      const response: ResolverWorkerResponse = {
        type: 'resolved',
        requestId: data.requestId,
        result: { match, installedCount: records.length, coveringPackIds: coveringPackIds(candidates, data.latitude, data.longitude) },
      };
      postMessage(response);
    } catch (error) {
      const response: ResolverWorkerResponse = {
        type: 'failed',
        requestId: data.requestId,
        message: error instanceof Error ? error.message : 'Offline locality lookup failed',
      };
      postMessage(response);
    }
  })();
});
