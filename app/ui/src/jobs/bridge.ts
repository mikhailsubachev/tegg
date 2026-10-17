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

/** The module worker isn't verified in WKWebView on the tauri:// scheme yet: transforms run on this thread (each
 *  takes milliseconds); switching it on keeps the fallback if the worker fails or doesn't answer within 2 s. */
const USE_WORKER = false;
let worker: Worker | null = null;
let workerBroken = false;
const pending = new Map<number, (a: TransformAnswer) => void>();

/** The worker when it starts and answers; else the same engine on this thread, so a job never waits on a worker
 *  the webview refused (WKWebView on a custom scheme may not run module workers). */
function viaWorker(req: TransformRequest): Promise<TransformAnswer> {
  if (!USE_WORKER) return Promise.resolve(handleRequest(req));
  if (worker === null && !workerBroken && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<TransformAnswer>) => { pending.get(e.data.requestId)?.(e.data); pending.delete(e.data.requestId); };
      worker.onerror = () => {
        workerBroken = true;
        worker = null;
        for (const [id, f] of pending) f(handleRequestById(id));
        pending.clear();
      };
    } catch {
      workerBroken = true;
      worker = null;
    }
  }
  if (!worker) return Promise.resolve(handleRequest(req));
  const w = worker;
  return new Promise((resolve) => {
    requests.set(req.requestId, req);
    const done = (a: TransformAnswer) => { clearTimeout(timer); requests.delete(req.requestId); resolve(a); };
    const timer = setTimeout(() => { pending.delete(req.requestId); workerBroken = true; worker = null; done(handleRequest(req)); }, 2000);
    pending.set(req.requestId, done);
    w.postMessage(req);
  });
}
const requests = new Map<number, TransformRequest>();
const handleRequestById = (id: number): TransformAnswer => {
  const r = requests.get(id);
  return r ? handleRequest(r) : { requestId: id, result: { error: 'worker failed' } };
};

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
