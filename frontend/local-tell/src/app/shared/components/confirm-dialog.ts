import { Component, effect, ElementRef, input, output, viewChild } from '@angular/core';

/** Accessible modal confirmation built on the native `<dialog>` element (focus trap, Escape to cancel). */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog #dialog class="lt-dialog" [attr.aria-labelledby]="id + '-title'" [attr.aria-describedby]="id + '-body'" (cancel)="onCancel($event)">
      <h2 [id]="id + '-title'">{{ heading() }}</h2>
      <div [id]="id + '-body'"><ng-content /></div>
      <div class="actions">
        <button type="button" class="btn" (click)="cancelled.emit()">{{ cancelLabel() }}</button>
        <button type="button" class="btn" [class.btn-danger]="danger()" [class.btn-primary]="!danger()" (click)="confirmed.emit()" [disabled]="confirmDisabled()">
          {{ confirmLabel() }}
        </button>
      </div>
    </dialog>
  `,
})
export class ConfirmDialog {
  private static counter = 0;
  protected readonly id = `confirm-${++ConfirmDialog.counter}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private returnFocus: HTMLElement | null = null;

  readonly open = input(false);
  readonly heading = input.required<string>();
  readonly confirmLabel = input('Confirm');
  readonly cancelLabel = input('Cancel');
  readonly danger = input(false);
  readonly confirmDisabled = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) {
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (typeof element.showModal === 'function') element.showModal();
        else element.setAttribute('open', '');
      } else if (!this.open() && element.open) {
        if (typeof element.close === 'function') element.close();
        else element.removeAttribute('open');
        this.returnFocus?.focus();
      }
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.cancelled.emit();
  }
}
