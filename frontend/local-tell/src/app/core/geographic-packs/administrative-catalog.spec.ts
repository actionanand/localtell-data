import { administrativeCatalog } from './administrative-catalog';
import type { CatalogState } from './pack-catalog.service';

describe('bundled administrative catalog', () => {
  it('shows 36 Indian units and nine Sri Lankan provinces without any manifest', () => {
    const countries = administrativeCatalog({ status: 'idle' }, new Map(), []);
    expect(countries[0].admins).toHaveLength(36);
    expect(countries[1].admins).toHaveLength(9);
    expect(countries[0].admins.every((admin) => !admin.downloadable && admin.status === 'Availability unknown')).toBe(true);
    expect(administrativeCatalog({ status: 'idle' }, new Map(), [], 'IN-KA')[0].admins[0].name).toBe('Karnataka');
  });
  it('does not invent availability and preserves installed states through catalog failures', () => {
    const unavailable: CatalogState = { status: 'error', message: 'Offline' };
    const entries = administrativeCatalog(unavailable, new Map([['KA', { version: 3 }]]), [])[0].admins;
    expect(entries.find((entry) => entry.id === 'KA')?.status).toBe('Installed');
    expect(entries.find((entry) => entry.id === 'KL')?.status).toBe('Catalog unavailable');
    const empty: CatalogState = { status: 'loaded', result: { manifests: [], packs: [], failedSources: [] }, cachedSources: [] };
    expect(administrativeCatalog(empty, new Map(), [])[0].admins.every((entry) => entry.status === 'Not yet published')).toBe(true);
  });
});