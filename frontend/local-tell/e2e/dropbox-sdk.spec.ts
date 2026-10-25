import { test, expect } from './fixtures';
import type { BrowserContext } from '@playwright/test';

const authorize = /^https:\/\/(?:www\.)?dropbox\.com\/oauth2\/authorize(?:\?|$)/;
async function seedSession(context: BrowserContext, expired: boolean): Promise<void> {
  await context.addInitScript(({ expired }) => {
    sessionStorage.setItem('localtell.dropbox.credential.v1', JSON.stringify({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + (expired ? -1000 : 3600000), scope: 'account_info.read files.metadata.read files.content.read files.content.write' }));
  }, { expired });
}

test('production SDK restores a session and refreshes expired access tokens', async ({ page, context }) => {
  test.skip(!process.env['E2E_DROPBOX'], 'Requires a configured synthetic production build.');
  await seedSession(context, true);
  let refreshed = false;
  await context.route('**/oauth2/token**', (route) => {
    refreshed = true;
    return route.fulfill({ json: { access_token: 'synthetic-renewed', token_type: 'bearer', expires_in: 14400 }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await context.route('**/2/users/get_current_account', (route) => route.fulfill({ json: { account_id: 'dbid:synthetic', name: { display_name: 'Synthetic Test Account' } }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('backup');
  await expect(page.getByText('Synthetic Test Account')).toBeVisible();
  expect(refreshed).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('localtell.dropbox.credential.v1'))).toBeNull();
});

test('expired credentials offer a fresh connection rather than an endless spinner', async ({ page, context }) => {
  test.skip(!process.env['E2E_DROPBOX'], 'Requires a configured synthetic production build.');
  await seedSession(context, true);
  await context.route('**/oauth2/token**', (route) => route.fulfill({ status: 400, json: { error: 'invalid_grant' }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await context.route(authorize, (route) => route.fulfill({ body: 'Authorization intercepted' }));
  await page.goto('backup');
  await expect(page.getByText(/access expired or was revoked/i)).toBeVisible();
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await expect(page).toHaveURL(authorize);
});

test('authorization cancellation preserves local data and allows reconnecting', async ({ page, context }) => {
  test.skip(!process.env['E2E_DROPBOX'], 'Requires a configured synthetic production build.');
  await context.route(authorize, (route) => route.fulfill({ body: 'Authorization intercepted' }));
  await page.goto('backup');
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await expect(page).toHaveURL(authorize);
  const authorization = new URL(page.url());
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  callback.searchParams.set('state', authorization.searchParams.get('state')!);
  callback.searchParams.set('error', 'access_denied');
  await page.goto(callback.href);
  await expect(page.getByText('Dropbox access was not granted.')).toBeVisible();
  await page.getByRole('link', { name: 'Go to Dropbox Backup' }).click();
  await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await expect(page).toHaveURL(authorize);
});

test('production SDK starts PKCE authorization without constructor errors', async ({ page, context }, info) => {
  test.skip(!process.env['E2E_DROPBOX'], 'Requires a production build with a synthetic public App key.');
  const errors: string[] = [];
  const debug = await context.newCDPSession(page);
  await debug.send('Debugger.enable');
  await debug.send('Debugger.setPauseOnExceptions', { state: 'all' });
  debug.on('Debugger.paused', async (event) => {
    if (/not a constructor/.test(event.data?.['description'] ?? '')) {
      errors.push(JSON.stringify({ error: event.data?.['description'], frames: event.callFrames.map((frame) => ({ name: frame.functionName, url: frame.url, location: frame.location })) }));
    }
    await debug.send('Debugger.resume');
  });
  await context.route(/^https:\/\/(?:www\.)?dropbox\.com\/oauth2\/authorize(?:\?|$)/, (route) => route.fulfill({ body: '<h1>Authorization intercepted</h1>', contentType: 'text/html' }));
  await page.goto('backup');
  try {
    await page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
    await expect(page).toHaveURL(/^https:\/\/(?:www\.)?dropbox\.com\/oauth2\/authorize\?/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['account_info.read', 'files.content.read', 'files.content.write', 'files.metadata.read']);
    expect(errors).toEqual([]);
  } catch (error) {
    console.error('SDK constructor diagnostics:', errors);
    await info.attach('sdk-constructor-stack', { body: JSON.stringify(errors), contentType: 'application/json' });
    throw error;
  } finally {
    await debug.detach();
  }
});