// Slice 5B (docs/acceptance/capture.md R55 Tags, FR-CAP-01 AC-6): the tag field's suggestions and chips, shared by the
// capture window and the Inbox's `Add tags…` (TagField.tsx). Pure.

/** Case, diacritics and NFC/NFD folded. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const key = (s: string) => s.normalize('NFC').toLowerCase();

/** Index tag names (D-185 spelling) starting with the typed text (case, diacritics and NFC/NFD folded), then those
 *  containing it, each group in D-122 order (`locale`), at most 8. A leading `#` in `typed` is ignored. */
export function tagSuggestions(typed: string, tags: string[], locale: string): string[] {
  const q = fold(typed.trim().replace(/^#/, ''));
  if (q === '') return [];
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const starts: string[] = [];
  const contains: string[] = [];
  for (const t of tags) {
    const f = fold(t);
    if (f.startsWith(q)) starts.push(t);
    else if (f.includes(q)) contains.push(t);
  }
  starts.sort(collator.compare);
  contains.sort(collator.compare);
  return [...starts, ...contains].slice(0, 8).map((t) => t.normalize('NFC'));
}

/** The chips after adding `typed` (a leading `#` dropped, NFC); a tag already a chip (case-insensitive, NFC) or an
 *  empty one is not added. */
export function addChip(chips: string[], typed: string): string[] {
  const tag = typed.trim().replace(/^#+/, '').normalize('NFC');
  if (tag === '' || chips.some((c) => key(c) === key(tag))) return [...chips];
  return [...chips, tag];
}
