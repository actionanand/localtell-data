import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ORIGIN_LABELS, type SelectedLocation } from '../../core/models/location';
import type { LocalityState } from '../../core/location/location-selection.service';
import { coordinateText, formatFixed, googleMapsDirectionsUrl, googleMapsUrl } from '../../core/maps-links/map-link-builder';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { SavedPlacesService } from '../../core/saved-places/saved-places.service';
import { savedPlaceFor, type SavedPlaceSource } from '../../core/saved-places/saved-place';
import { NotificationService } from '../../core/ui/notification.service';
import { Icon } from './icon';
import { RouterLink } from '@angular/router';
import { GeographyGuidance } from './geography-guidance';

/** Result panel: both codes, coordinates, offline locality and every quick action. */
@Component({
  selector: 'app-location-result',
  imports: [Icon, RouterLink, GeographyGuidance],
  template: `
    @let loc = location();
    <section class="card result" aria-labelledby="result-title">
      <h2 id="result-title">{{ loc.label ?? 'Location' }}</h2>
      <p class="small muted">
        Source: <strong>{{ originLabel() }}</strong>
        @if (loc.accuracyMetres !== null) {
          · accuracy about {{ accuracyText() }}
        }
        @if (loc.origin === 'ip') {
          · <span class="badge badge-warning">Approximate</span>
        }
      </p>

      <app-geography-guidance />
      <dl class="kv">
        <dt>19-digit code</dt>
        <dd><span class="code-value" data-testid="numeric-code">{{ loc.encoded.numericCode }}</span></dd>
        <dt>15-character code</dt>
        <dd><span class="code-value" data-testid="short-code">{{ loc.encoded.shortCode }}</span></dd>
        <dt>Latitude</dt>
        <dd data-testid="latitude">{{ latitude() }}</dd>
        <dt>Longitude</dt>
        <dd data-testid="longitude">{{ longitude() }}</dd>
        <dt>Locality</dt>
        <dd>
          @switch (locality().status) {
            @case ('resolving') {
              <span class="muted">Looking up offline data…</span>
            }
            @case ('resolved') {
              @if (match(); as m) {
                <strong>{{ m.localityName }}</strong>
                @if (m.localityType) {
                  <span class="muted"> ({{ m.localityType }})</span>
                }
                <br />
                <span class="small">{{ hierarchy() }}</span>
                <br />
                <span class="small muted"
                  >From pack {{ m.packId }} v{{ m.packVersion }} ·
                  {{ m.sourceQuality === 'polygon' ? 'inside settlement boundary' : 'nearest named settlement' }}</span
                >
              }
            }
            @case ('not-installed') {
              <span>Offline locality data is not installed for this location.</span>
              <a routerLink="/offline-data" class="small"> Download offline data</a>
            }
            @case ('error') {
              <span class="muted">Offline lookup unavailable: {{ localityError() }}</span>
            }
            @default {
              <span class="muted">—</span>
            }
          }
        </dd>
      </dl>

      <div class="row" role="group" aria-label="Copy">
        <button type="button" class="btn btn-small" (click)="copy(loc.encoded.numericCode, 'Numeric code')">
          <app-icon name="copy" /> Copy 19-digit code
        </button>
        <button type="button" class="btn btn-small" (click)="copy(loc.encoded.shortCode, 'Short code')">
          <app-icon name="copy" /> Copy short code
        </button>
        <button type="button" class="btn btn-small" (click)="copy(coordinates(), 'Coordinates')"><app-icon name="copy" /> Copy coordinates</button>
        <button type="button" class="btn btn-small" (click)="copy(mapsUrl(), 'Google Maps link')"><app-icon name="copy" /> Copy Maps link</button>
      </div>
      <div class="row actions" role="group" aria-label="Open and save">
        <a class="btn btn-primary" [href]="mapsUrl()" target="_blank" rel="noopener noreferrer" data-testid="open-maps">
          <app-icon name="external" /> Open in Google Maps
        </a>
        <a class="btn" [href]="directionsUrl()" target="_blank" rel="noopener noreferrer"><app-icon name="directions" /> Directions</a>
        <button type="button" class="btn" (click)="save()" [disabled]="saving() || alreadySaved()" data-testid="save-location">
          <app-icon name="bookmark" /> {{ alreadySaved() ? 'Saved' : 'Save location' }}
        </button>
        @if (canShare) {
          <button type="button" class="btn" (click)="share()"><app-icon name="share" /> Share</button>
        }
        <button type="button" class="btn" (click)="cleared.emit()"><app-icon name="close" /> Clear</button>
      </div>
    </section>
  `,
  styles: `
    .actions {
      margin-top: 0.75rem;
    }
  `,
})
export class LocationResult {
  private readonly clipboard = inject(ClipboardService);
  private readonly savedPlaces = inject(SavedPlacesService);
  private readonly notifications = inject(NotificationService);

  readonly location = input.required<SelectedLocation>();
  readonly locality = input<LocalityState>({ status: 'idle' });
  readonly cleared = output<void>();

  protected readonly saving = signal(false);
  protected readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  protected readonly originLabel = computed(() => ORIGIN_LABELS[this.location().origin]);
  protected readonly latitude = computed(() => formatFixed(this.location().encoded.latitude, 6));
  protected readonly longitude = computed(() => formatFixed(this.location().encoded.longitude, 6));
  protected readonly coordinates = computed(() => coordinateText(this.location().encoded.latitude, this.location().encoded.longitude));
  protected readonly mapsUrl = computed(() => googleMapsUrl(this.location().encoded.latitude, this.location().encoded.longitude));
  protected readonly directionsUrl = computed(() => googleMapsDirectionsUrl(this.location().encoded.latitude, this.location().encoded.longitude));
  protected readonly accuracyText = computed(() => {
    const accuracy = this.location().accuracyMetres ?? 0;
    return accuracy >= 1000 ? `${(accuracy / 1000).toFixed(1)} km` : `${Math.round(accuracy)} m`;
  });
  protected readonly match = computed(() => {
    const state = this.locality();
    return state.status === 'resolved' ? state.match : null;
  });
  protected readonly localityError = computed(() => {
    const state = this.locality();
    return state.status === 'error' ? state.message : '';
  });
  protected readonly hierarchy = computed(() => {
    const match = this.match();
    return match ? [match.subDistrict, match.district, match.state].filter((part) => part !== null).join(', ') : '';
  });
  private readonly candidate = computed(() => {
    const location = this.location();
    const match = this.match();
    const source: SavedPlaceSource = location.origin === 'device' ? 'EASY' : 'LOOKUP';
    return savedPlaceFor({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMetres: location.accuracyMetres,
      source,
      name: match?.localityName ?? null,
      subDistrict: match?.subDistrict ?? null,
      district: match?.district ?? null,
      state: match?.state ?? null,
      now: location.observedAt,
    });
  });
  protected readonly alreadySaved = computed(() => {
    const candidate = this.candidate();
    this.savedPlaces.places();
    return this.location().savedPlaceId !== null || (candidate !== null && this.savedPlaces.findMatch(candidate) !== undefined);
  });

  protected copy(text: string, label: string): void {
    void this.clipboard.copy(text, label);
  }

  protected async save(): Promise<void> {
    const candidate = this.candidate();
    if (!candidate) {
      this.notifications.show('This location cannot be saved.', 'error');
      return;
    }
    this.saving.set(true);
    try {
      const result = await this.savedPlaces.save({ ...candidate, savedAt: Date.now() });
      if (result === 'Saved') this.notifications.show(`Saved “${candidate.displayName}”.`, 'success');
      else if (result === 'Duplicate') this.notifications.show('This place is already saved.', 'info');
      else this.notifications.show(`Saved Places is full (${this.savedPlaces.limit}). Delete a place before saving another.`, 'warning');
    } catch {
      this.notifications.show('The place could not be saved. Browser storage may be unavailable.', 'error');
    } finally {
      this.saving.set(false);
    }
  }

  protected async share(): Promise<void> {
    const location = this.location();
    try {
      await navigator.share({
        title: 'LocalTell location',
        text: `LocalTell code ${location.encoded.shortCode} (${location.encoded.numericCode}) — ${this.coordinates()}`,
        url: this.mapsUrl(),
      });
    } catch {
      // The user cancelled the share sheet or sharing is blocked; nothing to report.
    }
  }
}
