import { DestroyRef, inject, Service } from '@angular/core';
import type { ResolverResult, ResolverWorkerRequest, ResolverWorkerResponse } from '../geographic-packs/pack-records';

export function sqlWasmUrl(): string {
  return new URL('assets/sqljs/sql-wasm-browser.wasm', document.baseURI).toString();
}

/** Runs schema-v3 locality lookups inside a dedicated Web Worker. */
@Service()
export class OfflineLocalityService {
  private worker: Worker | null = null;
  private nextRequest = 1;
  private readonly pending = new Map<number, { resolve: (result: ResolverResult) => void; reject: (error: Error) => void }>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.worker?.terminate());
  }

  resolve(latitude: number, longitude: number): Promise<ResolverResult> {
    const worker = this.ensureWorker();
    const requestId = this.nextRequest++;
    return new Promise<ResolverResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: ResolverWorkerRequest = { type: 'resolve', requestId, latitude, longitude, wasmUrl: sqlWasmUrl() };
      worker.postMessage(request);
    });
  }

  /** Drops cached databases after packs are installed, updated or removed. */
  invalidate(): void {
    const request: ResolverWorkerRequest = { type: 'invalidate' };
    this.worker?.postMessage(request);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') throw new Error('This browser does not support Web Workers.');
    const worker = new Worker(new URL('./resolver.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<ResolverWorkerResponse>) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.type === 'resolved') pending.resolve(data.result);
      else pending.reject(new Error(data.message));
    };
    worker.onerror = () => {
      for (const pending of this.pending.values()) pending.reject(new Error('The offline lookup worker stopped unexpectedly.'));
      this.pending.clear();
      worker.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
