import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { form, FormField } from '@angular/forms/signals';
import { BrowserGeolocationService } from '../../core/geolocation/browser-geolocation.service';
import { IpGeolocationService } from '../../core/ip-geolocation/ip-geolocation.service';
import { ObservationsService, type ObservationPoint } from '../../core/observations/observations.service';
import { PreferencesService } from '../../core/settings/preferences.service';
import { LocationSelectionService } from '../../core/location/location-selection.service';
import { selectedLocation } from '../../core/models/location';
import { haversineMetres } from '../../core/offline-resolver/geometry';
import { formatFixed } from '../../core/maps-links/map-link-builder';
import { NotificationService } from '../../core/ui/notification.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { MapView, type MapMarker } from '../../shared/components/map-view';
import { Icon } from '../../shared/components/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-location-comparison',
  imports: [FormField, DatePipe, DecimalPipe, ConfirmDialog, MapView, Icon, RouterLink],
  templateUrl: './location-comparison.html',
  styles: `
    .history {
      margin-top: 1rem;
    }
  `,
})
export class LocationComparison {
  private readonly geolocation = inject(BrowserGeolocationService);
  protected readonly ip = inject(IpGeolocationService);
  protected readonly observations = inject(ObservationsService);
  private readonly preferences = inject(PreferencesService);
  private readonly selection = inject(LocationSelectionService);
  private readonly notifications = inject(NotificationService);

  protected readonly device = this.geolocation.current;
  protected readonly ipState = this.ip.current;
  protected readonly fixed = formatFixed;
  protected readonly showDisclosure = signal(false);
  protected readonly labelModel = signal({ label: '' });
  protected readonly labelForm = form(this.labelModel);
  protected readonly pendingClear = signal(false);

  protected readonly deviceFix = computed(() => {
    const state = this.device();
    return state.status === 'located' ? state.fix : null;
  });
  protected readonly ipLocation = computed(() => {
    const state = this.ipState();
    return state.status === 'located' ? state.location : null;
  });
  protected readonly ipPlace = computed(() => {
    const location = this.ipLocation();
    return location ? [location.city, location.region, location.country].filter((part) => part !== null).join(', ') || 'Unknown' : '';
  });
  protected readonly distanceKm = computed(() => {
    const device = this.deviceFix();
    const ip = this.ipLocation();
    return device && ip ? haversineMetres(device.latitude, device.longitude, ip.latitude, ip.longitude) / 1000 : null;
  });
  protected readonly markers = computed<MapMarker[]>(() => {
    const markers: MapMarker[] = [];
    const device = this.deviceFix();
    const ip = this.ipLocation();
    if (device) markers.push({ id: 'device', latitude: device.latitude, longitude: device.longitude, kind: 'device', label: 'Device location', accuracyMetres: device.accuracyMetres });
    if (ip) markers.push({ id: 'ip', latitude: ip.latitude, longitude: ip.longitude, kind: 'ip', label: `Approximate IP location (${ip.provider})` });
    return markers;
  });

  protected detectDevice(): void {
    void this.geolocation.locate();
  }

  protected requestIp(): void {
    if (!this.preferences.preferences().ipDisclosureAccepted) {
      this.showDisclosure.set(true);
      return;
    }
    void this.ip.lookup();
  }

  protected async acceptDisclosure(): Promise<void> {
    this.showDisclosure.set(false);
    await this.preferences.update({ ipDisclosureAccepted: true }).catch(() => undefined);
    void this.ip.lookup();
  }

  protected useLocation(source: 'device' | 'ip'): void {
    const device = this.deviceFix();
    const ip = this.ipLocation();
    if (source === 'device' && device) {
      this.selection.select(selectedLocation(device.latitude, device.longitude, 'device', { accuracyMetres: device.accuracyMetres, label: 'My device location', observedAt: device.timestamp }));
    } else if (source === 'ip' && ip) {
      this.selection.select(selectedLocation(ip.latitude, ip.longitude, 'ip', { label: `Approximate IP location (${ip.city ?? ip.country ?? ip.provider})` }));
    }
    this.notifications.show('Location selected. Open Easy Location to see its codes.', 'info');
  }

  protected async saveComparison(): Promise<void> {
    const points: ObservationPoint[] = [];
    const device = this.deviceFix();
    const ip = this.ipLocation();
    if (device) {
      points.push({ source: 'device', latitude: device.latitude, longitude: device.longitude, accuracyMetres: device.accuracyMetres, provider: 'Browser geolocation', country: null, region: null, city: null, observedAt: device.timestamp });
    }
    if (ip) {
      points.push({ source: 'ip', latitude: ip.latitude, longitude: ip.longitude, accuracyMetres: null, provider: ip.provider, country: ip.country, region: ip.region, city: ip.city, observedAt: ip.timestamp });
    }
    if (points.length === 0) return;
    const distance = this.distanceKm();
    try {
      await this.observations.save({ label: this.labelModel().label, points, distanceMetres: distance === null ? null : distance * 1000 });
      this.labelModel.set({ label: '' });
      this.notifications.show('Comparison saved in this browser.', 'success');
    } catch {
      this.notifications.show('The comparison could not be saved.', 'error');
    }
  }

  protected async clearHistory(): Promise<void> {
    this.pendingClear.set(false);
    await this.observations.clear();
    this.notifications.show('Comparison history cleared.', 'success');
  }
}
