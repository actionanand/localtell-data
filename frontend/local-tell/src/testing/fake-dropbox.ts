import { signal } from '@angular/core';
import { dropboxContentHash, MANAGED_DIRECTORY } from '../app/core/dropbox/dropbox-policy';
import { DropboxSessionChangedError, type DropboxConnectionState, type DropboxSession } from '../app/core/dropbox/dropbox-auth.service';

interface StoredFile {
  id: string;
  name: string;
  path: string;
  rev: string;
  serverModified: string;
  bytes: Uint8Array;
  contentHash: string;
}

let counter = 0;
const nextRev = () => (0x100000000 + ++counter).toString(16).padStart(12, '0');

/**
 * In-memory Dropbox App Folder implementing only the SDK calls LocalTell uses. Any delete, move or
 * overwrite attempt fails the test: the web app must never remove or replace remote backups.
 */
export class FakeDropbox {
  readonly files = new Map<string, StoredFile>();
  readonly calls: string[] = [];
  folderExists = false;
  /** Runs after Dropbox accepts an upload, before the response returns (simulates concurrent activity). */
  afterUpload: (() => Promise<void> | void) | null = null;

  async addFile(name: string, contents: Uint8Array | string, modifiedAt = Date.now()): Promise<StoredFile> {
    const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
    const path = `${MANAGED_DIRECTORY}/${name}`.toLowerCase();
    if (this.files.has(path)) throw Object.assign(new Error('conflict'), { status: 409, error: { error_summary: 'path/conflict/file/' } });
    const file: StoredFile = {
      id: `id:${(++counter).toString(36)}fake`,
      name,
      path,
      rev: nextRev(),
      serverModified: new Date(modifiedAt).toISOString().replace(/\.\d+Z$/, 'Z'),
      bytes,
      contentHash: await dropboxContentHash(bytes),
    };
    this.folderExists = true;
    this.files.set(path, file);
    return file;
  }

  private metadata(file: StoredFile) {
    return {
      '.tag': 'file' as const,
      id: file.id,
      name: file.name,
      path_lower: file.path,
      path_display: file.path,
      rev: file.rev,
      size: file.bytes.byteLength,
      server_modified: file.serverModified,
      client_modified: file.serverModified,
      content_hash: file.contentHash,
    };
  }

  readonly client = new Proxy(
    {
      filesListFolder: async ({ path }: { path: string }) => {
        this.calls.push('filesListFolder');
        if (path !== MANAGED_DIRECTORY) throw new Error(`Unexpected list path ${path}`);
        if (!this.folderExists) throw { status: 409, error: { error_summary: 'path/not_found/' } };
        return { result: { entries: [...this.files.values()].map((file) => this.metadata(file)), cursor: 'c', has_more: false } };
      },
      filesListFolderContinue: async () => ({ result: { entries: [], cursor: 'c', has_more: false } }),
      filesGetMetadata: async ({ path }: { path: string }) => {
        this.calls.push('filesGetMetadata');
        if (path === MANAGED_DIRECTORY && this.folderExists) return { result: { '.tag': 'folder', name: 'localtell-managed-backups' } };
        throw { status: 409, error: { error_summary: 'path/not_found/' } };
      },
      filesCreateFolderV2: async () => {
        this.calls.push('filesCreateFolderV2');
        this.folderExists = true;
        return { result: {} };
      },
      filesUpload: async (arg: { path: string; mode: { '.tag': string }; autorename: boolean; strict_conflict: boolean; contents: Blob }) => {
        this.calls.push('filesUpload');
        if (arg.mode['.tag'] !== 'add' || arg.autorename !== false || arg.strict_conflict !== true) {
          throw new Error('Uploads must use add mode with strict conflicts');
        }
        const bytes = new Uint8Array(await arg.contents.arrayBuffer());
        const file = await this.addFile(arg.path.slice(MANAGED_DIRECTORY.length + 1), bytes);
        await this.afterUpload?.();
        return { result: this.metadata(file) };
      },
    },
    {
      get: (target, property: string) => {
        if (property in target) return target[property as keyof typeof target];
        return () => {
          throw new Error(`Forbidden or unexpected Dropbox call: ${property}`);
        };
      },
    },
  );

  /** `fetch` stand-in for https://content.dropboxapi.com/2/files/download. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url !== 'https://content.dropboxapi.com/2/files/download') throw new Error(`Unexpected fetch ${url}`);
    this.calls.push('download');
    const arg = JSON.parse(new Headers(init?.headers).get('Dropbox-API-Arg') ?? '{}') as { path?: string };
    const file = [...this.files.values()].find((entry) => `rev:${entry.rev}` === arg.path);
    if (!file) return new Response('{"error_summary":"path/not_found/"}', { status: 409 });
    const result = Object.fromEntries(Object.entries(this.metadata(file)).filter(([key]) => key !== '.tag'));
    return new Response(file.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify(result) } });
  };
}

/** Minimal DropboxAuthService stand-in with a controllable session generation. */
export class FakeDropboxAuth {
  generation = 1;
  readonly connection = signal<DropboxConnectionState>({
    status: 'connected',
    accountName: 'Test User',
    accountIdHash: 'a'.repeat(64),
    persistent: false,
    message: null,
  });
  readonly connected = () => this.connection().status === 'connected';

  constructor(private readonly dropbox: FakeDropbox) {}

  private session(): DropboxSession {
    return {
      client: this.dropbox.client as unknown as DropboxSession['client'],
      auth: { checkAndRefreshAccessToken: async () => undefined, getAccessToken: () => 'test-token' } as unknown as DropboxSession['auth'],
      account: 'a'.repeat(64),
      generation: this.generation,
    };
  }

  requireSession(expectedGeneration?: number): DropboxSession {
    if (expectedGeneration !== undefined && expectedGeneration !== this.generation) throw new DropboxSessionChangedError();
    return this.session();
  }

  persistRefreshedToken(): void {
    // Tokens are not persisted in tests.
  }

  handleRejectedCredential(): void {
    this.generation++;
  }
}
