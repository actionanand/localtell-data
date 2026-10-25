export interface DetectedRegion {
  countryCode: string;
  countryName: string;
  adminCode: string | null;
  adminName: string | null;
}

const SCALE = 1000000;
const EARTH = 6371000;
const radians = (degrees: number) => degrees * Math.PI / 180;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const roundEven = (value: number) => {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + Math.abs(floor % 2) : Math.round(value);
};

export class BoundaryPolygon {
  constructor(readonly kind: number, readonly code: string, readonly name: string, readonly errorMetres: number,
    readonly bounds: Int32Array, readonly rings: readonly Int32Array[]) {}

  private longitude(longitude: number): number {
    const centre = (this.bounds[2] + this.bounds[3]) / (2 * SCALE);
    return longitude + roundEven((centre - longitude) / 360) * 360;
  }

  contains(latitude: number, longitude: number): boolean {
    const pointX = this.longitude(longitude) * SCALE;
    const pointY = latitude * SCALE;
    if (pointY < this.bounds[0] || pointY > this.bounds[1] || pointX < this.bounds[2] || pointX > this.bounds[3]) return false;
    const inside = (ring: Int32Array) => {
      let result = false;
      let previous = ring.length - 2;
      for (let index = 0; index < ring.length; index += 2) {
        const firstX = ring[previous]; const firstY = ring[previous + 1];
        const nextX = ring[index]; const nextY = ring[index + 1];
        if ((firstY > pointY) !== (nextY > pointY) && pointX < (nextX - firstX) * (pointY - firstY) / (nextY - firstY) + firstX) result = !result;
        previous = index;
      }
      return result;
    };
    return inside(this.rings[0]) && !this.rings.slice(1).some(inside);
  }

  nearBoundary(latitude: number, longitude: number, radius: number): boolean {
    const pointX = this.longitude(longitude);
    const deltaY = (radius + 2) / 110000;
    const deltaX = deltaY / Math.max(Math.cos(radians(latitude)), 0.08);
    for (const ring of this.rings) {
      let previous = ring.length - 2;
      for (let index = 0; index < ring.length; index += 2) {
        const firstX = ring[previous] / SCALE; const firstY = ring[previous + 1] / SCALE;
        const nextX = ring[index] / SCALE; const nextY = ring[index + 1] / SCALE;
        previous = index;
        if (Math.abs(firstX - nextX) < 1e-8 && Math.abs((firstX + 180) % 360) < 1e-8) continue;
        if (latitude < Math.min(firstY, nextY) - deltaY || latitude > Math.max(firstY, nextY) + deltaY || pointX < Math.min(firstX, nextX) - deltaX || pointX > Math.max(firstX, nextX) + deltaX) continue;
        if (segmentDistance(latitude, pointX, firstY, firstX, nextY, nextX) <= radius + 2) return true;
      }
    }
    return false;
  }
}

function segmentDistance(latitude: number, longitude: number, firstY: number, firstX: number, nextY: number, nextX: number): number {
  const angle = (fromY: number, fromX: number, toY: number, toX: number) => {
    const haversine = Math.sin(radians(toY - fromY) / 2) ** 2 + Math.cos(radians(fromY)) * Math.cos(radians(toY)) * Math.sin(radians(toX - fromX) / 2) ** 2;
    return 2 * Math.asin(Math.sqrt(clamp(haversine, 0, 1)));
  };
  const bearing = (fromY: number, fromX: number, toY: number, toX: number) => {
    const from = radians(fromY); const to = radians(toY); const delta = radians(toX - fromX);
    return Math.atan2(Math.sin(delta) * Math.cos(to), Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(delta));
  };
  const length = angle(firstY, firstX, nextY, nextX);
  const toPoint = angle(firstY, firstX, latitude, longitude);
  if (length < 1e-12) return toPoint * EARTH;
  const difference = bearing(firstY, firstX, latitude, longitude) - bearing(firstY, firstX, nextY, nextX);
  const along = Math.atan2(Math.sin(toPoint) * Math.cos(difference), Math.cos(toPoint));
  return along < 0 || along > length ? Math.min(toPoint, angle(nextY, nextX, latitude, longitude)) * EARTH
    : Math.abs(Math.asin(clamp(Math.sin(toPoint) * Math.sin(difference), -1, 1))) * EARTH;
}

export class BoundaryIndex {
  private readonly countryNames: Map<string, string>;
  constructor(readonly polygons: readonly BoundaryPolygon[], private readonly grid: Map<number, number[]>) {
    this.countryNames = new Map(polygons.filter((polygon) => polygon.kind === 0).map((polygon) => [polygon.code, polygon.name]));
  }

  identify(latitude: number, longitude: number, accuracy: number | null): DetectedRegion | null {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180 || accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 25000) return null;
    const lng = longitude === 180 ? -180 : longitude;
    const key = Math.floor((latitude + 90) / 2) * 180 + Math.floor((lng + 180) / 2);
    const candidates = (this.grid.get(key) ?? []).map((index) => this.polygons[index]);
    if (candidates.some((polygon) => polygon.kind === 2 && (polygon.contains(latitude, lng) || polygon.nearBoundary(latitude, lng, accuracy + polygon.errorMetres)))) return null;
    const countries = candidates.filter((polygon) => polygon.kind === 0 && polygon.contains(latitude, lng));
    const states = candidates.filter((polygon) => polygon.kind === 1 && polygon.contains(latitude, lng));
    const state = states.length === 1 && !states[0].nearBoundary(latitude, lng, accuracy + states[0].errorMetres) ? states[0] : null;
    const codes = new Set(countries.map((polygon) => polygon.code));
    const adminCountry = state?.code.split('-')[0];
    if (codes.size > 1 || (adminCountry && [...codes].some((code) => code !== adminCountry))) return null;
    if (state && adminCountry) return { countryCode: adminCountry, countryName: this.countryNames.get(adminCountry) ?? adminCountry, adminCode: state.code, adminName: state.name };
    const country = countries.find((polygon) => !polygon.nearBoundary(latitude, lng, accuracy + polygon.errorMetres));
    return country ? { countryCode: country.code, countryName: country.name, adminCode: null, adminName: null } : null;
  }

  static read(bytes: Uint8Array): BoundaryIndex {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0; let vertices = 0;
    const integer = () => { const value = view.getInt32(offset); offset += 4; return value; };
    const byte = () => view.getUint8(offset++);
    const count = (maximum: number) => {
      const value = integer();
      if (value < 0 || value > maximum) throw new Error('Invalid LTG1 count');
      return value;
    };
    const text = () => {
      const length = view.getUint16(offset); offset += 2;
      if (offset + length > bytes.length) throw new Error('Truncated LTG1 text');
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)); offset += length;
      return value;
    };
    const delta = () => {
      let value = 0;
      for (let shift = 0; shift <= 28; shift += 7) {
        const next = byte(); value |= (next & 127) << shift;
        if ((next & 128) === 0) return (value >>> 1) ^ -(value & 1);
      }
      throw new Error('Invalid LTG1 delta');
    };
    if (integer() !== 0x4c544731) throw new Error('Invalid LTG1 magic');
    const polygons = Array.from({ length: count(10000) }, () => {
      const kind = byte();
      if (kind > 2) throw new Error('Invalid LTG1 kind');
      const code = text(); const name = text(); const error = count(10000);
      const bounds = Int32Array.from({ length: 4 }, integer);
      const rings = Array.from({ length: count(10000) }, () => {
        const size = count(2000000); vertices += size;
        if (vertices > 2000000 || size < 4) throw new Error('Invalid LTG1 vertex count');
        let pointX = 0; let pointY = 0;
        return Int32Array.from({ length: size * 2 }, (_, axis) => axis % 2 === 0 ? (pointX = (pointX + delta()) | 0) : (pointY = (pointY + delta()) | 0));
      });
      if (!rings.length) throw new Error('LTG1 polygon has no rings');
      return new BoundaryPolygon(kind, code, name, error, bounds, rings);
    });
    const grid = new Map<number, number[]>();
    for (let remaining = count(16200); remaining > 0; remaining--) {
      const key = count(16199);
      if (grid.has(key)) throw new Error('Duplicate LTG1 grid key');
      grid.set(key, Array.from({ length: count(10000) }, () => count(polygons.length - 1)));
    }
    if (offset !== bytes.length) throw new Error('Trailing LTG1 data');
    return new BoundaryIndex(polygons, grid);
  }
}