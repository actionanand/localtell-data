import { kotlinIsBlank, kotlinTrim } from '../location-code/local-tell-location-code';
import { formatFixed } from '../maps-links/map-link-builder';
import { validBackupUnicode } from '../backup/strict-json';
import { ISO_COUNTRY_CODES } from './iso-countries';

/** Absolute safety ceilings from Android `DataLimits`. */
export const MAX_SAVED_BOUND = 200;
export const MAX_JOURNEY_BOUND = 1000;

export type SavedPlaceSource = 'HOME' | 'EASY' | 'LOOKUP' | 'JOURNEY';
export const SAVED_PLACE_SOURCES: readonly SavedPlaceSource[] = ['HOME', 'EASY', 'LOOKUP', 'JOURNEY'];

/** Android `SavedPlace`; field names follow the `.bklt` payload except `displayName` (`name`). */
export interface SavedPlace {
  readonly id: string;
  readonly displayName: string;
  readonly localityName: string | null;
  readonly subDistrict: string | null;
  readonly district: string | null;
  readonly state: string | null;
  readonly countryCode: string | null;
  readonly latitude: number;
  readonly longitude: number;
  /** Epoch milliseconds. */
  readonly savedAt: number;
  readonly source: SavedPlaceSource;
  /** A binary32 value, like Android's `Float`. */
  readonly accuracyMetres: number | null;
}

export interface RestorePreview {
  readonly added: number;
  readonly duplicates: number;
  readonly total: number;
  readonly fits: boolean;
}

export type SaveResult = 'Saved' | 'Duplicate' | 'Full';

export function isIsoControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

export function hasNoIsoControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) if (isIsoControl(value.charCodeAt(index))) return false;
  return true;
}

function validText(value: string): boolean {
  return !kotlinIsBlank(value) && value.length <= 200 && hasNoIsoControl(value) && validBackupUnicode(value);
}

/** Kotlin `trim().replace(Regex("\\s+"), " ").lowercase(Locale.ROOT)`; Java `\s` is ASCII-only. */
function normalize(value: string | null): string {
  return kotlinTrim(value ?? '')
    // eslint-disable-next-line no-control-regex -- Java `\s` includes VT (\u000B).
    .replace(/[ \t\n\u000B\f\r]+/g, ' ')
    .toLowerCase();
}

const toRadians = (degrees: number) => degrees * 0.017453292519943295;

export const SavedPlaceIdentity = {
  of(place: SavedPlace): string {
    const name = normalize(place.localityName);
    if (name.length === 0) {
      return `coordinates:${formatFixed(place.latitude, 4)}:${formatFixed(place.longitude, 4)}`;
    }
    const parts = [place.localityName, place.subDistrict, place.district, place.state, place.countryCode]
      .map(normalize)
      .map((part) => `${part.length}:${part}`)
      .join('|');
    return `locality:${parts}:${formatFixed(place.latitude, 6)}:${formatFixed(place.longitude, 6)}`;
  },

  matches(a: SavedPlace, b: SavedPlace): boolean {
    const named = !isNullOrBlank(a.localityName) && !isNullOrBlank(b.localityName);
    if (named && normalize(a.localityName) !== normalize(b.localityName)) return false;
    const dLat = toRadians(a.latitude - b.latitude);
    const dLon = toRadians(a.longitude - b.longitude);
    const h =
      Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.pow(Math.sin(dLon / 2), 2);
    const metres = 12_742_000 * Math.asin(Math.sqrt(Math.min(Math.max(h, 0), 1)));
    if (metres <= 20) return true;
    if (!named) return false;
    const hasContext = [a.subDistrict, a.district, a.state].some((value) => !isNullOrBlank(value));
    if (!hasContext || metres > 5_000) return false;
    const contextA = [a.subDistrict, a.district, a.state, a.countryCode].map(normalize);
    const contextB = [b.subDistrict, b.district, b.state, b.countryCode].map(normalize);
    return contextA.every((value, index) => value === contextB[index]);
  },

  hasDuplicates(places: readonly SavedPlace[]): boolean {
    for (let i = 0; i < places.length; i++) {
      for (let j = 0; j < i; j++) if (SavedPlaceIdentity.matches(places[i], places[j])) return true;
    }
    return false;
  },

  valid(place: SavedPlace): boolean {
    return (
      Number.isFinite(place.latitude) &&
      place.latitude >= -90 &&
      place.latitude <= 90 &&
      Number.isFinite(place.longitude) &&
      place.longitude >= -180 &&
      place.longitude <= 180 &&
      /^[A-Za-z0-9_-]{1,100}$/.test(place.id) &&
      validText(place.displayName) &&
      [place.localityName, place.subDistrict, place.district, place.state].every((value) => value === null || validText(value)) &&
      (place.countryCode === null || ISO_COUNTRY_CODES.has(place.countryCode)) &&
      Number.isSafeInteger(place.savedAt) &&
      place.savedAt > 0 &&
      SAVED_PLACE_SOURCES.includes(place.source) &&
      (place.accuracyMetres === null || (Number.isFinite(place.accuracyMetres) && place.accuracyMetres >= 0))
    );
  },
};

function isNullOrBlank(value: string | null): boolean {
  return value === null || kotlinIsBlank(value);
}

/** Android `classifySavedPlace`: duplicates win before the configured capacity check. */
export function classifySavedPlace(current: readonly SavedPlace[], place: SavedPlace, limit: number): SaveResult {
  if (!SavedPlaceIdentity.valid(place)) throw new RangeError('Invalid saved place');
  if (current.some((existing) => SavedPlaceIdentity.matches(existing, place) || existing.id === place.id)) return 'Duplicate';
  if (current.length >= limit) return 'Full';
  return 'Saved';
}

/** Android `planSavedPlacesMerge`: existing identities win; an ID collision with a different place is invalid. */
export function planSavedPlacesMerge(
  current: readonly SavedPlace[],
  incoming: readonly SavedPlace[],
  limit: number,
): RestorePreview {
  if (incoming.length > MAX_SAVED_BOUND || !incoming.every(SavedPlaceIdentity.valid)) throw new RangeError('Invalid saved places');
  if (new Set(incoming.map((place) => place.id)).size !== incoming.length) throw new RangeError('Duplicate saved place IDs');
  if (SavedPlaceIdentity.hasDuplicates(incoming)) throw new RangeError('Duplicate saved places');
  const existingById = new Map(current.map((place) => [place.id, place]));
  for (const candidate of incoming) {
    const existing = existingById.get(candidate.id);
    if (existing && !SavedPlaceIdentity.matches(existing, candidate)) throw new RangeError('Saved place ID collision');
  }
  const added = incoming.filter((candidate) => !current.some((existing) => SavedPlaceIdentity.matches(existing, candidate))).length;
  return {
    added,
    duplicates: incoming.length - added,
    total: current.length + added,
    fits: added === 0 || current.length + added <= limit,
  };
}

export function newSavedPlaceId(): string {
  return crypto.randomUUID();
}

/** Android `savedPlaceFor`: the display name falls back to six-decimal coordinates. */
export function savedPlaceFor(options: {
  latitude: number;
  longitude: number;
  accuracyMetres: number | null;
  source: SavedPlaceSource;
  name?: string | null;
  subDistrict?: string | null;
  district?: string | null;
  state?: string | null;
  countryCode?: string | null;
  now: number;
}): SavedPlace | null {
  const name = options.name && !kotlinIsBlank(options.name) ? options.name : null;
  const place: SavedPlace = {
    id: newSavedPlaceId(),
    displayName: name ?? `${formatFixed(options.latitude, 6)}, ${formatFixed(options.longitude, 6)}`,
    localityName: name,
    subDistrict: options.subDistrict ?? null,
    district: options.district ?? null,
    state: options.state ?? null,
    countryCode: options.countryCode ?? null,
    latitude: options.latitude,
    longitude: options.longitude,
    savedAt: options.now,
    source: options.source,
    accuracyMetres: options.accuracyMetres === null ? null : Math.fround(options.accuracyMetres),
  };
  return SavedPlaceIdentity.valid(place) ? place : null;
}

/** Android `SavedPlacesOverflow`: only a Dropbox merge can exceed the limit; saving and sync pause until resolved. */
export const SavedPlacesOverflow = {
  excess(count: number, limit: number): number {
    return Math.max(count - limit, 0);
  },

  /** The oldest places, i.e. the last entries of the newest-first (`savedAt DESC, id DESC`) list. */
  oldestToRemove(places: readonly SavedPlace[], limit: number): SavedPlace[] {
    const excess = SavedPlacesOverflow.excess(places.length, limit);
    if (excess === 0) return [];
    return [...places].sort((a, b) => a.savedAt - b.savedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, excess);
  },
};
