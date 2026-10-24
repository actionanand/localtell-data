import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DropboxAuthService } from '../../core/dropbox/dropbox-auth.service';
import { DropboxBackupService, type RemoteOffer } from '../../core/dropbox/dropbox-backup.service';
import type { DropboxRemoteFile } from '../../core/dropbox/dropbox-policy';
import { MANAGED_DIRECTORY } from '../../core/dropbox/dropbox-policy';
import { AppDataService, RestoreCapacityError } from '../../core/backup/app-data.service';
import { BackupFileFormat, BackupValidationError, describeBackupError, encodeBackup, MAX_BACKUP_BYTES } from '../../core/backup/backup-codec';
import { isBackupEmpty, type AppBackupData, type AppRestorePlan } from '../../core/backup/app-backup-data';
import { SavedPlacesService } from '../../core/saved-places/saved-places.service';
import { NotificationService } from '../../core/ui/notification.service';
import { ConnectivityService } from '../../core/ui/connectivity.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { Icon } from '../../shared/components/icon';
import { RestorePreview } from './restore-preview';

interface FileImport {
  readonly name: string;
  readonly data: AppBackupData;
  readonly plan: AppRestorePlan;
}

@Component({
  selector: 'app-backup-sync',
  imports: [DatePipe, DecimalPipe, RouterLink, ConfirmDialog, Icon, RestorePreview],
  templateUrl: './backup-sync.html',
})
export class BackupSync {
  private readonly router = inject(Router);
  protected readonly auth = inject(DropboxAuthService);
  protected readonly backup = inject(DropboxBackupService);
  protected readonly appData = inject(AppDataService);
  protected readonly savedPlaces = inject(SavedPlacesService);
  private readonly notifications = inject(NotificationService);
  protected readonly online = inject(ConnectivityService).online;
  protected readonly managedDirectory = MANAGED_DIRECTORY;

  /** `?sync=1` from the dashboard “Sync now” quick action. */
  readonly sync = input<string | undefined>();

  protected readonly rememberSignIn = signal(false);
  protected readonly confirmDisconnect = signal(false);
  protected readonly offer = signal<RemoteOffer | null>(null);
  protected readonly fileImport = signal<FileImport | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly working = signal(false);
  protected readonly showJourneys = signal(false);
  protected readonly connection = this.auth.connection;
  protected readonly meta = this.backup.meta;
  protected readonly journeyCount = computed(() => this.appData.journeys().length);
  protected readonly statusText = computed(() => {
    switch (this.backup.status()) {
      case 'in-sync':
        return 'This browser and the newest Dropbox backup contain the same data.';
      case 'local-changes':
        return 'This browser has changes that are not in Dropbox yet.';
      case 'remote-changes':
        return 'Dropbox has a newer backup than this browser.';
      case 'both-changed':
        return 'Both this browser and Dropbox changed. Sync Now will ask you how to proceed.';
      case 'remote-empty':
        return 'Dropbox has no LocalTell backup with data yet.';
      default:
        return 'Not checked yet.';
    }
  });

  constructor() {
    let synced = false;
    effect(() => {
      if (this.sync() === '1' && this.auth.connected() && !synced) {
        synced = true;
        void this.syncNow();
        void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      }
    });
    effect(() => {
      if (this.auth.connected()) void this.backup.loadMeta();
      else this.backup.clearView();
    });
  }

  protected connect(): void {
    this.error.set(null);
    void this.auth.connect(this.rememberSignIn()).catch((error: unknown) => {
      this.error.set(error instanceof Error ? error.message : 'Dropbox sign-in could not start.');
    });
  }

  protected async disconnect(): Promise<void> {
    this.confirmDisconnect.set(false);
    this.offer.set(null);
    await this.auth.disconnect();
    this.backup.clearView();
  }

  protected async syncNow(): Promise<void> {
    await this.run(async () => {
      const outcome = await this.backup.sync();
      switch (outcome.kind) {
        case 'up-to-date':
          this.notifications.show('Already up to date. Nothing was uploaded.', 'success');
          break;
        case 'uploaded':
          this.notifications.show(`Backup ${outcome.file.name} uploaded and verified.`, 'success');
          break;
        case 'nothing-to-back-up':
          this.notifications.show('There is nothing to back up yet.', 'info');
          break;
        case 'remote-changed':
          this.notifications.show('Dropbox changed while syncing. Nothing was overwritten; check again.', 'warning');
          break;
        case 'offer':
          this.offer.set(outcome.offer);
          break;
      }
    });
  }

  protected async check(): Promise<void> {
    await this.run(async () => {
      await this.backup.check();
    });
  }

  protected async refresh(): Promise<void> {
    await this.run(() => this.backup.refresh());
  }

  protected async inspect(file: DropboxRemoteFile): Promise<void> {
    await this.run(async () => this.offer.set(await this.backup.inspect(file)));
  }

  /** Restore/merge the offered backup locally. `upload` additionally backs up the merged result. */
  protected async applyOffer(upload: boolean): Promise<void> {
    const offer = this.offer();
    if (!offer) return;
    await this.run(async () => {
      const result = await this.backup.applyOffer(offer, upload);
      this.offer.set(null);
      if (result === 'changed') this.notifications.show('Local or Dropbox data changed before restoring. Nothing was written; run Sync Now again.', 'warning');
      else this.notifications.show(result === 'restored' ? 'Backup restored into this browser.' : 'Backup merged and uploaded.', 'success');
    });
  }

  protected async keepLocal(): Promise<void> {
    const offer = this.offer();
    if (!offer) return;
    await this.run(async () => {
      const result = await this.backup.uploadLocal(offer.remoteStateToken);
      this.offer.set(null);
      this.notifications.show(
        result === 'uploaded'
          ? 'This browser’s data was uploaded as a new backup. The other backup was left untouched.'
          : 'Dropbox changed in the meantime. Nothing was uploaded; run Sync Now again.',
        result === 'uploaded' ? 'success' : 'warning',
      );
    });
  }

  protected async exportFile(): Promise<void> {
    try {
      const data = await this.appData.snapshot();
      if (isBackupEmpty(data)) {
        this.notifications.show('There is nothing to back up yet.', 'info');
        return;
      }
      const contents = await encodeBackup(data, Date.now());
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = BackupFileFormat.filename(new Date());
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.notifications.show('Backup file created. Keep it private: it contains unencrypted locations.', 'success');
    } catch (error) {
      this.notifications.show(describeBackupError(error), 'error');
    }
  }

  protected async importFile(event: Event): Promise<void> {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = '';
    if (!file) return;
    this.error.set(null);
    try {
      BackupFileFormat.requireFilename(file.name);
      if (file.size > MAX_BACKUP_BYTES) throw new BackupValidationError('The backup is larger than the 12 MiB limit.');
      const decoded = await BackupFileFormat.decode(file.name, new Uint8Array(await file.arrayBuffer()));
      this.fileImport.set({ name: file.name, data: decoded.data, plan: await this.appData.preview(decoded.data, 'file') });
    } catch (error) {
      this.error.set(describeBackupError(error));
    }
  }

  protected async confirmFileImport(): Promise<void> {
    const pending = this.fileImport();
    if (!pending) return;
    try {
      await this.appData.applyRestore(pending.data, 'file');
      this.fileImport.set(null);
      this.notifications.show('Backup file restored.', 'success');
    } catch (error) {
      this.fileImport.set(null);
      this.error.set(error instanceof RestoreCapacityError ? error.message : 'The backup could not be restored. Nothing was changed.');
    }
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.working.set(true);
    try {
      await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The Dropbox operation failed.');
    } finally {
      this.working.set(false);
    }
  }
}
