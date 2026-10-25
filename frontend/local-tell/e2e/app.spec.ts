import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';
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

test('reloads the app shell offline from the service worker cache', async ({ page, context }) => {
  test.slow();
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60_000 }).toBeTruthy();
  // The app shell is usable offline only after the worker has cached index.html.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          for (const key of await caches.keys()) {
            if (await (await caches.open(key)).match(new URL('index.html', document.baseURI).href)) return true;
          }
          return false;
        }),
      { timeout: 60_000 },
    )
    .toBe(true);
  await context.setOffline(true);
  await page.goto('easy');
  await page.getByTestId('easy-input').fill(SHORT);
  await page.getByTestId('easy-submit').click();
  await expect(page.getByTestId('latitude')).toHaveText('12.971598');
  await context.setOffline(false);
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
