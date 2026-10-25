import { DestroyRef, inject, Service, signal } from '@angular/core';
import type { SelectedLocation } from '../models/location';
import type { DetectedRegion } from './boundary-index';

export type GeographyState = { status: 'idle' | 'loading' | 'uncertain' } | { status: 'resolved'; region: DetectedRegion } | { status: 'error'; message: string };

@Service()
export class GeographyService {
  private worker: Worker | null = null;
  private generation = 0;
  private readonly state = signal<GeographyState>({ status: 'idle' });
  readonly current = this.state.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.worker?.terminate());
  }

  identify(location: SelectedLocation): void {
    const id = ++this.generation;
    if (location.origin === 'ip') { this.state.set({ status: 'uncertain' }); return; }
    this.state.set({ status: 'loading' });
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./geography.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<{ id: number; region?: DetectedRegion | null; error?: string }>) => {
          if (data.id !== this.generation) return;
          this.state.set(data.error ? { status: 'error', message: data.error } : data.region ? { status: 'resolved', region: data.region } : { status: 'uncertain' });
        };
        this.worker.onerror = () => {
          this.state.set({ status: 'error', message: 'Built-in geographic guidance could not load.' });
          this.worker?.terminate(); this.worker = null;
        };
      }
      this.worker.postMessage({ id, url: new URL('geography/boundaries.ltgz', document.baseURI).href,
        latitude: location.latitude, longitude: location.longitude,
        accuracy: location.origin === 'device' ? location.accuracyMetres : location.accuracyMetres ?? 0 });
    } catch {
      this.state.set({ status: 'error', message: 'Built-in geographic guidance requires Web Worker support.' });
    }
  }
}