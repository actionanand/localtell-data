import type { AppConfig } from '../app/core/config/app-config';
import { clearStore, STORE_NAMES } from '../app/core/storage/idb';

export const TEST_CONFIG: AppConfig = {
  production: false,
  manifestSources: [
    {
      countryCode: 'IN',
      countryName: 'India',
      packType: 'state_ut',
      layout: 'REGIONS',
      manifestUrl: 'https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/manifest.json',
    },
  ],
  downloadMirrors: [{ from: 'https://github.com/actionanand/localtell-data/releases/download/', to: 'data-mirror/' }],
  tiles: { urlTemplate: 'https://tile.example.test/{z}/{x}/{y}.png', attribution: 'Test tiles', maxZoom: 19 },
  ipGeolocation: { provider: 'none', providerName: 'none', privacyUrl: 'https://example.test/privacy' },
  dropbox: { appKey: '', redirectUri: '' },
  limits: { maxSavedPlaces: 30, maxJourneyPoints: 100 },
  features: { cloudBackup: true, serviceWorker: false },
};

export function testConfig(change: Partial<AppConfig> = {}): AppConfig {
  return { ...TEST_CONFIG, ...change };
}

/** Clears every IndexedDB store so each test starts from an empty browser profile. */
export async function resetDatabase(): Promise<void> {
  for (const store of STORE_NAMES) await clearStore(store);
}
