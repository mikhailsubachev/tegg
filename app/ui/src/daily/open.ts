// Date links open the Daily Note of their date (FR-DLY-08 AC-6, D-142 ended): one handler for every chip context
// (editor, read view, property values), set by the shell. A subpath opens the note at the top (D-332).
import { parseDate } from '@tegg/doc';

let handler: ((date: string) => void) | null = null;

export function setDateHandler(h: ((date: string) => void) | null) {
  handler = h;
}

/** The date a link target names (D-332), without alias and subpath. */
export function dateOf(target: string): string | null {
  return parseDate(target.normalize('NFC').split(/[|#]/)[0].trim());
}

/** Opens the date's Daily Note when `target` is a date; false when it isn't one. */
export function openDate(target: string): boolean {
  const d = dateOf(target);
  if (!d || !handler) return false;
  handler(d);
  return true;
}
