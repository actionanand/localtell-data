import { Service, signal } from '@angular/core';
import { clearStore, getAll, openDatabase, requestToPromise, transaction } from '../storage/idb';
import type { LocationOrigin, SelectedLocation } from '../models/location';

export interface RecentLookup {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly origin: LocationOrigin;
  readonly label: string | null;
  readonly createdAt: number;
}

const MAX_RECENT = 25;

/** Local-only history of decoded/selected locations; never uploaded or included in `.bklt`. */
@Service()
export class RecentLookupsService {
  private readonly items = signal<readonly RecentLookup[]>([]);
  readonly recent = this.items.asReadonly();

  async load(): Promise<void> {
    const all = await getAll<RecentLookup>('recentLookups');
    this.items.set(all.sort((a, b) => b.createdAt - a.createdAt));
  }

  async remember(location: SelectedLocation): Promise<void> {
    if (location.origin === 'recent') return;
    const entry: RecentLookup = {
      id: crypto.randomUUID(),
      latitude: location.encoded.latitude,
      longitude: location.encoded.longitude,
      origin: location.origin,
      label: location.label,
      createdAt: location.observedAt,
    };
    await openDatabase();
    await transaction('recentLookups', 'readwrite', async (tx) => {
      const store = tx.objectStore('recentLookups');
      await requestToPromise(store.put(entry));
      const all = (await requestToPromise(store.getAll())) as RecentLookup[];
      const excess = all.sort((a, b) => b.createdAt - a.createdAt).slice(MAX_RECENT);
      for (const old of excess) await requestToPromise(store.delete(old.id));
    });
    await this.load();
  }

  async clear(): Promise<void> {
    await clearStore('recentLookups');
    this.items.set([]);
  }
}
