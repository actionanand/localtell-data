import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { SavedPlacesService } from '../../core/saved-places/saved-places.service';
import type { SavedPlace } from '../../core/saved-places/saved-place';
import { encode } from '../../core/location-code/local-tell-location-code';
import { formatFixed, googleMapsUrl } from '../../core/maps-links/map-link-builder';
import { ClipboardService } from '../../core/ui/clipboard.service';
import { NotificationService } from '../../core/ui/notification.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { Icon } from '../../shared/components/icon';

type SortOrder = 'newest' | 'oldest' | 'name-asc' | 'name-desc';

interface PlaceView {
  readonly place: SavedPlace;
  readonly numericCode: string;
  readonly shortCode: string;
  readonly coordinates: string;
  readonly hierarchy: string;
  readonly mapsUrl: string;
}

const SOURCE_LABELS: Readonly<Record<SavedPlace['source'], string>> = {
  HOME: 'Home screen (Android)',
  EASY: 'Device location',
  LOOKUP: 'Lookup / map',
  JOURNEY: 'Journey (Android)',
};

@Component({
  selector: 'app-saved-places',
  imports: [FormField, RouterLink, DatePipe, ConfirmDialog, Icon],
  templateUrl: './saved-places.html',
  styles: `
    .place-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .filters {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(10rem, 1fr);
      gap: 0.75rem;
    }
    @media (max-width: 600px) {
      .filters {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class SavedPlaces {
  protected readonly saved = inject(SavedPlacesService);
  private readonly clipboard = inject(ClipboardService);
  private readonly notifications = inject(NotificationService);
  protected readonly sourceLabels = SOURCE_LABELS;

  protected readonly filterModel = signal({ query: '', sort: 'newest' as SortOrder });
  protected readonly filterForm = form(this.filterModel);
  protected readonly renameModel = signal({ name: '' });
  protected readonly renameForm = form(this.renameModel, (path) => maxLength(path.name, 200));
  protected readonly renaming = signal<string | null>(null);
  protected readonly renameError = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);
  protected readonly pendingDelete = signal<SavedPlace | null>(null);

  protected readonly views = computed<PlaceView[]>(() => {
    const { query, sort } = this.filterModel();
    const needle = query.trim().toLowerCase();
    const filtered = this.saved
      .places()
      .filter((place) =>
        needle.length === 0
          ? true
          : [place.displayName, place.localityName, place.subDistrict, place.district, place.state, place.countryCode]
              .filter((value): value is string => value !== null)
              .some((value) => value.toLowerCase().includes(needle)),
      );
    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.savedAt - b.savedAt;
        case 'name-asc':
          return a.displayName.localeCompare(b.displayName);
        case 'name-desc':
          return b.displayName.localeCompare(a.displayName);
        default:
          return b.savedAt - a.savedAt;
      }
    });
    return sorted.map((place) => {
      const encoded = encode(place.latitude, place.longitude);
      return {
        place,
        numericCode: encoded.numericCode,
        shortCode: encoded.shortCode,
        coordinates: `${formatFixed(place.latitude, 6)}, ${formatFixed(place.longitude, 6)}`,
        hierarchy: [place.subDistrict, place.district, place.state, place.countryCode].filter((part) => part !== null).join(', '),
        mapsUrl: googleMapsUrl(place.latitude, place.longitude),
      };
    });
  });

  protected copy(text: string, label: string): void {
    void this.clipboard.copy(text, label);
  }

  protected startRename(place: SavedPlace): void {
    this.renaming.set(place.id);
    this.renameError.set(null);
    this.renameModel.set({ name: place.displayName });
  }

  protected async commitRename(event: Event, place: SavedPlace): Promise<void> {
    event.preventDefault();
    try {
      await this.saved.rename(place.id, this.renameModel().name);
      this.renaming.set(null);
      this.notifications.show('Place renamed.', 'success');
    } catch (error) {
      this.renameError.set(error instanceof Error ? error.message : 'Rename failed.');
    }
  }

  protected async confirmDelete(): Promise<void> {
    const place = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!place) return;
    try {
      await this.saved.delete([place.id]);
      this.notifications.show(`Deleted “${place.displayName}”.`, 'success');
    } catch {
      this.notifications.show('The place could not be deleted.', 'error');
    }
  }
}
