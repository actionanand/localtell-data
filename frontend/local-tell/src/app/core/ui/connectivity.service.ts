import { DestroyRef, inject, Service, signal } from '@angular/core';

/** Tracks `navigator.onLine` so online-only features can explain limitations without disabling others. */
@Service()
export class ConnectivityService {
  private readonly state = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this.state.asReadonly();
  private readonly reconnectListeners = new Set<() => void>();

  constructor() {
    const update = () => {
      const wasOnline = this.state();
      this.state.set(navigator.onLine);
      if (!wasOnline && navigator.onLine) this.reconnectListeners.forEach((listener) => listener());
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }

  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }
}
