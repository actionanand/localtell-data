import { BackupFileFormat, backupFingerprint, decodeBackup, encodeBackup, MAX_BACKUP_BYTES } from './backup-codec';
import { planAppRestore, type AppBackupData, type JourneyPoint } from './app-backup-data';
import { androidJsonNumber, androidJsonString, javaDoubleToString, javaFloatToString, javaInstantToString, parseJavaInstant } from './java-format';
import { parseStrictJson } from './strict-json';
import { sha256Hex } from './sha256';
import { classifySavedPlace, planSavedPlacesMerge, SavedPlaceIdentity, type SavedPlace } from '../saved-places/saved-place';

const EXPORTED_AT = 1_760_000_000_000;

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'fixture',
    displayName: 'நாகர்கோவில் / स्थानम्',
    localityName: 'Nagercoil',
    subDistrict: null,
    district: 'Kanniyakumari',
    state: 'Tamil Nadu',
    countryCode: 'IN',
    latitude: 8.18,
    longitude: 77.41,
    savedAt: 1_700_000_000_000,
    source: 'HOME',
    accuracyMetres: 12.75,
    ...overrides,
  };
}

function point(number = 1, overrides: Partial<JourneyPoint> = {}): JourneyPoint {
  return {
    id: number,
    timestamp: 1_700_000_000_000 + number,
    areaName: `நாகர்கோவில் / स्थानम् ${number}`,
    district: 'Kanniyakumari',
    state: 'Tamil Nadu',
    radio: 'NR',
    plmn: '405-869',
    cellId: '4367237120',
    confidence: 100,
    latitude: 8.181910123,
    longitude: 77.352330456,
    accuracyMetres: 12.75,
    subDistrict: 'Kalkulam',
    ...overrides,
  };
}

const withoutIds = (points: readonly JourneyPoint[]) => points.map((entry) => ({ ...entry, id: 0 }));

async function resign(change: (body: Record<string, unknown>) => void): Promise<string> {
  const root = JSON.parse(await encodeBackup({ savedPlaces: [place()], journeys: [point()] }, EXPORTED_AT));
  const body = JSON.parse(root.payload);
  change(body);
  const payload = JSON.stringify(body);
  return JSON.stringify({ ...root, payload, sha256: await sha256Hex(payload) });
}

describe('Java formatting helpers', () => {
  it('matches Double.toString and Float.toString layouts', () => {
    expect(javaDoubleToString(8)).toBe('8.0');
    expect(javaDoubleToString(12.971598)).toBe('12.971598');
    expect(javaDoubleToString(0.0001)).toBe('1.0E-4');
    expect(javaDoubleToString(0.001)).toBe('0.001');
    expect(javaDoubleToString(1e7)).toBe('1.0E7');
    expect(javaDoubleToString(-0)).toBe('-0.0');
    expect(javaDoubleToString(-33.868820123)).toBe('-33.868820123');
    expect(javaFloatToString(Math.fround(3.2))).toBe('3.2');
    expect(javaFloatToString(12.75)).toBe('12.75');
    expect(javaFloatToString(Math.fround(0.1))).toBe('0.1');
  });

  it('matches Android JSONObject.numberToString', () => {
    expect(androidJsonNumber(8, 'double')).toBe('8');
    expect(androidJsonNumber(-0, 'double')).toBe('-0');
    expect(androidJsonNumber(-0, 'float')).toBe('0');
    expect(androidJsonNumber(8.18, 'double')).toBe('8.18');
    expect(androidJsonNumber(Math.fround(3.2), 'float')).toBe('3.2');
    expect(androidJsonNumber(0.00001, 'double')).toBe('1.0E-5');
  });

  it('escapes strings like Android JSONStringer', () => {
    expect(androidJsonString('a/b"c\\d\n\u0001\u2028')).toBe('"a\\/b\\"c\\\\d\\n\\u0001\u2028"');
  });

  it('formats and parses ISO instants like java.time.Instant', () => {
    expect(javaInstantToString(1_700_000_000_000)).toBe('2023-11-14T22:13:20Z');
    expect(javaInstantToString(1_700_000_000_123)).toBe('2023-11-14T22:13:20.123Z');
    expect(parseJavaInstant('2023-11-14T22:13:20Z')).toBe(1_700_000_000_000);
    expect(parseJavaInstant('2023-11-14T22:13:20.123456789Z')).toBe(1_700_000_000_123);
    expect(parseJavaInstant('2023-11-15T03:43:20+05:30')).toBe(1_700_000_000_000);
    for (const invalid of ['invalid', '2023-02-30T00:00:00Z', '2023-11-14 22:13:20Z', '2023-11-14T22:13Z']) {
      expect(() => parseJavaInstant(invalid)).toThrow();
    }
  });
});

describe('AppBackupCodec (Android AppBackupTest parity)', () => {
  it('preserves every field for saved-only, journey-only and combined backups including null coordinates', async () => {
    const legacy = point(2, { latitude: null, longitude: null, accuracyMetres: null, subDistrict: null });
    for (const data of [
      { savedPlaces: [place()], journeys: [] },
      { savedPlaces: [], journeys: [point(), legacy] },
      { savedPlaces: [place()], journeys: [point(), legacy] },
    ] as AppBackupData[]) {
      const encoded = await encodeBackup(data, EXPORTED_AT);
      const decoded = await decodeBackup(encoded);
      expect(decoded.data.savedPlaces).toEqual(data.savedPlaces);
      expect(decoded.data.journeys).toEqual(withoutIds(data.journeys));
      expect(decoded.exportedAt).toBe(EXPORTED_AT);
      const fromFile = await BackupFileFormat.decode('LocalTell.bklt', new TextEncoder().encode(encoded));
      expect(fromFile.data).toEqual(decoded.data);
    }
  });

  it('preserves original coordinate precision accuracy and source', async () => {
    const original = place({
      localityName: null,
      district: null,
      state: null,
      countryCode: null,
      latitude: -33.868820123,
      longitude: 151.209296789,
      source: 'LOOKUP',
    });
    const decoded = await decodeBackup(await encodeBackup({ savedPlaces: [original], journeys: [] }, EXPORTED_AT));
    expect(decoded.data.savedPlaces[0]).toEqual(original);
  });

  it('keeps 64-bit cell IDs exact', async () => {
    const big = point(1, { cellId: '9223372036854775807' });
    const decoded = await decodeBackup(await encodeBackup({ savedPlaces: [], journeys: [big] }, EXPORTED_AT));
    expect(decoded.data.journeys[0].cellId).toBe('9223372036854775807');
  });

  it('writes the versioned envelope with payload integrity and without journey IDs', async () => {
    const root = JSON.parse(await encodeBackup({ savedPlaces: [place()], journeys: [point()] }, EXPORTED_AT));
    expect(root.format).toBe('localtell-backup');
    expect(root.schemaVersion).toBe(1);
    expect(root.sha256).toBe(await sha256Hex(root.payload));
    expect(JSON.parse(root.payload).journeys[0].id).toBeUndefined();
    expect(Object.keys(JSON.parse(root.payload))).toEqual(['exportedAt', 'savedPlaces', 'journeys']);
    for (const mutated of [
      { ...root, schemaVersion: 2 },
      { ...root, schemaVersion: '1' },
      { ...root, sha256: '0'.repeat(64) },
      { ...root, payload: root.payload.replace('8.18', '8.19') },
    ]) {
      await expect(decodeBackup(JSON.stringify(mutated))).rejects.toThrow();
    }
    await expect(decodeBackup(JSON.stringify(root).replace('"schemaVersion":1', '"schemaVersion":1.0'))).rejects.toThrow();
  });

  it('rejects duplicate bookmarks even with a valid checksum', async () => {
    for (const newId of ['fixture', 'different-id']) {
      const bad = await resign((body) => {
        const entry = (body['savedPlaces'] as Record<string, unknown>[])[0];
        body['savedPlaces'] = [entry, { ...entry, id: newId }];
      });
      await expect(decodeBackup(bad)).rejects.toThrow();
    }
  });

  it('rejects invalid journey values and types', async () => {
    const cases: [string, unknown][] = [
      ['cellId', '123'],
      ['cellId', -1],
      ['confidence', 101],
      ['confidence', 1.5],
      ['timestamp', 'invalid'],
      ['latitude', 91],
      ['longitude', null],
      ['accuracyMetres', -1],
      ['radio', 'LTE\n'],
      ['areaName', ''],
      ['state', 'x'.repeat(201)],
    ];
    for (const [field, value] of cases) {
      const bad = await resign((body) => {
        (body['journeys'] as Record<string, unknown>[])[0][field] = value;
      });
      await expect(decodeBackup(bad)).rejects.toThrow();
    }
    const badLatitude = await resign((body) => {
      (body['savedPlaces'] as Record<string, unknown>[])[0]['latitude'] = '8.18';
    });
    await expect(decodeBackup(badLatitude)).rejects.toThrow();
    await expect(decodeBackup('{')).rejects.toThrow();
    await expect(decodeBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).rejects.toThrow();
  });

  it('fits maximum valid metadata in the documented byte bound', async () => {
    const longText = 'A' + '\u2028'.repeat(199);
    const savedPlaces = Array.from({ length: 200 }, (_, index) =>
      place({
        id: `id-${index + 1}`,
        displayName: longText,
        localityName: `${index + 1} ${longText}`.slice(0, 200),
        subDistrict: longText,
        district: longText,
        state: longText,
        latitude: (index + 1) * 0.1,
      }),
    );
    const journeys = Array.from({ length: 1000 }, (_, index) =>
      point(index + 1, { areaName: longText, district: longText, state: longText, subDistrict: longText, radio: longText, plmn: longText }),
    );
    const content = await encodeBackup({ savedPlaces, journeys }, EXPORTED_AT);
    expect(new TextEncoder().encode(content).byteLength).toBeLessThan(MAX_BACKUP_BYTES);
    expect((await decodeBackup(content)).data.journeys).toHaveLength(1000);
  });

  it('computes a fingerprint independent of export time, order and local IDs', async () => {
    const a = await backupFingerprint({ savedPlaces: [place(), place({ id: 'b', localityName: 'B', latitude: 9 })], journeys: [point(1), point(2)] });
    const b = await backupFingerprint({
      savedPlaces: [place({ id: 'b', localityName: 'B', latitude: 9 }), place()],
      journeys: [point(2, { id: 77 }), point(1, { id: 99 })],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await backupFingerprint({ savedPlaces: [place({ displayName: 'Renamed' })], journeys: [] })).not.toBe(
      await backupFingerprint({ savedPlaces: [place()], journeys: [] }),
    );
  });

  it('previews combined restore counts without changing inputs', () => {
    const current: AppBackupData = { savedPlaces: [place()], journeys: [point(3), point(2)] };
    const incoming: AppBackupData = {
      savedPlaces: [place({ id: 'same-place' }), place({ id: 'new', localityName: 'New' })],
      journeys: [point(1), point(2, { id: 900 }), point(4), point(4, { id: 901 })],
    };
    const plan = planAppRestore(current, incoming, { maxSavedPlaces: 30, maxJourneyPoints: 3 });
    expect(plan.saved).toEqual({ added: 1, duplicates: 1, total: 2, fits: true });
    expect(plan.journey.additions).toHaveLength(2);
    expect(plan.journey.insertions).toHaveLength(1);
    expect(plan.journey.duplicates).toBe(2);
    expect(plan.journey.removed).toBe(1);
    expect(plan.journey.total).toBe(3);
    expect(current.journeys).toHaveLength(2);
    expect(incoming.journeys).toHaveLength(4);
  });

  it('is idempotent for repeated restores including equal timestamps', () => {
    const apply = (current: AppBackupData, incoming: AppBackupData, maxJourneyPoints: number): AppBackupData => {
      const plan = planAppRestore(current, incoming, { maxSavedPlaces: 30, maxJourneyPoints });
      let lastId = Math.max(0, ...current.journeys.map((entry) => entry.id));
      const inserted = plan.journey.insertions.map((entry) => ({ ...entry, id: ++lastId }));
      return {
        savedPlaces: current.savedPlaces,
        journeys: [...current.journeys, ...inserted].sort((a, b) => b.timestamp - a.timestamp || b.id - a.id).slice(0, maxJourneyPoints),
      };
    };
    for (const sameTimestamp of [false, true]) {
      const incoming: AppBackupData = {
        savedPlaces: [],
        journeys: Array.from({ length: 200 }, (_, index) => {
          const entry = point(index + 1);
          return sameTimestamp ? { ...entry, timestamp: point().timestamp } : entry;
        }),
      };
      for (const limit of [50, 100, 200]) {
        const once = apply({ savedPlaces: [], journeys: [] }, incoming, limit);
        const twice = apply(once, incoming, limit);
        expect(once.journeys).toHaveLength(limit);
        expect(twice).toEqual(once);
        expect(planAppRestore(once, incoming, { maxSavedPlaces: 30, maxJourneyPoints: limit }).journey.insertions).toHaveLength(0);
      }
    }
  });

  it('treats signed zero and local IDs as duplicates', () => {
    const existing = point(1, { latitude: 0, longitude: 0, accuracyMetres: 0 });
    const incoming = { ...existing, id: 9999, latitude: -0, longitude: -0, accuracyMetres: -0 };
    const plan = planAppRestore({ savedPlaces: [], journeys: [existing] }, { savedPlaces: [], journeys: [incoming] }, {
      maxSavedPlaces: 30,
      maxJourneyPoints: 100,
    });
    expect(plan.journey.duplicates).toBe(1);
    expect(plan.journey.additions).toHaveLength(0);
  });

  it('blocks saved overflow while existing values win duplicates', () => {
    const current: AppBackupData = { savedPlaces: [place()], journeys: [point()] };
    const incoming: AppBackupData = {
      savedPlaces: [place({ id: 'same', displayName: 'Other name' }), place({ id: 'new', localityName: 'Distinct' })],
      journeys: [point(2)],
    };
    expect(planAppRestore(current, incoming, { maxSavedPlaces: 1, maxJourneyPoints: 100 }).saved.fits).toBe(false);
    expect(planAppRestore(current, incoming, { maxSavedPlaces: 50, maxJourneyPoints: 200 }).saved.fits).toBe(true);
  });
});

describe('BackupFileFormat (Android BackupFileFormatTest parity)', () => {
  it('creates readable unique bklt filenames', () => {
    const now = new Date(2026, 9, 18, 20, 30);
    expect(BackupFileFormat.filename(now, 'fixed')).toBe('LocalTell-18-Oct-2026-08-30PM-fixed.bklt');
    expect(BackupFileFormat.filename(now)).not.toBe(BackupFileFormat.filename(now));
    expect(() => BackupFileFormat.requireFilename(BackupFileFormat.filename(now))).not.toThrow();
  });

  it('accepts only provider supplied bklt names', () => {
    for (const name of [null, '', '.bklt', 'backup.json', 'backup.txt', 'backup.zip', 'backup.bklt.json', 'backup.bklt ', '../backup.bklt', 'dir\\backup.bklt', 'bad\u0000.bklt']) {
      expect(() => BackupFileFormat.requireFilename(name)).toThrow();
    }
    expect(() => BackupFileFormat.requireFilename('சேமிப்பு.bklt')).not.toThrow();
    expect(() => BackupFileFormat.requireFilename('स्थानानि.BKLT')).not.toThrow();
  });

  it('rejects renamed invalid content, invalid UTF-8 and oversize files', async () => {
    const encoder = new TextEncoder();
    const valid = JSON.parse(await encodeBackup({ savedPlaces: [place()], journeys: [] }, EXPORTED_AT));
    const invalid = [
      'not a backup',
      'PK\u0003\u0004',
      '{',
      '{}',
      '[]',
      'null',
      '{"format":"other","schemaVersion":1}',
      JSON.stringify({ ...valid, schemaVersion: 999 }),
      '{"format":"localtell-saved-places","schemaVersion":1,"places":[]}',
      '\ufeff' + JSON.stringify(valid),
    ];
    for (const content of invalid) {
      await expect(BackupFileFormat.decode('renamed.bklt', encoder.encode(content))).rejects.toThrow();
    }
    await expect(BackupFileFormat.decode('utf8.bklt', new Uint8Array([0xc3, 0x28]))).rejects.toThrow();
    await expect(BackupFileFormat.decode('large.bklt', new Uint8Array(MAX_BACKUP_BYTES + 1))).rejects.toThrow();
    await expect(BackupFileFormat.decode('LocalTell.json', encoder.encode(JSON.stringify(valid)))).rejects.toThrow();
  });

  it('rejects duplicate keys, trailing commas, comments, invalid numbers, lone surrogates and deep nesting', () => {
    for (const input of [
      '{"x":1,"x":2}',
      '{"x":1,"\\u0078":2}',
      '{"x":1,}',
      '[1,]',
      '{x:1}',
      "{'x':1}",
      '{/* comment */"x":1}',
      '{"x":01}',
      '{"x":NaN}',
      '{}{}',
      '"\\uD800"',
      '"\\uDC00"',
      '['.repeat(18) + '0' + ']'.repeat(18),
    ]) {
      expect(() => parseStrictJson(input)).toThrow();
    }
    expect(() => parseStrictJson('{"places":[true,false,null,-1.25e2,"தமிழ் / संस्कृतम् / \\u0061"]}')).not.toThrow();
  });

  it('bounds tiny value floods', () => {
    const flood = '[' + Array.from({ length: 40_001 }, () => 'null').join(',') + ']';
    expect(() => parseStrictJson(flood)).toThrow();
  });
});

describe('Saved place identity (Android SavedPlacesTest parity)', () => {
  const base = place({ id: 'place-1', displayName: 'நாகர்கோவில்', accuracyMetres: null });

  it('normalizes names and ignores coordinate drift', () => {
    expect(SavedPlaceIdentity.matches(base, { ...base, localityName: '  NAGERCOIL  ', latitude: 8.181 })).toBe(true);
    expect(SavedPlaceIdentity.matches({ ...base, localityName: 'New  Town' }, { ...base, localityName: 'new town' })).toBe(true);
    expect(SavedPlaceIdentity.matches(base, { ...base, state: 'Kerala', latitude: 8.5 })).toBe(false);
    expect(SavedPlaceIdentity.matches(base, { ...base, countryCode: 'LK', latitude: 6.9 })).toBe(false);
  });

  it('handles far namesakes and grid edges', () => {
    expect(SavedPlaceIdentity.matches(base, { ...base, latitude: 9.18 })).toBe(false);
    const edge = { ...base, localityName: null, latitude: 8.180049 };
    expect(SavedPlaceIdentity.matches(edge, { ...edge, latitude: 8.180051 })).toBe(true);
    expect(SavedPlaceIdentity.matches(base, { ...base, localityName: null, latitude: 8.18001 })).toBe(true);
    expect(SavedPlaceIdentity.matches(base, { ...base, district: null, countryCode: null, latitude: 8.18001 })).toBe(true);
  });

  it('uses a four decimal grid for coordinate-only identity', () => {
    const coordinate = { ...base, localityName: null };
    expect(SavedPlaceIdentity.of(coordinate)).toBe(SavedPlaceIdentity.of({ ...coordinate, latitude: 8.18001 }));
    expect(SavedPlaceIdentity.of(coordinate)).not.toBe(SavedPlaceIdentity.of({ ...coordinate, latitude: 8.181 }));
  });

  it('validates coordinates and metadata', () => {
    expect(SavedPlaceIdentity.valid(base)).toBe(true);
    expect(SavedPlaceIdentity.valid({ ...base, latitude: Number.NaN })).toBe(false);
    expect(SavedPlaceIdentity.valid({ ...base, longitude: 181 })).toBe(false);
    expect(SavedPlaceIdentity.valid({ ...base, countryCode: 'India' })).toBe(false);
    expect(SavedPlaceIdentity.valid({ ...base, id: '../path' })).toBe(false);
  });

  it('classifies duplicates before capacity and never evicts', () => {
    const current = Array.from({ length: 30 }, (_, index) => ({ ...base, id: `id-${index}`, localityName: `Place ${index}` }));
    expect(classifySavedPlace(current, { ...current[0], id: 'another-id' }, 30)).toBe('Duplicate');
    expect(classifySavedPlace(current, base, 30)).toBe('Full');
    expect(current).toHaveLength(30);
  });

  it('previews merges and rejects capacity overflow and ID collisions', () => {
    const existing = Array.from({ length: 30 }, (_, index) => ({ ...base, id: `id-${index}`, localityName: `Place ${index}` }));
    expect(planSavedPlacesMerge(existing, [{ ...existing[0], id: 'another-id', latitude: 8.181 }], 30)).toEqual({
      added: 0,
      duplicates: 1,
      total: 30,
      fits: true,
    });
    expect(planSavedPlacesMerge(existing, [base], 30)).toEqual({ added: 1, duplicates: 0, total: 31, fits: false });
    expect(() => planSavedPlacesMerge(existing, [{ ...base, id: existing[0].id }], 30)).toThrow();
    expect(() => planSavedPlacesMerge([base], [{ ...base, id: 'new-id', latitude: Number.POSITIVE_INFINITY }], 30)).toThrow();
    expect(() => planSavedPlacesMerge([base], [{ ...base, latitude: -33.86882, longitude: 151.209296 }], 30)).toThrow();
  });
});
