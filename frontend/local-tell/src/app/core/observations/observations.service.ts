import { Service, signal } from '@angular/core';
import { clearStore, deleteOne, getAll, putOne } from '../storage/idb';

export type ObservationSource = 'device' | 'ip';

export interface ObservationPoint {
  readonly source: ObservationSource;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMetres: number | null;
  readonly provider: string;
  readonly country: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly observedAt: number;
}

/**
 * A saved device-versus-IP comparison. Web-only data: kept in its own store and never written to
 * Android-compatible `.bklt` backups.
 */
export interface LocationObservation {
  readonly id: string;
  readonly createdAt: number;
  readonly label: string | null;
  readonly points: readonly ObservationPoint[];
  readonly distanceMetres: number | null;
}

@Service()
export class ObservationsService {
  private readonly items = signal<readonly LocationObservation[]>([]);
  readonly observations = this.items.asReadonly();

  async load(): Promise<void> {
    const all = await getAll<LocationObservation>('observations');
    this.items.set(all.sort((a, b) => b.createdAt - a.createdAt));
  }

  async save(observation: Omit<LocationObservation, 'id' | 'createdAt'>): Promise<void> {
    const label = observation.label?.trim().slice(0, 120) || null;
    await putOne<LocationObservation>('observations', { ...observation, label, id: crypto.randomUUID(), createdAt: Date.now() });
    await this.load();
  }

  async delete(id: string): Promise<void> {
    await deleteOne('observations', id);
    await this.load();
  }

  async clear(): Promise<void> {
    await clearStore('observations');
    this.items.set([]);
  }
}
