import { MAX_JOURNEY_BOUND, MAX_SAVED_BOUND, SAVED_PLACE_SOURCES, SavedPlaceIdentity, type SavedPlace, type SavedPlaceSource } from '../saved-places/saved-place';
import { isIsoControl } from '../saved-places/saved-place';
import {
  asArray,
  asObject,
  integerValue,
  JsonNumber,
  numberValue,
  optionalNumber,
  optionalText,
  parseStrictJson,
  requireKey,
  text,
  type JsonObject,
} from './strict-json';
import { androidJsonNumber, androidJsonString, javaInstantToString, parseJavaInstant } from './java-format';
import { compareJourneyCanonical, validJourney, type AppBackupData, type JourneyPoint } from './app-backup-data';
import { sha256Hex } from './sha256';

/** Includes UTF-8 and twice-escaped JSON at the absolute 200/1000 record ceilings (Android parity). */
export const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
export const BACKUP_FORMAT = 'localtell-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

function fail(message: string): never {
  throw new BackupValidationError(message);
}

const utf8 = new TextEncoder();

export function utf8Length(value: string): number {
  return utf8.encode(value).byteLength;
}

/** Android `AppBackupCodec.validate`. */
export function validateBackupData(data: AppBackupData): void {
  if (data.savedPlaces.length > MAX_SAVED_BOUND || !data.savedPlaces.every(SavedPlaceIdentity.valid)) fail('Invalid saved places');
  if (new Set(data.savedPlaces.map((place) => place.id)).size !== data.savedPlaces.length) fail('Duplicate saved place IDs');
  if (SavedPlaceIdentity.hasDuplicates(data.savedPlaces)) fail('Duplicate saved places');
  if (data.journeys.length > MAX_JOURNEY_BOUND || !data.journeys.every(validJourney)) fail('Invalid journey records');
}

type NumberKind = 'double' | 'float';

interface SerializeOptions {
  /** Android's fingerprint re-parses the payload, which turns a Double "-0" into the Integer 0. */
  readonly reparsedNumbers: boolean;
}

function jsonNumber(value: number, kind: NumberKind, options: SerializeOptions): string {
  const textValue = androidJsonNumber(value, kind);
  return options.reparsedNumbers && textValue === '-0' ? '0' : textValue;
}

function nullableString(value: string | null): string {
  return value === null ? 'null' : androidJsonString(value);
}

function nullableNumber(value: number | null, kind: NumberKind, options: SerializeOptions): string {
  return value === null ? 'null' : jsonNumber(value, kind, options);
}

function object(entries: readonly (readonly [string, string])[]): string {
  return `{${entries.map(([key, value]) => `${androidJsonString(key)}:${value}`).join(',')}}`;
}

/** Field order follows Android's insertion-ordered JSONObject in `savedJson`. */
function savedJson(place: SavedPlace, options: SerializeOptions): string {
  return object([
    ['id', androidJsonString(place.id)],
    ['name', androidJsonString(place.displayName)],
    ['localityName', nullableString(place.localityName)],
    ['subDistrict', nullableString(place.subDistrict)],
    ['district', nullableString(place.district)],
    ['state', nullableString(place.state)],
    ['countryCode', nullableString(place.countryCode)],
    ['latitude', jsonNumber(place.latitude, 'double', options)],
    ['longitude', jsonNumber(place.longitude, 'double', options)],
    ['savedAt', androidJsonString(javaInstantToString(place.savedAt))],
    ['source', androidJsonString(place.source)],
    ['accuracyMetres', nullableNumber(place.accuracyMetres, 'float', options)],
  ]);
}

function journeyJson(point: JourneyPoint, options: SerializeOptions): string {
  return object([
    ['timestamp', androidJsonString(javaInstantToString(point.timestamp))],
    ['areaName', androidJsonString(point.areaName)],
    ['district', nullableString(point.district)],
    ['state', nullableString(point.state)],
    ['subDistrict', nullableString(point.subDistrict)],
    ['radio', androidJsonString(point.radio)],
    ['plmn', androidJsonString(point.plmn)],
    ['cellId', point.cellId],
    ['confidence', String(point.confidence)],
    ['latitude', nullableNumber(point.latitude, 'double', options)],
    ['longitude', nullableNumber(point.longitude, 'double', options)],
    ['accuracyMetres', nullableNumber(point.accuracyMetres, 'float', options)],
  ]);
}

function lists(data: AppBackupData, options: SerializeOptions): readonly (readonly [string, string])[] {
  return [
    ['savedPlaces', `[${data.savedPlaces.map((place) => savedJson(place, options)).join(',')}]`],
    ['journeys', `[${data.journeys.map((point) => journeyJson(point, options)).join(',')}]`],
  ];
}

/** Android `AppBackupCodec.encode`. */
export async function encodeBackup(data: AppBackupData, exportedAt: number): Promise<string> {
  validateBackupData(data);
  const payload = object([['exportedAt', androidJsonString(javaInstantToString(exportedAt))], ...lists(data, { reparsedNumbers: false })]);
  const envelope = object([
    ['format', androidJsonString(BACKUP_FORMAT)],
    ['schemaVersion', String(BACKUP_SCHEMA_VERSION)],
    ['payload', androidJsonString(payload)],
    ['sha256', androidJsonString(await sha256Hex(payload))],
  ]);
  if (utf8Length(envelope) > MAX_BACKUP_BYTES) fail('Backup exceeds the 12 MiB limit');
  return envelope;
}

/** Android `AppBackupCodec.fingerprint`: stable across exports; timestamps and local IDs are excluded. */
export async function backupFingerprint(data: AppBackupData): Promise<string> {
  validateBackupData(data);
  const canonical: AppBackupData = {
    savedPlaces: [...data.savedPlaces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    journeys: [...data.journeys].sort(compareJourneyCanonical),
  };
  return sha256Hex(object(lists(canonical, { reparsedNumbers: true })));
}

function savedSource(value: string): SavedPlaceSource {
  if (!(SAVED_PLACE_SOURCES as readonly string[]).includes(value)) fail('Unknown saved place source');
  return value as SavedPlaceSource;
}

function float(value: number | null): number | null {
  return value === null ? null : Math.fround(value);
}

function decodeSavedPlace(item: JsonObject): SavedPlace {
  return {
    id: text(item, 'id'),
    displayName: text(item, 'name'),
    localityName: optionalText(item, 'localityName'),
    subDistrict: optionalText(item, 'subDistrict'),
    district: optionalText(item, 'district'),
    state: optionalText(item, 'state'),
    countryCode: optionalText(item, 'countryCode'),
    latitude: numberValue(item, 'latitude'),
    longitude: numberValue(item, 'longitude'),
    savedAt: parseJavaInstant(text(item, 'savedAt')),
    source: savedSource(text(item, 'source')),
    accuracyMetres: float(optionalNumber(item, 'accuracyMetres')),
  };
}

function decodeJourney(item: JsonObject): JourneyPoint {
  const confidence = integerValue(item, 'confidence');
  if (confidence < 0n || confidence > 100n) fail('Invalid journey confidence');
  return {
    id: 0,
    timestamp: parseJavaInstant(text(item, 'timestamp')),
    areaName: text(item, 'areaName'),
    district: optionalText(item, 'district'),
    state: optionalText(item, 'state'),
    radio: text(item, 'radio'),
    plmn: text(item, 'plmn'),
    cellId: integerValue(item, 'cellId').toString(),
    confidence: Number(confidence),
    latitude: optionalNumber(item, 'latitude'),
    longitude: optionalNumber(item, 'longitude'),
    accuracyMetres: float(optionalNumber(item, 'accuracyMetres')),
    subDistrict: optionalText(item, 'subDistrict'),
  };
}

export interface DecodedBackup {
  readonly data: AppBackupData;
  readonly exportedAt: number;
}

/** Android `AppBackupCodec.decode`. Every failure throws; no partial data is returned. */
export async function decodeBackup(json: string): Promise<DecodedBackup> {
  if (utf8Length(json) > MAX_BACKUP_BYTES) fail('Backup exceeds the 12 MiB limit');
  const root = asObject(parseStrictJson(json));
  if (requireKey(root, 'format') !== BACKUP_FORMAT) fail('Not a LocalTell backup');
  const version = requireKey(root, 'schemaVersion');
  if (!(version instanceof JsonNumber) || !version.isInt || version.integral !== BigInt(BACKUP_SCHEMA_VERSION)) {
    fail('Unsupported backup schema version');
  }
  const payload = requireKey(root, 'payload');
  if (typeof payload !== 'string') fail('Missing payload');
  if (requireKey(root, 'sha256') !== (await sha256Hex(payload))) fail('Backup checksum mismatch');
  const body = asObject(parseStrictJson(payload));
  const exportedAt = parseJavaInstant(text(body, 'exportedAt'));
  const saved = asArray(requireKey(body, 'savedPlaces'));
  const journeys = asArray(requireKey(body, 'journeys'));
  if (saved.length > MAX_SAVED_BOUND || journeys.length > MAX_JOURNEY_BOUND) fail('Backup exceeds record limits');
  const data: AppBackupData = {
    savedPlaces: saved.map((item) => decodeSavedPlace(asObject(item))),
    journeys: journeys.map((item) => decodeJourney(asObject(item))),
  };
  validateBackupData(data);
  return { data, exportedAt };
}

/** Android `BackupFileFormat`. */
export const BackupFileFormat = {
  requireFilename(name: string | null | undefined): void {
    if (name === null || name === undefined || name.length < 6 || name.length > 255 || !name.toLowerCase().endsWith('.bklt')) {
      fail('Expected a .bklt backup filename');
    }
    for (let index = 0; index < name.length; index++) {
      const character = name[index];
      if (character === '/' || character === '\\' || isIsoControl(name.charCodeAt(index))) fail('Invalid backup filename');
    }
  },

  /** `LocalTell-18-Oct-2026-08-30PM-<UUID>.bklt` in the local time zone, like Android. */
  filename(now: Date, uniqueId: string = crypto.randomUUID()): string {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(uniqueId)) fail('Invalid backup file identifier');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (value: number) => String(value).padStart(2, '0');
    const hour = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12;
    const timestamp = `${pad(now.getDate())}-${months[now.getMonth()]}-${now.getFullYear()}-${pad(hour)}-${pad(now.getMinutes())}${now.getHours() < 12 ? 'AM' : 'PM'}`;
    return `LocalTell-${timestamp}-${uniqueId}.bklt`;
  },

  async decode(name: string | null | undefined, bytes: Uint8Array): Promise<DecodedBackup> {
    BackupFileFormat.requireFilename(name);
    if (bytes.byteLength > MAX_BACKUP_BYTES) fail('Backup exceeds the 12 MiB limit');
    let textValue: string;
    try {
      // Keep a BOM in the text, as Java's decoder does, so strict parsing rejects it.
      textValue = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      fail('Backup is not valid UTF-8');
    }
    return decodeBackup(textValue);
  },
};

export function describeBackupError(error: unknown): string {
  if (error instanceof BackupValidationError) return error.message;
  if (error instanceof RangeError || (error instanceof Error && error.name === 'StrictJsonError')) {
    return `The backup is invalid: ${error.message}`;
  }
  return 'The backup could not be read.';
}
