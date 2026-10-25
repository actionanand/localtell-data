import { Service, signal } from '@angular/core';

export interface DeviceFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMetres: number | null;
  readonly timestamp: number;
}

export type DeviceLocationState =
  | { readonly status: 'idle' }
  | { readonly status: 'locating' }
  | { readonly status: 'located'; readonly fix: DeviceFix }
  | { readonly status: 'error'; readonly reason: DeviceLocationError; readonly message: string };

export type DeviceLocationError = 'insecure-context' | 'unsupported' | 'permission-denied' | 'unavailable' | 'timeout';

export const DEVICE_LOCATION_TIMEOUT_MS = 20_000;

/**
 * One-shot browser geolocation (`getCurrentPosition`). There is no continuous tracking. The browser
 * may derive the fix from GPS, Wi-Fi, cellular or network information; it is not necessarily GPS.
 */
@Service()
export class BrowserGeolocationService {
  private readonly state = signal<DeviceLocationState>({ status: 'idle' });
  readonly current = this.state.asReadonly();

  locate(): Promise<DeviceLocationState> {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      return Promise.resolve(this.fail('insecure-context', 'Device location requires HTTPS (or localhost).'));
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return Promise.resolve(this.fail('unsupported', 'This browser does not support device location.'));
    }
    this.state.set({ status: 'locating' });
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const fix: DeviceFix = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMetres: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
            timestamp: position.timestamp,
          };
          const located: DeviceLocationState = { status: 'located', fix };
          this.state.set(located);
          resolve(located);
        },
        (error) => {
          switch (error.code) {
            case error.PERMISSION_DENIED:
              resolve(this.fail('permission-denied', 'Location permission was denied. Allow location for this site in your browser settings to use this feature.'));
              break;
            case error.TIMEOUT:
              resolve(this.fail('timeout', 'The browser did not return a location in time. Try again, ideally with Wi-Fi or GPS enabled.'));
              break;
            default:
              resolve(this.fail('unavailable', 'The browser could not determine your location.'));
          }
        },
        { enableHighAccuracy: true, timeout: DEVICE_LOCATION_TIMEOUT_MS, maximumAge: 0 },
      );
    });
  }

  private fail(reason: DeviceLocationError, message: string): DeviceLocationState {
    const state: DeviceLocationState = { status: 'error', reason, message };
    this.state.set(state);
    return state;
  }
}
