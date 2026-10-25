import { afterNextRender, Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { LocationSelectionService } from '../../core/location/location-selection.service';
import { selectedLocation, type LocationOrigin } from '../../core/models/location';
import { BrowserGeolocationService } from '../../core/geolocation/browser-geolocation.service';
import { formatFixed } from '../../core/maps-links/map-link-builder';
import { LocationResult } from '../../shared/components/location-result';
import { MapView, type MapMarker } from '../../shared/components/map-view';
import { Icon } from '../../shared/components/icon';
import { interpretInput } from './interpret-input';
import { AnnouncementCard } from '../../shared/components/announcement-card';

const ORIGIN_MARKER: Partial<Record<LocationOrigin, MapMarker['kind']>> = {
  'numeric-code': 'decoded',
  'short-code': 'decoded',
  device: 'device',
  ip: 'ip',
  'saved-place': 'saved',
};

@Component({
  selector: 'app-easy-location',
  imports: [FormField, LocationResult, MapView, Icon, AnnouncementCard],
  templateUrl: './easy-location.html',
})
export class EasyLocation {
  private readonly selection = inject(LocationSelectionService);
  private readonly geolocation = inject(BrowserGeolocationService);
  private readonly inputElement = viewChild.required<ElementRef<HTMLInputElement>>('queryInput');

  /** Optional `?q=` deep link, e.g. from the dashboard “Decode a code” action. */
  readonly q = input<string | undefined>();

  protected readonly model = signal({ query: '' });
  protected readonly queryForm = form(this.model);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<{ latitude: number; longitude: number; message: string } | null>(null);
  protected readonly selected = this.selection.selected;
  protected readonly locality = this.selection.locality;
  protected readonly device = this.geolocation.current;
  protected readonly markers = computed<MapMarker[]>(() => {
    const pending = this.pending();
    if (pending) return [{ id: 'pending', latitude: pending.latitude, longitude: pending.longitude, kind: 'selected', label: 'Unconfirmed point' }];
    const location = this.selected();
    if (!location) return [];
    return [
      {
        id: 'current',
        latitude: location.encoded.latitude,
        longitude: location.encoded.longitude,
        kind: ORIGIN_MARKER[location.origin] ?? 'selected',
        label: location.label ?? 'Selected location',
        accuracyMetres: location.accuracyMetres,
      },
    ];
  });
  protected readonly pendingText = computed(() => {
    const pending = this.pending();
    return pending ? `${formatFixed(pending.latitude, 6)}, ${formatFixed(pending.longitude, 6)}` : '';
  });

  constructor() {
    afterNextRender(() => this.inputElement().nativeElement.focus());
    effect(() => {
      const query = this.q();
      if (query) {
        this.model.set({ query });
        this.submit();
      }
    });
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    const text = this.model().query;
    this.pending.set(null);
    const result = interpretInput(text);
    if (result.kind === 'error') {
      this.error.set(result.message);
      return;
    }
    this.error.set(null);
    if (result.kind === 'confirm') {
      this.pending.set({ latitude: result.latitude, longitude: result.longitude, message: result.message });
      return;
    }
    this.selection.select(selectedLocation(result.latitude, result.longitude, result.origin, { label: this.labelFor(result.origin) }));
  }

  protected confirmPending(): void {
    const pending = this.pending();
    if (!pending) return;
    this.pending.set(null);
    this.selection.select(selectedLocation(pending.latitude, pending.longitude, 'maps-link', { label: 'Confirmed map point' }));
  }

  protected onMapClick(point: { latitude: number; longitude: number }): void {
    this.pending.set(null);
    this.error.set(null);
    this.selection.select(selectedLocation(point.latitude, point.longitude, 'map-click', { label: 'Selected on the map' }));
  }

  protected async detect(): Promise<void> {
    const state = await this.geolocation.locate();
    if (state.status === 'located') {
      this.error.set(null);
      this.selection.select(
        selectedLocation(state.fix.latitude, state.fix.longitude, 'device', {
          accuracyMetres: state.fix.accuracyMetres,
          label: 'My device location',
          observedAt: state.fix.timestamp,
        }),
      );
    }
  }

  protected clear(): void {
    this.selection.clear();
    this.model.set({ query: '' });
    this.error.set(null);
    this.pending.set(null);
    this.inputElement().nativeElement.focus();
  }

  private labelFor(origin: LocationOrigin): string {
    switch (origin) {
      case 'numeric-code':
      case 'short-code':
        return 'Decoded caller location';
      case 'maps-link':
        return 'Google Maps location';
      default:
        return 'Entered coordinates';
    }
  }
}
