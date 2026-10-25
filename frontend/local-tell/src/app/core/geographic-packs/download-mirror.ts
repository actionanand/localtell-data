import type { DownloadMirror } from '../config/app-config';

/**
 * Maps a published GitHub Release URL to a configured mirror. Only an exact configured prefix is
 * rewritten; the remaining path must stay inside the mirror (no `..`, encoded separators or queries).
 */
export function resolveDownloadUrl(url: string, mirrors: readonly DownloadMirror[], baseUri: string): string {
  for (const mirror of mirrors) {
    if (!url.startsWith(mirror.from)) continue;
    const rest = url.slice(mirror.from.length);
    if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(rest) || rest.split('/').some((segment) => segment === '..' || segment === '.')) {
      throw new Error('Refusing to map an unexpected download path to the mirror');
    }
    return new URL(mirror.to + rest, baseUri).toString();
  }
  return url;
}
