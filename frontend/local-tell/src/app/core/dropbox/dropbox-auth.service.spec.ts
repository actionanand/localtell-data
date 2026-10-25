import { TestBed } from '@angular/core/testing';
import { APP_CONFIG, validateAppConfig } from '../config/app-config';
import { DropboxAuthService } from './dropbox-auth.service';
import { TEST_CONFIG, testConfig } from '../../../testing/test-config';
import { DROPBOX_SDK_LOADER } from './dropbox-sdk';

describe('Dropbox public configuration', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function service(appKey: string, redirectUri = ''): DropboxAuthService {
    TestBed.configureTestingModule({ providers: [{ provide: APP_CONFIG, useValue: testConfig({ dropbox: { appKey, redirectUri } }) }] });
    return TestBed.inject(DropboxAuthService);
  }

  it('disables the unresolved placeholder without breaking the rest of the app', async () => {
    const key = 'DROPBOX_APP_KEY_PLACEHOLDER';
    expect(validateAppConfig({ ...TEST_CONFIG, dropbox: { appKey: key, redirectUri: '' } }).dropbox.appKey).toBe('');
    const auth = service(key);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await auth.initialize();
    expect(auth.configured()).toBe(false);
    expect(auth.connection().status).toBe('unconfigured');
    await expect(auth.connect(false)).rejects.toThrow('not configured');
    await auth.completeAuthorization(new URLSearchParams('code=test&state=test'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enables a valid public key and defaults to session-only sign-in', async () => {
    const auth = service('example123456');
    await auth.initialize();
    expect(auth.configured()).toBe(true);
    expect(auth.connection().persistent).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('leaves connecting and reports a safe recoverable message if SDK initialization fails', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DROPBOX_SDK_LOADER, useValue: () => Promise.reject(new TypeError('n is not a constructor')) }] });
    const auth = service('example123456');
    await expect(auth.connect(false)).rejects.toThrow('Dropbox sign-in could not start');
    expect(auth.connection().status).toBe('failed');
    expect(auth.connection().message).not.toContain('constructor');
    await auth.retry();
    expect(auth.connection().status).toBe('disconnected');
  });

  it('rejects a callback with mismatched state before token exchange', async () => {
    const auth = service('example123456');
    sessionStorage.setItem('localtell.dropbox.oauth.v1', JSON.stringify({ state: 'expected', codeVerifier: 'a'.repeat(64), createdAt: Date.now(), redirectUri: auth.redirectUri(), persistent: false }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await auth.completeAuthorization(new URLSearchParams('code=test&state=wrong'));
    expect(auth.connection().status).toBe('failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an off-origin redirect URI', () => {
    expect(() => service('example123456', 'https://untrusted.example/callback').redirectUri()).toThrow('same-origin');
  });

  it('refuses a stored redirect that no longer matches configuration', async () => {
    const auth = service('example123456');
    sessionStorage.setItem('localtell.dropbox.oauth.v1', JSON.stringify({ state: 'expected', codeVerifier: 'a'.repeat(64), createdAt: Date.now(), redirectUri: 'https://untrusted.example/callback', persistent: false }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await auth.completeAuthorization(new URLSearchParams('code=test&state=expected'));
    expect(auth.connection().status).toBe('failed');
    expect(fetch).not.toHaveBeenCalled();
  });
});