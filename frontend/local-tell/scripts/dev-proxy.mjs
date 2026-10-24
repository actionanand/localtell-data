// Development proxy for geographic downloads (`ng serve`). GitHub Release URLs answer with a 302 to a
// signed asset host that sends no CORS headers, so redirects are rewritten to stay on this origin.
export const RELEASE_PATH = '/actionanand/localtell-data/releases/download';

export const ASSET_HOSTS = {
  '/data-mirror-assets': 'https://release-assets.githubusercontent.com',
  '/data-mirror-objects': 'https://objects.githubusercontent.com',
};

/** Maps an upstream redirect to the matching same-origin proxy path; unknown hosts are left as-is. */
export function rewriteRedirectLocation(location) {
  if (typeof location !== 'string') return location;
  if (location.startsWith(`https://github.com${RELEASE_PATH}/`)) {
    return `/data-mirror/${location.slice(`https://github.com${RELEASE_PATH}/`.length)}`;
  }
  for (const [prefix, origin] of Object.entries(ASSET_HOSTS)) {
    if (location.startsWith(`${origin}/`)) return `${prefix}${location.slice(origin.length)}`;
  }
  return location;
}

function rewriteRedirects(proxy) {
  proxy.on('proxyRes', (response) => {
    if (response.headers.location) response.headers.location = rewriteRedirectLocation(response.headers.location);
  });
}

export function createProxyConfig() {
  const config = {
    '/data-mirror/': {
      target: 'https://github.com',
      secure: true,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/data-mirror\//, `${RELEASE_PATH}/`),
      configure: rewriteRedirects,
    },
  };
  for (const [prefix, target] of Object.entries(ASSET_HOSTS)) {
    config[`${prefix}/`] = {
      target,
      secure: true,
      changeOrigin: true,
      rewrite: (path) => path.slice(prefix.length),
      configure: rewriteRedirects,
    };
  }
  return config;
}
