import { inject, Service, signal } from '@angular/core';
import type { SelectedLocation } from '../models/location';
import type { LocalityMatch } from '../offline-resolver/offline-locality-resolver';
import { OfflineLocalityService } from '../offline-resolver/offline-locality.service';
import { RecentLookupsService } from './recent-lookups.service';

export type LocalityState =
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | { readonly status: 'resolved'; readonly match: LocalityMatch }
  | { readonly status: 'not-installed'; readonly installedCount: number }
  | { readonly status: 'error'; readonly message: string };

/** The location currently being discussed, shared by Easy Location, the map and the dashboard. */
@Service()
export class LocationSelectionService {
  private readonly resolver = inject(OfflineLocalityService);
  private readonly recent = inject(RecentLookupsService);
  private readonly selectedState = signal<SelectedLocation | null>(null);
  private readonly localityState = signal<LocalityState>({ status: 'idle' });
  private generation = 0;

  readonly selected = this.selectedState.asReadonly();
  readonly locality = this.localityState.asReadonly();

  select(location: SelectedLocation, options: { remember?: boolean } = {}): void {
    this.selectedState.set(location);
    if (options.remember !== false) void this.recent.remember(location).catch(() => undefined);
    void this.resolve(location);
  }

  clear(): void {
    this.generation++;
    this.selectedState.set(null);
    this.localityState.set({ status: 'idle' });
  }

  /** Re-runs lookup, e.g. after packs are installed. */
  refreshLocality(): void {
    const current = this.selectedState();
    if (current) void this.resolve(current);
  }

  private async resolve(location: SelectedLocation): Promise<void> {
    const generation = ++this.generation;
    this.localityState.set({ status: 'resolving' });
    try {
      const result = await this.resolver.resolve(location.latitude, location.longitude);
      if (generation !== this.generation) return;
      this.localityState.set(
        result.match ? { status: 'resolved', match: result.match } : { status: 'not-installed', installedCount: result.installedCount },
      );
    } catch (error) {
      if (generation !== this.generation) return;
      this.localityState.set({ status: 'error', message: error instanceof Error ? error.message : 'Offline lookup failed' });
    }
  }
}
