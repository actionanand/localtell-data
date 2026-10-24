const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
}

export async function sha256HexOfBytes(data: Uint8Array): Promise<string> {
  return toHex(await sha256Bytes(data));
}

/** Lowercase SHA-256 of the exact UTF-8 bytes of [value]. */
export async function sha256Hex(value: string): Promise<string> {
  return sha256HexOfBytes(encoder.encode(value));
}
