// Slice Q2-T: the tag filter of view tabs and `All <plural>` (docs/contracts/v1-views.md §28.1, §29.6; D-518 all-of,
// D-1892…D-1894, D-1908; AP-1545; FR-QRY-07 AC-30, FR-FMT-12 AC-14). Pure (L1). Keys are tag keys (NFC, case-folded);
// the selection is machine-local per `tagFilterKey` (§30.3).
import { nameKey } from './model';

const nfc = (s: string) => s.normalize('NFC');
/** A tag key as tags.md R79 folds it: no `#`, NFC, lower case. */
const tagKeyOf = (s: string) => nfc(s.replace(/^#/, '').trim()).toLowerCase();

export type TagFilterScope = { kind: 'tab'; typeKey: string; name: string } | { kind: 'all'; typeKey: string };

/** `tab:<type>/<name key>` (part two's usage-key rule) or `all:<type>`, NFC. */
export function tagFilterKey(scope: TagFilterScope): string {
  return scope.kind === 'all' ? `all:${nfc(scope.typeKey)}` : `tab:${nfc(scope.typeKey)}/${nameKey(scope.name)}`;
}

const selKeys = (selected: readonly string[]) => [...new Set(selected.map(tagKeyOf).filter((k) => k !== ''))];

/** All-of (D-518): the row has every selected tag. */
export function keepRow(row: { tags: readonly string[] }, selected: readonly string[]): boolean {
  const sel = selKeys(selected);
  if (sel.length === 0) return true;
  const have = new Set(row.tags.map(tagKeyOf));
  return sel.every((k) => have.has(k));
}

/** The options (AP-1545): the tags of the shown rows (before the tag and text filters), each with the number of rows that
 *  would remain with it added to the selection; most first, then collation of the label, then key bytes. Every selected
 *  key is listed, `0` when no row has it. */
export function tagOptions(rows: readonly { tags: readonly string[] }[], selected: readonly string[], spelling: (key: string) => string, collator: Intl.Collator): { key: string; label: string; count: number }[] {
  const sel = selKeys(selected);
  const keys = new Set<string>(sel);
  const sets = rows.map((r) => new Set(r.tags.map(tagKeyOf)));
  for (const s of sets) for (const k of s) if (k !== '') keys.add(k);
  const out = [...keys].map((key) => {
    const want = sel.includes(key) ? sel : [...sel, key];
    const count = sets.filter((s) => want.every((k) => s.has(k))).length;
    return { key, label: spelling(key), count };
  });
  out.sort((a, b) => b.count - a.count || collator.compare(a.label, b.label) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
