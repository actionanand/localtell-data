import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnnouncementService } from '../../core/announcements/announcement.service';
import { Icon } from './icon';

@Component({
  selector: 'app-announcement-card',
  imports: [RouterLink, Icon],
  template: `
    @if (announcements.visible(); as item) {
      <aside class="announcement mb" [class.critical]="item.type === 'critical'" aria-labelledby="announcement-title" data-testid="announcement">
        <div class="row"><h2 id="announcement-title">{{ announcements.text(item.title) }}</h2>
          <button type="button" class="icon-button" aria-label="Dismiss announcement" title="Dismiss announcement" (click)="announcements.dismiss()"><app-icon name="close" /></button></div>
        <p>{{ announcements.text(item.message) }}</p>
        <span class="badge" [class.badge-warning]="item.type === 'critical' || item.type === 'downtime'">{{ item.type }}</span>
        @if (item.action === 'offline_data') { <a routerLink="/offline-data">Offline data</a> }
        @if (item.action === 'open_play_store' && item.actionUrl) { <a [href]="item.actionUrl" target="_blank" rel="noopener noreferrer">Open Play Store</a> }
      </aside>
    }
  `,
  styles: `.announcement { padding: 1rem; border-inline-start: 4px solid var(--lt-primary); background: var(--lt-primary-soft); } .critical { border-color: var(--lt-error); } h2 { font-size: 1rem; margin: 0; } p { margin: .5rem 0; }`,
})
export class AnnouncementCard implements OnInit {
  protected readonly announcements = inject(AnnouncementService);
  ngOnInit(): void { void this.announcements.start(); }
}