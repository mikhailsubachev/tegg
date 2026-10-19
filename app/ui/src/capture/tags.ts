// Slice 5B (docs/acceptance/capture.md R55 Tags, FR-CAP-01 AC-6): the tag field's suggestions and chips, shared by the
// capture window and the Inbox's `Add tags…` (TagField.tsx). Pure.
// STUB (TS-I1): exists and compiles, returns deliberately wrong results until 5B is built.

/** Index tag names (D-185 spelling) starting with the typed text (case, diacritics and NFC/NFD folded), then those
 *  containing it, each group in D-122 order (`locale`), at most 8. A leading `#` in `typed` is ignored. STUB: []. */
export function tagSuggestions(_typed: string, _tags: string[], _locale: string): string[] {
  return [];
}

/** The chips after adding `typed` (a leading `#` dropped, NFC); a tag already a chip (case-insensitive, NFC) or an
 *  empty one is not added. STUB: the chips unchanged. */
export function addChip(chips: string[], _typed: string): string[] {
  return [...chips];
}
