import { Component, computed, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LocationSelectionService } from '../../core/location/location-selection.service';
import { BrowserGeolocationService } from '../../core/geolocation/browser-geolocation.service';
import { IpGeolocationService } from '../../core/ip-geolocation/ip-geolocation.service';
import { SavedPlacesService } from '../../core/saved-places/saved-places.service';
import { PackCatalogService } from '../../core/geographic-packs/pack-catalog.service';
import { DropboxAuthService } from '../../core/dropbox/dropbox-auth.service';
import { DropboxBackupService } from '../../core/dropbox/dropbox-backup.service';
import { selectedLocation } from '../../core/models/location';
import { formatFixed } from '../../core/maps-links/map-link-builder';
import { NotificationService } from '../../core/ui/notification.service';
import { Icon } from '../../shared/components/icon';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, Icon, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly router = inject(Router);
  private readonly selection = inject(LocationSelectionService);
  private readonly geolocation = inject(BrowserGeolocationService);
  private readonly notifications = inject(NotificationService);
  protected readonly ip = inject(IpGeolocationService);
  protected readonly savedPlaces = inject(SavedPlacesService);
  protected readonly packs = inject(PackCatalogService);
  protected readonly dropbox = inject(DropboxAuthService);
  protected readonly backup = inject(DropboxBackupService);

  protected readonly device = this.geolocation.current;
  protected readonly selected = this.selection.selected;
  protected readonly locality = this.selection.locality;
  protected readonly fixed = formatFixed;
  protected readonly installedCount = computed(() => this.packs.installed().length);
  protected readonly installedNames = computed(() =>
    this.packs
      .installed()
      .slice(0, 6)
      .map((pack) => pack.name)
      .join(', '),
  );

  protected async detect(): Promise<void> {
    const state = await this.geolocation.locate();
    if (state.status === 'located') {
      this.selection.select(
        selectedLocation(state.fix.latitude, state.fix.longitude, 'device', {
          accuracyMetres: state.fix.accuracyMetres,
          label: 'My device location',
          observedAt: state.fix.timestamp,
        }),
      );
    }
  }

  protected async syncNow(): Promise<void> {
    if (!this.dropbox.connected()) {
      await this.router.navigate(['/backup']);
      return;
    }
    await this.router.navigate(['/backup'], { queryParams: { sync: '1' } });
  }

  protected openSelected(): void {
    if (!this.selected()) {
      this.notifications.show('Select or decode a location first.', 'info');
      return;
    }
    void this.router.navigate(['/easy']);
  }
}
