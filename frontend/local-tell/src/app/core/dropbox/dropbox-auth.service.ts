import { computed, inject, Service, signal } from '@angular/core';
import type { Dropbox, DropboxAuth } from 'dropbox';
import { APP_CONFIG, isDropboxAppKey } from '../config/app-config';
import { accountHash, hasRequiredScopes, REQUIRED_SCOPES } from './dropbox-policy';

export type DropboxConnectionStatus =
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reauthorization-required'
  | 'failed'
  | 'disconnecting';

export interface DropboxConnectionState {
  readonly status: DropboxConnectionStatus;
  readonly accountName: string | null;
  readonly accountIdHash: string | null;
  readonly persistent: boolean;
  readonly message: string | null;
}

interface StoredCredential {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number | null;
  readonly scope: string;
}

interface PendingAuthorization {
  readonly state: string;
  readonly codeVerifier: string;
  readonly createdAt: number;
  readonly persistent: boolean;
  readonly redirectUri: string;
}

const CREDENTIAL_KEY = 'localtell.dropbox.credential.v1';
const PENDING_KEY = 'localtell.dropbox.oauth.v1';
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

export interface DropboxSession {
  readonly client: Dropbox;
  readonly auth: DropboxAuth;
  readonly account: string;
  readonly generation: number;
}

export class DropboxSessionChangedError extends Error {
  constructor() {
    super('The Dropbox connection changed during the operation. Nothing further was changed.');
    this.name = 'DropboxSessionChangedError';
  }
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function isCredential(value: unknown): value is StoredCredential {
  const record = value as Partial<StoredCredential> | null;
  return (
    !!record &&
    typeof record.accessToken === 'string' &&
    record.accessToken.length > 0 &&
    typeof record.refreshToken === 'string' &&
    record.refreshToken.length > 0 &&
    (record.expiresAt === null || typeof record.expiresAt === 'number') &&
    typeof record.scope === 'string'
  );
}

function status(error: unknown): number | null {
  const value = (error as { status?: unknown } | null)?.status;
  return typeof value === 'number' ? value : null;
}

/** True when Dropbox rejected the stored credential (revoked/expired refresh token). */
export function isCredentialRejected(error: unknown): boolean {
  const code = status(error);
  if (code === 401) return true;
  const body = JSON.stringify((error as { error?: unknown } | null)?.error ?? '');
  return code === 400 && /invalid_grant|invalid_access_token|expired_access_token/.test(body);
}

/**
 * Dropbox OAuth 2 authorization-code flow with PKCE using the official SDK. The App key is a public
 * client identifier; no app secret exists in the browser. Tokens never enter logs, backups or
 * IndexedDB. Session-only storage is the default; "remember" uses localStorage with disclosure.
 */
@Service()
export class DropboxAuthService {
  private readonly config = inject(APP_CONFIG);
  private readonly state = signal<DropboxConnectionState>({
    status: 'disconnected',
    accountName: null,
    accountIdHash: null,
    persistent: false,
    message: null,
  });
  private generation = 0;
  private session: DropboxSession | null = null;

  readonly connection = this.state.asReadonly();
  readonly configured = computed(() => this.config.features.cloudBackup && isDropboxAppKey(this.config.dropbox.appKey));
  readonly connected = computed(() => this.state().status === 'connected');

  redirectUri(): string {
    const url = new URL(this.config.dropbox.redirectUri || 'dropbox/callback', document.baseURI);
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.origin !== window.location.origin || url.username || url.password || url.search || url.hash) {
      throw new Error('Dropbox redirect URI must be a same-origin HTTPS URL (HTTP is allowed on localhost).');
    }
    return url.toString();
  }

  currentGeneration(): number {
    return this.generation;
  }

  async initialize(): Promise<void> {
    if (!this.configured()) {
      this.publish({ status: 'unconfigured' });
      return;
    }
    const stored = this.loadCredential();
    if (!stored) {
      this.publish({ status: 'disconnected' });
      return;
    }
    await this.verify(++this.generation, stored.credential, stored.persistent);
  }

  async connect(persistent: boolean): Promise<void> {
    if (!this.configured()) throw new Error('Dropbox is not configured for this deployment.');
    this.generation++;
    this.session = null;
    this.publish({ status: 'connecting' });
    const { DropboxAuth } = await import('dropbox');
    const auth = new DropboxAuth({ clientId: this.config.dropbox.appKey });
    const state = randomState();
    const redirectUri = this.redirectUri();
    const url = await auth.getAuthenticationUrl(redirectUri, state, 'code', 'offline', [...REQUIRED_SCOPES], 'none', true);
    const pending: PendingAuthorization = { state, codeVerifier: auth.getCodeVerifier(), createdAt: Date.now(), persistent, redirectUri };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    window.location.assign(String(url));
  }

  /** Handles the OAuth redirect. Always consumes the pending authorization, success or not. */
  async completeAuthorization(params: URLSearchParams): Promise<void> {
    if (!this.configured()) {
      sessionStorage.removeItem(PENDING_KEY);
      this.publish({ status: 'unconfigured' });
      return;
    }
    const pending = readJson<PendingAuthorization>(sessionStorage, PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const operation = ++this.generation;
    this.session = null;
    if (!pending || typeof pending.state !== 'string' || typeof pending.codeVerifier !== 'string') {
      this.publish({ status: 'failed', message: 'No Dropbox sign-in was in progress in this tab. Start again from Dropbox Backup.' });
      return;
    }
    if (params.get('state') !== pending.state || !Number.isFinite(pending.createdAt) || pending.createdAt > Date.now() || Date.now() - pending.createdAt > PENDING_MAX_AGE_MS) {
      this.publish({ status: 'failed', message: 'The Dropbox sign-in response could not be verified (state mismatch or expired). Nothing was connected.' });
      return;
    }
    const oauthError = params.get('error');
    if (oauthError) {
      this.publish({
        status: 'disconnected',
        message: oauthError === 'access_denied' ? 'Dropbox access was not granted.' : 'Dropbox reported an authorization error.',
      });
      return;
    }
    const code = params.get('code');
    if (!code) {
      this.publish({ status: 'failed', message: 'Dropbox did not return an authorization code.' });
      return;
    }
    this.publish({ status: 'connecting' });
    try {
      if (pending.redirectUri !== this.redirectUri()) throw new Error('Dropbox redirect URI changed during authorization.');
      const { DropboxAuth } = await import('dropbox');
      const auth = new DropboxAuth({ clientId: this.config.dropbox.appKey });
      auth.setCodeVerifier(pending.codeVerifier);
      const response = await auth.getAccessTokenFromCode(pending.redirectUri, code);
      const result = response.result as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
      if (!result.access_token || !result.refresh_token || !hasRequiredScopes(result.scope)) {
        this.publish({ status: 'failed', message: 'Dropbox did not grant the required permissions. Reconnect and approve all requested access.' });
        return;
      }
      const credential: StoredCredential = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: typeof result.expires_in === 'number' ? Date.now() + result.expires_in * 1000 : null,
        scope: result.scope ?? '',
      };
      if (operation !== this.generation) return;
      this.saveCredential(credential, pending.persistent);
      await this.verify(operation, credential, pending.persistent);
    } catch {
      if (operation === this.generation) this.publish({ status: 'failed', message: 'Dropbox sign-in could not be completed. Check your connection and try again.' });
    }
  }

  /** Clears local credentials; never deletes local data, Dropbox files or packs. */
  async disconnect(): Promise<void> {
    const operation = ++this.generation;
    const session = this.session;
    this.session = null;
    this.publish({ status: 'disconnecting' });
    let revoked = false;
    if (session) {
      try {
        await session.client.authTokenRevoke();
        revoked = true;
      } catch {
        revoked = false;
      }
    }
    this.clearCredential();
    if (operation !== this.generation) return;
    this.publish({
      status: this.configured() ? 'disconnected' : 'unconfigured',
      message: revoked
        ? 'Disconnected. Dropbox access for this browser was revoked.'
        : 'Disconnected locally. Dropbox could not confirm token revocation; you can remove LocalTell under Dropbox Settings → Connected apps.',
    });
  }

  async retry(): Promise<void> {
    await this.initialize();
  }

  /** The verified client for the current generation; throws if the connection changed. */
  requireSession(expectedGeneration?: number): DropboxSession {
    const session = this.session;
    if (!session || this.state().status !== 'connected' || (expectedGeneration !== undefined && session.generation !== expectedGeneration)) {
      throw new DropboxSessionChangedError();
    }
    return session;
  }

  /** Persists a refreshed access token after SDK calls, if the session is still current. */
  persistRefreshedToken(session: DropboxSession): void {
    if (session.generation !== this.generation) return;
    const stored = this.loadCredential();
    if (!stored) return;
    const accessToken = session.auth.getAccessToken();
    const expires = session.auth.getAccessTokenExpiresAt();
    if (accessToken && accessToken !== stored.credential.accessToken) {
      this.saveCredential({ ...stored.credential, accessToken, expiresAt: expires ? expires.getTime() : null }, stored.persistent);
    }
  }

  handleRejectedCredential(session: DropboxSession): void {
    if (session.generation !== this.generation) return;
    this.generation++;
    this.session = null;
    this.clearCredential();
    this.publish({ status: 'reauthorization-required', message: 'Dropbox access expired or was revoked. Connect again to continue.' });
  }

  private async verify(operation: number, credential: StoredCredential, persistent: boolean): Promise<void> {
    this.publish({ status: 'connecting', persistent });
    try {
      const { Dropbox, DropboxAuth } = await import('dropbox');
      const auth = new DropboxAuth({
        clientId: this.config.dropbox.appKey,
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        accessTokenExpiresAt: credential.expiresAt ? new Date(credential.expiresAt) : undefined,
      });
      const client = new Dropbox({ auth });
      const account = await client.usersGetCurrentAccount();
      if (operation !== this.generation) return;
      const hash = await accountHash(account.result.account_id);
      this.session = { client, auth, account: hash, generation: operation };
      this.persistRefreshedToken(this.session);
      this.publish({ status: 'connected', accountName: account.result.name.display_name, accountIdHash: hash, persistent });
    } catch (error) {
      if (operation !== this.generation) return;
      if (isCredentialRejected(error)) {
        this.clearCredential();
        this.publish({ status: 'reauthorization-required', message: 'Dropbox access expired or was revoked. Connect again to continue.' });
      } else {
        this.publish({ status: 'failed', persistent, message: 'Dropbox could not be reached. Your sign-in is kept; retry when online.' });
      }
    }
  }

  private publish(change: Partial<DropboxConnectionState> & { status: DropboxConnectionStatus }): void {
    this.state.set({
      accountName: null,
      accountIdHash: null,
      persistent: false,
      message: null,
      ...change,
    });
  }

  private loadCredential(): { credential: StoredCredential; persistent: boolean } | null {
    const session = readJson<unknown>(sessionStorage, CREDENTIAL_KEY);
    if (isCredential(session)) return { credential: session, persistent: false };
    const persistent = readJson<unknown>(localStorage, CREDENTIAL_KEY);
    if (isCredential(persistent)) return { credential: persistent, persistent: true };
    return null;
  }

  private saveCredential(credential: StoredCredential, persistent: boolean): void {
    this.clearCredential();
    (persistent ? localStorage : sessionStorage).setItem(CREDENTIAL_KEY, JSON.stringify(credential));
  }

  private clearCredential(): void {
    sessionStorage.removeItem(CREDENTIAL_KEY);
    localStorage.removeItem(CREDENTIAL_KEY);
  }
}
