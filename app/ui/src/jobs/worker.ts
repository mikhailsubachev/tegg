// Slice 4C (docs/contracts/ms4-jobs.md §2.3): the Web Worker entry that runs `@tegg/doc` `transform` for the core's
// `job:transform` requests (one text engine, D-82). Messages: in `{ requestId, source, text, ops }`, out
// `{ requestId, result }` with `result` a `Transformed` or `{ error }`.
//
// Stub (slice 4C red tests): answers `{ kind: 'unchanged' }` without calling the engine.
export type TransformRequest = { requestId: number; source: string; text: string; ops: unknown[] };
export type TransformAnswer = { requestId: number; result: { kind: 'unchanged' } | { kind: 'bytes'; text: string; edits: { start: number; end: number }[] } | { error: string } };

export function handleRequest(req: TransformRequest): TransformAnswer {
  return { requestId: req.requestId, result: { kind: 'unchanged' } };
}
