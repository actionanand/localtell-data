import { computed, inject, Service, signal } from '@angular/core';
import type { files } from 'dropbox';
import { DropboxAuthService, DropboxSessionChangedError, isCredentialRejected, type DropboxSession } from './dropbox-auth.service';
import {
  decideSync,
  DropboxDownloadMismatchError,
  dropboxContentHash,
  DropboxRemoteState,
  DropboxValidationError,
  managedSyncDecision,
  MANAGED_DIRECTORY,
  ownedMatches,
  revisionPath,
  selectRemoteBaseline,
  type DropboxRemoteFile,
  type DropboxSyncDecision,
} from './dropbox-policy';
import { DropboxOwnershipLedger } from './dropbox-ownership';
import { BackupFileFormat, BackupValidationError, backupFingerprint, encodeBackup, MAX_BACKUP_BYTES } from '../backup/backup-codec';
import { isBackupEmpty, type AppBackupData, type AppRestorePlan } from '../backup/app-backup-data';
import { AppDataService, RestoreCapacityError } from '../backup/app-data.service';
import { getSetting, putSetting } from '../storage/idb';
import { StrictJsonError } from '../backup/strict-json';

export interface DropboxSyncMeta {
  readonly baseline: string | null;
  readonly lastSuccessfulBackupAt: number | null;
  readonly lastRestoreAt: number | null;
  readonly lastAttemptAt: number | null;
  readonly lastAttemptResult: string | null;
  readonly lastCheckAt: number | null;
}

const EMPTY_META: DropboxSyncMeta = {
  baseline: null,
  lastSuccessfulBackupAt: null,
  lastRestoreAt: null,
  lastAttemptAt: null,
  lastAttemptResult: null,
  lastCheckAt: null,
};

export interface RemoteBackupView {
  readonly file: DropboxRemoteFile;
  readonly ownedByThisBrowser: boolean;
}

export interface RemoteOffer {
  readonly kind: 'restore-offer' | 'conflict' | 'inspect';
  readonly file: DropboxRemoteFile;
  readonly data: AppBackupData;
  readonly plan: AppRestorePlan;
  readonly remoteStateToken: string;
}

export type SyncOutcome =
  | { readonly kind: 'up-to-date' }
  | { readonly kind: 'uploaded'; readonly file: DropboxRemoteFile }
  | { readonly kind: 'nothing-to-back-up' }
  | { readonly kind: 'offer'; readonly offer: RemoteOffer }
  | { readonly kind: 'remote-changed' };

export type SyncStatusSummary = 'in-sync' | 'local-changes' | 'remote-changes' | 'both-changed' | 'remote-empty' | 'unknown';

export interface DiagnosticEntry {
  readonly at: number;
  readonly stage: string;
  readonly detail: string;
}

export function isInvalidRemoteBackup(error: unknown): boolean {
  return (
    error instanceof BackupValidationError ||
    error instanceof StrictJsonError ||
    error instanceof DropboxValidationError ||
    error instanceof RangeError
  );
}

function toRemoteFile(metadata: files.FileMetadata): DropboxRemoteFile {
  if (!metadata.path_lower) throw new DropboxValidationError('Dropbox file path is unavailable');
  return {
    path: metadata.path_lower,
    name: metadata.name,
    modifiedAtMillis: Date.parse(metadata.server_modified),
    id: metadata.id,
    revision: metadata.rev,
    size: metadata.size,
    contentHash: metadata.content_hash ?? null,
  };
}

function errorSummary(error: unknown): string {
  if (error instanceof DropboxSessionChangedError) return error.message;
  const code = (error as { status?: unknown } | null)?.status;
  if (typeof code === 'number') {
    if (code === 429) return 'Dropbox is rate limiting requests. Try again shortly.';
    if (code === 507 || /insufficient_space/.test(JSON.stringify((error as { error?: unknown }).error ?? ''))) return 'Your Dropbox is full.';
    if (code >= 500) return 'Dropbox is temporarily unavailable.';
    return `Dropbox rejected the request (HTTP ${code}).`;
  }
  if (error instanceof Error) return error.message;
  return 'The Dropbox operation failed.';
}

/**
 * Android-compatible `.bklt` backup interoperability with the App Folder directory
 * `/localtell-managed-backups`. Remote files are never deleted, renamed or overwritten:
 * uploads use add mode with strict conflict detection, and web retention cleanup is not implemented.
 */
@Service()
export class DropboxBackupService {
  private readonly auth = inject(DropboxAuthService);
  private readonly appData = inject(AppDataService);
  private readonly ledger = new DropboxOwnershipLedger();
  private readonly filesState = signal<readonly RemoteBackupView[]>([]);
  private readonly metaState = signal<DropboxSyncMeta>(EMPTY_META);
  private readonly busyState = signal<string | null>(null);
  private readonly statusState = signal<SyncStatusSummary>('unknown');
  private readonly diagnosticsState = signal<readonly DiagnosticEntry[]>([]);

  readonly files = this.filesState.asReadonly();
  readonly meta = this.metaState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly diagnostics = this.diagnosticsState.asReadonly();
  readonly isBusy = computed(() => this.busyState() !== null);

  async loadMeta(): Promise<void> {
    const account = this.auth.connection().accountIdHash;
    this.metaState.set(account ? { ...EMPTY_META, ...(await getSetting<DropboxSyncMeta>(`dropbox-sync:${account}`)) } : EMPTY_META);
  }

  clearView(): void {
    this.filesState.set([]);
    this.metaState.set(EMPTY_META);
    this.statusState.set('unknown');
  }

  /** Lists the managed folder; read-only. */
  async refresh(): Promise<void> {
    await this.exclusive('Refreshing backup list', async (session) => {
      await this.listViews(session);
    });
  }

  /** Read-only comparison used by Check Dropbox / on-open / on-reconnect checks. */
  async check(): Promise<SyncStatusSummary> {
    return this.exclusive('Checking Dropbox', async (session) => {
      const files = await this.listViews(session);
      const ownership = await this.requireLedger(session.account);
      const local = await this.appData.snapshot();
      const localFingerprint = await backupFingerprint(local);
      const remote = await selectRemoteBaseline(files, null, ownership, (file) => this.download(session, file), isInvalidRemoteBackup);
      const remoteFingerprint = remote.data ? await backupFingerprint(remote.data) : null;
      const baseline = this.metaState().baseline;
      let summary: SyncStatusSummary;
      if (remoteFingerprint === null || (remote.data && isBackupEmpty(remote.data))) summary = 'remote-empty';
      else if (remoteFingerprint === localFingerprint) summary = 'in-sync';
      else if (baseline === remoteFingerprint) summary = 'local-changes';
      else if (baseline === localFingerprint) summary = 'remote-changes';
      else summary = 'both-changed';
      this.statusState.set(summary);
      await this.updateMeta(session.account, { lastCheckAt: Date.now() });
      return summary;
    });
  }

  /** Sync Now: never silently picks one side; differing data on both sides returns an offer. */
  async sync(): Promise<SyncOutcome> {
    return this.exclusive('Syncing with Dropbox', async (session) => {
      await this.updateMeta(session.account, { lastAttemptAt: Date.now(), lastAttemptResult: 'In progress' });
      try {
        const outcome = await this.runSync(session);
        await this.updateMeta(session.account, { lastAttemptResult: describeOutcome(outcome) });
        return outcome;
      } catch (error) {
        await this.updateMeta(session.account, { lastAttemptResult: `Failed: ${errorSummary(error)}` }).catch(() => undefined);
        throw error;
      }
    });
  }

  /** Downloads and validates one backup for preview; read-only toward Dropbox. */
  async inspect(file: DropboxRemoteFile): Promise<RemoteOffer> {
    return this.exclusive('Inspecting backup', async (session) => {
      const files = await this.listFiles(session);
      const data = await this.download(session, file);
      return {
        kind: 'inspect',
        file,
        data,
        plan: await this.appData.preview(data, 'dropbox'),
        remoteStateToken: await DropboxRemoteState.token(files),
      };
    });
  }

  /**
   * Applies a previewed remote backup locally after confirming the file set and revision are
   * unchanged. Read-only toward Dropbox. Restore offers write only into a still-empty browser.
   */
  async applyOffer(offer: RemoteOffer, uploadMergedResult: boolean): Promise<'restored' | 'merged-and-uploaded' | 'changed'> {
    return this.exclusive('Restoring backup', async (session) => {
      const files = await this.listFiles(session);
      const current = files.find((file) => file.id === offer.file.id);
      if (!current || current.revision !== offer.file.revision || (await DropboxRemoteState.token(files)) !== offer.remoteStateToken) {
        return 'changed';
      }
      const restored = await this.appData.applyRestore(offer.data, 'dropbox', { requireEmpty: offer.kind === 'restore-offer' });
      if (restored === null) return 'changed';
      const remoteFingerprint = await backupFingerprint(offer.data);
      this.auth.requireSession(session.generation);
      if (!uploadMergedResult) {
        const local = await backupFingerprint(await this.appData.snapshot());
        await this.updateMeta(session.account, {
          lastRestoreAt: Date.now(),
          baseline: local === remoteFingerprint ? remoteFingerprint : this.metaState().baseline,
        });
        this.statusState.set(local === remoteFingerprint ? 'in-sync' : 'local-changes');
        return 'restored';
      }
      await this.updateMeta(session.account, { lastRestoreAt: Date.now() });
      const uploaded = await this.uploadVerified(session, await this.appData.snapshot(), files);
      if (uploaded === 'conflict') return 'changed';
      return 'merged-and-uploaded';
    });
  }

  /** "Use this browser's data": append-only upload; nothing in Dropbox is replaced. */
  async uploadLocal(expectedToken: string): Promise<'uploaded' | 'changed'> {
    return this.exclusive('Uploading backup', async (session) => {
      const files = await this.listFiles(session);
      if ((await DropboxRemoteState.token(files)) !== expectedToken) return 'changed';
      const result = await this.uploadVerified(session, await this.appData.snapshot(), files);
      return result === 'conflict' ? 'changed' : 'uploaded';
    });
  }

  private async runSync(session: DropboxSession): Promise<SyncOutcome> {
    const files = await this.listViews(session);
    const ownership = await this.requireLedger(session.account);
    const local = await this.appData.snapshot();
    const localFingerprint = await backupFingerprint(local);
    const pending = await this.ledger.pending(session.account);
    if (pending && files.some((file) => file.id === pending.file.id)) {
      // Resume verification of an upload that Dropbox already accepted instead of uploading again.
      const result = await this.uploadVerified(session, local, files);
      return result === 'conflict' ? { kind: 'remote-changed' } : { kind: 'uploaded', file: result };
    }
    if (pending) await this.ledger.clearPending(session.account);
    const remote = await selectRemoteBaseline(files, null, ownership, (file) => this.download(session, file), isInvalidRemoteBackup);
    const remoteFingerprint = remote.data ? await backupFingerprint(remote.data) : null;
    let decision: DropboxSyncDecision = decideSync(localFingerprint, remoteFingerprint, this.metaState().baseline, {
      localEmpty: isBackupEmpty(local),
      remoteEmpty: remote.data !== null && isBackupEmpty(remote.data),
    });
    decision = managedSyncDecision(decision, remote.file, ownership);
    const token = await DropboxRemoteState.token(files);
    switch (decision) {
      case 'UP_TO_DATE':
        await this.updateMeta(session.account, { baseline: localFingerprint, lastCheckAt: Date.now() });
        this.statusState.set('in-sync');
        return { kind: 'up-to-date' };
      case 'UPLOAD_LOCAL': {
        if (isBackupEmpty(local) && remote.file === null) return { kind: 'nothing-to-back-up' };
        const result = await this.uploadVerified(session, local, files);
        return result === 'conflict' ? { kind: 'remote-changed' } : { kind: 'uploaded', file: result };
      }
      case 'RESTORE_REMOTE':
      case 'CONFLICT': {
        const file = remote.file as DropboxRemoteFile;
        const data = remote.data as AppBackupData;
        this.statusState.set(decision === 'CONFLICT' ? 'both-changed' : 'remote-changes');
        return {
          kind: 'offer',
          offer: {
            kind: decision === 'CONFLICT' ? 'conflict' : 'restore-offer',
            file,
            data,
            plan: await this.appData.preview(data, 'dropbox'),
            remoteStateToken: token,
          },
        };
      }
    }
  }

  /** Port of Android `DropboxVerifiedUpload.execute` without retention deletion. */
  private async uploadVerified(session: DropboxSession, data: AppBackupData, expected: readonly DropboxRemoteFile[]): Promise<DropboxRemoteFile | 'conflict'> {
    const account = session.account;
    await this.requireLedger(account);
    const before = await this.listFiles(session);
    let pending = await this.ledger.pending(account);
    if (pending && !before.some((file) => file.id === pending?.file.id)) {
      // An interrupted upload that no longer exists remotely is forgotten (Android behaviour).
      await this.ledger.clearPending(account);
      pending = null;
    }
    if (!DropboxRemoteState.unchanged(expected, before)) return 'conflict';
    this.auth.requireSession(session.generation);
    const uploaded = pending?.file ?? (await this.upload(session, data));
    const fingerprint = pending?.fingerprint ?? (await backupFingerprint(data));
    if (!pending) {
      await this.ledger.savePending(account, { file: uploaded, fingerprint, beforeToken: await DropboxRemoteState.token(before) });
    }
    this.log('VERIFY_UPLOAD', 'Downloading the uploaded revision to verify it');
    const verified = await this.download(session, uploaded);
    if ((await backupFingerprint(verified)) !== fingerprint) throw new Error('Dropbox verification mismatch: the uploaded backup differs from local data.');
    this.auth.requireSession(session.generation);
    await this.ledger.record(account, uploaded);
    const after = await this.listViews(session);
    const expectedToken = pending?.beforeToken ?? (await DropboxRemoteState.token(before));
    const othersToken = await DropboxRemoteState.token(after.filter((file) => file.id !== uploaded.id));
    await this.ledger.clearPending(account);
    await this.updateMeta(account, {
      baseline: fingerprint,
      lastSuccessfulBackupAt: Date.now(),
    });
    if (!after.some((file) => file.id === uploaded.id) || othersToken !== expectedToken) {
      this.log('LIST_REMOTE', 'Another device changed the backup folder during upload');
      this.statusState.set('both-changed');
      return 'conflict';
    }
    this.statusState.set('in-sync');
    return uploaded;
  }

  private async upload(session: DropboxSession, data: AppBackupData): Promise<DropboxRemoteFile> {
    const contents = await encodeBackup(data, Date.now());
    await this.prepareFolder(session);
    this.auth.requireSession(session.generation);
    this.log('UPLOAD_BACKUP', 'Uploading a new uniquely named backup (add mode, no overwrite)');
    const response = await this.call(session, (client) =>
      client.filesUpload({
        path: `${MANAGED_DIRECTORY}/${BackupFileFormat.filename(new Date())}`,
        mode: { '.tag': 'add' },
        autorename: false,
        strict_conflict: true,
        contents: new Blob([contents], { type: 'application/octet-stream' }),
      }),
    );
    return toRemoteFile(response.result as files.FileMetadata);
  }

  private async prepareFolder(session: DropboxSession): Promise<void> {
    try {
      const metadata = await this.call(session, (client) => client.filesGetMetadata({ path: MANAGED_DIRECTORY }));
      if ((metadata.result as { '.tag'?: string })['.tag'] !== 'folder') throw new DropboxValidationError('Backup destination is not a folder');
      return;
    } catch (error) {
      if (!isPathNotFound(error)) throw error;
    }
    try {
      await this.call(session, (client) => client.filesCreateFolderV2({ path: MANAGED_DIRECTORY, autorename: false }));
    } catch (error) {
      // Only a concurrent folder creation is acceptable; permission/quota failures propagate.
      if (!/conflict/.test(JSON.stringify((error as { error?: unknown }).error ?? ''))) throw error;
      const metadata = await this.call(session, (client) => client.filesGetMetadata({ path: MANAGED_DIRECTORY }));
      if ((metadata.result as { '.tag'?: string })['.tag'] !== 'folder') throw error;
    }
  }

  private async listFiles(session: DropboxSession): Promise<DropboxRemoteFile[]> {
    this.log('LIST_REMOTE', `Listing ${MANAGED_DIRECTORY}`);
    const result: DropboxRemoteFile[] = [];
    let page: files.ListFolderResult;
    try {
      page = (await this.call(session, (client) => client.filesListFolder({ path: MANAGED_DIRECTORY }))).result;
    } catch (error) {
      if (isPathNotFound(error)) return [];
      throw error;
    }
    for (;;) {
      for (const entry of page.entries) {
        if (entry['.tag'] !== 'file') continue;
        const metadata = entry as files.FileMetadataReference;
        if (metadata.name.startsWith('LocalTell-') && metadata.name.toLowerCase().endsWith('.bklt')) result.push(toRemoteFile(metadata));
      }
      if (!page.has_more) break;
      const cursor = page.cursor;
      page = (await this.call(session, (client) => client.filesListFolderContinue({ cursor }))).result;
    }
    return result;
  }

  private async listViews(session: DropboxSession): Promise<DropboxRemoteFile[]> {
    const listed = await this.listFiles(session);
    const ownership = (await this.ledger.read(session.account)) ?? [];
    this.filesState.set(
      [...listed]
        .sort((a, b) => b.modifiedAtMillis - a.modifiedAtMillis)
        .map((file) => ({ file, ownedByThisBrowser: ownership.some((owned) => ownedMatches(owned, file)) })),
    );
    return listed;
  }

  /** Android `DropboxRevisionDownload.fetch` with streamed byte bounds. */
  private async download(session: DropboxSession, file: DropboxRemoteFile): Promise<AppBackupData> {
    BackupFileFormat.requireFilename(file.name);
    const path = revisionPath(file);
    if (file.size < 0 || file.size > MAX_BACKUP_BYTES) throw new DropboxValidationError('Backup exceeds download limit');
    this.log('DOWNLOAD_REMOTE', `Downloading revision ${file.revision}`);
    this.auth.requireSession(session.generation);
    await session.auth.checkAndRefreshAccessToken();
    this.auth.persistRefreshedToken(session);
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.auth.getAccessToken()}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });
    if (!response.ok) {
      if (response.status === 401) this.auth.handleRejectedCredential(session);
      throw Object.assign(new Error(`Dropbox download failed (HTTP ${response.status})`), { status: response.status });
    }
    const resultHeader = response.headers.get('Dropbox-API-Result');
    let actual: { id?: string; rev?: string; size?: number; content_hash?: string } = {};
    try {
      actual = resultHeader ? JSON.parse(resultHeader) : {};
    } catch {
      throw new DropboxDownloadMismatchError('Dropbox download metadata is unreadable');
    }
    if (
      actual.id !== file.id ||
      actual.rev !== file.revision ||
      actual.size !== file.size ||
      (file.contentHash !== null && actual.content_hash !== undefined && actual.content_hash !== file.contentHash)
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new DropboxDownloadMismatchError('Dropbox download metadata changed');
    }
    const bytes = await readLimited(response, MAX_BACKUP_BYTES);
    this.auth.requireSession(session.generation);
    if (bytes.byteLength !== file.size) throw new DropboxDownloadMismatchError('Dropbox download is incomplete');
    if (file.contentHash !== null && (await dropboxContentHash(bytes)) !== file.contentHash) {
      throw new DropboxDownloadMismatchError('Dropbox download content hash mismatch');
    }
    return (await BackupFileFormat.decode(file.name, bytes)).data;
  }

  private async requireLedger(account: string): Promise<DropboxRemoteFile[]> {
    const ledger = await this.ledger.read(account);
    if (ledger === null) throw new Error('This browser’s backup ownership record is unreadable, so uploads are blocked to protect your backups.');
    return ledger;
  }

  private async call<T>(session: DropboxSession, operation: (client: DropboxSession['client']) => Promise<T>): Promise<T> {
    this.auth.requireSession(session.generation);
    try {
      return await operation(session.client);
    } catch (error) {
      if (isCredentialRejected(error)) this.auth.handleRejectedCredential(session);
      throw error;
    } finally {
      this.auth.persistRefreshedToken(session);
    }
  }

  private async exclusive<T>(label: string, work: (session: DropboxSession) => Promise<T>): Promise<T> {
    if (this.busyState() !== null) throw new Error(`Another Dropbox operation is running: ${this.busyState()}.`);
    const session = this.auth.requireSession();
    this.busyState.set(label);
    this.diagnosticsState.set([]);
    this.log('START', label);
    try {
      if (this.metaState() === EMPTY_META) await this.loadMeta();
      const result = await work(session);
      this.log('COMPLETE', label);
      return result;
    } catch (error) {
      this.log('FAILED', errorSummary(error));
      if (error instanceof RestoreCapacityError) throw error;
      throw new Error(errorSummary(error));
    } finally {
      this.busyState.set(null);
    }
  }

  private async updateMeta(account: string, change: Partial<DropboxSyncMeta>): Promise<void> {
    const next = { ...this.metaState(), ...change };
    await putSetting(`dropbox-sync:${account}`, next);
    if (this.auth.connection().accountIdHash === account) this.metaState.set(next);
  }

  private log(stage: string, detail: string): void {
    this.diagnosticsState.update((entries) => [...entries.slice(-49), { at: Date.now(), stage, detail }]);
  }
}

function isPathNotFound(error: unknown): boolean {
  const body = JSON.stringify((error as { error?: unknown } | null)?.error ?? '');
  return (error as { status?: unknown } | null)?.status === 409 && /not_found/.test(body);
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new DropboxValidationError('Backup exceeds download limit');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function describeOutcome(outcome: SyncOutcome): string {
  switch (outcome.kind) {
    case 'up-to-date':
      return 'Already up to date';
    case 'uploaded':
      return 'Backup uploaded and verified';
    case 'nothing-to-back-up':
      return 'Nothing to back up';
    case 'offer':
      return outcome.offer.kind === 'conflict' ? 'Waiting for your choice (different data on both sides)' : 'Dropbox backup available to restore';
    case 'remote-changed':
      return 'Dropbox changed during the sync; check again';
  }
}
