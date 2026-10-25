import type { Dropbox, DropboxAuth } from 'dropbox';
import { InjectionToken } from '@angular/core';

interface DropboxSdk {
  Dropbox: typeof Dropbox;
  DropboxAuth: typeof DropboxAuth;
}

export function dropboxSdkNamespace(value: unknown): DropboxSdk {
  const module = value as Partial<DropboxSdk> & { default?: Partial<DropboxSdk> };
  const sdk = typeof module?.DropboxAuth === 'function' ? module : module?.default;
  if (typeof sdk?.Dropbox !== 'function' || typeof sdk.DropboxAuth !== 'function') {
    throw new Error('The Dropbox SDK could not be loaded. Reload the page and try again.');
  }
  return sdk as DropboxSdk;
}

export async function loadDropboxSdk(): Promise<DropboxSdk> {
  return dropboxSdkNamespace(await import('dropbox'));
}

export const DROPBOX_SDK_LOADER = new InjectionToken<typeof loadDropboxSdk>('DROPBOX_SDK_LOADER', {
  providedIn: 'root', factory: () => loadDropboxSdk,
});