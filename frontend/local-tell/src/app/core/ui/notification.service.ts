import { Service, signal } from '@angular/core';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface Notice {
  readonly id: number;
  readonly tone: NoticeTone;
  readonly message: string;
}

/** Short, non-technical status messages announced through a polite live region. */
@Service()
export class NotificationService {
  private nextId = 1;
  private readonly notices = signal<readonly Notice[]>([]);
  readonly current = this.notices.asReadonly();

  show(message: string, tone: NoticeTone = 'info', timeoutMs = 6000): void {
    const notice: Notice = { id: this.nextId++, tone, message };
    this.notices.update((list) => [...list.slice(-3), notice]);
    if (timeoutMs > 0) setTimeout(() => this.dismiss(notice.id), timeoutMs);
  }

  dismiss(id: number): void {
    this.notices.update((list) => list.filter((notice) => notice.id !== id));
  }
}
