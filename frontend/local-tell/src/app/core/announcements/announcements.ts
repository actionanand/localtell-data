import { parseStrictJson } from '../backup/strict-json';
import { parseJavaInstant } from '../backup/java-format';

export interface Announcement {
  id: string; enabled: boolean; priority: number; publishedAt: number | null; expiresAt: number | null;
  minVersionCode: number | null; maxVersionCode: number | null;
  title: Record<string, string>; message: Record<string, string>; type: string; revision: number;
  repeatPolicy: 'every_launch' | 'once_per_revision'; action: 'none' | 'offline_data' | 'open_play_store'; actionUrl: string | null;
}

export function playStoreUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value) ? value : null;
}

export function parseAnnouncements(text: string): Announcement[] {
  if (new TextEncoder().encode(text).length > 65536) throw new Error('Announcement document too large');
  parseStrictJson(text);
  const root = JSON.parse(text) as Record<string, unknown>;
  if (root['schemaVersion'] !== 1 || !Array.isArray(root['announcements'])) throw new Error('Unsupported announcement schema');
  const ids = new Set<string>();
  return root['announcements'].map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid announcement');
    const entry = raw as Record<string, unknown>;
    const integer = (key: string, fallback: number | null, low = 0, high = 2147483647) => {
      const value = entry[key] ?? fallback;
      if (value === null) return null;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) throw new Error('Invalid announcement integer');
      return value;
    };
    const instant = (key: string) => entry[key] == null ? null : typeof entry[key] === 'string' ? parseJavaInstant(entry[key]) : (() => { throw new Error('Invalid announcement date'); })();
    const localized = (key: string, maximum: number): Record<string, string> => {
      const value = entry[key] as Record<string, unknown> | null;
      if (!value || typeof value !== 'object' || typeof value['en'] !== 'string' || !value['en'].trim()) throw new Error('Missing English announcement');
      const result: Record<string, string> = {};
      for (const language of ['en', 'ta', 'sa']) {
        const text = value[language];
        if (text == null || text === '') continue;
        if (typeof text !== 'string' || !text.trim() || text.length > maximum) throw new Error('Invalid announcement text');
        result[language] = text;
      }
      return result;
    };
    const id = entry['id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(id) || ids.has(id) || typeof entry['enabled'] !== 'boolean') throw new Error('Invalid announcement identity');
    ids.add(id);
    const publishedAt = instant('publishedAt'); const expiresAt = instant('expiresAt');
    const minVersionCode = integer('minVersionCode', null); const maxVersionCode = integer('maxVersionCode', null);
    if ((publishedAt !== null && expiresAt !== null && expiresAt <= publishedAt) || (minVersionCode !== null && maxVersionCode !== null && maxVersionCode < minVersionCode)) throw new Error('Invalid announcement range');
    const revisionValue = entry['revision'] ?? 1;
    const revision = typeof revisionValue === 'string' && /^\d+$/.test(revisionValue) ? Number(revisionValue) : revisionValue;
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision <= 0 || revision > 2147483647) throw new Error('Invalid revision');
    const actionUrl = playStoreUrl(entry['actionUrl']);
    const action = String(entry['action'] ?? 'none').toLowerCase();
    const type = String(entry['type'] ?? 'general').toLowerCase();
    return { id, enabled: entry['enabled'], priority: integer('priority', 0, -1000000, 1000000) ?? 0, publishedAt, expiresAt, minVersionCode, maxVersionCode,
      title: localized('title', 120), message: localized('message', 600),
      revision, repeatPolicy: entry['repeatPolicy'] === 'once_per_revision' ? 'once_per_revision' : 'every_launch',
      type: ['general', 'feature', 'maintenance', 'downtime', 'migration', 'critical'].includes(type) ? type : 'general',
      action: action === 'offline_data' ? 'offline_data' : action === 'open_play_store' && actionUrl ? 'open_play_store' : 'none', actionUrl };
  });
}

export function selectAnnouncement(items: readonly Announcement[], now: number, session: Readonly<Record<string, number>>, persisted: Readonly<Record<string, number>>, suppressed: boolean): Announcement | null {
  if (suppressed) return null;
  return items.filter((item) => item.enabled && (item.publishedAt === null || item.publishedAt <= now) && (item.expiresAt === null || now < item.expiresAt)
    && item.revision > dismissedRevision(session, item.id) && (item.repeatPolicy !== 'once_per_revision' || item.revision > dismissedRevision(persisted, item.id)))
    .sort((first, next) => next.priority - first.priority || (next.publishedAt ?? -Infinity) - (first.publishedAt ?? -Infinity) || (first.id < next.id ? -1 : first.id > next.id ? 1 : 0))[0] ?? null;
}

export function dismissedRevision(values: Readonly<Record<string, number>>, id: string): number {
  return Object.hasOwn(values, id) ? values[id] : 0;
}

export function localizeAnnouncement(text: Record<string, string>, language: string): string {
  return text[language.split('-')[0].toLowerCase()] ?? text['en'];
}