import { Component, computed, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { APP_CONFIG } from '../../core/config/app-config';
import { SavedPlacesService } from '../../core/saved-places/saved-places.service';
import { AppDataService } from '../../core/backup/app-data.service';
import { RecentLookupsService } from '../../core/location/recent-lookups.service';
import { ObservationsService } from '../../core/observations/observations.service';
import { PackCatalogService } from '../../core/geographic-packs/pack-catalog.service';
import { PreferencesService, type UserPreferences } from '../../core/settings/preferences.service';
import { DropboxAuthService } from '../../core/dropbox/dropbox-auth.service';
import { NotificationService } from '../../core/ui/notification.service';
import { formatPackBytes } from '../../core/geographic-packs/pack-manifest';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';

type DataCategory = 'saved' | 'journeys' | 'recent' | 'observations' | 'packs';

const CATEGORY_TEXT: Readonly<Record<DataCategory, { title: string; body: string }>> = {
  saved: { title: 'Delete all Saved Places?', body: 'Every saved place in this browser will be deleted. Dropbox backups are not changed.' },
  journeys: { title: 'Delete Journey history?', body: 'Journey records restored from Android backups will be deleted from this browser.' },
  recent: { title: 'Clear recent lookups?', body: 'The local list of recently decoded or selected locations will be cleared.' },
  observations: { title: 'Clear comparison history?', body: 'Saved device/IP location comparisons will be deleted.' },
  packs: { title: 'Remove all offline packs?', body: 'All downloaded geographic packs will be removed. Locality names will need a new download.' },
};

@Component({
  selector: 'app-settings',
  imports: [ConfirmDialog],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly config = inject(APP_CONFIG);
  protected readonly saved = inject(SavedPlacesService);
  protected readonly appData = inject(AppDataService);
  protected readonly recent = inject(RecentLookupsService);
  protected readonly observations = inject(ObservationsService);
  protected readonly packs = inject(PackCatalogService);
  protected readonly preferences = inject(PreferencesService);
  protected readonly dropbox = inject(DropboxAuthService);
  private readonly notifications = inject(NotificationService);
  private readonly updates = inject(SwUpdate);

  protected readonly pending = signal<DataCategory | null>(null);
  protected readonly pendingText = computed(() => {
    const category = this.pending();
    return category ? CATEGORY_TEXT[category] : null;
  });
  protected readonly packBytes = computed(() => formatPackBytes(this.packs.installed().reduce((sum, pack) => sum + pack.sizeBytes, 0)) ?? '0 B');
  protected readonly swEnabled = this.updates.isEnabled;
  protected readonly tileHost = new URL(this.config.tiles.urlTemplate.replace(/\{[a-z]\}/g, 'x')).host;

  protected async toggle(key: keyof UserPreferences): Promise<void> {
    try {
      await this.preferences.update({ [key]: !this.preferences.preferences()[key] });
    } catch {
      this.notifications.show('The preference could not be saved.', 'error');
    }
  }

  protected async confirmDelete(): Promise<void> {
    const category = this.pending();
    this.pending.set(null);
    if (!category) return;
    try {
      switch (category) {
        case 'saved':
          await this.saved.delete(this.saved.places().map((place) => place.id));
          break;
        case 'journeys':
          await this.appData.clearJourneys();
          break;
        case 'recent':
          await this.recent.clear();
          break;
        case 'observations':
          await this.observations.clear();
          break;
        case 'packs':
          await this.packs.remove(this.packs.installed().map((pack) => pack.id));
          break;
      }
      this.notifications.show('Deleted.', 'success');
    } catch {
      this.notifications.show('The data could not be deleted.', 'error');
    }
  }

  protected async checkForUpdate(): Promise<void> {
    try {
      const available = await this.updates.checkForUpdate();
      if (available) {
        this.notifications.show('A new version was downloaded. Reloading…', 'info');
        await this.updates.activateUpdate();
        document.location.reload();
      } else {
        this.notifications.show('You have the latest version.', 'success');
      }
    } catch {
      this.notifications.show('Could not check for updates.', 'warning');
    }
  }
}
