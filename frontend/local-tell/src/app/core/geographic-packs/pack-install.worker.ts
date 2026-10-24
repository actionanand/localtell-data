/// <reference lib="webworker" />
import { preparePack } from './prepare-pack';
import { loadSqlJs, wrapDatabase } from '../offline-resolver/sqljs-database';
import type { InstallWorkerRequest, InstallWorkerResponse } from './pack-records';

const active = new Map<number, AbortController>();

function post(message: InstallWorkerResponse, transfer: Transferable[] = []): void {
  postMessage(message, transfer);
}

addEventListener('message', ({ data }: MessageEvent<InstallWorkerRequest>) => {
  if (data.type === 'cancel') {
    active.get(data.requestId)?.abort();
    return;
  }
  const controller = new AbortController();
  active.set(data.requestId, controller);
  void preparePack(data.pack, data.url, {
    signal: controller.signal,
    onPhase: (phase, percent) => post({ type: 'progress', requestId: data.requestId, phase, percent }),
    openDatabase: async (bytes) => {
      const SQL = await loadSqlJs(data.wasmUrl);
      const db = new SQL.Database(bytes);
      return { db: wrapDatabase(db), close: () => db.close() };
    },
  })
    .then(({ bytes, validated }) => {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'prepared', requestId: data.requestId, bytes: buffer, validated }, [buffer]);
    })
    .catch((error: unknown) => {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? 'Download cancelled' : error instanceof Error ? error.message : 'Pack installation failed';
      post({ type: 'failed', requestId: data.requestId, message, cancelled });
    })
    .finally(() => active.delete(data.requestId));
});
