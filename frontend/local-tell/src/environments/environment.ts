import type { AppConfig } from '../app/core/config/app-config';
import manifestSources from '../config/manifest-sources.json';

/**
 * Production (GitHub Pages) configuration. Everything here is public: never add secrets.
 * The Dropbox app key is a public OAuth client identifier injected before deployment.
 */
export const environment: AppConfig = {
  production: true,
  manifestSources: manifestSources as AppConfig['manifestSources'],
  // GitHub Release downloads do not send CORS headers; the Pages workflow mirrors verified files here.
  downloadMirrors: [{ from: 'https://github.com/actionanand/localtell-data/releases/download/', to: 'data-mirror/' }],
  tiles: {
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  ipGeolocation: { provider: 'ipapi-co', providerName: 'ipapi.co', privacyUrl: 'https://ipapi.co/privacy/' },
  dropbox: { appKey: 'DROPBOX_APP_KEY_PLACEHOLDER', redirectUri: '' },
  limits: { maxSavedPlaces: 30, maxJourneyPoints: 100 },
  features: { cloudBackup: true, serviceWorker: true },
};
