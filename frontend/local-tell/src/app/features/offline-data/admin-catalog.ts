import { Component, computed, inject, input, output } from '@angular/core';
import { PackCatalogService } from '../../core/geographic-packs/pack-catalog.service';
import { administrativeCatalog, type AdminEntry } from '../../core/geographic-packs/administrative-catalog';
import { formatPackBytes, INDIA_REGIONS, type RemotePack } from '../../core/geographic-packs/pack-manifest';
import { PackList } from './pack-list';

@Component({
  selector: 'app-admin-units',
  imports: [PackList],
  template: `
    @for (admin of entries(); track admin.id) {
      <details [open]="expanded()" [attr.data-testid]="'admin-' + admin.id" class="admin-unit">
        <summary>{{ admin.name }} <span class="muted">{{ admin.adminCode }} · {{ admin.status }}</span></summary>
        @if (admin.pack) {
          <app-pack-list [packs]="[admin.pack]" [allowDownload]="admin.downloadable" (removeRequested)="removeRequested.emit($event)" />
        } @else {
          <p>{{ admin.status }}. Built-in administrative guidance is separate from locality databases.</p>
          @if (catalog.installedById().get(admin.id); as installed) {
            <p>Installed v{{ installed.version }} · {{ bytes(installed.sizeBytes) }} stored</p>
            <button type="button" class="btn btn-small btn-danger" (click)="removeRequested.emit({ id: installed.id, name: installed.name })">Remove {{ installed.name }}</button>
          }
        }
      </details>
    }
  `,
  styles: `details { padding: .5rem; margin-inline-start: 1rem; } summary { cursor: pointer; padding: .4rem; }`,
})
export class AdminUnits {
  protected readonly catalog = inject(PackCatalogService);
  protected readonly bytes = formatPackBytes;
  readonly entries = input.required<readonly AdminEntry[]>();
  readonly expanded = input(false);
  readonly removeRequested = output<Pick<RemotePack, 'id' | 'name'>>();
}

@Component({
  selector: 'app-admin-catalog',
  imports: [AdminUnits],
  template: `
    @for (country of countries(); track country.countryCode) {
      <details open [attr.data-testid]="'country-' + country.countryCode" class="admin-country">
        <summary>{{ country.countryName }} <span class="muted">({{ country.admins.length }})</span></summary>
        <button type="button" class="btn btn-small" [disabled]="downloadable(country.admins).length === 0" (click)="downloadRequested.emit({ title: 'Download ' + country.countryName, packs: downloadable(country.admins) })">Download country</button>
        @if (country.layout === 'REGIONS') {
          @for (region of regions; track region.manifestKey) {
            @let entries = inRegion(country.admins, region.manifestKey);
            @if (entries.length) {
              <details [open]="!!query()">
                <summary>{{ region.displayName }} ({{ entries.length }})</summary>
                <button type="button" class="btn btn-small" [disabled]="downloadable(entries).length === 0" (click)="downloadRequested.emit({ title: 'Download ' + region.displayName, packs: downloadable(entries) })">Download region</button>
                <app-admin-units [entries]="entries" [expanded]="!!query()" (removeRequested)="removeRequested.emit($event)" />
              </details>
            }
          }
        } @else {
          <app-admin-units [entries]="country.admins" [expanded]="!!query()" (removeRequested)="removeRequested.emit($event)" />
        }
      </details>
    } @empty { <p>No administrative areas match your search.</p> }
  `,
  styles: `details { border-top: 1px solid var(--lt-border); padding: .6rem 0; } summary { cursor: pointer; font-weight: 600; padding: .4rem; } .admin-unit { margin-inline-start: 1rem; }`,
})
export class AdminCatalog {
  private readonly catalog = inject(PackCatalogService);
  readonly query = input('');
  readonly downloadRequested = output<{ title: string; packs: readonly RemotePack[] }>();
  readonly removeRequested = output<Pick<RemotePack, 'id' | 'name'>>();
  protected readonly regions = INDIA_REGIONS;
  protected readonly countries = computed(() => administrativeCatalog(this.catalog.catalog(), this.catalog.installedById(), this.catalog.sources(), this.query()));
  protected inRegion(entries: readonly AdminEntry[], region: string): AdminEntry[] { return entries.filter((entry) => entry.region === region); }
  protected downloadable(entries: readonly AdminEntry[]): RemotePack[] { return entries.flatMap((entry) => entry.downloadable && entry.pack ? [entry.pack] : []); }
}