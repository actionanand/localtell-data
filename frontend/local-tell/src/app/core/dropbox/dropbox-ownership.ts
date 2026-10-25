import { deleteSetting, getSetting, putSetting } from '../storage/idb';
import { sha256Hex } from '../backup/sha256';
import { MANAGED_DIRECTORY, type DropboxRemoteFile } from './dropbox-policy';

/**
 * Browser-local, account-scoped proof of which Dropbox files this installation uploaded and
 * verified (Android `DropboxBackupOwnership`). It is never imported from a backup or inferred from a
 * filename. A missing or corrupt ledger blocks uploads and can never authorize anything remote.
 * The web app does not delete remote backups at all; ownership only labels files and drives the
 * Android `managedSyncDecision` rule.
 */
interface LedgerEnvelope {
  readonly version: 1;
  readonly payload: string;
  readonly sha256: string;
}

export interface PendingUpload {
  readonly file: DropboxRemoteFile;
  readonly fingerprint: string;
  readonly beforeToken: string;
}

interface PendingEnvelope {
  readonly file: string;
  readonly fingerprint: string;
  readonly before: string;
  readonly sha256: string;
}

const HEX64 = /^[a-f0-9]{64}$/;

async function encode(records: readonly DropboxRemoteFile[]): Promise<LedgerEnvelope> {
  const payload = JSON.stringify(
    records.map((file) => ({
      path: file.path,
      name: file.name,
      modified: file.modifiedAtMillis,
      id: file.id,
      revision: file.revision,
      size: file.size,
      hash: file.contentHash,
    })),
  );
  return { version: 1, payload, sha256: await sha256Hex(payload) };
}

async function decode(envelope: unknown): Promise<DropboxRemoteFile[] | null> {
  try {
    if (typeof envelope !== 'object' || envelope === null) return null;
    const { version, payload, sha256 } = envelope as Partial<LedgerEnvelope>;
    if (version !== 1 || typeof payload !== 'string' || sha256 !== (await sha256Hex(payload))) return null;
    const entries: unknown = JSON.parse(payload);
    if (!Array.isArray(entries)) return null;
    const records = entries.map((entry): DropboxRemoteFile => {
      const value = entry as Record<string, unknown>;
      const file: DropboxRemoteFile = {
        path: String(value['path']),
        name: String(value['name']),
        modifiedAtMillis: Number(value['modified']),
        id: String(value['id']),
        revision: String(value['revision']),
        size: Number(value['size']),
        contentHash: typeof value['hash'] === 'string' ? value['hash'] : null,
      };
      if (
        !file.id.startsWith('id:') ||
        file.revision.trim().length === 0 ||
        !file.path.startsWith(`${MANAGED_DIRECTORY}/`) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        !HEX64.test(file.contentHash ?? '')
      ) {
        throw new Error('invalid');
      }
      return file;
    });
    return new Set(records.map((record) => record.id)).size === records.length ? records : null;
  } catch {
    return null;
  }
}

export class DropboxOwnershipLedger {
  private key(account: string): string {
    return `dropbox-ownership:${account}`;
  }

  private pendingKey(account: string): string {
    return `dropbox-pending:${account}`;
  }

  /** `null` means the ledger exists but is unreadable; callers must stop before any remote write. */
  async read(account: string): Promise<DropboxRemoteFile[] | null> {
    const stored = await getSetting<unknown>(this.key(account));
    return stored === undefined ? [] : decode(stored);
  }

  async record(account: string, file: DropboxRemoteFile): Promise<void> {
    const records = await this.read(account);
    if (records === null) throw new Error('Backup ownership ledger is invalid');
    if (file.contentHash === null) throw new Error('Cannot record a backup without a content hash');
    await putSetting(this.key(account), await encode([...records.filter((record) => record.id !== file.id), file]));
  }

  async pending(account: string): Promise<PendingUpload | null> {
    const stored = await getSetting<PendingEnvelope>(this.pendingKey(account));
    if (stored === undefined) return null;
    const files = typeof stored.file === 'string' ? await decode(safeParse(stored.file)) : null;
    const file = files?.length === 1 ? files[0] : null;
    if (
      file === null ||
      !HEX64.test(stored.fingerprint) ||
      !HEX64.test(stored.before) ||
      stored.sha256 !== (await sha256Hex(`${stored.file}|${stored.fingerprint}|${stored.before}`))
    ) {
      throw new Error('Pending upload record is invalid');
    }
    return { file, fingerprint: stored.fingerprint, beforeToken: stored.before };
  }

  async savePending(account: string, upload: PendingUpload): Promise<void> {
    const file = JSON.stringify(await encode([upload.file]));
    const envelope: PendingEnvelope = {
      file,
      fingerprint: upload.fingerprint,
      before: upload.beforeToken,
      sha256: await sha256Hex(`${file}|${upload.fingerprint}|${upload.beforeToken}`),
    };
    await putSetting(this.pendingKey(account), envelope);
  }

  async clearPending(account: string): Promise<void> {
    await deleteSetting(this.pendingKey(account));
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
