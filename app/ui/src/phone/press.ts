// Slice AND-3 (docs/contracts/android-edit.md §4.3; FR-EDT-01 AC-17, D-2506): which long presses keep the system's
// text selection and menu. The body's text, a draft's Title and form fields do; chips, tags, links, rows, buttons,
// checklist boxes, maps and the frame don't (PhoneFrame prevents their `contextmenu`).

const BLOCKED = '.chip, .tag, .tag-chip, [data-wikilink], a, [role="link"], [role="button"], [contenteditable="false"], .checklist-item .check, button';

export function contextmenuAllowed(target: Element | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  if (target.closest(BLOCKED)) return false;
  if (target.matches('input, textarea')) return true;
  return !!target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
}
