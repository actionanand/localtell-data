import { test as base, chromium, type Browser } from '@playwright/test';

/**
 * Uses a browser reached over CDP when PW_CDP_ENDPOINT is set (e.g. Windows Chrome from WSL1, where
 * Linux Chrome cannot start); otherwise Playwright launches its own Chromium.
 */
export const test = base.extend<object, { browser: Browser }>({
  browser: [
    async ({ playwright }, use) => {
      const endpoint = process.env['PW_CDP_ENDPOINT'];
      const browser = endpoint ? await chromium.connectOverCDP(endpoint) : await playwright.chromium.launch();
      await use(browser);
      await browser.close();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
