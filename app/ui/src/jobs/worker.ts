// Slice 4C (docs/contracts/ms4-jobs.md §2.3): the Web Worker entry that runs `@tegg/doc` `transform` for the core's
// `job:transform` requests (one text engine, D-82). Messages: in `{ requestId, source, text, ops }`, out
// `{ requestId, result }` with `result` a `Transformed` or `{ error }`.
import { transform, type TextOp, type Transformed } from '@tegg/doc';

export type TransformRequest = { requestId: number; source: string; text: string; ops: unknown[] };
export type TransformAnswer = { requestId: number; result: Transformed | { error: string } };

export function handleRequest(req: TransformRequest): TransformAnswer {
  try {
    return { requestId: req.requestId, result: transform(req.source, req.text, req.ops as TextOp[]) };
  } catch (e) {
    return { requestId: req.requestId, result: { error: String((e as Error)?.message ?? e) } };
  }
}

// In a worker: answer each message. Imported on the main thread (fallback, tests), this does nothing.
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: (m: unknown) => void; onmessage?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e: MessageEvent<TransformRequest>) => scope.postMessage!(handleRequest(e.data));
}
