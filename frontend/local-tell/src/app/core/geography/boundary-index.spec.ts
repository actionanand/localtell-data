import { BoundaryIndex, BoundaryPolygon } from './boundary-index';

describe('Android BoundaryPolygon parity', () => {
  const ring = (values: number[]) => Int32Array.from(values.map((value) => value * 1e6));
  const outer = ring([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]);
  const hole = ring([4, 4, 6, 4, 6, 6, 4, 6, 4, 4]);
  const polygon = new BoundaryPolygon(0, 'XX', 'Test', 0, ring([0, 10, 0, 10]), [outer, hole]);
  it('preserves holes, enclaves and spherical edge distance', () => {
    expect(polygon.contains(3, 3)).toBe(true);
    expect(polygon.contains(5, 5)).toBe(false);
    expect(polygon.nearBoundary(3.999, 5, 200)).toBe(true);
    expect(polygon.nearBoundary(3, 3, 200)).toBe(false);
  });
  it('classifies unwrapped polygons on both sides of the antimeridian', () => {
    const wrapped = new BoundaryPolygon(0, 'XX', 'Test', 0, ring([10, 20, 170, 190]), [ring([170, 10, 190, 10, 190, 20, 170, 20, 170, 10])]);
    expect(wrapped.contains(15, 175)).toBe(true);
    expect(wrapped.contains(15, -175)).toBe(true);
    expect(wrapped.contains(15, 0)).toBe(false);
  });
  it('rejects malformed binary input and unreliable fixes', () => {
    expect(() => BoundaryIndex.read(new Uint8Array(8))).toThrow();
    const index = new BoundaryIndex([], new Map());
    for (const accuracy of [null, -1, 100000, NaN]) expect(index.identify(12.97, 77.59, accuracy)).toBeNull();
  });
});