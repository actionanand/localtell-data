import { computed, inject, Service, signal } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import { getAll, requestToPromise, transaction } from '../storage/idb';
import { classifySavedPlace, SavedPlaceIdentity, type SaveResult, type SavedPlace } from './saved-place';
import { kotlinIsBlank } from '../location-code/local-tell-location-code';

/** Android ordering: `saved_at DESC, id DESC`. */
export function compareSavedPlaces(a: SavedPlace, b: SavedPlace): number {
  return b.savedAt - a.savedAt || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
}

@Service()
export class SavedPlacesService {
  private readonly config = inject(APP_CONFIG);
  private readonly items = signal<readonly SavedPlace[]>([]);
  private readonly loadedState = signal(false);
  readonly places = this.items.asReadonly();
  readonly loaded = this.loadedState.asReadonly();
  readonly limit = this.config.limits.maxSavedPlaces;
  readonly overLimit = computed(() => this.items().length > this.limit);
  readonly full = computed(() => this.items().length >= this.limit);

  async load(): Promise<void> {
    const all = await getAll<SavedPlace>('savedPlaces');
    this.items.set([...all].sort(compareSavedPlaces));
    this.loadedState.set(true);
  }

  /** Classifies against committed records inside the write transaction, like Android `save`. */
  async save(place: SavedPlace): Promise<SaveResult> {
    if (!SavedPlaceIdentity.valid(place)) throw new RangeError('Invalid saved place');
    const result = await transaction('savedPlaces', 'readwrite', async (tx) => {
      const store = tx.objectStore('savedPlaces');
      const existing = (await requestToPromise(store.getAll())) as SavedPlace[];
      const classification = classifySavedPlace(existing, place, this.limit);
      if (classification === 'Saved') await requestToPromise(store.add(place));
      return classification;
    });
    await this.load();
    return result;
  }

  findMatch(place: SavedPlace): SavedPlace | undefined {
    return this.items().find((existing) => SavedPlaceIdentity.matches(existing, place) || existing.id === place.id);
  }

  async rename(id: string, displayName: string): Promise<void> {
    const name = displayName.trim();
    await transaction('savedPlaces', 'readwrite', async (tx) => {
      const store = tx.objectStore('savedPlaces');
      const current = (await requestToPromise(store.get(id))) as SavedPlace | undefined;
      if (!current) throw new Error('This saved place no longer exists.');
      const renamed: SavedPlace = { ...current, displayName: name };
      if (kotlinIsBlank(name) || !SavedPlaceIdentity.valid(renamed)) {
        throw new RangeError('Names must be 1-200 characters without control characters.');
      }
      await requestToPromise(store.put(renamed));
    });
    await this.load();
  }

  async delete(ids: readonly string[]): Promise<void> {
    await transaction('savedPlaces', 'readwrite', async (tx) => {
      const store = tx.objectStore('savedPlaces');
      for (const id of ids) await requestToPromise(store.delete(id));
    });
    await this.load();
  }
}
