import type * as Leaflet from 'leaflet';
import { leafletNamespace } from './map-view';

describe('leafletNamespace', () => {
  const fake = { map: () => undefined } as unknown as typeof Leaflet;

  it('uses named exports when the bundler provides them', () => {
    expect(leafletNamespace(fake)).toBe(fake);
  });

  it('falls back to the CommonJS default export used by the production bundle', () => {
    expect(leafletNamespace({ default: fake } as unknown as typeof Leaflet & { default: typeof Leaflet })).toBe(fake);
  });

  it('fails clearly when Leaflet is unusable', () => {
    expect(() => leafletNamespace({} as typeof Leaflet)).toThrow('Leaflet failed to load');
  });
});
