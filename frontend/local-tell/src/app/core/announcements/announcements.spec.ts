import feed from '../../../../../../announcements/home.json';
import { localizeAnnouncement, parseAnnouncements, playStoreUrl, selectAnnouncement } from './announcements';

describe('Android announcement contract on Web', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const item = () => parseAnnouncements(JSON.stringify(feed))[0];
  it('shows the shared Sri Lanka feed without applying Android integer versions to Web semver', () => {
    expect(selectAnnouncement(parseAnnouncements(JSON.stringify(feed)), now, {}, {}, false)?.id).toBe('sri-lanka-support-2026-10');
    expect(item().minVersionCode).toBe(30);
  });
  it('selects by priority, publication and expiry with English fallback', () => {
    const base = item();
    expect(selectAnnouncement([{ ...base, id: 'low', priority: 1 }, { ...base, id: 'high', priority: 10 }], now, {}, {}, false)?.id).toBe('high');
    expect(selectAnnouncement([{ ...base, expiresAt: now }], now, {}, {}, false)).toBeNull();
    expect(localizeAnnouncement({ en: 'English', ta: 'Tamil' }, 'ta-IN')).toBe('Tamil');
    expect(localizeAnnouncement({ en: 'English' }, 'sa')).toBe('English');
  });
  it('respects session and persistent revision dismissal and result suppression', () => {
    const notice = { ...item(), repeatPolicy: 'once_per_revision' as const };
    expect(selectAnnouncement([notice], now, {}, { [notice.id]: 1 }, false)).toBeNull();
    expect(selectAnnouncement([{ ...notice, revision: 2 }], now, {}, { [notice.id]: 1 }, false)?.revision).toBe(2);
    expect(selectAnnouncement([notice], now, { [notice.id]: 1 }, {}, false)).toBeNull();
    expect(selectAnnouncement([notice], now, {}, {}, true)).toBeNull();
    expect(selectAnnouncement([{ ...notice, repeatPolicy: 'every_launch' }], now, {}, { [notice.id]: 1 }, false)).not.toBeNull();
  });
  it('rejects duplicate IDs, invalid schemas and unsafe action links', () => {
    expect(() => parseAnnouncements(JSON.stringify({ ...feed, announcements: [feed.announcements[0], feed.announcements[0]] }))).toThrow();
    expect(() => parseAnnouncements('{"schemaVersion":2,"announcements":[]}')).toThrow();
    expect(() => parseAnnouncements(' '.repeat(65537))).toThrow();
    for (const url of ['https://play.google.com.evil/store/apps/details?id=com.test.app', 'https://play.google.com/store/apps/details?id=com.test.app&x=1', 'javascript:alert(1)', 'https://user@play.google.com/store/apps/details?id=com.test.app']) expect(playStoreUrl(url)).toBeNull();
    expect(playStoreUrl('https://play.google.com/store/apps/details?id=com.actionanand.localtell.app')).not.toBeNull();
  });
  it('treats valid IDs named like object properties as ordinary announcement IDs', () => {
    expect(selectAnnouncement([{ ...item(), id: 'constructor' }], now, {}, {}, false)?.id).toBe('constructor');
  });
});