import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DropboxAuthService } from '../../core/dropbox/dropbox-auth.service';
import { DropboxBackupService } from '../../core/dropbox/dropbox-backup.service';

/** OAuth redirect target. Removes the authorization code from the address bar immediately. */
@Component({
  selector: 'app-dropbox-callback',
  imports: [RouterLink],
  template: `
    <section class="card" aria-live="polite">
      <h1>Connecting Dropbox</h1>
      @if (done()) {
        <p>{{ auth.connection().message ?? (auth.connected() ? 'Dropbox is connected.' : 'Dropbox was not connected.') }}</p>
        <a routerLink="/backup" class="btn btn-primary">Go to Dropbox Backup</a>
      } @else {
        <p role="status">Verifying the Dropbox response…</p>
      }
    </section>
  `,
})
export class DropboxCallback implements OnInit {
  protected readonly auth = inject(DropboxAuthService);
  private readonly backup = inject(DropboxBackupService);
  private readonly router = inject(Router);
  protected readonly done = signal(false);

  async ngOnInit(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    history.replaceState(history.state, '', window.location.pathname);
    await this.auth.completeAuthorization(params);
    this.done.set(true);
    if (this.auth.connected()) {
      await this.backup.loadMeta().catch(() => undefined);
      await this.router.navigate(['/backup'], { replaceUrl: true });
    }
  }
}
