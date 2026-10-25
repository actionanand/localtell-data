import { hasNoIsoControl, MAX_JOURNEY_BOUND, planSavedPlacesMerge, type RestorePreview, type SavedPlace } from '../saved-places/saved-place';
import { kotlinIsBlank } from '../location-code/local-tell-location-code';
import { validBackupUnicode } from './strict-json';
import { javaDoubleToString, javaFloatToString } from './java-format';

/** Android `JourneyPoint`. `cellId` is a decimal string so 64-bit values are never rounded. */
export interface JourneyPoint {
  /** Local IndexedDB ID; 0 for records decoded from a backup. Never serialized. */
  readonly id: number;
  readonly timestamp: number;
  readonly areaName: string;
  readonly district: string | null;
  readonly state: string | null;
  readonly radio: string;
  readonly plmn: string;
  readonly cellId: string;
  readonly confidence: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyMetres: number | null;
  readonly subDistrict: string | null;
}

export interface AppBackupData {
  readonly savedPlaces: readonly SavedPlace[];
  readonly journeys: readonly JourneyPoint[];
}

export interface DataLimits {
  readonly maxSavedPlaces: number;
  readonly maxJourneyPoints: number;
}

export interface JourneyMergePlan {
  readonly additions: readonly JourneyPoint[];
  readonly insertions: readonly JourneyPoint[];
  readonly duplicates: number;
  readonly removed: number;
  readonly total: number;
}

export interface AppRestorePlan {
  readonly saved: RestorePreview;
  readonly journey: JourneyMergePlan;
}

export function isBackupEmpty(data: AppBackupData): boolean {
  return data.savedPlaces.length === 0 && data.journeys.length === 0;
}

const INT64_MAX = 2n ** 63n - 1n;

export function validJourney(point: JourneyPoint): boolean {
  const text = (value: string | null) =>
    value === null || (!kotlinIsBlank(value) && value.length <= 200 && hasNoIsoControl(value) && validBackupUnicode(value));
  let cellId: bigint;
  try {
    cellId = BigInt(point.cellId);
  } catch {
    return false;
  }
  return (
    /^(0|[1-9][0-9]*)$/.test(point.cellId) &&
    Number.isSafeInteger(point.timestamp) &&
    point.timestamp > 0 &&
    text(point.areaName) &&
    text(point.district) &&
    text(point.state) &&
    text(point.subDistrict) &&
    point.radio.length <= 200 &&
    point.plmn.length <= 200 &&
    hasNoIsoControl(point.radio) &&
    hasNoIsoControl(point.plmn) &&
    validBackupUnicode(point.radio) &&
    validBackupUnicode(point.plmn) &&
    cellId >= 0n &&
    cellId <= INT64_MAX &&
    Number.isInteger(point.confidence) &&
    point.confidence >= 0 &&
    point.confidence <= 100 &&
    ((point.latitude === null && point.longitude === null) ||
      (point.latitude !== null &&
        Number.isFinite(point.latitude) &&
        point.latitude >= -90 &&
        point.latitude <= 90 &&
        point.longitude !== null &&
        Number.isFinite(point.longitude) &&
        point.longitude >= -180 &&
        point.longitude <= 180)) &&
    (point.accuracyMetres === null ||
      (point.latitude !== null && Number.isFinite(point.accuracyMetres) && point.accuracyMetres >= 0))
  );
}

/** Android `journeyIdentity`: local IDs and signed zero never affect duplicate matching. */
export function journeyIdentityKey(point: JourneyPoint): string {
  const number = (value: number | null) => (value === null ? 'null' : String(value === 0 ? 0 : value));
  return JSON.stringify([
    point.timestamp,
    point.areaName,
    point.district,
    point.state,
    point.radio,
    point.plmn,
    point.cellId,
    point.confidence,
    number(point.latitude),
    number(point.longitude),
    number(point.accuracyMetres),
    point.subDistrict,
  ]);
}

/** Android `AppBackupCodec.journeySortKey` including Java `toString` number text. */
export function journeySortKey(point: JourneyPoint): string {
  const values: (string | null)[] = [
    point.areaName,
    point.district,
    point.state,
    point.subDistrict,
    point.radio,
    point.plmn,
    point.cellId,
    String(point.confidence),
    point.latitude === null ? null : javaDoubleToString(point.latitude),
    point.longitude === null ? null : javaDoubleToString(point.longitude),
    point.accuracyMetres === null ? null : javaFloatToString(point.accuracyMetres),
  ];
  return values.map((value) => value ?? '\u0001').join('\u0000');
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareJourneyCanonical(a: JourneyPoint, b: JourneyPoint): number {
  return a.timestamp - b.timestamp || compareStrings(journeySortKey(a), journeySortKey(b));
}

/** Android `planAppRestore`. [savedLimit] lets Dropbox merges use the absolute safety bound. */
export function planAppRestore(current: AppBackupData, incoming: AppBackupData, limits: DataLimits): AppRestorePlan {
  if (incoming.journeys.length > MAX_JOURNEY_BOUND || !incoming.journeys.every(validJourney)) {
    throw new RangeError('Invalid journey records');
  }
  const existing = new Set(current.journeys.map(journeyIdentityKey));
  const additions = incoming.journeys
    .filter((point) => {
      const key = journeyIdentityKey(point);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    })
    .sort(compareJourneyCanonical);
  const beforeTrim = current.journeys.length + additions.length;
  // Existing rows win equal-timestamp retention ties, exactly as on Android.
  const candidates = [
    ...current.journeys.map((point) => ({ point, isNew: false })),
    ...additions.map((point) => ({ point, isNew: true })),
  ];
  const retained = candidates
    .sort(
      (a, b) =>
        b.point.timestamp - a.point.timestamp ||
        Number(a.isNew) - Number(b.isNew) ||
        (b.isNew ? 0 : b.point.id) - (a.isNew ? 0 : a.point.id) ||
        compareStrings(journeySortKey(b.point), journeySortKey(a.point)),
    )
    .slice(0, limits.maxJourneyPoints);
  const insertionKeys = new Set(retained.filter((entry) => entry.isNew).map((entry) => journeyIdentityKey(entry.point)));
  return {
    saved: planSavedPlacesMerge(current.savedPlaces, incoming.savedPlaces, limits.maxSavedPlaces),
    journey: {
      additions,
      insertions: additions.filter((point) => insertionKeys.has(journeyIdentityKey(point))),
      duplicates: incoming.journeys.length - additions.length,
      removed: Math.max(beforeTrim - limits.maxJourneyPoints, 0),
      total: Math.min(beforeTrim, limits.maxJourneyPoints),
    },
  };
}

/** Final Android Journey ordering: timestamp DESC, id DESC. */
export function compareJourneyStored(a: JourneyPoint, b: JourneyPoint): number {
  return b.timestamp - a.timestamp || b.id - a.id;
}
