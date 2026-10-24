import { BoundedTransferError, fetchBounded, gunzipBounded, HARD_MAX_COMPRESSED_BYTES, HARD_MAX_UNCOMPRESSED_BYTES } from './bounded-transfer';
import type { RemotePack } from './pack-manifest';
import { PackValidationError, validateGeographicPack, type PackDatabase, type ValidatedPack } from '../offline-resolver/offline-locality-resolver';
import { sha256HexOfBytes } from '../backup/sha256';

export type InstallPhase = 'download' | 'verify' | 'decompress' | 'validate';

export interface PreparedPack {
  readonly bytes: Uint8Array;
  readonly validated: ValidatedPack;
}

export interface PreparePackDependencies {
  readonly signal: AbortSignal;
  readonly onPhase: (phase: InstallPhase, percent: number | null) => void;
  readonly fetchBytes?: typeof fetchBounded;
  readonly openDatabase: (bytes: Uint8Array) => Promise<{ db: PackDatabase; close: () => void }>;
}

/**
 * Android `PackDownloader.download` without activation: download, SHA-256 of the compressed file,
 * bounded gunzip and full schema validation. Nothing is persisted here, so a failure or
 * cancellation can never replace an installed, valid pack.
 */
export async function preparePack(pack: RemotePack, url: string, deps: PreparePackDependencies): Promise<PreparedPack> {
  const maxCompressed = Math.min(pack.compressedBytes ?? HARD_MAX_COMPRESSED_BYTES, HARD_MAX_COMPRESSED_BYTES);
  const maxUncompressed = Math.min(pack.uncompressedBytes ?? HARD_MAX_UNCOMPRESSED_BYTES, HARD_MAX_UNCOMPRESSED_BYTES);
  deps.onPhase('download', 0);
  const fetchBytes = deps.fetchBytes ?? fetchBounded;
  const compressed = await fetchBytes(url, {
    signal: deps.signal,
    maxBytes: maxCompressed,
    onProgress: (received, total) => {
      const expected = total ?? pack.compressedBytes;
      deps.onPhase('download', expected ? Math.min(100, Math.floor((received * 100) / expected)) : null);
    },
  });
  deps.signal.throwIfAborted();
  deps.onPhase('verify', null);
  const actual = await sha256HexOfBytes(compressed);
  if (actual !== pack.sha256) throw new BoundedTransferError('SHA-256 mismatch for downloaded pack');
  deps.signal.throwIfAborted();
  deps.onPhase('decompress', null);
  const bytes = await gunzipBounded(compressed, maxUncompressed);
  deps.signal.throwIfAborted();
  deps.onPhase('validate', null);
  const { db, close } = await deps.openDatabase(bytes);
  try {
    const validated = validateGeographicPack(db);
    const packId = validated.meta['pack_id'];
    if (packId !== undefined && packId !== pack.id) throw new PackValidationError(`Pack metadata ID ${packId} does not match ${pack.id}`);
    return { bytes, validated };
  } finally {
    close();
  }
}
