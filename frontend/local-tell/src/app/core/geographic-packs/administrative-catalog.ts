import inventory from '../../../config/admin-inventory.json';
import type { CatalogState } from './pack-catalog.service';
import type { CountryManifestSource, RemotePack } from './pack-manifest';

export interface AdminUnit { id: string; adminCode: string; name: string; region: string | null; displayOrder: number }
export interface AdminEntry extends AdminUnit { pack: RemotePack | null; status: string; downloadable: boolean }
export interface AdminCountry { countryCode: string; countryName: string; layout: string; admins: AdminEntry[] }

export function administrativeCatalog(state: CatalogState, installed: ReadonlyMap<string, { version: number }>, sources: readonly CountryManifestSource[], query = ''): AdminCountry[] {
  const remote = state.status === 'loaded' ? state.result.packs : [];
  const countries = new Map(inventory.map((country) => [country.countryCode, { ...country, admins: [...country.admins] as AdminUnit[] }]));
  for (const source of sources) if (!countries.has(source.countryCode)) countries.set(source.countryCode, { ...source, admins: [] });
  for (const pack of remote) {
    const country = countries.get(pack.countryCode);
    if (country && !country.admins.some((admin) => admin.id === pack.id || admin.adminCode === pack.adminCode)) {
      country.admins.push({ id: pack.id, adminCode: pack.adminCode ?? pack.id, name: pack.name, region: pack.region, displayOrder: pack.displayOrder });
    }
  }
  const normalized = (value: string) => value.toLowerCase().replace(/[\s-]+/g, '');
  const search = normalized(query);
  return [...countries.values()].map((country): AdminCountry => {
    const confirmed = state.status === 'loaded' && !state.result.failedSources.some((failed) => failed.source.countryCode === country.countryCode)
      && !state.cachedSources.some((cached) => cached.startsWith(country.countryName + ' ('));
    const unavailable = state.status === 'error' || (state.status === 'loaded' && !confirmed);
    const admins = country.admins.sort((first, next) => first.displayOrder - next.displayOrder).map((admin): AdminEntry => {
      const pack = remote.find((pack) => pack.countryCode === country.countryCode && (pack.id === admin.id || pack.adminCode === admin.adminCode)) ?? null;
      const current = installed.get(admin.id);
      const update = !!current && !!pack && current.version < pack.version;
      const status = current ? update ? 'Update available' : 'Installed' : unavailable ? 'Catalog unavailable' : !confirmed ? 'Availability unknown' : pack ? 'Downloadable' : 'Not yet published';
      return { ...admin, pack, status, downloadable: confirmed && !!pack && (!current || update) };
    }).filter((admin) => normalized([country.countryName, country.countryCode, admin.region ?? '', admin.name, admin.id, admin.adminCode, admin.pack?.name ?? ''].join(' ')).includes(search));
    return { ...country, admins };
  }).filter((country) => country.admins.length > 0 || !search);
}