// Slice 4C (docs/contracts/ms4-jobs.md §2.3, §9): answers the core's `job:transform` events through the worker
// (`job_transform_result`), and applies `live` transformations to the open editor as one transaction (D-386).
//
// Stub (slice 4C red tests): listens to nothing.

/** Starts answering `job:transform`; returns the stop function. */
export function startBridge(): () => void {
  return () => {};
}
