import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { LocationSelectionService } from '../../core/location/location-selection.service';
import { selectedLocation } from '../../core/models/location';
import { SavedPlacesService } from '../../core/saved-places/saved-places.service';
import { BrowserGeolocationService } from '../../core/geolocation/browser-geolocation.service';
import { IpGeolocationService } from '../../core/ip-geolocation/ip-geolocation.service';
import { LocationResult } from '../../shared/components/location-result';
import { MapView, type MapMarker } from '../../shared/components/map-view';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-interactive-map',
  imports: [LocationResult, MapView, Icon],
  template: `
    <header class="page-header">
      <h1>Interactive Map</h1>
      <p>Click anywhere (or use “Select map centre”) to generate both LocalTell codes for that point.</p>
    </header>
    <div class="split">
      <section class="card" aria-labelledby="map-title">
        <h2 id="map-title" class="visually-hidden">Map</h2>
        <label class="checkbox small">
          <input type="checkbox" [checked]="showSaved()" (change)="showSaved.set(!showSaved())" />
          <span>Show saved places ({{ savedCount() }})</span>
        </label>
        <app-map-view [markers]="markers()" [activeId]="activeId()" [selectable]="true" ariaLabel="Interactive LocalTell map" (mapClick)="select($event)" />
      </section>
      <div class="stack">
        @if (selected(); as location) {
          <app-location-result [location]="location" [locality]="locality()" (cleared)="selection.clear()" />
        } @else {
          <section class="card">
            <h2><app-icon name="target" /> Nothing selected</h2>
            <p class="muted">Select a point on the map to see its codes, offline locality and Google Maps links.</p>
          </section>
        }
      </div>
    </div>
  `,
})
export class InteractiveMap {
  protected readonly selection = inject(LocationSelectionService);
  private readonly savedPlaces = inject(SavedPlacesService);
  private readonly device = inject(BrowserGeolocationService).current;
  private readonly ip = inject(IpGeolocationService).current;

  /** `?saved=<id>` opens a saved place. */
  readonly saved = input<string | undefined>();

  protected readonly showSaved = signal(true);
  protected readonly selected = this.selection.selected;
  protected readonly locality = this.selection.locality;
  protected readonly savedCount = computed(() => this.savedPlaces.places().length);
  protected readonly activeId = computed(() => (this.selected() ? 'selected' : null));
  protected readonly markers = computed<MapMarker[]>(() => {
    const markers: MapMarker[] = [];
    if (this.showSaved()) {
      for (const place of this.savedPlaces.places()) {
        markers.push({ id: `saved-${place.id}`, latitude: place.latitude, longitude: place.longitude, kind: 'saved', label: place.displayName });
      }
    }
    const device = this.device();
    if (device.status === 'located') {
      markers.push({ id: 'device', latitude: device.fix.latitude, longitude: device.fix.longitude, kind: 'device', label: 'My device location', accuracyMetres: device.fix.accuracyMetres });
    }
    const ip = this.ip();
    if (ip.status === 'located') {
      markers.push({ id: 'ip', latitude: ip.location.latitude, longitude: ip.location.longitude, kind: 'ip', label: `Approximate IP location (${ip.location.provider})` });
    }
    const location = this.selected();
    if (location) {
      const decoded = location.origin === 'numeric-code' || location.origin === 'short-code';
      markers.push({
        id: 'selected',
        latitude: location.encoded.latitude,
        longitude: location.encoded.longitude,
        kind: decoded ? 'decoded' : 'selected',
        label: location.label ?? 'Selected location',
      });
    }
    return markers;
  });

  constructor() {
    let handled: string | null = null;
    effect(() => {
      const id = this.saved();
      const place = id ? this.savedPlaces.places().find((entry) => entry.id === id) : undefined;
      if (place && handled !== place.id) {
        handled = place.id;
        this.selection.select(
          selectedLocation(place.latitude, place.longitude, 'saved-place', {
            label: place.displayName,
            savedPlaceId: place.id,
            accuracyMetres: place.accuracyMetres,
          }),
          { remember: false },
        );
      }
    });
  }

  protected select(point: { latitude: number; longitude: number }): void {
    this.selection.select(selectedLocation(point.latitude, point.longitude, 'map-click', { label: 'Selected on the map' }));
  }
}
