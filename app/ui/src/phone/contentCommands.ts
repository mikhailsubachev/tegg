// Slice AND-2 (docs/contracts/android-phone.md §10; FR-UX-03 AC-59, D-2474): the commands of controls inside a note's
// content on the phone. Their numbers follow the shown page's document order, which React's render doesn't know, so a
// pass over `main` sets them after each change: the n-th fold button gets `read.fold:<n>`, every control that opens
// the n-th embed `read.openEmbed:<n>`. The registry lists the page-local ids it finds (`pageCommandIds`).

const FOLDS = '.callout-fold, .mindmap-fold';
const EMBED = '[data-embed-target]';
const OPENERS = 'a, button, [role="link"], [role="button"]';

/** Prefixes of the phone's page-local command ids, registered while a control on the page carries one. */
export const PAGE_COMMAND_PREFIXES: readonly string[] = [
  'read.fold:', 'read.openEmbed:', 'board.openCard:', 'board.openSource:', 'views.tab:', 'board.toggleLane',
  // Slice AND-3 (android-edit §13.3): per-row and per-control ids of editing on the phone.
  'task.complete:', 'note.markReviewed:', 'note.markUnreviewed:', 'phone.prop:', 'phone.prop.show:', 'phone.conflict.keep:', 'edit.blockType:',
];

/** Slice AND-3 (§13.3): the phone's own editing ids, registered while their control is shown (a `.` or `:` ending is a
 *  prefix). */
const PHONE_OWN: readonly string[] = [
  ...PAGE_COMMAND_PREFIXES.filter((p) => p.endsWith(':') && !p.startsWith('read.') && !p.startsWith('board.') && !p.startsWith('views.')),
  'edit.blockType', 'edit.tag', 'edit.bulletList', 'edit.checklist', 'edit.indent', 'edit.outdent', 'edit.bold', 'edit.italic', 'edit.link', 'edit.undo', 'edit.redo',
  'phone.link.remove', 'phone.merge.', 'phone.deleted.', 'phone.offer.create', 'phone.conflict.', 'phone.conflictMerge.', 'phone.notice.undo',
  'note.markReviewed', 'note.markUnreviewed', 'daily.markReviewed', 'daily.markUnreviewed',
];

function set(el: Element, id: string) {
  if (el.getAttribute('data-command') !== id) el.setAttribute('data-command', id);
}

/** Numbers the fold buttons and the embed openers under `root` (the shown `main`). */
export function numberContent(root: ParentNode): void {
  root.querySelectorAll(FOLDS).forEach((b, i) => set(b, `read.fold:${i + 1}`));
  root.querySelectorAll(EMBED).forEach((frame, i) => {
    const id = `read.openEmbed:${i + 1}`;
    const own = (el: Element) => el.closest(EMBED) === frame && !el.closest('[data-embed-body]') && el.getAttribute('role') !== 'checkbox';
    if (frame.matches(OPENERS) && own(frame)) set(frame, id);
    frame.querySelectorAll(OPENERS).forEach((el) => { if (own(el)) set(el, id); });
  });
}

/** The page-local command ids carried by controls in the document (for the registry, contract §10). */
export function pageCommandIds(doc: Document | null = typeof document === 'undefined' ? null : document): string[] {
  if (!doc) return [];
  const ids = new Set<string>();
  doc.querySelectorAll('main [data-command]').forEach((el) => {
    const id = el.getAttribute('data-command') ?? '';
    if (PAGE_COMMAND_PREFIXES.some((p) => id.startsWith(p))) ids.add(id);
  });
  // Slice AND-3 (§13.3): the phone's editing controls dock outside `main` (the bar, panels, sheets, banners).
  doc.querySelectorAll('[data-command]').forEach((el) => {
    const id = el.getAttribute('data-command') ?? '';
    if (PHONE_OWN.some((p) => (p.endsWith(':') || p.endsWith('.') ? id.startsWith(p) : id === p))) ids.add(id);
  });
  return [...ids];
}

/** Keeps the numbers current while the phone frame is shown; returns the stop function. */
export function watchContent(main: () => HTMLElement | null): () => void {
  let queued = 0;
  const run = () => { queued = 0; const m = main(); if (m) numberContent(m); };
  const mo = new MutationObserver(() => { if (!queued) queued = requestAnimationFrame(run); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-command'] });
  run();
  return () => { mo.disconnect(); cancelAnimationFrame(queued); };
}
