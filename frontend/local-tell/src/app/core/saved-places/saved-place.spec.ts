import { TestBed } from '@angular/core/testing';
import { APP_CONFIG } from '../config/app-config';
import { SavedPlacesOverflow, type SavedPlace } from './saved-place';
import { SavedPlacesService } from './saved-places.service';
import { putOne } from '../storage/idb';
import { resetDatabase, testConfig } from '../../../testing/test-config';

function place(id: string, savedAt: number): SavedPlace {
  return {
    id,
    displayName: `Place ${id}`,
    localityName: `Locality ${id}`,
    subDistrict: null,
    district: null,
    state: null,
    countryCode: 'IN',
    latitude: 8 + savedAt / 1000,
    longitude: 77,
    savedAt,
    source: 'EASY',
    accuracyMetres: null,
  };
}

/** Ported from Android SavedPlacesOverflowTest.kt. */
describe('SavedPlacesOverflow', () => {
  it('has no excess within the limit', () => {
    const places = [place('a', 1), place('b', 2)];
    expect(SavedPlacesOverflow.excess(places.length, 2)).toBe(0);
    expect(SavedPlacesOverflow.oldestToRemove(places, 2)).toEqual([]);
  });

  it('removes only the oldest extras', () => {
    const places = [place('new', 50), place('old', 10), place('mid', 30), place('oldest', 5)];
    expect(SavedPlacesOverflow.excess(places.length, 2)).toBe(2);
    expect(SavedPlacesOverflow.oldestToRemove(places, 2).map((entry) => entry.id)).toEqual(['oldest', 'old']);
  });

  it('breaks equal timestamps like the last entries of the newest-first list', () => {
    const places = [place('b', 10), place('a', 10), place('c', 20)];
    expect(SavedPlacesOverflow.oldestToRemove(places, 2).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('SavedPlacesService.removeOldestOverflow', () => {
  let service: SavedPlacesService;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [{ provide: APP_CONFIG, useValue: testConfig({ limits: { maxSavedPlaces: 2, maxJourneyPoints: 100 } }) }] });
    service = TestBed.inject(SavedPlacesService);
    await resetDatabase();
    for (const entry of [place('new', 50), place('old', 10), place('mid', 30), place('oldest', 5)]) await putOne('savedPlaces', entry);
    await service.load();
  });

  it('never removes more than the confirmed count', async () => {
    expect(service.excess()).toBe(2);
    expect(await service.removeOldestOverflow(1)).toBe(1);
    expect(service.places().map((entry) => entry.id)).toEqual(['new', 'mid', 'old']);
  });

  it('replans against current data and removes nothing once within the limit', async () => {
    await service.delete(['new', 'mid']);
    expect(await service.removeOldestOverflow(2)).toBe(0);
    expect(service.places()).toHaveLength(2);
  });

  it('blocks new saves while over the limit', async () => {
    expect(await service.save(place('fresh', 99))).toBe('Full');
    await expect(service.removeOldestOverflow(-1)).rejects.toThrow(RangeError);
  });
});
