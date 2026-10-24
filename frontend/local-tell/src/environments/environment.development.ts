import type { AppConfig } from '../app/core/config/app-config';
import { environment as production } from './environment';

/** `ng serve` proxies `/data-mirror/` to GitHub Releases (see proxy.conf.mjs). */
export const environment: AppConfig = {
  ...production,
  production: false,
  features: { ...production.features, serviceWorker: false },
};
