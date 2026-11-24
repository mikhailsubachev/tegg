// Slice AND-2 (docs/contracts/android-phone.md §4.5; FR-EDT-07 AC-23, D-2413): the Properties strip of a note.
import type { PanelRow } from '../types/panel';

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const nfc = (s: string) => s.normalize('NFC');

/** The rows in `preview` (in its order, at most 3, non-empty); with no `preview`, the first three non-empty rows. */
export function stripRows(rows: readonly PanelRow[], preview: readonly string[]): { strip: PanelRow[]; more: number } {
  let strip: PanelRow[];
  if (preview.length > 0) {
    strip = preview
      .map((k) => rows.find((r) => nfc(r.key) === nfc(k)))
      .filter((r): r is PanelRow => !!r && !empty(r.raw))
      .slice(0, 3);
  } else {
    strip = rows.filter((r) => !empty(r.raw)).slice(0, 3);
  }
  return { strip, more: rows.length - strip.length };
}
