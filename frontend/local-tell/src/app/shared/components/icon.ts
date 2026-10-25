import { Component, computed, input } from '@angular/core';

export type IconName =
  | 'dashboard'
  | 'search'
  | 'map'
  | 'download'
  | 'bookmark'
  | 'compare'
  | 'cloud'
  | 'settings'
  | 'menu'
  | 'close'
  | 'copy'
  | 'external'
  | 'directions'
  | 'share'
  | 'locate'
  | 'globe'
  | 'trash'
  | 'edit'
  | 'refresh'
  | 'upload'
  | 'check'
  | 'warning'
  | 'expand'
  | 'target';

/** Path data (24px viewBox, stroke icons) kept inline so icons work offline without a font. */
const PATHS: Readonly<Record<IconName, string>> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  compare: 'M7 4v16M17 4v16M3 8h8M13 16h8',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  directions: 'M12 2 2 12l10 10 10-10zM9 13v-2h5l-2-2M14 11l-2 2',
  share: 'M4 12v8h16v-8M12 3v13M7 8l5-5 5 5',
  locate: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  upload: 'M12 21V9M7 14l5-5 5 5M4 5h16',
  check: 'M5 12l5 5 9-10',
  warning: 'M12 3 2 21h20zM12 10v5M12 18v.01',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  target: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
};

@Component({
  selector: 'app-icon',
  template: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path [attr.d]="path()" /></svg>`,
  host: { class: 'icon' },
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => PATHS[this.name()]);
}
