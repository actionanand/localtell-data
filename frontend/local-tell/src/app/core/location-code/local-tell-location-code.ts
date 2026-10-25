/**
 * TypeScript port of Android `LocalTellLocationCode.kt` (Location Code V1).
 *
 * Do not change constants, alphabet order, checksum tables or byte order: they define the
 * meaning of every published code. Payload arithmetic uses BigInt so no 64-bit value is
 * rounded by JavaScript numbers.
 */

export interface EncodedLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly numericCode: string;
  readonly shortCode: string;
}

export type LocationCodeDecodeError =
  | 'InvalidLength'
  | 'InvalidCharacter'
  | 'InvalidChecksum'
  | 'UnsupportedVersion'
  | 'OutOfRange'
  | 'MalformedNumericCode'
  | 'MalformedShortCode';

export type LocationCodeDecodeResult =
  | { readonly kind: 'Success'; readonly latitude: number; readonly longitude: number }
  | { readonly kind: LocationCodeDecodeError };

export const VERSION = 1;
export const LAT_SCALE = 1_000_000n;
export const LON_SCALE = 1_000_000n;
export const LON_BUCKETS = 360_000_001n;
export const LOCATION_SPACE = 180_000_001n * LON_BUCKETS;
export const NUMERIC_PAYLOAD_LENGTH = 18;
export const NUMERIC_CODE_LENGTH = NUMERIC_PAYLOAD_LENGTH + 1;
export const SHORT_PAYLOAD_LENGTH = 13;
export const SHORT_CODE_LENGTH = SHORT_PAYLOAD_LENGTH + 2;
export const SAFE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const MAX_VERSION = 15n;
const ALPHABET_SIZE = BigInt(SAFE_ALPHABET.length);
const LONG_MAX = 0x7fff_ffff_ffff_ffffn;

/** Kotlin `Char.isWhitespace()`: Java whitespace plus every Unicode space separator. */
// eslint-disable-next-line no-control-regex -- Kotlin whitespace includes VT and \u001C-\u001F.
const KOTLIN_WHITESPACE = /[\t\n\u000B\f\r\u001C-\u001F\p{Zs}\u2028\u2029]/u;
/** Java regex `\s` without UNICODE_CHARACTER_CLASS is ASCII-only. */
// eslint-disable-next-line no-control-regex -- Java `\s` includes VT (\u000B).
const SEPARATORS = /[ \t\n\u000B\f\r-]+/g;
const UNICODE_DECIMAL_DIGIT = /^\p{Nd}$/u;

export function kotlinTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && KOTLIN_WHITESPACE.test(value[start])) start++;
  while (end > start && KOTLIN_WHITESPACE.test(value[end - 1])) end--;
  return value.slice(start, end);
}

export function kotlinIsBlank(value: string): boolean {
  return kotlinTrim(value).length === 0;
}

/** Kotlin `Char.isDigit()` operates on a single UTF-16 unit and accepts every Unicode Nd digit. */
function isUnicodeDigit(unit: string): boolean {
  return UNICODE_DECIMAL_DIGIT.test(unit);
}

/** Unicode Nd digits occur in contiguous zero-to-nine runs, so the run offset gives the value. */
function digitValue(unit: string): number {
  const code = unit.charCodeAt(0);
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  let preceding = 0;
  while (preceding < 1_000 && isUnicodeDigit(String.fromCharCode(code - preceding - 1))) preceding++;
  return preceding % 10;
}

function normalize(value: string): string {
  return kotlinTrim(value).replace(SEPARATORS, '').toUpperCase();
}

export function encode(latitude: number, longitude: number): EncodedLocation {
  const locationKey = coordinateToKey(latitude, longitude);
  if (locationKey === null) throw new RangeError('Coordinate out of range');
  const payload = payloadFor(VERSION, locationKey);
  const numeric = numericPayload(payload);
  return {
    latitude: latitudeForKey(locationKey),
    longitude: longitudeForKey(locationKey),
    numericCode: formatNumeric(numeric + verhoeffCheckDigit(numeric)),
    shortCode: formatShort(shortPayload(payload) + shortChecksum(payload)),
  };
}

export function decodeNumeric(value: string): LocationCodeDecodeResult {
  const normalized = normalize(value);
  if (normalized.length !== NUMERIC_CODE_LENGTH) return { kind: 'InvalidLength' };
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- Kotlin checks UTF-16 units; for-of would yield code points.
  for (let index = 0; index < normalized.length; index++) {
    if (!isUnicodeDigit(normalized[index])) return { kind: 'MalformedNumericCode' };
  }
  if (!verhoeffValid(normalized)) return { kind: 'InvalidChecksum' };
  const digits = Array.from(normalized.slice(0, -1), (unit) => digitValue(unit)).join('');
  return decodePayload(BigInt(digits));
}

export function decodeShort(value: string): LocationCodeDecodeResult {
  const normalized = normalize(value);
  if (normalized.length !== SHORT_CODE_LENGTH) return { kind: 'InvalidLength' };
  // eslint-disable-next-line @typescript-eslint/prefer-for-of -- Kotlin checks UTF-16 units; for-of would yield code points.
  for (let index = 0; index < normalized.length; index++) {
    if (!SAFE_ALPHABET.includes(normalized[index])) return { kind: 'InvalidCharacter' };
  }
  const payload = decodeBase31(normalized.slice(0, SHORT_PAYLOAD_LENGTH));
  if (payload === null) return { kind: 'MalformedShortCode' };
  if (shortChecksum(payload) !== normalized.slice(-2)) return { kind: 'InvalidChecksum' };
  return decodePayload(payload);
}

export function formatNumeric(value: string): string {
  const firstGroupLength = value.length % 3;
  const groups: string[] = [];
  if (firstGroupLength !== 0) groups.push(value.slice(0, firstGroupLength));
  for (let index = firstGroupLength; index < value.length; index += 3) groups.push(value.slice(index, index + 3));
  return groups.join(' ');
}

export function formatShort(value: string): string {
  const groups: string[] = [];
  for (let index = 0; index < value.length; index += 5) groups.push(value.slice(index, index + 5));
  return groups.join('-');
}

/** Mirrors Android's `numericCodeForPayloadForTest` so version-namespace tests stay identical. */
export function numericCodeForPayloadForTest(payload: bigint): string {
  const numeric = numericPayload(payload);
  return formatNumeric(numeric + verhoeffCheckDigit(numeric));
}

function coordinateToKey(latitude: number, longitude: number): bigint | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // Kotlin roundToLong() and JavaScript Math.round() both round half-way values towards +infinity.
  const latIndex = Math.round((latitude + 90) * Number(LAT_SCALE));
  const lonIndex = Math.round((longitude + 180) * Number(LON_SCALE));
  if (latIndex < 0 || latIndex > 180_000_000 || lonIndex < 0 || lonIndex > 360_000_000) return null;
  return BigInt(latIndex) * LON_BUCKETS + BigInt(lonIndex);
}

function payloadFor(version: number, locationKey: bigint): bigint {
  if (version < 1 || BigInt(version) > MAX_VERSION) throw new RangeError('Unsupported version');
  if (locationKey < 0n || locationKey >= LOCATION_SPACE) throw new RangeError('Location key out of range');
  return BigInt(version - 1) * LOCATION_SPACE + locationKey;
}

function decodePayload(payload: bigint): LocationCodeDecodeResult {
  if (payload < 0n) return { kind: 'OutOfRange' };
  const version = payload / LOCATION_SPACE + 1n;
  if (version < 1n || version > MAX_VERSION) return { kind: 'UnsupportedVersion' };
  if (version !== BigInt(VERSION)) return { kind: 'UnsupportedVersion' };
  const locationKey = payload % LOCATION_SPACE;
  return { kind: 'Success', latitude: latitudeForKey(locationKey), longitude: longitudeForKey(locationKey) };
}

function latitudeForKey(locationKey: bigint): number {
  return Number(locationKey / LON_BUCKETS - 90_000_000n) / Number(LAT_SCALE);
}

function longitudeForKey(locationKey: bigint): number {
  return Number((locationKey % LON_BUCKETS) - 180_000_000n) / Number(LON_SCALE);
}

function numericPayload(payload: bigint): string {
  return payload.toString().padStart(NUMERIC_PAYLOAD_LENGTH, '0');
}

function shortPayload(payload: bigint): string {
  let remaining = payload;
  const characters = new Array<string>(SHORT_PAYLOAD_LENGTH);
  for (let index = SHORT_PAYLOAD_LENGTH - 1; index >= 0; index--) {
    characters[index] = SAFE_ALPHABET[Number(remaining % ALPHABET_SIZE)];
    remaining /= ALPHABET_SIZE;
  }
  if (remaining !== 0n) throw new RangeError('Payload exceeds short-code capacity');
  return characters.join('');
}

function decodeBase31(value: string): bigint | null {
  let result = 0n;
  for (const character of value) {
    result = result * ALPHABET_SIZE + BigInt(SAFE_ALPHABET.indexOf(character));
  }
  // All digits are nonnegative, so the fold is monotonic: Kotlin's Math.*Exact overflow
  // happens exactly when the final value exceeds Long.MAX_VALUE.
  return result > LONG_MAX ? null : result;
}

/** CRC-8/ATM: polynomial 0x07, init 0x00, no reflection, xorout 0x00, over big-endian signed Long bytes. */
function shortChecksum(payload: bigint): string {
  const unsigned = BigInt.asUintN(64, payload);
  let crc = 0;
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    crc ^= Number((unsigned >> shift) & 0xffn);
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return `${SAFE_ALPHABET[Math.floor(crc / SAFE_ALPHABET.length)]}${SAFE_ALPHABET[crc % SAFE_ALPHABET.length]}`;
}

function verhoeffCheckDigit(value: string): string {
  let checksum = 0;
  const reversed = [...value].reverse();
  reversed.forEach((character, index) => {
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[(index + 1) % 8][digitValue(character)]];
  });
  return String(VERHOEFF_INV[checksum]);
}

function verhoeffValid(value: string): boolean {
  let checksum = 0;
  const reversed = [...value].reverse();
  reversed.forEach((character, index) => {
    checksum = VERHOEFF_D[checksum][VERHOEFF_P[index % 8][digitValue(character)]];
  });
  return checksum === 0;
}

const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
