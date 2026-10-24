import { Component, input } from '@angular/core';
import type { AppRestorePlan } from '../../core/backup/app-backup-data';

@Component({
  selector: 'app-restore-preview',
  template: `
    @let p = plan();
    <dl class="kv">
      <dt>Saved Places in backup</dt>
      <dd>{{ p.saved.added + p.saved.duplicates }}</dd>
      <dt>New places to add</dt>
      <dd>{{ p.saved.added }}</dd>
      <dt>Already saved (kept as is)</dt>
      <dd>{{ p.saved.duplicates }}</dd>
      <dt>Saved Places after restore</dt>
      <dd>
        {{ p.saved.total }} (limit {{ savedLimit() }})
        @if (!p.saved.fits) {
          <span class="badge badge-warning">Exceeds limit — nothing will be restored</span>
        } @else if (p.saved.total > savedLimit()) {
          <span class="badge badge-warning">Over the configured limit; new saves pause until places are removed</span>
        }
      </dd>
      <dt>Journey records in backup</dt>
      <dd>{{ p.journey.additions.length + p.journey.duplicates }}</dd>
      <dt>New Journey records</dt>
      <dd>{{ p.journey.additions.length }} ({{ p.journey.insertions.length }} kept after retention)</dd>
      <dt>Journey duplicates skipped</dt>
      <dd>{{ p.journey.duplicates }}</dd>
      <dt>Journey records removed by retention</dt>
      <dd>{{ p.journey.removed }} (keeping newest {{ p.journey.total }})</dd>
    </dl>
    <p class="small muted">Existing local records always win duplicates. Nothing is deleted except Journey entries beyond the configured retention.</p>
  `,
})
export class RestorePreview {
  readonly plan = input.required<AppRestorePlan>();
  readonly savedLimit = input.required<number>();
}
