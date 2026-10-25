import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
import { shellManifest, shellState, waitForOfflineShell, withOfflineDiagnostics } from './offline-shell';
import type { BrowserContext, Page } from '@playwright/test';

const NUMERIC = '0 370 697 756 405 661 642';
const SHORT = '23G93-PU3ER-X2S3P';

/** Map tiles are third-party; block them so tests never depend on or load the public OSM servers. */
async function blockTiles(context: BrowserContext): Promise<void> {
  await context.route(/tile\.openstreetmap\.org|tile\.example/, (route) => route.abort());
}

async function decode(page: Page, value: string): Promise<void> {
  await page.goto('easy');
  await page.getByTestId('easy-input').fill(value);
  await page.getByTestId('easy-submit').click();
}

test.beforeEach(async ({ context }) => {
  await blockTiles(context);
});

test('decodes a code, shows the marker, copies, saves, survives reload and opens Google Maps', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await decode(page, NUMERIC);
  await expect(page.getByTestId('latitude')).toHaveText('12.971598');
  await expect(page.getByTestId('longitude')).toHaveText('77.594566');
  await expect(page.getByTestId('short-code')).toHaveText(SHORT);
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();

  await page.getByRole('button', { name: 'Copy short code' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SHORT);

  await page.getByTestId('save-location').click();
  await expect(page.getByTestId('save-location')).toHaveText(/Saved/);

  await page.reload();
  await page.getByRole('link', { name: 'Saved Places' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Saved Places' })).toBeVisible();
  const saved = page.getByRole('list', { name: 'Saved places' }).getByRole('listitem');
  await expect(saved).toHaveCount(1);
  await expect(saved.first()).toContainText('12.971598');

  await decode(page, SHORT);
  const maps = page.getByTestId('open-maps');
  await expect(maps).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=12.971598%2C77.594566');
  await expect(maps).toHaveAttribute('rel', /noopener/);
  const popupPromise = context.waitForEvent('page');
  await context.route('https://www.google.com/**', (route) => route.fulfill({ status: 200, body: 'maps stub' }));
  await maps.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toContain('google.com/maps/search/?api=1&query=12.971598%2C77.594566');
});

test('rejects an invalid checksum instead of guessing coordinates', async ({ page }) => {
  await decode(page, '0 370 697 756 405 661 643');
  await expect(page.getByTestId('easy-error')).toContainText(/check/i);
  await expect(page.getByTestId('latitude')).toHaveCount(0);
});

test('reports a denied location permission clearly', async ({ page, context }) => {
  await context.clearPermissions();
  await page.goto('easy');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail: (error: object) => void) => fail({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }) },
    });
  });
  await page.getByRole('button', { name: 'Detect my location' }).click();
  await expect(page.getByText(/permission was denied/i)).toBeVisible();
});

test('serves deep links through the Pages 404 fallback', async ({ page }) => {
  const response = await page.goto('offline-data');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Offline Data' })).toBeVisible();
});

test('keeps decoding while the browser is offline', async ({ page, context }) => {
  await page.goto('easy');
  await context.setOffline(true);
  await page.getByTestId('easy-input').fill('-33.86882, 151.209296');
  await page.getByTestId('easy-submit').click();
  await expect(page.getByTestId('numeric-code')).toHaveText('0 202 072 251 873 404 765');
  await expect(page.locator('.connection')).toContainText('Offline');
  await context.setOffline(false);
});

test('reloads the app shell offline from the service worker cache', async ({ page, context }, info) => {
  test.slow();
  await withOfflineDiagnostics(page, context, info, async (record) => {
    await page.goto('./');
    const manifest = await shellManifest(page);
    await waitForOfflineShell(page, manifest);
    await context.setOffline(true);
    for (const path of ['./', 'easy']) {
      const navigation = await page.goto(path);
      record(navigation);
      expect(navigation?.status()).toBe(200);
      expect(navigation?.fromServiceWorker()).toBe(true);
      const response = await page.reload();
      record(response);
      expect(response?.status()).toBe(200);
      expect(response?.fromServiceWorker()).toBe(true);
      expect(response?.headers()['content-type']).toContain('text/html');
      await expect(page.locator('base')).toHaveAttribute('href', '/localtell-data/');
      if (path === './') await expect(page.getByRole('heading', { level: 1, name: 'LocalTell Web' })).toBeVisible();
      else {
        await page.getByTestId('easy-input').fill(SHORT);
        await page.getByTestId('easy-submit').click();
        await expect(page.getByTestId('latitude')).toHaveText('12.971598');
      }
    }
  });
});

test('offline readiness waits for prefetched JavaScript after index.html is cached', async ({ page, context }, info) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route(/\/main-[^/]+\.js$/, async (route) => {
    if (route.request().serviceWorker()) await gate;
    await route.continue();
  });
  try {
    await withOfflineDiagnostics(page, context, info, async (record) => {
      await page.goto('./');
      const manifest = await shellManifest(page);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await expect.poll(async () => {
        const state = await shellState(page, manifest);
        return !state.missing.includes(manifest.index) && state.missing.some((url) => /\/main-[^/]+\.js$/.test(url));
      }).toBe(true);
      let ready = false;
      const readiness = waitForOfflineShell(page, manifest).then(() => { ready = true; });
      expect(ready).toBe(false);
      release();
      await readiness;
      await context.setOffline(true);
      const response = await page.goto('easy');
      record(response);
      expect(response?.fromServiceWorker()).toBe(true);
      await page.getByTestId('easy-input').fill(SHORT);
      await page.getByTestId('easy-submit').click();
      await expect(page.getByTestId('latitude')).toHaveText('12.971598');
    });
  } finally {
    release();
  }
});

for (const path of ['./', 'easy', 'saved', 'offline-data', 'backup', 'settings', 'compare', 'map']) {
  test(`has no axe WCAG A/AA violations on /${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`)).toEqual([]);
  });
}

test('downloads, verifies and uses an offline pack from the same-origin mirror', async ({ page, context }) => {
  test.skip(!process.env['E2E_PACKS'], 'Set E2E_PACKS=1 after `npm run mirror:data -- --countries=LK`.');
  test.slow();
  await page.goto('offline-data');
  const pack = page.getByTestId('pack-LK-1');
  await expect(pack).toBeVisible({ timeout: 60_000 });
  await pack.getByRole('button', { name: 'Download Western Province' }).click();
  await expect(pack).toContainText('Installed v1', { timeout: 120_000 });

  await decode(page, '6.927079, 79.861244');
  await expect(page.getByText('From pack LK-1')).toBeVisible({ timeout: 30_000 });

  // The installed pack survives a reload; once the lookup worker is loaded it answers without network.
  await page.reload();
  await page.getByTestId('easy-input').fill('6.927079, 79.861244');
  await page.getByTestId('easy-submit').click();
  await expect(page.getByText('From pack LK-1')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.getByTestId('easy-input').fill('7.087310, 79.999000');
  await page.getByTestId('easy-submit').click();
  await expect(page.getByTestId('latitude')).toHaveText('7.087310');
  await expect(page.getByText('From pack LK-1')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
});
