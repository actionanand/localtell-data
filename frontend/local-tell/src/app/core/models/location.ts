import { encode, type EncodedLocation } from '../location-code/local-tell-location-code';

export type LocationOrigin =
  | 'numeric-code'
  | 'short-code'
  | 'coordinates'
  | 'maps-link'
  | 'map-click'
  | 'device'
  | 'ip'
  | 'saved-place'
  | 'recent';

export const ORIGIN_LABELS: Readonly<Record<LocationOrigin, string>> = {
  'numeric-code': 'Decoded 19-digit LocalTell code',
  'short-code': 'Decoded 15-character LocalTell code',
  coordinates: 'Entered coordinates',
  'maps-link': 'Google Maps link',
  'map-click': 'Selected on the map',
  device: 'Browser device location',
  ip: 'Approximate public-IP location',
  'saved-place': 'Saved place',
  recent: 'Recent lookup',
};

export interface SelectedLocation {
  /** The original coordinate (raw input, map click or provider value) before six-decimal rounding. */
  readonly latitude: number;
  readonly longitude: number;
  readonly encoded: EncodedLocation;
  readonly origin: LocationOrigin;
  readonly accuracyMetres: number | null;
  readonly observedAt: number;
  readonly label: string | null;
  readonly savedPlaceId: string | null;
}

export function selectedLocation(
  latitude: number,
  longitude: number,
  origin: LocationOrigin,
  options: { accuracyMetres?: number | null; label?: string | null; savedPlaceId?: string | null; observedAt?: number } = {},
): SelectedLocation {
  return {
    latitude,
    longitude,
    encoded: encode(latitude, longitude),
    origin,
    accuracyMetres: options.accuracyMetres ?? null,
    observedAt: options.observedAt ?? Date.now(),
    label: options.label ?? null,
    savedPlaceId: options.savedPlaceId ?? null,
  };
}
