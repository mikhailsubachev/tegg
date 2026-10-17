// Slice 4C (docs/contracts/ms4-jobs.md §2.3, §9): answers the core's `job:transform` events through the worker
// (`job_transform_result`), and hands `live` transformations to the editor that has the file open (D-386), which
// applies them as one transaction and saves them with its autosave.
import { events, ipc, type JobTransformEvent } from '../ipc/client';
import { handleRequest, type TransformAnswer, type TransformRequest } from './worker';

type Live = (ops: unknown[]) => void;
const live = new Map<string, Live>();

/** The open note page registers how its editor applies a live transformation (D-386). */
export function registerLive(path: string, f: Live): () => void {
  const p = path.normalize('NFC');
  live.set(p, f);
  return () => { if (live.get(p) === f) live.delete(p); };
}

let worker: Worker | null = null;
const pending = new Map<number, (a: TransformAnswer) => void>();

function viaWorker(req: TransformRequest): Promise<TransformAnswer> {
  if (worker === null && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<TransformAnswer>) => { pending.get(e.data.requestId)?.(e.data); pending.delete(e.data.requestId); };
      worker.onerror = () => { worker = null; };
    } catch {
      worker = null;
    }
  }
  if (!worker) return Promise.resolve(handleRequest(req));
  return new Promise((resolve) => { pending.set(req.requestId, resolve); worker!.postMessage(req); });
}

/** Starts answering `job:transform`; returns the stop function. */
export function startBridge(): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  void events.jobTransform(async (t: JobTransformEvent) => {
    if (t.live) {
      live.get(t.source.normalize('NFC'))?.(t.ops);
      return;
    }
    const a = await viaWorker({ requestId: t.requestId, source: t.source, text: t.text, ops: t.ops });
    await ipc.jobTransformResult(a.requestId, a.result).catch(() => {});
  }).then((u) => { if (stopped) u(); else stop = u; });
  return () => { stopped = true; stop?.(); };
}
