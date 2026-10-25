import { inject, Service } from '@angular/core';
import { NotificationService } from './notification.service';

@Service()
export class ClipboardService {
  private readonly notifications = inject(NotificationService);

  async copy(text: string, label: string): Promise<boolean> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      this.notifications.show(`${label} copied.`, 'success', 3000);
      return true;
    } catch {
      this.notifications.show(`Could not copy ${label.toLowerCase()}. Select the text and copy it manually.`, 'warning');
      return false;
    }
  }
}
