import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { App } from './app';
import { routes } from './app.routes';
import { APP_CONFIG } from './core/config/app-config';
import { NotificationService } from './core/ui/notification.service';
import { TEST_CONFIG } from '../testing/test-config';

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), { provide: APP_CONFIG, useValue: TEST_CONFIG }],
    }).compileComponents();
  });

  afterEach(() => vi.restoreAllMocks());

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the LocalTell brand, skip link and all primary destinations', async () => {
    const element = await render();
    expect(element.querySelector('.brand')?.textContent).toContain('LocalTell');
    expect(element.querySelector('.skip-link')?.getAttribute('href')).toBe('#main-content');
    const labels = [...element.querySelectorAll('#primary-nav a')].map((link) => link.textContent?.trim());
    expect(labels).toEqual([
      'Dashboard',
      'Easy Location',
      'Interactive Map',
      'Offline Data',
      'Saved Places',
      'Location Comparison',
      'Dropbox Backup',
      'Settings',
    ]);
    expect(element.querySelector('main#main-content')).not.toBeNull();
  });

  it('toggles the mobile navigation with an accessible state', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const toggle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.menu-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    toggle?.click();
    await fixture.whenStable();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('Close navigation menu');
  });

  it('explains which features keep working offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fixture = TestBed.createComponent(App);
    window.dispatchEvent(new Event('offline'));
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.connection')?.textContent).toContain('Offline');
  });

  it('announces notifications in a polite live region', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(NotificationService).show('Numeric code copied.', 'success', 0);
    await fixture.whenStable();
    const region = (fixture.nativeElement as HTMLElement).querySelector('.toasts');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toContain('Numeric code copied.');
  });

  it('has no automatically detectable accessibility violations', async () => {
    const element = await render();
    document.body.appendChild(element);
    // jsdom cannot compute layout, so contrast is verified in the browser integration tests instead.
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    element.remove();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
