import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Page, type Response, type TestInfo } from '@playwright/test';

interface ShellManifest {
  index: string;
  assetGroups: { name: string; installMode: string; urls: string[] }[];
}

const lastStates = new WeakMap<Page, unknown>();

export async function shellManifest(page: Page): Promise<ShellManifest> {
  const url = await page.evaluate(() => new URL('ngsw.json', document.baseURI).href);
  const response = await page.request.get(url);
  expect(response.status(), 'Production service-worker manifest').toBe(200);
  return response.json();
}

export async function shellState(page: Page, manifest: ShellManifest) {
  const hash = createHash('sha1').update(JSON.stringify(manifest)).digest('hex');
  const state = await page.evaluate(async ({ manifest, hash }) => {
    const names = await caches.keys();
    const cacheEntries = await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      return { name, urls: (await cache.keys()).map((request) => request.url) };
    }));
    const missing: string[] = [];
    for (const group of manifest.assetGroups.filter((group) => group.installMode === 'prefetch')) {
      const name = names.find((name) => name.includes(`:${hash}:assets:${group.name}:cache`));
      const cache = name ? await caches.open(name) : null;
      for (const url of group.urls) {
        const response = await cache?.match(new URL(url, location.origin).href);
        if (!response || response.status !== 200) missing.push(url);
      }
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      url: location.href,
      baseURI: document.baseURI,
      online: navigator.onLine,
      controller: navigator.serviceWorker.controller ? {
        url: navigator.serviceWorker.controller.scriptURL,
        state: navigator.serviceWorker.controller.state,
      } : null,
      registrations: registrations.map((registration) => ({
        scope: registration.scope,
        active: registration.active?.state,
        waiting: registration.waiting?.state,
        installing: registration.installing?.state,
      })),
      manifestHash: hash,
      index: manifest.index,
      caches: cacheEntries,
      missing,
    };
  }, { manifest, hash });
  lastStates.set(page, state);
  return state;
}

export async function waitForOfflineShell(page: Page, manifest: ShellManifest): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // Activation/controller acquisition precedes Angular's asynchronous prefetch initialization.
  await expect.poll(async () => {
    const state = await shellState(page, manifest);
    return state.controller?.state === 'activated' && state.missing.length === 0;
  }, { timeout: 60_000, message: 'Current service-worker version has every prefetched app-shell asset' }).toBe(true);
}

export async function withOfflineDiagnostics(
  page: Page,
  context: BrowserContext,
  info: TestInfo,
  run: (recordNavigation: (response: Response | null) => void) => Promise<void>,
): Promise<void> {
  const events: object[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') events.push({ type: 'console', level: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => events.push({ type: 'pageerror', message: error.message }));
  context.on('requestfailed', (request) => events.push({ type: 'requestfailed', url: request.url(), resourceType: request.resourceType(), worker: request.serviceWorker()?.url(), error: request.failure() }));
  context.on('response', (response) => {
    if (['document', 'script'].includes(response.request().resourceType()) || /\.js(?:\?|$)/.test(response.url())) {
      events.push({ type: 'response', url: response.url(), status: response.status(), worker: response.fromServiceWorker() });
    }
  });
  const navigations: object[] = [];
  try {
    await run((response) => navigations.push({
      url: response?.url(),
      status: response?.status(),
      fromServiceWorker: response?.fromServiceWorker(),
      contentType: response?.headers()['content-type'],
    }));
  } catch (error) {
    const lastKnownState = lastStates.get(page);
    const manifest = await shellManifest(page).catch(() => null);
    const state = manifest ? await shellState(page, manifest).catch((error: Error) => ({ error: error.message })) : null;
    const documentSnapshot = await page.evaluate(() => ({ title: document.title, html: document.documentElement.outerHTML.slice(0, 4000) })).catch(() => null);
    const workerDebug = await page.evaluate(async () => {
      const response = await fetch(new URL('ngsw/state', document.baseURI));
      return { status: response.status, body: (await response.text()).slice(0, 8000) };
    }).catch(() => null);
    const body = JSON.stringify({ url: page.url(), navigations, events, lastKnownState, state, workerDebug, document: documentSnapshot }, null, 2);
    console.error(`Offline shell failure diagnostics:\n${body}`);
    await info.attach('offline-shell-diagnostics', { body, contentType: 'application/json' });
    throw error;
  } finally {
    await context.setOffline(false);
  }
}