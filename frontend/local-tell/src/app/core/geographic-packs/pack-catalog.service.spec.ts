import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import { PACK_INSTALL_WORKER_FACTORY, PackCatalogService } from './pack-catalog.service';
import type { InstallWorkerRequest, InstallWorkerResponse } from './pack-records';
import type { RemotePack } from './pack-manifest';
import { getAll } from '../storage/idb';
import { resetDatabase, TEST_CONFIG } from '../../../testing/test-config';

class FakeInstallWorker {
  readonly requests: InstallWorkerRequest[] = [];
  onmessage: ((event: MessageEvent<InstallWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;

  postMessage(request: InstallWorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    // Nothing to release.
  }

  installs(): Extract<InstallWorkerRequest, { type: 'install' }>[] {
    return this.requests.filter((request): request is Extract<InstallWorkerRequest, { type: 'install' }> => request.type === 'install');
  }

  respond(message: InstallWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<InstallWorkerResponse>);
  }

  prepared(requestId: number): void {
    this.respond({
      type: 'prepared',
      requestId,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      validated: { schemaVersion: 3, meta: { pack_id: 'TN' }, stateRings: ['0,0;0,1;1,1;1,0'] },
    });
  }
}

function pack(id: string): RemotePack {
  return {
    id,
    name: `Pack ${id}`,
    version: 3,
    region: 'south',
    displayOrder: 1,
    downloadUrl: `https://github.com/actionanand/localtell-data/releases/download/cell-data-v3/${id}.db.gz`,
    sha256: 'a'.repeat(64),
    compressedBytes: 10,
    uncompressedBytes: 20,
    countryCode: 'IN',
    countryName: 'India',
    packType: 'state_ut',
    adminCode: null,
    layout: 'REGIONS',
    sourceOrder: 0,
  };
}

/** Waits until queued microtasks and IndexedDB callbacks have run. */
const settle = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(condition()).toBe(true);
};

describe('PackCatalogService installation queue', () => {
  let worker: FakeInstallWorker;
  let service: PackCatalogService;

  beforeEach(async () => {
    worker = new FakeInstallWorker();
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: TEST_CONFIG },
        { provide: PACK_INSTALL_WORKER_FACTORY, useValue: () => worker as unknown as Worker },
      ],
    });
    service = TestBed.inject(PackCatalogService);
    await resetDatabase();
    await service.loadInstalled();
  });

  it('never activates a pack whose worker result arrives after cancellation', async () => {
    service.enqueue([pack('TN')]);
    await settle(() => worker.installs().length === 1);
    const requestId = worker.installs()[0].requestId;
    expect(service.cancel('TN')).toBe(true);
    worker.prepared(requestId);
    await settle(() => service.jobs().get('TN')?.status === 'cancelled');
    expect(worker.requests).toContainEqual({ type: 'cancel', requestId });
    expect(await getAll('installedPacks')).toEqual([]);
    expect(await getAll('packFiles')).toEqual([]);
  });

  it('cancels before the worker starts without sending an install request', async () => {
    service.enqueue([pack('TN')]);
    expect(service.cancel('TN')).toBe(true);
    await settle(() => service.jobs().get('TN')?.status === 'cancelled');
    expect(worker.installs()).toEqual([]);
  });

  it('runs one install at a time even when packs are queued repeatedly', async () => {
    service.enqueue([pack('TN')]);
    service.enqueue([pack('KL')]);
    service.enqueue([pack('KA')]);
    await settle(() => worker.installs().length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(worker.installs().map((request) => request.pack.id)).toEqual(['TN']);
    worker.prepared(worker.installs()[0].requestId);
    await settle(() => worker.installs().length === 2);
    expect(worker.installs()[1].pack.id).toBe('KL');
  });

  it('keeps the previous version when a cancelled update would have replaced it', async () => {
    service.enqueue([{ ...pack('TN'), version: 2 }]);
    await settle(() => worker.installs().length === 1);
    worker.prepared(worker.installs()[0].requestId);
    await settle(() => service.installed().length === 1);
    service.enqueue([pack('TN')]);
    await settle(() => worker.installs().length === 2);
    service.cancel('TN');
    worker.prepared(worker.installs()[1].requestId);
    await settle(() => service.jobs().get('TN')?.status === 'cancelled');
    expect(service.installed().map((record) => record.version)).toEqual([2]);
  });

  it('reports that cancellation is too late once activation has started', async () => {
    service.enqueue([pack('TN')]);
    await settle(() => worker.installs().length === 1);
    worker.prepared(worker.installs()[0].requestId);
    await settle(() => service.jobs().get('TN')?.phase === 'activate' || service.installed().length === 1);
    if (service.installed().length === 0) expect(service.cancel('TN')).toBe(false);
    await settle(() => service.installed().length === 1);
    expect(service.jobs().has('TN')).toBe(false);
  });
});
