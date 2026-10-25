/// <reference lib="webworker" />
import { BoundaryIndex } from './boundary-index';
import { gunzipBounded } from '../geographic-packs/bounded-transfer';
import { sha256HexOfBytes } from '../backup/sha256';

let loaded: Promise<BoundaryIndex> | null = null;
async function load(url: string): Promise<BoundaryIndex> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Boundary asset unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== 6032996 || await sha256HexOfBytes(bytes) !== 'e34ce12b0ad1d5a289704a30848fcb021f6a09ed70babf421e90136df1ebb4e0') throw new Error('Boundary asset integrity mismatch');
  return BoundaryIndex.read(await gunzipBounded(bytes, 64 * 1024 * 1024));
}

addEventListener('message', ({ data }: MessageEvent<{ id: number; url: string; latitude: number; longitude: number; accuracy: number | null }>) => {
  loaded ??= load(data.url).catch((error: unknown) => { loaded = null; throw error; });
  void loaded.then((index) => postMessage({ id: data.id, region: index.identify(data.latitude, data.longitude, data.accuracy) }))
    .catch(() => postMessage({ id: data.id, error: 'Built-in geographic guidance is unavailable. Reload online to recover the pinned boundary asset.' }));
});