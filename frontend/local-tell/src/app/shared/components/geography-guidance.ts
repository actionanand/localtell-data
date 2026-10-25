import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GeographyService } from '../../core/geography/geography.service';
import { PackCatalogService } from '../../core/geographic-packs/pack-catalog.service';

@Component({
  selector: 'app-geography-guidance',
  imports: [RouterLink],
  template: `
    @switch (geography.current().status) {
      @case ('loading') { <p role="status">Identifying country and administrative area...</p> }
      @case ('resolved') {
        @if (region(); as region) {
          <dl class="kv">
            <dt>Country</dt><dd data-testid="country-result">{{ region.countryName }}</dd>
            <dt>State / territory</dt><dd data-testid="admin-result">{{ region.adminName ?? 'Not confidently identified' }}</dd>
          </dl>
          @if (target(); as pack) {
            @if (!packs.installedById().has(pack.id)) {
              <button type="button" class="btn btn-small" (click)="packs.enqueue([pack])">Download {{ pack.name }} data</button>
            }
          }
          <a routerLink="/offline-data" [queryParams]="{ query: region.adminCode ?? region.countryCode }">View {{ region.adminName ?? region.countryName }} offline data</a>
        }
      }
      @case ('uncertain') { <p class="muted">Country or state cannot be identified confidently. Borders, disputed areas and broad accuracy estimates may be uncertain.</p> }
      @case ('error') { <p class="banner banner-warning">Built-in geographic guidance is unavailable. Codes and installed locality packs remain independent.</p> }
    }
    <details class="small">
      <summary>Geographic data attribution</summary>
      <p>Made with Natural Earth (public domain). India: geoBoundaries gbOpen / DataMeet India community / Election Commission of India; <a href="https://creativecommons.org/licenses/by/2.5/in/" target="_blank" rel="noopener">CC BY 2.5 IN</a>. Not survey-grade or a statement of territorial claims.</p>
      <a [href]="notice" target="_blank" rel="noopener">Full NOTICE</a> · <a [href]="provenance" target="_blank" rel="noopener">Pinned provenance</a>
    </details>
  `,
})
export class GeographyGuidance {
  protected readonly geography = inject(GeographyService);
  protected readonly packs = inject(PackCatalogService);
  protected readonly notice = new URL('geography/NOTICE.txt', document.baseURI).href;
  protected readonly provenance = new URL('geography/provenance.json', document.baseURI).href;
  protected readonly region = computed(() => { const state = this.geography.current(); return state.status === 'resolved' ? state.region : null; });
  protected readonly target = computed(() => {
    const region = this.region(); const state = this.packs.catalog();
    if (!region?.adminCode || state.status !== 'loaded' || state.result.failedSources.some((entry) => entry.source.countryCode === region.countryCode)
      || state.cachedSources.some((entry) => entry.startsWith(region.countryName + ' ('))) return null;
    return state.result.packs.find((pack) => pack.countryCode === region.countryCode && (pack.adminCode === region.adminCode || (region.countryCode === 'IN' && pack.id === region.adminCode?.slice(3)))) ?? null;
  });
}