import { Component, computed, inject, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ConnectivityService } from './core/ui/connectivity.service';
import { NotificationService } from './core/ui/notification.service';
import { StartupService } from './core/startup.service';
import { Icon, type IconName } from './shared/components/icon';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
  readonly exact: boolean;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, NgOptimizedImage],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class App {
  private readonly connectivity = inject(ConnectivityService);
  private readonly startup = inject(StartupService);
  protected readonly notifications = inject(NotificationService);
  protected readonly online = this.connectivity.online;
  protected readonly storageError = this.startup.storageError;
  protected readonly menuOpen = signal(false);
  protected readonly menuLabel = computed(() => (this.menuOpen() ? 'Close navigation menu' : 'Open navigation menu'));

  protected readonly nav: readonly NavItem[] = [
    { path: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
    { path: '/easy', label: 'Easy Location', icon: 'search', exact: false },
    { path: '/map', label: 'Interactive Map', icon: 'map', exact: false },
    { path: '/offline-data', label: 'Offline Data', icon: 'download', exact: false },
    { path: '/saved', label: 'Saved Places', icon: 'bookmark', exact: false },
    { path: '/compare', label: 'Location Comparison', icon: 'compare', exact: false },
    { path: '/backup', label: 'Dropbox Backup', icon: 'cloud', exact: false },
    { path: '/settings', label: 'Settings', icon: 'settings', exact: false },
  ];

  constructor() {
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.menuOpen.set(false);
    });
  }

  protected focusMain(event: Event): void {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  }
}
