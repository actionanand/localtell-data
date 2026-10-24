import { defineConfig } from '@playwright/test';

const port = Number(process.env['E2E_PORT'] ?? 4300);

/**
 * Browser integration tests against the production build served like GitHub Pages
 * (`npm run build:gh`, optionally `npm run mirror:data -- --countries=LK`, then `npm run e2e`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}/localtell-data/`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    url: `http://localhost:${port}/localtell-data/`,
    env: { PORT: String(port), BASE_HREF: '/localtell-data/' },
    reuseExistingServer: !process.env['CI'],
  },
});
