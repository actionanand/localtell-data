import { Component, inject, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PackCatalogService } from '../../core/geographic-packs/pack-catalog.service';
import { formatPackBytes, type RemotePack } from '../../core/geographic-packs/pack-manifest';

const PHASE_LABELS = { download: 'Downloading', verify: 'Verifying SHA-256', decompress: 'Decompressing', validate: 'Validating database', activate: 'Activating (can no longer be cancelled)' } as const;

@Component({
  selector: 'app-pack-list',
  imports: [DatePipe],
  template: `
    <ul class="list">
      @for (pack of packs(); track pack.id) {
        @let job = catalog.jobs().get(pack.id);
        @let state = status(pack);
        @let installed = catalog.installedById().get(pack.id);
        <li class="pack-row" [attr.data-testid]="'pack-' + pack.id">
          <div>
            <strong>{{ pack.name }}</strong>
            <span class="muted small">
              {{ pack.id }} · v{{ pack.version }} · {{ bytes(pack.compressedBytes) }} download, {{ bytes(pack.uncompressedBytes) }} stored</span
            >
            <div class="small">
              @switch (state) {
                @case ('installed') {
                  <span class="badge badge-success">Installed v{{ installed?.version }}</span>
                  <span class="muted"> {{ installed?.installedAt | date: 'mediumDate' }}</span>
                }
                @case ('newer') {
                  <span class="badge badge-success">Installed (newer v{{ installed?.version }})</span>
                }
                @case ('update') {
                  <span class="badge badge-warning">Update available (installed v{{ installed?.version }})</span>
                }
                @default {
                  <span class="badge">Not installed</span>
                }
              }
            </div>
            @if (job) {
              @if (job.status === 'running') {
                <div role="status" class="small">
                  {{ job.phase ? phases[job.phase] : 'Starting' }}
                  @if (job.percent !== null) {
                    {{ job.percent }}%
                  }
                  <progress class="progress" max="100" [value]="job.percent" [attr.aria-label]="'Progress for ' + pack.name"></progress>
                </div>
              } @else if (job.status === 'queued') {
                <span class="small muted" role="status">Queued</span>
              } @else {
                <p class="banner small" [class.banner-error]="job.status === 'failed'" [class.banner-warning]="job.status === 'cancelled'" role="alert">
                  {{ job.error }}
                </p>
              }
            }
          </div>
          <div class="row">
            @if (job && (job.status === 'running' || job.status === 'queued') && job.phase !== 'activate') {
              <button type="button" class="btn btn-small" (click)="catalog.cancel(pack.id)" [attr.aria-label]="'Cancel ' + pack.name">Cancel</button>
            } @else if (job && (job.status === 'failed' || job.status === 'cancelled') && allowDownload()) {
              <button type="button" class="btn btn-small" (click)="catalog.enqueue([pack])" [attr.aria-label]="'Retry ' + pack.name">Retry</button>
              <button type="button" class="btn btn-small" (click)="catalog.dismissJob(pack.id)">Dismiss</button>
            } @else if ((state === 'missing' || state === 'update') && allowDownload()) {
              <button
                type="button"
                class="btn btn-small btn-primary"
                (click)="catalog.enqueue([pack])"
                [attr.aria-label]="(state === 'update' ? 'Update ' : 'Download ') + pack.name"
              >
                {{ state === 'update' ? 'Update' : 'Download' }}
              </button>
            }
            @if (state !== 'missing') {
              <button type="button" class="btn btn-small btn-danger" (click)="removeRequested.emit(pack)" [attr.aria-label]="'Remove ' + pack.name">
                Remove
              </button>
            }
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .pack-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.5rem;
      align-items: center;
    }
    @media (max-width: 600px) {
      .pack-row {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class PackList {
  protected readonly catalog = inject(PackCatalogService);
  protected readonly phases = PHASE_LABELS;
  readonly packs = input.required<readonly RemotePack[]>();
  readonly allowDownload = input(true);
  readonly removeRequested = output<RemotePack>();

  protected bytes(value: number | null): string {
    return formatPackBytes(value) ?? '—';
  }

  protected status(pack: RemotePack): 'installed' | 'update' | 'newer' | 'missing' {
    const installed = this.catalog.installedById().get(pack.id);
    if (!installed) return 'missing';
    if (installed.version < pack.version) return 'update';
    return installed.version > pack.version ? 'newer' : 'installed';
  }
}
