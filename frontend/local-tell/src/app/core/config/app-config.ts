import { InjectionToken } from '@angular/core';
import type { CountryManifestSource } from '../geographic-packs/pack-manifest';

export interface DownloadMirror {
  /** Exact absolute URL prefix found in published manifests. */
  readonly from: string;
  /** Replacement prefix, relative to the document base URL or absolute (same-origin recommended). */
  readonly to: string;
}

export interface TileProviderConfig {
  readonly urlTemplate: string;
  readonly attribution: string;
  readonly maxZoom: number;
  readonly subdomains?: string;
}

export type IpProviderId = 'ipapi-co' | 'ipwho-is' | 'none';

export interface IpGeolocationConfig {
  readonly provider: IpProviderId;
  /** Shown in the privacy disclosure before any request is sent. */
  readonly providerName: string;
  readonly privacyUrl: string;
}

export interface DropboxConfig {
  /** Public OAuth client identifier (App key). Never put the app secret in browser configuration. */
  readonly appKey: string;
  /** Absolute redirect URI; empty means `<origin><base href>dropbox/callback`. */
  readonly redirectUri: string;
}

export interface AppConfig {
  readonly production: boolean;
  readonly manifestSources: readonly Omit<CountryManifestSource, 'sourceOrder'>[];
  readonly downloadMirrors: readonly DownloadMirror[];
  readonly tiles: TileProviderConfig;
  readonly ipGeolocation: IpGeolocationConfig;
  readonly dropbox: DropboxConfig;
  /** Android app-config.json `maxSavedPlaces` / `maxJourneyPoints`. */
  readonly limits: { readonly maxSavedPlaces: number; readonly maxJourneyPoints: number };
  readonly features: { readonly cloudBackup: boolean; readonly serviceWorker: boolean };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

export function isDropboxAppKey(value: string): boolean {
  return /^[a-z0-9]{8,32}$/i.test(value);
}

export function manifestSources(config: AppConfig): CountryManifestSource[] {
  return config.manifestSources.map((source, sourceOrder) => ({ ...source, sourceOrder }));
}

/** Validates deployment configuration at start-up so a typo fails loudly instead of silently. */
export function validateAppConfig(config: AppConfig): AppConfig {
  const problems: string[] = [];
  if (!(config.limits.maxSavedPlaces >= 1 && config.limits.maxSavedPlaces <= 200)) problems.push('limits.maxSavedPlaces must be 1-200');
  if (!(config.limits.maxJourneyPoints >= 1 && config.limits.maxJourneyPoints <= 1000)) problems.push('limits.maxJourneyPoints must be 1-1000');
  for (const source of config.manifestSources) {
    if (!source.manifestUrl.startsWith('https://')) problems.push(`Manifest URL must use HTTPS: ${source.countryCode}`);
    if (source.layout === 'REGIONS' && source.countryCode !== 'IN') problems.push(`Regional layout is only defined for IN`);
  }
  if (!/^https:\/\//.test(config.tiles.urlTemplate)) problems.push('Tile URL template must use HTTPS');
  const unconfigured = config.dropbox.appKey.endsWith('_PLACEHOLDER');
  if (config.dropbox.appKey && !unconfigured && !isDropboxAppKey(config.dropbox.appKey)) problems.push('Dropbox app key looks invalid');
  if (problems.length > 0) throw new Error(`Invalid LocalTell configuration: ${problems.join('; ')}`);
  return unconfigured ? { ...config, dropbox: { ...config.dropbox, appKey: '' } } : config;
}
