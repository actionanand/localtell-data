import { createServer, type IncomingHttpHeaders } from 'node:http';
import { test, expect } from './fixtures';

test.use({ serviceWorkers: 'block' });

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`OSM attribution and browser Referer at ${viewport.width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize(viewport);
    const requests: { url: string; headers: Record<string, string> }[] = [];
    await context.route('https://tile.openstreetmap.org/**', async (route) => {
      requests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
      await route.abort();
    });
    await page.goto('easy');
    const attribution = page.locator('.leaflet-control-attribution');
    const copyright = attribution.getByRole('link', { name: 'OpenStreetMap' });
    await expect(copyright).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(attribution).toContainText('©');
    await expect(attribution).toContainText('contributors');
    const assertUnobscured = async () => {
      await copyright.scrollIntoViewIfNeeded();
      await expect(copyright).toBeVisible();
      expect(await copyright.evaluate((link) => {
        const rect = link.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return link === hit || link.contains(hit);
      })).toBe(true);
    };
    await assertUnobscured();
    await page.getByRole('button', { name: 'Expand map' }).click();
    await assertUnobscured();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
      expect(request.headers['referer']).toBe(new URL(baseURL!).origin + '/');
      expect(request.headers['cache-control'] ?? '').not.toContain('no-cache');
      expect(request.headers['pragma'] ?? '').not.toContain('no-cache');
    }
  });
}

test('native browser tile-image caching honours freshness and ETag revalidation', async ({ page }) => {
  const requests: { path: string; headers: IncomingHttpHeaders }[] = [];
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=', 'base64');
  const server = createServer((request, response) => {
    requests.push({ path: request.url!, headers: request.headers });
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', request.url === '/fresh.png' ? 'public, max-age=3600' : 'public, max-age=0');
    response.setHeader('Expires', new Date(request.url === '/fresh.png' ? Date.now() + 3600000 : 0).toUTCString());
    response.setHeader('ETag', '"localtell-test-tile"');
    if (request.headers['if-none-match'] === '"localtell-test-tile"') response.writeHead(304).end();
    else response.writeHead(200, { 'Content-Type': 'image/png' }).end(image);
  });
  await new Promise<void>((resolve) => server.listen(4399, resolve));
  try {
    await page.goto('backup');
    await page.evaluate(async () => {
      const load = (url: string) => new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Test tile failed to load'));
        image.src = url;
        document.body.append(image);
      });
      await load('http://localhost:4399/fresh.png');
      await load('http://localhost:4399/fresh.png');
      await fetch('http://localhost:4399/stale.png');
      await fetch('http://localhost:4399/stale.png');
    });
    expect(requests.filter((request) => request.path === '/fresh.png')).toHaveLength(1);
    const stale = requests.filter((request) => request.path === '/stale.png');
    expect(stale).toHaveLength(2);
    expect(stale[1].headers['if-none-match']).toBe('"localtell-test-tile"');
    expect(requests.every((request) => !!request.headers.referer)).toBe(true);
    expect(requests.every((request) => !String(request.headers['cache-control']).includes('no-cache'))).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});