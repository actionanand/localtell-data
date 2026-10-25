import { inject, Service, signal } from '@angular/core';
import { SavedPlacesService } from './saved-places/saved-places.service';
import { PreferencesService } from './settings/preferences.service';
import { PackCatalogService } from './geographic-packs/pack-catalog.service';
import { RecentLookupsService } from './location/recent-lookups.service';
import { ObservationsService } from './observations/observations.service';
import { AppDataService } from './backup/app-data.service';
import { DropboxAuthService } from './dropbox/dropbox-auth.service';
import { DropboxBackupService } from './dropbox/dropbox-backup.service';
import { ConnectivityService } from './ui/connectivity.service';
import { describeStorageError } from './storage/idb';

/** Loads local data without blocking first render; offline features never wait for the network. */
@Service()
export class StartupService {
  private readonly savedPlaces = inject(SavedPlacesService);
  private readonly preferences = inject(PreferencesService);
  private readonly packs = inject(PackCatalogService);
  private readonly recent = inject(RecentLookupsService);
  private readonly observations = inject(ObservationsService);
  private readonly appData = inject(AppDataService);
  private readonly dropboxAuth = inject(DropboxAuthService);
  private readonly dropboxBackup = inject(DropboxBackupService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly storageErrorState = signal<string | null>(null);
  readonly storageError = this.storageErrorState.asReadonly();

  start(): void {
    void this.loadLocal();
    if (!window.location.pathname.endsWith('/dropbox/callback')) void this.startDropbox();
    this.connectivity.onReconnect(() => {
      if (this.preferences.preferences().dropboxCheckOnReconnect && this.dropboxAuth.connected()) {
        void this.dropboxBackup.check().catch(() => undefined);
      }
    });
  }

  private async loadLocal(): Promise<void> {
    try {
      await Promise.all([
        this.savedPlaces.load(),
        this.preferences.load(),
        this.packs.loadInstalled(),
        this.recent.load(),
        this.observations.load(),
        this.appData.loadJourneys(),
      ]);
    } catch (error) {
      this.storageErrorState.set(describeStorageError(error));
    }
  }

  private async startDropbox(): Promise<void> {
    await this.dropboxAuth.initialize();
    if (!this.dropboxAuth.connected()) return;
    await this.dropboxBackup.loadMeta().catch(() => undefined);
    await this.preferences.load().catch(() => undefined);
    if (this.preferences.preferences().dropboxCheckOnOpen) await this.dropboxBackup.check().catch(() => undefined);
  }
}
