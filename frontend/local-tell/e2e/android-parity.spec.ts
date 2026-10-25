import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { shellManifest, waitForOfflineShell } from './offline-shell';

const feed = JSON.parse(readFileSync(resolve(process.cwd(), '../../announcements/home.json'), 'utf8'));
const feedUrl = 'https://raw.githubusercontent.com/actionanand/localtell-data/master/announcements/home.json';

test.beforeEach(async ({ context, page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
  await context.route(/tile\.openstreetmap\.org/, (route) => route.abort());
  await context.route(feedUrl, (route) => route.fulfill({ json: feed }));
});

for (const failure of ['missing', 'corrupt'] as const) {
  test(`boundary asset ${failure} leaves worldwide codes usable`, async ({ page, context }) => {
    await context.route(/\/geography\/boundaries\.ltgz(?:\?|$)/, (route) => route.fulfill({ status: failure === 'missing' ? 404 : 200, body: 'not the pinned boundary index' }));
    await page.goto('easy');
    await page.getByTestId('easy-input').fill('23G93-PU3ER-X2S3P');
    await page.getByTestId('easy-submit').click();
    await expect(page.getByTestId('latitude')).toHaveText('12.971598');
    await expect(page.getByText('Built-in geographic guidance is unavailable.', { exact: false })).toBeVisible();
  });
}

test('broad device accuracy does not guess a precise Indian state', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 28.6139, longitude: 77.209, accuracy: 25000 });
  await page.goto('easy');
  await page.getByRole('button', { name: 'Detect my location', exact: true }).click();
  await expect(page.getByTestId('country-result')).toHaveText('India');
  await expect(page.getByTestId('admin-result')).toHaveText('Not confidently identified');
});

test('built-in India guidance works offline independently of locality databases', async ({ page, context }) => {
  await page.goto('easy');
  await page.getByTestId('easy-input').fill('12.971598, 77.594566');
  await page.getByTestId('easy-submit').click();
  await expect(page.getByTestId('country-result')).toHaveText('India');
  await expect(page.getByTestId('admin-result')).toHaveText('Karnataka');
  await expect(page.getByText('Offline locality data is not installed for this location.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download Karnataka data' })).toHaveCount(0);
  await waitForOfflineShell(page, await shellManifest(page));
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('easy-input').fill('10.5276, 76.2144');
  await page.getByTestId('easy-submit').click();
  await expect(page.getByTestId('country-result')).toHaveText('India');
  await expect(page.getByTestId('admin-result')).toHaveText('Kerala');
  await context.setOffline(false);
});

test('administrative inventory remains visible without any online manifest', async ({ page, context }) => {
  await context.route('**/data-mirror/**', (route) => route.abort());
  await page.goto('offline-data');
  await expect(page.getByTestId('country-IN')).toBeVisible();
  await expect(page.locator('[data-testid^="admin-"]')).toHaveCount(45);
  await page.getByTestId('country-IN').locator('summary').filter({ hasText: 'South India' }).click();
  await expect(page.getByTestId('admin-KA')).toContainText('Karnataka');
  await expect(page.getByTestId('admin-KA')).toContainText('Catalog unavailable');
  await expect(page.getByRole('button', { name: 'Download country', exact: true }).first()).toBeDisabled();
});

test('validated stable admin codes enable only the matching targeted download', async ({ page, context }) => {
  await context.route('**/data-mirror/cell-data-v3/manifest.json', (route) => route.fulfill({ json: { schemaVersion: 2, packs: [
    { id: 'KA', name: 'Karnataka', region: 'south', version: 3, displayOrder: 3, sha256: 'a'.repeat(64), downloadUrl: 'https://example.test/KA.db.gz', compressedBytes: 100, uncompressedBytes: 200 },
  ] } }));
  await page.goto('offline-data');
  await page.getByLabel('Search packs').fill('IN-KA');
  await expect(page.getByTestId('admin-KA')).toContainText('Downloadable');
  await page.getByRole('link', { name: 'Easy Location', exact: true }).click();
  await page.getByTestId('easy-input').fill('12.971598, 77.594566');
  await page.getByTestId('easy-submit').click();
  await expect(page.getByRole('button', { name: 'Download Karnataka data' })).toBeVisible();
});

test('announcements share dismissals and remain suppressed after a result is cleared', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('announcement')).toContainText('Sri Lanka');
  await page.getByRole('button', { name: 'Dismiss announcement' }).click();
  await page.getByRole('link', { name: 'Easy Location', exact: true }).click();
  await expect(page).toHaveURL(/\/easy$/);
  await expect(page.getByTestId('announcement')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('announcement')).toBeVisible();
  await page.getByTestId('easy-input').fill('23G93-PU3ER-X2S3P');
  await page.getByTestId('easy-submit').click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('announcement')).toHaveCount(0);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByTestId('announcement')).toHaveCount(0);
});

test('once-per-revision dismissals persist offline and a newer revision can return', async ({ page, context }) => {
  const notice = { ...feed.announcements[0], repeatPolicy: 'once_per_revision', revision: 1 };
  await context.unroute(feedUrl);
  await context.route(feedUrl, (route) => route.fulfill({ json: { schemaVersion: 1, announcements: [notice] } }));
  await page.goto('./');
  await expect(page.getByTestId('announcement')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss announcement' }).click();
  await waitForOfflineShell(page, await shellManifest(page));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('announcement')).toHaveCount(0);
  await context.setOffline(false);
  notice.revision = 2;
  await page.reload();
  await expect(page.getByTestId('announcement')).toBeVisible();
});

test('the validated shared feed remains visible on an offline app reload', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByTestId('announcement')).toContainText('Sri Lanka');
  await waitForOfflineShell(page, await shellManifest(page));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('announcement')).toContainText('Sri Lanka');
  await context.setOffline(false);
});

test('a location acquired on Comparison suppresses Dashboard announcements for the session', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 12.971598, longitude: 77.594566, accuracy: 20 });
  await page.goto('./');
  await expect(page.getByTestId('announcement')).toBeVisible();
  await page.getByRole('link', { name: 'Location Comparison', exact: true }).click();
  await page.getByRole('button', { name: 'Detect my location', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh device location', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'LocalTell Web' })).toBeVisible();
  await expect(page.getByTestId('announcement')).toHaveCount(0);
});

test('theme follows System and persists an explicit mode across reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('settings');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radio', { name: 'System', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F7FAF7');
});

for (const theme of ['light', 'dark'] as const) {
  test(`Android ${theme} palette passes accessibility across feature routes`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    for (const path of ['./', 'easy', 'offline-data', 'saved', 'compare', 'backup', 'settings', 'map']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main h1')).toBeVisible();
      if (path === 'easy') {
        await page.getByTestId('easy-input').fill('23G93-PU3ER-X2S3P');
        await page.getByTestId('easy-submit').click();
        await expect(page.getByTestId('admin-result')).toHaveText('Karnataka');
      }
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), path).toEqual([]);
    }
  });
}