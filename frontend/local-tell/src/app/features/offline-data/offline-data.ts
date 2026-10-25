import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { form, FormField } from '@angular/forms/signals';
import { PackCatalogService } from '../../core/geographic-packs/pack-catalog.service';
import { formatPackBytes, PackCatalog, type CountryPacks, type RegionPacks, type RemotePack } from '../../core/geographic-packs/pack-manifest';
import { ConnectivityService } from '../../core/ui/connectivity.service';
import { NotificationService } from '../../core/ui/notification.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { Icon } from '../../shared/components/icon';
import { AdminCatalog } from './admin-catalog';

interface ConfirmDownload {
  readonly title: string;
  readonly packs: readonly RemotePack[];
}

@Component({
  selector: 'app-offline-data',
  imports: [FormField, ConfirmDialog, Icon, DatePipe, AdminCatalog],
  templateUrl: './offline-data.html',
  styles: `
    .group-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      justify-content: space-between;
      margin: 1rem 0 0.5rem;
    }
  `,
})
export class OfflineData implements OnInit {
  readonly query = input('');
  protected readonly packs = inject(PackCatalogService);
  private readonly notifications = inject(NotificationService);
  protected readonly online = inject(ConnectivityService).online;

  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel);
  protected readonly confirmDownload = signal<ConfirmDownload | null>(null);
  protected readonly confirmDelete = signal<{ ids: readonly string[]; label: string } | null>(null);
  protected readonly formatBytes = (bytes: number | null) => formatPackBytes(bytes) ?? '—';

  protected readonly result = computed(() => {
    const state = this.packs.catalog();
    return state.status === 'loaded' ? state.result : null;
  });
  protected readonly countries = computed(() => {
    const result = this.result();
    return result ? PackCatalog.filterCountries(PackCatalog.countries(result.packs), this.searchModel().query) : [];
  });
  protected readonly allPacks = computed(() => {
    const state = this.packs.catalog();
    if (state.status !== 'loaded') return [];
    return state.result.packs.filter((pack) => !state.result.failedSources.some((failed) => failed.source.countryCode === pack.countryCode)
      && !state.cachedSources.some((cached) => cached.startsWith(pack.countryName + ' (')));
  });
  protected readonly required = computed(() => PackCatalog.requiredPacks(this.allPacks(), this.packs.installedById()));
  protected readonly orphans = computed(() => {
    const known = new Set(this.allPacks().map((pack) => pack.id));
    return this.result() ? this.packs.installed().filter((record) => !known.has(record.id)) : [];
  });
  protected readonly confirmTotals = computed(() => {
    const pending = this.confirmDownload();
    return pending ? PackCatalog.totals(PackCatalog.requiredPacks(pending.packs, this.packs.installedById())) : null;
  });
  protected readonly confirmCount = computed(() => {
    const pending = this.confirmDownload();
    return pending ? PackCatalog.requiredPacks(pending.packs, this.packs.installedById()).length : 0;
  });

  ngOnInit(): void {
    if (this.query()) this.searchModel.set({ query: this.query() });
    void this.packs.refreshStorageEstimate();
    if (this.packs.catalog().status === 'idle') void this.packs.loadCatalog();
  }

  protected regions(country: CountryPacks): RegionPacks[] {
    return PackCatalog.regions(country.packs);
  }

  protected requiredIn(packs: readonly RemotePack[]): number {
    return PackCatalog.requiredPacks(packs, this.packs.installedById()).length;
  }

  protected installedIn(packs: readonly RemotePack[]): string[] {
    return PackCatalog.installedPacks(packs, this.packs.installedById()).map((pack) => pack.id);
  }

  protected askDownload(title: string, packs: readonly RemotePack[]): void {
    if (this.requiredIn(packs) === 0) {
      this.notifications.show('Everything in this selection is already installed and current.', 'info');
      return;
    }
    this.confirmDownload.set({ title, packs });
  }

  protected startConfirmedDownload(): void {
    const pending = this.confirmDownload();
    this.confirmDownload.set(null);
    if (!pending) return;
    void this.packs.requestPersistentStorage();
    const queued = this.packs.enqueue(pending.packs);
    this.notifications.show(`${queued} pack${queued === 1 ? '' : 's'} queued. Downloads run one at a time.`, 'info');
  }

  protected async deleteConfirmed(): Promise<void> {
    const pending = this.confirmDelete();
    this.confirmDelete.set(null);
    if (!pending) return;
    try {
      await this.packs.remove(pending.ids);
      this.notifications.show(`Removed ${pending.label}.`, 'success');
    } catch {
      this.notifications.show('The pack could not be removed from browser storage.', 'error');
    }
  }
}
