import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import { APP_CONFIG, manifestSources } from '../config/app-config';
import { describeStorageError, getAll, getSetting, isQuotaError, putSetting, requestToPromise, transaction } from '../storage/idb';
import { fetchManifestSources, MAX_MANIFEST_BYTES, PackCatalog, parseManifest, type CountryManifestSource, type ManifestFetchResult, type RemoteManifest, type RemotePack } from './pack-manifest';
import { resolveDownloadUrl } from './download-mirror';
import type { InstalledPackRecord, InstallWorkerRequest, InstallWorkerResponse, PackFileRecord } from './pack-records';
import type { InstallPhase } from './prepare-pack';
import { OfflineLocalityService, sqlWasmUrl } from '../offline-resolver/offline-locality.service';
import { LocationSelectionService } from '../location/location-selection.service';
import type { ValidatedPack } from '../offline-resolver/offline-locality-resolver';

export type CatalogState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly result: ManifestFetchResult; readonly cachedSources: readonly string[] }
  | { readonly status: 'error'; readonly message: string };

export interface PackJob {
  readonly packId: string;
  readonly name: string;
  readonly status: 'queued' | 'running' | 'failed' | 'cancelled';
  readonly phase: InstallPhase | null;
  readonly percent: number | null;
  readonly error: string | null;
}

export interface StorageEstimateState {
  readonly usage: number | null;
  readonly quota: number | null;
  readonly persisted: boolean | null;
}

interface CachedManifest {
  readonly text: string;
  readonly fetchedAt: number;
}

const STORAGE_MARGIN_BYTES = 32 * 1024 * 1024;

@Service()
export class PackCatalogService {
  private readonly config = inject(APP_CONFIG);
  private readonly resolver = inject(OfflineLocalityService);
  private readonly selection = inject(LocationSelectionService);
  private readonly catalogState = signal<CatalogState>({ status: 'idle' });
  private readonly installedState = signal<readonly InstalledPackRecord[]>([]);
  private readonly jobsState = signal<ReadonlyMap<string, PackJob>>(new Map());
  private readonly storageState = signal<StorageEstimateState>({ usage: null, quota: null, persisted: null });
  private readonly queue: RemotePack[] = [];
  private worker: Worker | null = null;
  private running: { pack: RemotePack; requestId: number; resolve: (value: { bytes: ArrayBuffer; validated: ValidatedPack }) => void; reject: (error: Error & { cancelled?: boolean }) => void } | null = null;
  private nextRequest = 1;

  readonly catalog = this.catalogState.asReadonly();
  readonly installed = this.installedState.asReadonly();
  readonly jobs = this.jobsState.asReadonly();
  readonly storage = this.storageState.asReadonly();
  readonly installedById = computed(() => new Map(this.installedState().map((record) => [record.id, record])));
  readonly busy = computed(() => [...this.jobsState().values()].some((job) => job.status === 'queued' || job.status === 'running'));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.worker?.terminate());
  }

  sources(): CountryManifestSource[] {
    return manifestSources(this.config);
  }

  async loadInstalled(): Promise<void> {
    const records = await getAll<InstalledPackRecord>('installedPacks');
    this.installedState.set(records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  }

  async refreshStorageEstimate(): Promise<void> {
    if (!navigator.storage?.estimate) return;
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate().catch(() => null),
      navigator.storage.persisted?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    this.storageState.set({ usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted });
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    const granted = await navigator.storage.persist().catch(() => false);
    await this.refreshStorageEstimate();
    return granted;
  }

  async loadCatalog(): Promise<void> {
    this.catalogState.set({ status: 'loading' });
    const cachedSources: string[] = [];
    try {
      const result = await fetchManifestSources(this.sources(), async (source) => {
        try {
          return await this.fetchManifest(source);
        } catch (error) {
          const cached = await getSetting<CachedManifest>(`manifest-cache:${source.countryCode}`).catch(() => undefined);
          if (!cached) throw error;
          cachedSources.push(`${source.countryName} (saved ${new Date(cached.fetchedAt).toLocaleString()})`);
          return parseManifest(cached.text, source);
        }
      });
      this.catalogState.set({ status: 'loaded', result, cachedSources });
    } catch (error) {
      this.catalogState.set({
        status: 'error',
        message: `${error instanceof Error ? error.message : 'The catalog could not be loaded'}. Installed packs keep working offline.`,
      });
    }
  }

  private async fetchManifest(source: CountryManifestSource): Promise<RemoteManifest> {
    const url = resolveDownloadUrl(source.manifestUrl, this.config.downloadMirrors, document.baseURI);
    const response = await fetch(url, { credentials: 'omit', cache: 'no-cache', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${source.countryName} catalog request failed: HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) throw new Error(`${source.countryName} catalog is too large`);
    const manifest = parseManifest(text, source);
    await putSetting<CachedManifest>(`manifest-cache:${source.countryCode}`, { text, fetchedAt: Date.now() }).catch(() => undefined);
    return manifest;
  }

  /** Queues packs that are missing or outdated; downloads run one at a time. */
  enqueue(packs: readonly RemotePack[]): number {
    const required = PackCatalog.requiredPacks(packs, this.installedById());
    let added = 0;
    for (const pack of required) {
      const job = this.jobsState().get(pack.id);
      if (job && (job.status === 'queued' || job.status === 'running')) continue;
      this.queue.push(pack);
      this.setJob({ packId: pack.id, name: pack.name, status: 'queued', phase: null, percent: null, error: null });
      added++;
    }
    void this.pump();
    return added;
  }

  cancel(packId: string): void {
    const index = this.queue.findIndex((pack) => pack.id === packId);
    if (index >= 0) {
      const [pack] = this.queue.splice(index, 1);
      this.setJob({ packId, name: pack.name, status: 'cancelled', phase: null, percent: null, error: 'Cancelled before starting' });
      return;
    }
    if (this.running?.pack.id === packId && this.worker) {
      const request: InstallWorkerRequest = { type: 'cancel', requestId: this.running.requestId };
      this.worker.postMessage(request);
    }
  }

  cancelAll(): void {
    for (const pack of [...this.queue]) this.cancel(pack.id);
    if (this.running) this.cancel(this.running.pack.id);
  }

  dismissJob(packId: string): void {
    const jobs = new Map(this.jobsState());
    jobs.delete(packId);
    this.jobsState.set(jobs);
  }

  async remove(ids: readonly string[]): Promise<void> {
    await transaction(['installedPacks', 'packFiles'], 'readwrite', async (tx) => {
      for (const id of ids) {
        await requestToPromise(tx.objectStore('installedPacks').delete(id));
        await requestToPromise(tx.objectStore('packFiles').delete(id));
      }
    });
    this.resolver.invalidate();
    await this.loadInstalled();
    await this.refreshStorageEstimate();
    this.selection.refreshLocality();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const pack = this.queue.shift();
    if (!pack) return;
    try {
      await this.install(pack);
      this.dismissJob(pack.id);
    } catch (error) {
      const cancelled = (error as { cancelled?: boolean }).cancelled === true;
      this.setJob({
        packId: pack.id,
        name: pack.name,
        status: cancelled ? 'cancelled' : 'failed',
        phase: null,
        percent: null,
        error: cancelled ? 'Cancelled. Any previously installed version is unchanged.' : this.describe(error),
      });
    } finally {
      this.running = null;
      void this.pump();
    }
  }

  private describe(error: unknown): string {
    if (isQuotaError(error)) return describeStorageError(error);
    const message = error instanceof Error ? error.message : 'Download failed';
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      return 'The pack could not be downloaded. The host may block browser downloads (CORS) or you may be offline.';
    }
    return message;
  }

  private async ensureSpace(pack: RemotePack): Promise<void> {
    if (!navigator.storage?.estimate) return;
    const estimate = await navigator.storage.estimate().catch(() => null);
    if (!estimate?.quota || estimate.usage === undefined) return;
    const required = (pack.compressedBytes ?? 0) + (pack.uncompressedBytes ?? 0) * 2 + STORAGE_MARGIN_BYTES;
    if (estimate.quota - estimate.usage < required) {
      throw new Error(`Not enough browser storage. About ${Math.ceil(required / 1024 / 1024)} MB is needed.`);
    }
  }

  private async install(pack: RemotePack): Promise<void> {
    await this.ensureSpace(pack);
    const url = resolveDownloadUrl(pack.downloadUrl, this.config.downloadMirrors, document.baseURI);
    const prepared = await this.prepareInWorker(pack, url);
    const installedAt = Date.now();
    const record: InstalledPackRecord = {
      id: pack.id,
      name: pack.name,
      version: pack.version,
      countryCode: pack.countryCode,
      countryName: pack.countryName,
      region: pack.region,
      sha256: pack.sha256,
      sizeBytes: prepared.bytes.byteLength,
      installedAt,
      sourceUrl: pack.downloadUrl,
      stateRings: prepared.validated.stateRings,
      meta: prepared.validated.meta,
    };
    const file: PackFileRecord = { id: pack.id, version: pack.version, installedAt, bytes: prepared.bytes };
    // Activation: both records replace the previous version in one transaction, or neither does.
    await transaction(['installedPacks', 'packFiles'], 'readwrite', async (tx) => {
      await requestToPromise(tx.objectStore('packFiles').put(file));
      await requestToPromise(tx.objectStore('installedPacks').put(record));
    });
    this.resolver.invalidate();
    await this.loadInstalled();
    await this.refreshStorageEstimate();
    this.selection.refreshLocality();
  }

  private prepareInWorker(pack: RemotePack, url: string): Promise<{ bytes: ArrayBuffer; validated: ValidatedPack }> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequest++;
    this.setJob({ packId: pack.id, name: pack.name, status: 'running', phase: 'download', percent: 0, error: null });
    return new Promise((resolve, reject) => {
      this.running = { pack, requestId, resolve, reject };
      const request: InstallWorkerRequest = { type: 'install', requestId, pack, url, wasmUrl: sqlWasmUrl() };
      worker.postMessage(request);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./pack-install.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<InstallWorkerResponse>) => {
      const running = this.running;
      if (!running || running.requestId !== data.requestId) return;
      if (data.type === 'progress') {
        this.setJob({ packId: running.pack.id, name: running.pack.name, status: 'running', phase: data.phase, percent: data.percent, error: null });
      } else if (data.type === 'prepared') {
        running.resolve({ bytes: data.bytes, validated: data.validated });
      } else {
        running.reject(Object.assign(new Error(data.message), { cancelled: data.cancelled }));
      }
    };
    worker.onerror = () => {
      this.running?.reject(new Error('The download worker stopped unexpectedly.'));
      worker.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private setJob(job: PackJob): void {
    const jobs = new Map(this.jobsState());
    jobs.set(job.packId, job);
    this.jobsState.set(jobs);
  }
}
