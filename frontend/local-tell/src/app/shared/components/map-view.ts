import {
  afterNextRender,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { APP_CONFIG } from '../../core/config/app-config';
import { formatFixed } from '../../core/maps-links/map-link-builder';
import { Icon } from './icon';

export type MarkerKind = 'selected' | 'decoded' | 'device' | 'ip' | 'saved';

export interface MapMarker {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly kind: MarkerKind;
  readonly label: string;
  readonly accuracyMetres?: number | null;
}

export const MARKER_LEGEND: readonly { kind: MarkerKind; label: string }[] = [
  { kind: 'selected', label: 'Selected / manual' },
  { kind: 'decoded', label: 'Decoded caller location' },
  { kind: 'device', label: 'Browser device location' },
  { kind: 'ip', label: 'Approximate IP location' },
  { kind: 'saved', label: 'Saved place' },
];

const DEFAULT_CENTER: Leaflet.LatLngTuple = [20, 78];
const DEFAULT_ZOOM = 4;

/**
 * Leaflet is UMD/CommonJS. The production esbuild bundle exposes it only as the dynamic import's
 * `default` export, while the dev server and type definitions expose named exports.
 */
export function leafletNamespace(module: typeof Leaflet & { default?: typeof Leaflet }): typeof Leaflet {
  const namespace = typeof module.map === 'function' ? module : module.default;
  if (!namespace || typeof namespace.map !== 'function') throw new Error('Leaflet failed to load');
  return namespace;
}

/**
 * Reusable Leaflet map. Codes and offline lookups never depend on it: if Leaflet or tiles fail the
 * component reports the problem while the rest of the page keeps working.
 */
@Component({
  selector: 'app-map-view',
  imports: [Icon],
  template: `
    <div class="map-tools row" role="toolbar" aria-label="Map tools">
      <button type="button" class="btn btn-small" (click)="fitToMarkers()" [disabled]="markers().length === 0">
        <app-icon name="target" /> Fit to markers
      </button>
      <button type="button" class="btn btn-small" (click)="resetView()"><app-icon name="refresh" /> Reset view</button>
      @if (selectable()) {
        <button type="button" class="btn btn-small" (click)="selectCentre()" [disabled]="!ready()">
          <app-icon name="locate" /> Select map centre
        </button>
      }
      <button type="button" class="btn btn-small" [attr.aria-pressed]="expanded()" (click)="toggleExpanded()">
        <app-icon name="expand" /> {{ expanded() ? 'Shrink map' : 'Expand map' }}
      </button>
    </div>
    <div
      #container
      class="lt-map"
      role="application"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-describedby]="selectable() ? 'map-help' : null"
    ></div>
    @if (selectable()) {
      <p id="map-help" class="small muted">
        Click the map to choose a location. Keyboard: focus the map, use arrow keys to pan and +/− to zoom, then press “Select map
        centre”.
      </p>
    }
    @if (pointer(); as p) {
      <p class="small muted" aria-hidden="true">Pointer: {{ p }}</p>
    }
    @if (problem(); as message) {
      <p class="banner banner-warning" role="status">{{ message }}</p>
    }
    <ul class="legend" aria-label="Map legend">
      @for (entry of legend; track entry.kind) {
        <li><span [class]="'lt-marker lt-marker-' + entry.kind" aria-hidden="true"></span>{{ entry.label }}</li>
      }
    </ul>
  `,
  host: { '[class.lt-map-expanded]': 'expanded()' },
})
export class MapView {
  private readonly config = inject(APP_CONFIG);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  readonly markers = input<readonly MapMarker[]>([]);
  readonly activeId = input<string | null>(null);
  readonly selectable = input(false);
  readonly ariaLabel = input('Interactive map');
  readonly mapClick = output<{ latitude: number; longitude: number }>();

  protected readonly legend = MARKER_LEGEND;
  protected readonly ready = signal(false);
  protected readonly expanded = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly pointer = signal<string | null>(null);

  private L: typeof Leaflet | null = null;
  private map: Leaflet.Map | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private tileErrors = 0;
  private tilesLoaded = 0;

  constructor() {
    afterNextRender(() => void this.initialise());
    inject(DestroyRef).onDestroy(() => this.dispose());
    effect(() => {
      const markers = this.markers();
      const active = this.activeId();
      if (this.ready()) untracked(() => this.renderMarkers(markers, active, true));
    });
  }

  fitToMarkers(): void {
    const map = this.map;
    const L = this.L;
    const markers = this.markers();
    if (!map || !L || markers.length === 0) return;
    if (markers.length === 1) {
      map.setView([markers[0].latitude, markers[0].longitude], Math.max(map.getZoom(), 15));
      return;
    }
    map.fitBounds(L.latLngBounds(markers.map((marker) => [marker.latitude, marker.longitude] as Leaflet.LatLngTuple)), {
      padding: [40, 40],
      maxZoom: 16,
    });
  }

  resetView(): void {
    this.map?.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }

  protected selectCentre(): void {
    const centre = this.map?.getCenter();
    if (centre) this.mapClick.emit({ latitude: centre.lat, longitude: wrapLongitude(centre.lng) });
  }

  protected toggleExpanded(): void {
    this.expanded.update((value) => !value);
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  private async initialise(): Promise<void> {
    try {
      const L = leafletNamespace(await import('leaflet'));
      this.L = L;
      const element = this.container().nativeElement;
      const map = L.map(element, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, worldCopyJump: true, keyboard: true });
      const tiles = L.tileLayer(this.config.tiles.urlTemplate, {
        attribution: this.config.tiles.attribution,
        maxZoom: this.config.tiles.maxZoom,
        subdomains: this.config.tiles.subdomains ?? 'abc',
        crossOrigin: true,
      });
      tiles.on('tileerror', () => {
        this.tileErrors++;
        if (this.tileErrors >= 4 && this.tilesLoaded === 0) {
          this.problem.set('Map tiles are unavailable (offline or blocked). Codes, coordinates and offline locality lookup still work.');
        }
      });
      tiles.on('tileload', () => {
        this.tilesLoaded++;
        if (this.problem()) this.problem.set(null);
      });
      tiles.addTo(map);
      this.layer = L.layerGroup().addTo(map);
      map.on('click', (event: Leaflet.LeafletMouseEvent) => {
        if (this.selectable()) this.mapClick.emit({ latitude: event.latlng.lat, longitude: wrapLongitude(event.latlng.lng) });
      });
      map.on('mousemove', (event: Leaflet.LeafletMouseEvent) => {
        this.pointer.set(`${formatFixed(event.latlng.lat, 6)}, ${formatFixed(wrapLongitude(event.latlng.lng), 6)}`);
      });
      map.on('mouseout', () => this.pointer.set(null));
      this.map = map;
      this.resizeObserver = new ResizeObserver(() => map.invalidateSize());
      this.resizeObserver.observe(element);
      this.ready.set(true);
      this.renderMarkers(this.markers(), this.activeId(), true);
    } catch {
      this.problem.set('The interactive map could not be loaded. Codes, coordinates and offline locality lookup still work.');
    }
  }

  private renderMarkers(markers: readonly MapMarker[], activeId: string | null, focus: boolean): void {
    const L = this.L;
    const layer = this.layer;
    if (!L || !layer || !this.map) return;
    layer.clearLayers();
    for (const marker of markers) {
      const active = marker.id === activeId;
      const icon = L.divIcon({
        className: '',
        html: `<span class="lt-marker lt-marker-${marker.kind}${active ? ' lt-marker-active' : ''}"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 22],
        popupAnchor: [0, -22],
      });
      const leafletMarker = L.marker([marker.latitude, marker.longitude], {
        icon,
        title: marker.label,
        alt: marker.label,
        keyboard: true,
        zIndexOffset: active ? 1000 : 0,
      });
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = marker.label;
      const coords = document.createElement('div');
      coords.textContent = `${formatFixed(marker.latitude, 6)}, ${formatFixed(marker.longitude, 6)}`;
      popup.append(title, coords);
      leafletMarker.bindPopup(popup);
      leafletMarker.addTo(layer);
      if (marker.accuracyMetres && marker.accuracyMetres > 0) {
        L.circle([marker.latitude, marker.longitude], {
          radius: marker.accuracyMetres,
          weight: 1,
          color: marker.kind === 'ip' ? '#8a5300' : '#1b7f3b',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(layer);
      }
    }
    if (focus) {
      const active = markers.find((marker) => marker.id === activeId);
      if (active) this.map.setView([active.latitude, active.longitude], Math.max(this.map.getZoom(), 15));
      else this.fitToMarkers();
    }
  }

  private dispose(): void {
    this.resizeObserver?.disconnect();
    this.map?.off();
    this.map?.remove();
    this.map = null;
    this.layer = null;
  }
}

/** Leaflet may report longitudes outside ±180 after panning across the antimeridian. */
export function wrapLongitude(longitude: number): number {
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && longitude > 0 ? 180 : wrapped;
}
