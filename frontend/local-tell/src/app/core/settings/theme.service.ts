import { computed, DestroyRef, inject, Service, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_KEY = 'localtell.theme.v1';
export function resolveTheme(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? systemDark ? 'dark' : 'light' : mode;
}

@Service()
export class ThemeService {
  private readonly media = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly selected = signal<ThemeMode>(this.read());
  private readonly systemDark = signal(this.media?.matches ?? false);
  readonly mode = this.selected.asReadonly();
  readonly effective = computed(() => resolveTheme(this.selected(), this.systemDark()));

  constructor() {
    const changed = () => { this.systemDark.set(this.media?.matches ?? false); this.apply(); };
    this.media?.addEventListener('change', changed);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', changed));
    this.apply();
  }

  set(mode: ThemeMode): void {
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* The current session can still use the selected theme. */ }
    this.selected.set(mode); this.apply();
  }

  apply(): void {
    const dark = this.effective() === 'dark';
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#09120D' : '#F7FAF7');
  }

  private read(): ThemeMode {
    try { const value = localStorage.getItem(THEME_KEY); return value === 'light' || value === 'dark' ? value : 'system'; }
    catch { return 'system'; }
  }
}