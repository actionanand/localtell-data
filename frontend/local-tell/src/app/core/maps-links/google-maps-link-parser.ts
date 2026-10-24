/**
 * Deterministic coordinate extraction from Google Maps links.
 *
 * Only explicit marker/destination coordinates are accepted automatically. A viewport centre
 * (`/@lat,lng,zoom`) is returned as a candidate that the user must confirm, and short links
 * (`maps.app.goo.gl`) are reported as unresolvable because following their redirect from a browser
 * is blocked by CORS. Nothing is geocoded or invented.
 */

export const MAX_LINK_LENGTH = 4096;

export type GoogleMapsLinkResult =
  | { readonly kind: 'coordinate'; readonly latitude: number; readonly longitude: number; readonly via: GoogleMapsCoordinateSource }
  | { readonly kind: 'viewport-only'; readonly latitude: number; readonly longitude: number }
  | { readonly kind: 'short-link' }
  | { readonly kind: 'error'; readonly reason: GoogleMapsLinkError };

export type GoogleMapsCoordinateSource = 'place-data' | 'destination' | 'query' | 'path' | 'geo-uri';

export type GoogleMapsLinkError =
  | 'too-long'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'unsupported-host'
  | 'out-of-range'
  | 'ambiguous'
  | 'no-coordinates'
  | 'address-only';

const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
const NUMBER = String.raw`[+-]?(?:\d{1,3}(?:\.\d+)?|\.\d+)`;
const PAIR = new RegExp(String.raw`^\s*(?:loc:\s*)?(${NUMBER})\s*,\s*(${NUMBER})\s*$`);
const DMS_PART = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|'')\s*`;
const DMS = new RegExp(String.raw`^\s*${DMS_PART}([NS])[\s,]*${DMS_PART}([EW])\s*$`, 'i');
const PLACE_DATA = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/g;
const VIEWPORT = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|$)/;

export function looksLikeMapLink(input: string): boolean {
  const value = input.trim().toLowerCase();
  return (
    /^(?:https?:\/\/|geo:)/.test(value) ||
    /^(?:www\.|maps\.)?google\.[a-z.]+\/maps/.test(value) ||
    /^(?:maps\.app\.)?goo\.gl\//.test(value)
  );
}

export function parseGoogleMapsLink(input: string): GoogleMapsLinkResult {
  const value = input.trim();
  if (value.length > MAX_LINK_LENGTH) return error('too-long');
  if (/^geo:/i.test(value)) return parseGeoUri(value);

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return error('invalid-url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return error('unsupported-protocol');
  if (url.username || url.password || url.port) return error('unsupported-host');
  const host = url.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) return { kind: 'short-link' };
  if (!GOOGLE_HOST.test(host)) return error('unsupported-host');
  if (!host.startsWith('maps.') && !url.pathname.startsWith('/maps')) return error('unsupported-host');

  const path = safeDecode(url.pathname);

  const placeData = [...path.matchAll(PLACE_DATA)].map((match) => [Number(match[1]), Number(match[2])] as const);
  const distinctPlaces = new Set(placeData.map(([lat, lng]) => `${lat},${lng}`));
  if (distinctPlaces.size > 1) return error('ambiguous');
  if (placeData.length > 0) return coordinate(placeData[0][0], placeData[0][1], 'place-data');

  for (const name of ['destination', 'daddr']) {
    const parameter = url.searchParams.get(name);
    if (parameter !== null) return fromText(lastWaypoint(parameter), 'destination');
  }
  for (const name of ['query', 'q']) {
    const parameter = url.searchParams.get(name);
    if (parameter !== null) return fromText(parameter, 'query');
  }

  const segments = path.split('/').filter((segment) => segment.length > 0);
  const mapsIndex = segments.indexOf('maps');
  const section = mapsIndex >= 0 ? segments[mapsIndex + 1] : undefined;
  const waypoints = segments.slice(mapsIndex + 2).filter((segment) => !segment.startsWith('@') && !segment.startsWith('data='));
  if ((section === 'place' || section === 'search') && waypoints.length > 0) {
    return fromText(waypoints[0].replaceAll('+', ' '), 'path');
  }
  if (section === 'dir' && waypoints.length > 0) {
    return fromText(waypoints[waypoints.length - 1].replaceAll('+', ' '), 'path');
  }

  const viewport = VIEWPORT.exec(path) ?? PAIR.exec(url.searchParams.get('center') ?? url.searchParams.get('ll') ?? '');
  if (viewport) {
    const latitude = Number(viewport[1]);
    const longitude = Number(viewport[2]);
    if (!inRange(latitude, longitude)) return error('out-of-range');
    return { kind: 'viewport-only', latitude, longitude };
  }
  return error('no-coordinates');
}

function parseGeoUri(value: string): GoogleMapsLinkResult {
  const body = value.slice(4).split(/[;?]/, 1)[0];
  const parts = body.split(',');
  if (parts.length < 2 || parts.length > 3) return error('no-coordinates');
  const match = PAIR.exec(`${parts[0]},${parts[1]}`);
  if (!match) return error('no-coordinates');
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (latitude === 0 && longitude === 0) {
    const query = /[?&]q=([^&]*)/.exec(value);
    if (query) return fromText(safeDecode(query[1].replaceAll('+', ' ')).replace(/\(.*\)\s*$/, ''), 'geo-uri');
  }
  return coordinate(latitude, longitude, 'geo-uri');
}

function fromText(text: string, via: GoogleMapsCoordinateSource): GoogleMapsLinkResult {
  const pair = PAIR.exec(text);
  if (pair) return coordinate(Number(pair[1]), Number(pair[2]), via);
  const dms = DMS.exec(text);
  if (dms) {
    const latitude = dmsValue(dms[1], dms[2], dms[3], dms[4]);
    const longitude = dmsValue(dms[5], dms[6], dms[7], dms[8]);
    if (latitude === null || longitude === null) return error('out-of-range');
    return coordinate(latitude, longitude, via);
  }
  return text.trim().length > 0 ? error('address-only') : error('no-coordinates');
}

function dmsValue(degrees: string, minutes: string, seconds: string, hemisphere: string): number | null {
  const minuteValue = Number(minutes);
  const secondValue = Number(seconds);
  if (minuteValue >= 60 || secondValue >= 60) return null;
  const magnitude = Number(degrees) + minuteValue / 60 + secondValue / 3600;
  const signed = /[SW]/i.test(hemisphere) ? -magnitude : magnitude;
  return Math.round(signed * 1_000_000) / 1_000_000;
}

function lastWaypoint(value: string): string {
  const parts = value.split(/\s+to:\s*/i);
  return parts[parts.length - 1];
}

function coordinate(latitude: number, longitude: number, via: GoogleMapsCoordinateSource): GoogleMapsLinkResult {
  if (!inRange(latitude, longitude)) return error('out-of-range');
  return { kind: 'coordinate', latitude, longitude, via };
}

function inRange(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function error(reason: GoogleMapsLinkError): GoogleMapsLinkResult {
  return { kind: 'error', reason };
}

export function googleMapsLinkErrorMessage(reason: GoogleMapsLinkError): string {
  switch (reason) {
    case 'too-long':
      return 'The link is too long to be a supported Google Maps link.';
    case 'invalid-url':
      return 'This is not a valid web link.';
    case 'unsupported-protocol':
      return 'Only https Google Maps links and geo: links are supported.';
    case 'unsupported-host':
      return 'Only google.com/maps links (or regional Google domains) are supported.';
    case 'out-of-range':
      return 'The link contains coordinates outside the valid latitude/longitude range.';
    case 'ambiguous':
      return 'The link contains several different marker coordinates, so the destination is ambiguous.';
    case 'address-only':
      return 'The link contains an address or place name, not coordinates. LocalTell does not geocode addresses; drop a pin in Google Maps and share the pinned location, or enter the coordinates manually.';
    case 'no-coordinates':
      return 'No destination coordinates were found in this link.';
  }
}
