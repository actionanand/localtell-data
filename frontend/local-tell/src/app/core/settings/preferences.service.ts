import { Service, signal } from '@angular/core';
import { getSetting, putSetting } from '../storage/idb';

export interface UserPreferences {
  /** Check Dropbox for remote changes when the app opens (only while connected). */
  readonly dropboxCheckOnOpen: boolean;
  /** Check Dropbox again when connectivity returns. */
  readonly dropboxCheckOnReconnect: boolean;
  /** Acknowledged the IP provider privacy disclosure. */
  readonly ipDisclosureAccepted: boolean;
}

const DEFAULTS: UserPreferences = { dropboxCheckOnOpen: false, dropboxCheckOnReconnect: false, ipDisclosureAccepted: false };
const KEY = 'preferences.v1';

@Service()
export class PreferencesService {
  private readonly state = signal<UserPreferences>(DEFAULTS);
  readonly preferences = this.state.asReadonly();

  async load(): Promise<void> {
    const stored = await getSetting<Partial<UserPreferences>>(KEY);
    this.state.set({ ...DEFAULTS, ...pickBooleans(stored) });
  }

  async update(change: Partial<UserPreferences>): Promise<void> {
    const next = { ...this.state(), ...change };
    await putSetting(KEY, next);
    this.state.set(next);
  }
}

function pickBooleans(value: Partial<UserPreferences> | undefined): Partial<UserPreferences> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, boolean> = {};
  for (const key of Object.keys(DEFAULTS)) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'boolean') result[key] = entry;
  }
  return result as Partial<UserPreferences>;
}
