// Slice 4C (docs/contracts/ms4-jobs.md §10, FR-UX-07 AC-9): the non-modal status element of a running rename
// (`role="status"`): `Updating links in {count} notes`, then `Updated links in {count} notes` with `Undo` for 5 s.
// Nothing is shown when no other file is rewritten.
//
// Stub (slice 4C red tests): renders nothing.
export function JobStatus(): null {
  return null;
}
