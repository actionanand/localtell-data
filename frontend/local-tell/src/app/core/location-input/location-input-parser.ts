import {
  NUMERIC_CODE_LENGTH,
  SHORT_CODE_LENGTH,
  decodeNumeric,
  decodeShort,
  kotlinTrim,
  type LocationCodeDecodeError,
  type LocationCodeDecodeResult,
} from '../location-code/local-tell-location-code';

export type LocationInputSource = 'NUMERIC_CODE' | 'SHORT_CODE' | 'COORDINATE';

export type LocationInputResult =
  | { readonly kind: 'Coordinate'; readonly latitude: number; readonly longitude: number; readonly source: LocationInputSource }
  | { readonly kind: 'Error'; readonly reason: LocationCodeDecodeError | null };

/** Java `\d`/`\s` are ASCII-only without UNICODE_CHARACTER_CLASS; the pattern keeps that meaning. */
const COORDINATE_PATTERN =
  /^([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))[ \t\n\u000B\f\r]*(?:,|[ \t\n\u000B\f\r]+)[ \t\n\u000B\f\r]*([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))$/;
const SEPARATORS = /[ \t\n\u000B\f\r-]+/g;

/** Port of Android `LocationInputParser.parse`. */
export function parseLocationInput(input: string): LocationInputResult {
  const trimmed = kotlinTrim(input);
  if (trimmed.length === 0) return { kind: 'Error', reason: null };
  const match = COORDINATE_PATTERN.exec(trimmed);
  if (match) {
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return { kind: 'Error', reason: null };
    return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      ? { kind: 'Coordinate', latitude, longitude, source: 'COORDINATE' }
      : { kind: 'Error', reason: 'OutOfRange' };
  }

  const normalized = trimmed.replace(SEPARATORS, '').toUpperCase();
  if (normalized.length === NUMERIC_CODE_LENGTH && /^[0-9]+$/.test(normalized)) {
    return toInputResult(decodeNumeric(normalized), 'NUMERIC_CODE');
  }
  if (normalized.length === SHORT_CODE_LENGTH) return toInputResult(decodeShort(normalized), 'SHORT_CODE');
  return { kind: 'Error', reason: null };
}

function toInputResult(result: LocationCodeDecodeResult, source: LocationInputSource): LocationInputResult {
  return result.kind === 'Success'
    ? { kind: 'Coordinate', latitude: result.latitude, longitude: result.longitude, source }
    : { kind: 'Error', reason: result.kind };
}
