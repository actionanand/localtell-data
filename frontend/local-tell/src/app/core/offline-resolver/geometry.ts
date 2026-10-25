/** Port of Android `PointInPolygon`, `LocalityLookupRules` and `PolygonOrder` (OfflineLocalityResolver.kt). */

export type RingPoint = readonly [latitude: number, longitude: number];

/** Java `Double.parseDouble` accepted forms that occur in decimal pack data (plus NaN/Infinity). */
const JAVA_DOUBLE = /^[+-]?(?:NaN|Infinity|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[fFdD]?$/;

function kotlinToDoubleOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!JAVA_DOUBLE.test(trimmed)) return null;
  return Number(trimmed.replace(/[fFdD]$/, ''));
}

export function parseRing(encodedRing: string | null): RingPoint[] {
  const points: RingPoint[] = [];
  for (const pair of (encodedRing ?? '').split(';')) {
    const parts = pair.split(',');
    if (parts.length !== 2) continue;
    const latitude = kotlinToDoubleOrNull(parts[0]);
    if (latitude === null) continue;
    const longitude = kotlinToDoubleOrNull(parts[1]);
    if (longitude === null) continue;
    points.push([latitude, longitude]);
  }
  return points;
}

/** Ray casting kept aligned with localtell-data/scripts/test_locality_lookup.py. */
export function ringContains(latitude: number, longitude: number, points: readonly RingPoint[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  let previous = points[points.length - 1];
  for (const current of points) {
    const [lat1, lon1] = previous;
    const [lat2, lon2] = current;
    if (lat1 > latitude !== lat2 > latitude) {
      const crossingLongitude = ((lon2 - lon1) * (latitude - lat1)) / (lat2 - lat1) + lon1;
      if (longitude < crossingLongitude) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

export function polygonContains(latitude: number, longitude: number, encodedRing: string | null): boolean {
  return ringContains(latitude, longitude, parseRing(encodedRing));
}

export function boundingBoxArea(encodedRing: string | null): number {
  const points = parseRing(encodedRing);
  if (points.length === 0) return Number.MAX_VALUE;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return (maxLat - minLat) * (maxLng - minLng);
}

export const NEAREST_PLACE_TYPES: readonly string[] = ['neighbourhood', 'suburb', 'locality', 'hamlet', 'village', 'town', 'city'];
export const POLYGON_PLACE_TYPES = NEAREST_PLACE_TYPES;

export function polygonPriority(type: string | null): number {
  const index = POLYGON_PLACE_TYPES.indexOf(type?.toLowerCase() ?? '');
  return index < 0 ? POLYGON_PLACE_TYPES.length + 1 : index + 1;
}

export interface PolygonOrder {
  readonly priority: number;
  readonly boundingBoxArea: number;
  readonly geometryId: number;
  readonly placeId: number;
}

export function polygonOrder(type: string | null, area: number, geometryId: number, placeId: number): PolygonOrder {
  return { priority: polygonPriority(type), boundingBoxArea: area, geometryId, placeId };
}

export function comparePolygonOrder(a: PolygonOrder, b: PolygonOrder): number {
  return (
    Math.sign(a.priority - b.priority) ||
    Math.sign(a.boundingBoxArea - b.boundingBoxArea) ||
    Math.sign(a.geometryId - b.geometryId) ||
    Math.sign(a.placeId - b.placeId)
  );
}

const DEGREES_TO_RADIANS = 0.017453292519943295;

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEGREES_TO_RADIANS;
  const dLng = (lng2 - lng1) * DEGREES_TO_RADIANS;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEGREES_TO_RADIANS) * Math.cos(lat2 * DEGREES_TO_RADIANS) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
