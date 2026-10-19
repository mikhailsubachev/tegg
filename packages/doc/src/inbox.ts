// Slice 5B (docs/contracts/ms5-capture.md §7.3; D-557…D-559): the text changes of the Inbox actions. Each edits only its
// lines (D-230 append rule; quote style kept; CRLF, BOM and final-newline state kept).
// STUB (TS-I1): exists and compiles, returns a deliberately wrong result until 5B is built.

export type InboxChange =
  | { op: 'set-review'; value: 'reviewed' | 'unreviewed'; now: string }
  /** Writes `type`, `review: reviewed`, `modified` (D-557). */
  | { op: 'set-type'; type: string; now: string }
  /** Flow list append, unique by tagKey. */
  | { op: 'add-tags'; tags: string[]; now: string }
  /** Blank line + `[[target]]` paragraph (D-559). */
  | { op: 'append-link'; target: string; now: string }

/** STUB: always `unchanged`. */
export function applyInboxChange(_text: string, _change: InboxChange): { kind: 'bytes'; text: string } | { kind: 'unchanged' } {
  return { kind: 'unchanged' }
}

/** D-558: `## <title>` + the item's body appended to `target`, links rewritten by `retarget` (D-184 text or null =
 *  keep), `modified` set to `now`. STUB: the target unchanged. */
export function appendSection(target: string, _title: string, _itemBody: string, _retarget: (link: string) => string | null, _now: string): string {
  return target
}
