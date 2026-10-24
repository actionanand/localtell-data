// Shared helpers for the cross-platform build scripts (no shell syntax, works on Windows and POSIX).
export const DEFAULT_BASE_HREF = '/localtell-data/';

/** Normalizes BASE_HREF to an absolute path with leading and trailing slashes. */
export function resolveBaseHref(value) {
  const raw = (value ?? '').trim() || DEFAULT_BASE_HREF;
  if (!/^\/?[A-Za-z0-9._~\-/]*$/.test(raw) || raw.includes('..') || raw.includes('//')) {
    throw new Error(`Invalid BASE_HREF: ${raw}`);
  }
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}
