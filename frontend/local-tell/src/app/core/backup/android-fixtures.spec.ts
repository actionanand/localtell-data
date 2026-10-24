import plainBytes from '../../../testing/fixtures/android/LocalTell-android-plain.bklt';
import unicodeBytes from '../../../testing/fixtures/android/LocalTell-android-unicode.bklt';
import overLimitBytes from '../../../testing/fixtures/android/LocalTell-android-over-limit.bklt';
import webBytes from '../../../testing/fixtures/android/web-unicode.bklt';
import manifest from '../../../testing/fixtures/android/fixtures.json';
import androidDecodedWeb from '../../../testing/fixtures/android/web-unicode.android-decoded.json';
import { BackupFileFormat, encodeBackup } from './backup-codec';
import { planAppRestore } from './app-backup-data';
import { SavedPlacesOverflow } from '../saved-places/saved-place';

/**
 * Files produced by Android's own `AppBackupCodec.kt` (JVM unit-test runtime, org.json 20240303;
 * generator source: src/testing/fixtures/android/WebFixtureGeneratorTest.kt.txt). That runtime
 * writes object keys in hash order, unlike Android devices, which also exercises key-order independence.
 */
const FILES: Record<string, Uint8Array> = {
  'LocalTell-android-plain.bklt': plainBytes,
  'LocalTell-android-unicode.bklt': unicodeBytes,
  'LocalTell-android-over-limit.bklt': overLimitBytes,
};

describe('Android-generated .bklt interoperability', () => {
  it('decodes every Android fixture with the documented record counts', async () => {
    for (const entry of manifest.fixtures) {
      const decoded = await BackupFileFormat.decode(entry.file, FILES[entry.file]);
      expect(decoded.data.savedPlaces).toHaveLength(entry.savedPlaces);
      expect(decoded.data.journeys).toHaveLength(entry.journeys);
    }
  });

  it('preserves Unicode, 64-bit cell IDs, float accuracy and full coordinate precision', async () => {
    const plain = await BackupFileFormat.decode('LocalTell-android-plain.bklt', plainBytes);
    expect(plain.data.journeys.map((point) => point.cellId).sort()).toEqual(['4367237120', '9223372036854775807']);
    expect(plain.data.savedPlaces[0]).toMatchObject({ id: 'plain-1', accuracyMetres: 12.75, countryCode: 'IN', source: 'HOME' });

    const unicode = await BackupFileFormat.decode('LocalTell-android-unicode.bklt', unicodeBytes);
    const byId = new Map(unicode.data.savedPlaces.map((place) => [place.id, place]));
    expect(byId.get('fixture')?.displayName).toBe('நாகர்கோவில் / स्थानम्');
    expect(byId.get('coord-only')).toMatchObject({ latitude: -33.868820123, longitude: 151.209296789, accuracyMetres: Math.fround(3.2), source: 'LOOKUP' });
    expect(byId.get('coord-only')?.savedAt).toBe(1_700_000_000_123);
    expect(byId.get('tiny')).toMatchObject({ latitude: 0.0001, longitude: -0.00005, accuracyMetres: null });
    const legacy = unicode.data.journeys.find((point) => point.latitude === null);
    expect(legacy).toMatchObject({ longitude: null, accuracyMetres: null, subDistrict: null, id: 0 });
  });

  it('re-encodes Android data without loss', async () => {
    for (const [name, bytes] of Object.entries(FILES)) {
      const decoded = await BackupFileFormat.decode(name, bytes);
      const again = await BackupFileFormat.decode(name, new TextEncoder().encode(await encodeBackup(decoded.data, decoded.exportedAt)));
      expect(again.data).toEqual(decoded.data);
    }
  });

  it('rejects a tampered Android fixture', async () => {
    const text = new TextDecoder().decode(plainBytes).replace('Nagercoil', 'Nagarcoil');
    await expect(BackupFileFormat.decode('LocalTell-android-plain.bklt', new TextEncoder().encode(text))).rejects.toThrow();
  });

  it('applies Android capacity rules to an over-limit backup', async () => {
    const decoded = await BackupFileFormat.decode('LocalTell-android-over-limit.bklt', overLimitBytes);
    const empty = { savedPlaces: [], journeys: [] };
    expect(planAppRestore(empty, decoded.data, { maxSavedPlaces: 30, maxJourneyPoints: 100 }).saved.fits).toBe(false);
    expect(planAppRestore(empty, decoded.data, { maxSavedPlaces: 200, maxJourneyPoints: 100 }).saved).toEqual({
      added: 35,
      duplicates: 0,
      total: 35,
      fits: true,
    });
    expect(SavedPlacesOverflow.oldestToRemove(decoded.data.savedPlaces, 30).map((place) => place.id)).toEqual([
      'over-1',
      'over-2',
      'over-3',
      'over-4',
      'over-5',
    ]);
  });

  it('produces files that Android AppBackupCodec decodes (web → Android)', async () => {
    const web = await BackupFileFormat.decode('web-unicode.bklt', webBytes);
    expect(androidDecodedWeb.savedPlaces).toBe(web.data.savedPlaces.length);
    expect(androidDecodedWeb.journeys).toBe(web.data.journeys.length);
    expect(androidDecodedWeb.names).toEqual(web.data.savedPlaces.map((place) => place.displayName));
    expect(androidDecodedWeb.cellIds).toEqual(web.data.journeys.map((point) => point.cellId));
  });
});
