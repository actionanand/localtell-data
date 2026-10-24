import type { LocationCodeDecodeError } from '../../core/location-code/local-tell-location-code';
import { parseLocationInput } from '../../core/location-input/location-input-parser';
import { googleMapsLinkErrorMessage, looksLikeMapLink, parseGoogleMapsLink } from '../../core/maps-links/google-maps-link-parser';
import type { LocationOrigin } from '../../core/models/location';

export type InterpretedInput =
  | { readonly kind: 'location'; readonly latitude: number; readonly longitude: number; readonly origin: LocationOrigin }
  | { readonly kind: 'confirm'; readonly latitude: number; readonly longitude: number; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export function decodeErrorMessage(reason: LocationCodeDecodeError | null, normalizedDigits: number | null): string {
  switch (reason) {
    case 'InvalidLength':
      return 'A LocalTell code has exactly 19 digits or 15 characters (spaces and hyphens are ignored). Check that nothing is missing or extra.';
    case 'InvalidCharacter':
      return 'The short code contains a character LocalTell never uses (0, 1, I, L, O or punctuation). Check the code with the caller.';
    case 'InvalidChecksum':
      return 'The check characters do not match, so at least one character was mistyped. Ask the caller to repeat the code.';
    case 'UnsupportedVersion':
      return 'This code uses a LocalTell format version this app cannot decode. It was not treated as coordinates.';
    case 'OutOfRange':
      return 'Coordinates must be within latitude −90 to 90 and longitude −180 to 180.';
    case 'MalformedNumericCode':
    case 'MalformedShortCode':
      return 'The code is malformed and cannot be decoded.';
    case null:
      return normalizedDigits !== null
        ? `That is ${normalizedDigits} digits. A numeric LocalTell code has exactly 19 digits.`
        : 'Enter a 19-digit code, a 15-character code, “latitude, longitude” or a Google Maps link.';
  }
}

/** Strict input detection for the Easy Location field. Invalid codes never fall back to coordinates. */
export function interpretInput(text: string): InterpretedInput {
  if (looksLikeMapLink(text)) {
    const link = parseGoogleMapsLink(text);
    switch (link.kind) {
      case 'coordinate':
        return { kind: 'location', latitude: link.latitude, longitude: link.longitude, origin: 'maps-link' };
      case 'viewport-only':
        return {
          kind: 'confirm',
          latitude: link.latitude,
          longitude: link.longitude,
          message:
            'This link only contains the map view centre, not a dropped pin or destination. Confirm that the marker is the intended place before using it.',
        };
      case 'short-link':
        return {
          kind: 'error',
          message:
            'Short maps.app.goo.gl links hide the coordinates behind a redirect that browsers block for security (CORS). Open the link, then copy the full address-bar URL or the coordinates and paste them here.',
        };
      case 'error':
        return { kind: 'error', message: googleMapsLinkErrorMessage(link.reason) };
    }
  }
  const result = parseLocationInput(text);
  if (result.kind === 'Coordinate') {
    const origin: LocationOrigin =
      result.source === 'NUMERIC_CODE' ? 'numeric-code' : result.source === 'SHORT_CODE' ? 'short-code' : 'coordinates';
    return { kind: 'location', latitude: result.latitude, longitude: result.longitude, origin };
  }
  const digits = text.replace(/[\s-]/g, '');
  const digitCount = /^[0-9]{10,30}$/.test(digits) && digits.length !== 19 && digits.length !== 15 ? digits.length : null;
  return { kind: 'error', message: decodeErrorMessage(result.reason, digitCount) };
}
