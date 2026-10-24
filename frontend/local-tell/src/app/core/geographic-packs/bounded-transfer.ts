/** Network and decompression helpers with hard byte ceilings; usable from workers. */

export const HARD_MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
export const HARD_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export class BoundedTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundedTransferError';
  }
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  tooLarge: string,
  onChunk?: (received: number) => void,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BoundedTransferError(tooLarge);
      chunks.push(value);
      onChunk?.(total);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return concat(chunks, total);
}

export async function fetchBounded(
  url: string,
  options: { signal: AbortSignal; maxBytes: number; onProgress?: (received: number, total: number | null) => void },
): Promise<Uint8Array> {
  const response = await fetch(url, { signal: options.signal, credentials: 'omit', cache: 'no-store', redirect: 'follow' });
  if (!response.ok) throw new BoundedTransferError(`Download failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > options.maxBytes) throw new BoundedTransferError('Download is larger than expected');
  if (!response.body) throw new BoundedTransferError('Download returned no data');
  const total = Number.isFinite(declared) && declared > 0 ? declared : null;
  return readBounded(response.body, options.maxBytes, 'Download is larger than expected', (received) =>
    options.onProgress?.(received, total),
  );
}

export async function gunzipBounded(compressed: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new BoundedTransferError('This browser cannot decompress gzip data');
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  try {
    return await readBounded(stream, maxBytes, 'Decompressed pack is larger than declared');
  } catch (error) {
    if (error instanceof BoundedTransferError) throw error;
    throw new BoundedTransferError('Pack is not valid gzip data');
  }
}
