import type { RemotePack } from './pack-manifest';
import type { InstallPhase } from './prepare-pack';
import type { LocalityMatch, ValidatedPack } from '../offline-resolver/offline-locality-resolver';

/** Records persisted for installed geographic packs (IndexedDB `installedPacks` / `packFiles`). */
export interface InstalledPackRecord {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly countryCode: string;
  readonly countryName: string;
  readonly region: string | null;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly installedAt: number;
  readonly sourceUrl: string;
  readonly stateRings: readonly string[];
  readonly meta: Readonly<Record<string, string>>;
}

export interface PackFileRecord {
  readonly id: string;
  readonly version: number;
  readonly installedAt: number;
  readonly bytes: ArrayBuffer;
}

export type InstallWorkerRequest =
  | { readonly type: 'install'; readonly requestId: number; readonly pack: RemotePack; readonly url: string; readonly wasmUrl: string }
  | { readonly type: 'cancel'; readonly requestId: number };

export type InstallWorkerResponse =
  | { readonly type: 'progress'; readonly requestId: number; readonly phase: InstallPhase; readonly percent: number | null }
  | { readonly type: 'prepared'; readonly requestId: number; readonly bytes: ArrayBuffer; readonly validated: ValidatedPack }
  | { readonly type: 'failed'; readonly requestId: number; readonly message: string; readonly cancelled: boolean };

export type ResolverWorkerRequest =
  | { readonly type: 'resolve'; readonly requestId: number; readonly latitude: number; readonly longitude: number; readonly wasmUrl: string }
  | { readonly type: 'invalidate' };

export interface ResolverResult {
  readonly match: LocalityMatch | null;
  readonly installedCount: number;
  readonly coveringPackIds: readonly string[];
}

export type ResolverWorkerResponse =
  | { readonly type: 'resolved'; readonly requestId: number; readonly result: ResolverResult }
  | { readonly type: 'failed'; readonly requestId: number; readonly message: string };
