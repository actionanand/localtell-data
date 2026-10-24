/** Ports of Android Dropbox policy types: DropboxBackupPolicy.kt, DropboxRevisionDownload.kt, DropboxVerifiedUpload.kt. */
import { sha256Bytes, sha256Hex, toHex } from '../backup/sha256';

export const MANAGED_DIRECTORY = '/localtell-managed-backups';
export const REQUIRED_SCOPES = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'] as const;

export interface DropboxRemoteFile {
  readonly path: string;
  readonly name: string;
  readonly modifiedAtMillis: number;
  readonly id: string;
  readonly revision: string;
  readonly size: number;
  readonly contentHash: string | null;
}

export function hasRequiredScopes(grantedScope: string | null | undefined): boolean {
  const granted = new Set((grantedScope ?? '').split(' ').filter((scope) => scope.length > 0));
  return REQUIRED_SCOPES.every((scope) => granted.has(scope));
}

export function sameRemoteFile(a: DropboxRemoteFile, b: DropboxRemoteFile): boolean {
  return (
    a.path === b.path &&
    a.name === b.name &&
    a.modifiedAtMillis === b.modifiedAtMillis &&
    a.id === b.id &&
    a.revision === b.revision &&
    a.size === b.size &&
    a.contentHash === b.contentHash
  );
}

/** Android `DropboxOwnedBackup.matches`: ownership needs the exact recorded upload response. */
export function ownedMatches(owned: DropboxRemoteFile, remote: DropboxRemoteFile): boolean {
  return (
    owned.id === remote.id &&
    owned.revision === remote.revision &&
    owned.path === remote.path &&
    owned.size === remote.size &&
    owned.contentHash !== null &&
    owned.contentHash === remote.contentHash
  );
}

export const DropboxRemoteState = {
  unchanged(before: readonly DropboxRemoteFile[], after: readonly DropboxRemoteFile[], excludingId: string | null = null): boolean {
    const afterFiltered = after.filter((file) => file.id !== excludingId);
    const beforeById = new Map(before.map((file) => [file.id, file]));
    const afterById = new Map(afterFiltered.map((file) => [file.id, file]));
    if (beforeById.size !== afterById.size) return false;
    for (const [id, file] of beforeById) {
      const other = afterById.get(id);
      if (!other || !sameRemoteFile(file, other)) return false;
    }
    return true;
  },

  async token(files: readonly DropboxRemoteFile[]): Promise<string> {
    const description = [...files]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((file) => [file.id, file.revision, file.path, String(file.size), file.contentHash ?? ''].map((part) => `${part.length}:${part}`).join(''))
      .join('');
    return sha256Hex(description);
  },
};

export type DropboxSyncDecision = 'UP_TO_DATE' | 'UPLOAD_LOCAL' | 'RESTORE_REMOTE' | 'CONFLICT';

/** Android `DropboxSyncProtocol.decide`. */
export function decideSync(
  local: string,
  remote: string | null,
  baseline: string | null,
  options: { localEmpty?: boolean; remoteEmpty?: boolean; requireReview?: boolean } = {},
): DropboxSyncDecision {
  if (remote === local) return 'UP_TO_DATE';
  if (remote === null || options.remoteEmpty) return 'UPLOAD_LOCAL';
  if (options.localEmpty) return 'RESTORE_REMOTE';
  if (!options.requireReview && baseline !== null && remote === baseline) return 'UPLOAD_LOCAL';
  return 'CONFLICT';
}

/** Android `managedSyncDecision`: identical content in a file this browser does not own is not a verified backup. */
export function managedSyncDecision(
  decision: DropboxSyncDecision,
  latest: DropboxRemoteFile | null,
  ownership: readonly DropboxRemoteFile[],
): DropboxSyncDecision {
  return decision === 'UP_TO_DATE' && latest !== null && !ownership.some((owned) => ownedMatches(owned, latest)) ? 'UPLOAD_LOCAL' : decision;
}

export interface RemoteBaseline<T> {
  readonly file: DropboxRemoteFile | null;
  readonly data: T | null;
}

/**
 * Android `selectRemoteBaseline`: newest readable backup first; an unreadable file of unknown origin
 * is skipped (never deleted), while an unreadable owned backup or a transfer failure stops the sync.
 */
export async function selectRemoteBaseline<T>(
  files: readonly DropboxRemoteFile[],
  preferredPath: string | null,
  ownership: readonly DropboxRemoteFile[],
  download: (file: DropboxRemoteFile) => Promise<T>,
  isInvalidBackup: (error: unknown) => boolean,
): Promise<RemoteBaseline<T>> {
  const ordered = [...files].sort(
    (a, b) =>
      Number(preferredPath !== null && b.path === preferredPath) - Number(preferredPath !== null && a.path === preferredPath) ||
      b.modifiedAtMillis - a.modifiedAtMillis ||
      (b.name < a.name ? -1 : b.name > a.name ? 1 : 0),
  );
  for (const file of ordered) {
    try {
      return { file, data: await download(file) };
    } catch (error) {
      if (!isInvalidBackup(error) || ownership.some((owned) => owned.id === file.id)) throw error;
    }
  }
  return { file: null, data: null };
}

const REVISION_PATTERN = /^[0-9a-f]{9,}$/;

/** Android `dropboxRevisionPath`: a specific revision is addressed through the path argument. */
export function revisionPath(file: DropboxRemoteFile): string {
  if (!REVISION_PATTERN.test(file.revision)) throw new DropboxValidationError('Dropbox revision is invalid');
  return `rev:${file.revision}`;
}

export class DropboxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DropboxValidationError';
  }
}

/** The listed file no longer matches what Dropbox returned; abort instead of accepting other content. */
export class DropboxDownloadMismatchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DropboxDownloadMismatchError';
  }
}

const BLOCK_SIZE = 4 * 1024 * 1024;

/** Dropbox content hash: SHA-256 over the concatenated SHA-256 digests of each 4 MiB block. */
export async function dropboxContentHash(bytes: Uint8Array): Promise<string> {
  const digests: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BLOCK_SIZE) {
    digests.push(await sha256Bytes(bytes.subarray(offset, Math.min(offset + BLOCK_SIZE, bytes.byteLength))));
  }
  const joined = new Uint8Array(digests.length * 32);
  digests.forEach((digest, index) => joined.set(digest, index * 32));
  return toHex(await sha256Bytes(joined));
}

/** Android `backupAccountHash`: SHA-256 of the Dropbox account ID, used to scope local state. */
export function accountHash(accountId: string): Promise<string> {
  return sha256Hex(accountId);
}
