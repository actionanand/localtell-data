import { inject, Service, signal } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import { clearStore, getAll, requestToPromise, transaction } from '../storage/idb';
import { MAX_SAVED_BOUND, SavedPlaceIdentity, type SavedPlace } from '../saved-places/saved-place';
import { SavedPlacesService } from '../saved-places/saved-places.service';
import {
  compareJourneyStored,
  isBackupEmpty,
  planAppRestore,
  type AppBackupData,
  type AppRestorePlan,
  type DataLimits,
  type JourneyPoint,
} from './app-backup-data';

export type RestoreMode = 'file' | 'dropbox';

export class RestoreCapacityError extends Error {
  constructor(readonly plan: AppRestorePlan) {
    super('The backup has more new saved places than the configured limit allows. Nothing was restored.');
    this.name = 'RestoreCapacityError';
  }
}

/**
 * Saved Places + Journey snapshot and restore for `.bklt` interoperability.
 * Both datasets are read and written in single IndexedDB transactions, mirroring Android's attached
 * SQLite transaction: a failure leaves both stores unchanged.
 */
@Service()
export class AppDataService {
  private readonly config = inject(APP_CONFIG);
  private readonly savedPlaces = inject(SavedPlacesService);
  private readonly journeyItems = signal<readonly JourneyPoint[]>([]);
  readonly journeys = this.journeyItems.asReadonly();

  /** Dropbox merges may keep unique Saved Places up to the absolute 200-record bound (Android). */
  limits(mode: RestoreMode): DataLimits {
    return {
      maxSavedPlaces: mode === 'dropbox' ? MAX_SAVED_BOUND : this.config.limits.maxSavedPlaces,
      maxJourneyPoints: this.config.limits.maxJourneyPoints,
    };
  }

  async loadJourneys(): Promise<void> {
    const all = await getAll<JourneyPoint>('journeys');
    this.journeyItems.set([...all].sort(compareJourneyStored));
  }

  async snapshot(): Promise<AppBackupData> {
    return transaction(['savedPlaces', 'journeys'], 'readonly', async (tx) => {
      const savedPlaces = (await requestToPromise(tx.objectStore('savedPlaces').getAll())) as SavedPlace[];
      const journeys = (await requestToPromise(tx.objectStore('journeys').getAll())) as JourneyPoint[];
      return { savedPlaces, journeys: journeys.sort(compareJourneyStored) };
    });
  }

  async preview(incoming: AppBackupData, mode: RestoreMode): Promise<AppRestorePlan> {
    return planAppRestore(await this.snapshot(), incoming, this.limits(mode));
  }

  /**
   * Replans against committed data inside the write transaction, checks capacity before any write,
   * inserts both datasets and applies Journey retention atomically.
   */
  async applyRestore(incoming: AppBackupData, mode: RestoreMode, options: { requireEmpty?: boolean } = {}): Promise<AppRestorePlan | null> {
    const limits = this.limits(mode);
    const plan = await transaction(['savedPlaces', 'journeys'], 'readwrite', async (tx) => {
      const savedStore = tx.objectStore('savedPlaces');
      const journeyStore = tx.objectStore('journeys');
      const current: AppBackupData = {
        savedPlaces: (await requestToPromise(savedStore.getAll())) as SavedPlace[],
        journeys: (await requestToPromise(journeyStore.getAll())) as JourneyPoint[],
      };
      if (options.requireEmpty && !isBackupEmpty(current)) return null;
      const restorePlan = planAppRestore(current, incoming, limits);
      if (!restorePlan.saved.fits) throw new RestoreCapacityError(restorePlan);
      const additions = incoming.savedPlaces.filter(
        (candidate) => !current.savedPlaces.some((existing) => SavedPlaceIdentity.matches(existing, candidate)),
      );
      for (const place of additions) await requestToPromise(savedStore.add(place));
      for (const point of restorePlan.journey.insertions) await requestToPromise(journeyStore.add(withoutLocalId(point)));
      const all = ((await requestToPromise(journeyStore.getAll())) as JourneyPoint[]).sort(compareJourneyStored);
      for (const evicted of all.slice(limits.maxJourneyPoints)) await requestToPromise(journeyStore.delete(evicted.id));
      return restorePlan;
    });
    await Promise.all([this.savedPlaces.load(), this.loadJourneys()]);
    return plan;
  }

  async clearJourneys(): Promise<void> {
    await clearStore('journeys');
    await this.loadJourneys();
  }
}

/** IndexedDB assigns a new auto-increment ID, like Android's SQLite rowid. */
function withoutLocalId(point: JourneyPoint): Omit<JourneyPoint, 'id'> {
  return Object.fromEntries(Object.entries(point).filter(([key]) => key !== 'id')) as Omit<JourneyPoint, 'id'>;
}
