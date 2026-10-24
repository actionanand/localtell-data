import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import { DropboxAuthService } from './dropbox-auth.service';
import { DropboxBackupService, type RemoteOffer } from './dropbox-backup.service';
import { AppDataService } from '../backup/app-data.service';
import { BackupFileFormat, encodeBackup } from '../backup/backup-codec';
import { SavedPlacesService } from '../saved-places/saved-places.service';
import { putOne } from '../storage/idb';
import type { SavedPlace } from '../saved-places/saved-place';
import { FakeDropbox, FakeDropboxAuth } from '../../../testing/fake-dropbox';
import { resetDatabase, testConfig } from '../../../testing/test-config';
import { describeApplyResult } from '../../features/backup-sync/backup-sync';

const ALLOWED_CALLS = new Set(['filesListFolder', 'filesGetMetadata', 'filesCreateFolderV2', 'filesUpload', 'download']);

function place(n: number, overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: `place-${n}`,
    displayName: `Place ${n}`,
    localityName: `Locality ${n}`,
    subDistrict: null,
    district: null,
    state: null,
    countryCode: 'IN',
    latitude: 8 + n,
    longitude: 77,
    savedAt: 1_700_000_000_000 + n * 1000,
    source: 'EASY',
    accuracyMetres: null,
    ...overrides,
  };
}

describe('DropboxBackupService regressions', () => {
  let dropbox: FakeDropbox;
  let auth: FakeDropboxAuth;
  let service: DropboxBackupService;
  let savedPlaces: SavedPlacesService;
  let appData: AppDataService;

  async function setup(maxSavedPlaces = 30): Promise<void> {
    dropbox = new FakeDropbox();
    auth = new FakeDropboxAuth(dropbox);
    vi.stubGlobal('fetch', dropbox.fetch);
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: testConfig({ limits: { maxSavedPlaces, maxJourneyPoints: 100 } }) },
        { provide: DropboxAuthService, useValue: auth },
      ],
    });
    service = TestBed.inject(DropboxBackupService);
    savedPlaces = TestBed.inject(SavedPlacesService);
    appData = TestBed.inject(AppDataService);
    await resetDatabase();
  }

  async function seedLocal(...places: SavedPlace[]): Promise<void> {
    for (const entry of places) await putOne('savedPlaces', entry);
    await savedPlaces.load();
  }

  async function seedRemote(places: SavedPlace[], id = 'remote'): Promise<void> {
    const contents = await encodeBackup({ savedPlaces: places, journeys: [] }, 1_760_000_000_000);
    await dropbox.addFile(BackupFileFormat.filename(new Date(2026, 0, 1), id), contents, Date.UTC(2026, 0, 1));
  }

  async function conflictOffer(): Promise<RemoteOffer> {
    const outcome = await service.sync();
    if (outcome.kind !== 'offer') throw new Error(`Expected an offer, got ${outcome.kind}`);
    expect(outcome.offer.kind).toBe('conflict');
    return outcome.offer;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    expect(dropbox.calls.filter((call) => !ALLOWED_CALLS.has(call))).toEqual([]);
  });

  describe('applyOffer post-commit reporting', () => {
    it('reports a committed merge when Dropbox changes during the follow-up upload', async () => {
      await setup();
      await seedLocal(place(1));
      await seedRemote([place(2)]);
      const offer = await conflictOffer();
      dropbox.afterUpload = async () => {
        dropbox.afterUpload = null;
        await dropbox.addFile(BackupFileFormat.filename(new Date(), 'other-device'), 'x');
      };
      const result = await service.applyOffer(offer, true);
      expect(result).toEqual({ kind: 'applied', upload: 'remote-changed', uploadError: null, localPending: true });
      expect(savedPlaces.places().map((entry) => entry.id).sort()).toEqual(['place-1', 'place-2']);
      expect(describeApplyResult(result).text).toContain('merged into this browser');
      expect(describeApplyResult(result).text).not.toContain('Nothing was written');
      expect(dropbox.files.size).toBe(3);
    });

    it('does not claim nothing was written when the session changes after the local commit', async () => {
      await setup();
      await seedLocal(place(1));
      await seedRemote([place(2)]);
      const offer = await conflictOffer();
      const original = appData.applyRestore.bind(appData);
      vi.spyOn(appData, 'applyRestore').mockImplementation(async (...args) => {
        const plan = await original(...args);
        auth.generation++;
        return plan;
      });
      const result = await service.applyOffer(offer, true);
      expect(result.kind).toBe('applied');
      if (result.kind === 'applied') {
        expect(result.upload).toBe('failed');
        expect(result.uploadError).toMatch(/connection changed/i);
      }
      expect(savedPlaces.places()).toHaveLength(2);
      expect(dropbox.calls).not.toContain('filesUpload');
    });

    it('writes nothing when the remote backup set changed before restoring', async () => {
      await setup();
      await seedLocal(place(1));
      await seedRemote([place(2)]);
      const offer = await conflictOffer();
      await dropbox.addFile(BackupFileFormat.filename(new Date(), 'late'), 'x');
      expect(await service.applyOffer(offer, false)).toEqual({ kind: 'not-applied', reason: 'remote-changed' });
      expect(savedPlaces.places().map((entry) => entry.id)).toEqual(['place-1']);
    });

    it('adopts the restored backup as baseline after a restore without upload', async () => {
      await setup();
      await seedLocal(place(1));
      await seedRemote([place(2)]);
      const offer = await conflictOffer();
      const result = await service.applyOffer(offer, false);
      expect(result).toEqual({ kind: 'applied', upload: 'not-requested', uploadError: null, localPending: true });
      expect(service.meta().baseline).toMatch(/^[0-9a-f]{64}$/);
      expect(service.status()).toBe('local-changes');
    });
  });

  describe('status after concurrent local edits', () => {
    it('reports local changes, not in-sync, when an edit lands during the upload', async () => {
      await setup();
      await seedLocal(place(1));
      dropbox.afterUpload = async () => {
        await savedPlaces.save(place(9));
      };
      const outcome = await service.sync();
      expect(outcome).toMatchObject({ kind: 'uploaded', localPending: true });
      expect(service.status()).toBe('local-changes');
    });

    it('reports in-sync when nothing changed during the upload', async () => {
      await setup();
      await seedLocal(place(1));
      const outcome = await service.sync();
      expect(outcome).toMatchObject({ kind: 'uploaded', localPending: false });
      expect(service.status()).toBe('in-sync');
      expect(await service.sync()).toEqual({ kind: 'up-to-date' });
    });
  });

  describe('over-limit Saved Places (Android SavedPlacesOverflow)', () => {
    it('pauses Sync Now, uploads and checks without contacting Dropbox for writes', async () => {
      await setup(3);
      await seedLocal(place(1), place(2), place(3), place(4));
      expect(await service.sync()).toEqual({ kind: 'saved-limit-exceeded', excess: 1 });
      expect(await service.uploadLocal('ignored')).toBe('saved-limit-exceeded');
      expect(await service.check()).toBe('saved-limit-exceeded');
      expect(dropbox.calls).not.toContain('filesUpload');
      expect(savedPlaces.places()).toHaveLength(4);
    });

    it('keeps every place from a Dropbox merge and pauses the upload until the user trims', async () => {
      await setup(3);
      await seedLocal(place(1), place(2));
      await seedRemote([place(3), place(4)]);
      const offer = await conflictOffer();
      const result = await service.applyOffer(offer, true);
      expect(result).toMatchObject({ kind: 'applied', upload: 'saved-limit-exceeded' });
      expect(savedPlaces.places()).toHaveLength(4);
      expect(dropbox.calls).not.toContain('filesUpload');
      expect(await savedPlaces.save(place(7))).toBe('Full');

      expect(await savedPlaces.removeOldestOverflow(savedPlaces.excess())).toBe(1);
      expect(savedPlaces.places().map((entry) => entry.id)).not.toContain('place-1');
      const outcome = await service.sync();
      expect(outcome.kind).not.toBe('saved-limit-exceeded');
    });
  });
});
