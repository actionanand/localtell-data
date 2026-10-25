import { computed, DestroyRef, effect, inject, Service, signal } from '@angular/core';
import { BrowserGeolocationService } from '../geolocation/browser-geolocation.service';
import { IpGeolocationService } from '../ip-geolocation/ip-geolocation.service';
import { getSetting, putSetting } from '../storage/idb';
import { dismissedRevision, localizeAnnouncement, parseAnnouncements, selectAnnouncement, type Announcement } from './announcements';

const FEED = 'https://raw.githubusercontent.com/actionanand/localtell-data/master/announcements/home.json';
const CACHE = 'announcements.document.v1';
const DISMISSED = 'announcements.dismissed.v1';

@Service()
export class AnnouncementService {
  private readonly device = inject(BrowserGeolocationService);
  private readonly ip = inject(IpGeolocationService);
  private readonly items = signal<Announcement[]>([]);
  private readonly persisted = signal<Record<string, number>>({});
  private readonly dismissed = signal<Record<string, number>>({});
  private readonly suppressed = signal(false);
  private readonly now = signal(Date.now());
  private lastRefresh = -Infinity;
  private pending = false;
  private started = false;
  readonly visible = computed(() => selectAnnouncement(this.items(), this.now(), this.dismissed(), this.persisted(), this.suppressed()));

  constructor() {
    effect(() => {
      if (this.device.current().status === 'located' || this.ip.current().status === 'located') this.suppressForSession();
    });
    const refresh = () => { this.now.set(Date.now()); if (document.visibilityState === 'visible') void this.refresh(); };
    const foreground = () => { this.now.set(Date.now()); if (document.visibilityState === 'visible') void this.refresh(60000); };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', foreground);
    const timer = setInterval(refresh, 30000);
    inject(DestroyRef).onDestroy(() => { clearInterval(timer); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', foreground); });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const [cached, revisions] = await Promise.all([getSetting<string>(CACHE), getSetting<Record<string, number>>(DISMISSED)]);
      if (revisions && typeof revisions === 'object') this.persisted.set(Object.fromEntries(Object.entries(revisions).filter(([key, value]) => /^[A-Za-z0-9._-]{1,100}$/.test(key) && Number.isInteger(value) && value > 0)));
      if (cached) this.items.set(parseAnnouncements(cached));
    } catch { /* A broken cached document never replaces a validated response. */ }
    await this.refresh();
  }

  suppressForSession(): void { this.suppressed.set(true); }

  dismiss(): void {
    const item = this.visible();
    if (!item) return;
    this.dismissed.update((current) => ({ ...current, [item.id]: Math.max(dismissedRevision(current, item.id), item.revision) }));
    if (item.repeatPolicy === 'once_per_revision') {
      this.persisted.update((current) => ({ ...current, [item.id]: Math.max(dismissedRevision(current, item.id), item.revision) }));
      void putSetting(DISMISSED, this.persisted()).catch(() => undefined);
    }
  }

  text(value: Record<string, string>): string { return localizeAnnouncement(value, navigator.language); }

  async refresh(interval = 300000): Promise<void> {
    if (this.pending || this.suppressed() || performance.now() - this.lastRefresh < interval) return;
    this.lastRefresh = performance.now(); this.pending = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(FEED, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 65536) throw new Error('Announcement request failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > 65536) throw new Error('Announcement document too large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const items = parseAnnouncements(text);
      await putSetting(CACHE, text).catch(() => undefined);
      this.items.set(items); this.now.set(Date.now());
    } catch { /* Keep the last validated feed; announcement failures never block location work. */ }
    finally { clearTimeout(timer); this.pending = false; }
  }
}