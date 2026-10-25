import { computed, inject, Service, signal } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';
import { IP_PROVIDERS, IpLookupError, type IpLocation } from './ip-providers';

export type IpLocationState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'located'; readonly location: IpLocation }
  | { readonly status: 'error'; readonly message: string };

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

/** Approximate public-IP geolocation; only ever requested by an explicit user action. */
@Service()
export class IpGeolocationService {
  private readonly config = inject(APP_CONFIG).ipGeolocation;
  private readonly state = signal<IpLocationState>({ status: 'idle' });
  readonly current = this.state.asReadonly();
  readonly configured = computed(() => this.config.provider !== 'none');
  readonly providerName = this.config.providerName;
  readonly privacyUrl = this.config.privacyUrl;

  async lookup(): Promise<IpLocationState> {
    if (this.config.provider === 'none') {
      const state: IpLocationState = { status: 'error', message: 'No IP geolocation provider is configured for this deployment.' };
      this.state.set(state);
      return state;
    }
    const provider = IP_PROVIDERS[this.config.provider];
    this.state.set({ status: 'loading' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(provider.endpoint, {
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new IpLookupError(response.status === 429 ? 'The provider rate limit was reached. Try again later.' : `The provider returned HTTP ${response.status}.`);
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new IpLookupError('The provider response was too large.');
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new IpLookupError('The provider returned an invalid response.');
      }
      const state: IpLocationState = { status: 'located', location: provider.parse(body, Date.now()) };
      this.state.set(state);
      return state;
    } catch (error) {
      const message =
        error instanceof IpLookupError
          ? error.message
          : controller.signal.aborted
            ? 'The IP location request timed out.'
            : 'The IP location provider could not be reached. Check your connection, VPN or content blocker.';
      const state: IpLocationState = { status: 'error', message };
      this.state.set(state);
      return state;
    } finally {
      clearTimeout(timer);
    }
  }
}
