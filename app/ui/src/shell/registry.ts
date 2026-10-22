// Route, panel, disabled-control and shortcut registries (D-116, D-124, docs/contracts/ms3-shell.md §3.2).
// Their content equals tables R1–R4 of docs/acceptance/app-shell.md; each later slice or milestone flips its
// entries to built in the commit that builds them.
import { en } from '../i18n/catalog';

export type Milestone = 'MS3' | 'MS4' | 'MS5' | 'MS6' | 'MS7' | 'MS8' | 'v1.0' | 'v1.x';
export type Slice = '3A' | '3B' | '3C' | '3D' | '3E' | '4A' | '4B' | '4C' | '4D' | '4E' | '4F'; // D-292: MS4 slices too
export type Due = { milestone: Milestone; slice?: Slice };

export type RouteDef = {
  id: string;
  name: string;
  purpose: string;
  status: { built: true; due?: Due } | { built: false; due: Due };
  reqs: string[];
  design: string | null;
};
export type TabDef = { id: 'backlinks' | 'outline' | 'graph'; name: string; status: RouteDef['status']; reqs: string[] };
export type DisabledControl = { label: string; where: string; due: Due; req: string };
export type ShortcutDef = { keys: string; command: string };

/** R5 in-note placeholders (read-view.md, D-144; ms3-shell §11.3). */
export type InNotePlaceholderDef = {
  id: 'embed-image' | 'embed-pdf' | 'embed-other' | 'query' | 'mindmap';
  name: string;
  due: Due;
  reqs: string[];
};
const built = { built: true } as const;
const tbd = (milestone: Milestone, slice?: Slice) => ({ built: false as const, due: slice ? { milestone, slice } : { milestone } });

export const IN_NOTE_PLACEHOLDERS: InNotePlaceholderDef[] = [
  // 6A (D-630): `embed-image` and `embed-pdf` are retired (trash-media.md R77 renders them); `embed-other` is a built card.
  { id: 'query', name: 'ph.query', due: { milestone: 'v1.0' }, reqs: ['FR-QRY-01', 'FR-FMT-06'] },
  { id: 'mindmap', name: 'ph.mindmap', due: { milestone: 'v1.0' }, reqs: ['FR-MMP-01', '-02', 'FR-FMT-05'] },
];

export const ROUTES: RouteDef[] = [
  { id: 'chooser', name: 'route.chooser', purpose: 'purpose.chooser', status: built, reqs: ['FR-VLT-01', 'FR-VLT-02'], design: null },
  // 6A (trash-media.md R75, D-613): `home` is removed until FR-HOM-01 ships in v1.0; the Inbox is built (5B).
  { id: 'inbox', name: 'route.inbox', purpose: 'purpose.inbox', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-INB-01…04'], design: 'Inbox' },
  // 4B (daily-notes.md R17): `today` redirects to `daily/<today>` (D-321).
  { id: 'today', name: 'route.today', purpose: 'purpose.today', status: { built: true, due: { milestone: 'MS4', slice: '4B' } }, reqs: ['FR-DLY-01…06'], design: 'Home' },
  { id: 'daily/YYYY-MM-DD', name: 'route.today', purpose: 'purpose.today', status: { built: true, due: { milestone: 'MS4', slice: '4B' } }, reqs: ['FR-DLY-01…06'], design: 'Home' },
  // 5A-1 (tasks.md R45): the Schedule and the Kanban (D-378, D-379, D-481).
  { id: 'tasks', name: 'route.tasks', purpose: 'purpose.tasks', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-TSK-04', 'FR-TSK-05'], design: 'Tasks' },
  { id: 'tasks/kanban', name: 'route.tasks', purpose: 'purpose.tasks', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-TSK-04', 'FR-TSK-05'], design: 'TasksBoard' },
  { id: 'search', name: 'route.search', purpose: 'purpose.search', status: built, reqs: ['FR-SRC-01…04'], design: null },
  { id: 'type/<type>', name: 'route.type', purpose: 'purpose.type', status: built, reqs: ['FR-TYP-09'], design: 'Ideas' },
  { id: 'type-settings/<type>', name: 'route.typeSettings', purpose: 'purpose.typeSettings', status: built, reqs: ['FR-TYP-01…03', '-05', '-11', '-12'], design: 'TypeSettings' }, // built in 3D (types.md R1)
  { id: 'tags', name: 'route.tags', purpose: 'purpose.tags', status: tbd('MS4'), reqs: ['FR-TAG-06', 'FR-TAG-07'], design: 'Main' },
  { id: 'pinned', name: 'route.pinned', purpose: 'purpose.pinned', status: tbd('v1.0'), reqs: ['FR-HOM-02'], design: null }, // 5B R62 (D-376)
  { id: 'saved-queries', name: 'route.savedQueries', purpose: 'purpose.savedQueries', status: tbd('v1.0'), reqs: ['FR-QRY-06'], design: null },
  { id: 'note/<path>', name: 'route.note', purpose: 'purpose.note', status: built, reqs: [], design: 'Main' },
  // D-520 (ms5-tasks §12.2): an unsaved new object; becomes `note/<path>` on its first write.
  { id: 'new/<type>', name: 'route.new', purpose: 'purpose.new', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-TYP-09', 'FR-EDT-01'], design: 'Main' },
  { id: 'graph', name: 'route.graph', purpose: 'purpose.graph', status: tbd('v1.0'), reqs: ['FR-GRP-01…08'], design: 'Graph' },
  { id: 'trash', name: 'route.trash', purpose: 'purpose.trash', status: { built: true, due: { milestone: 'MS6' } }, reqs: ['FR-HIS-01', 'FR-HIS-02'], design: null }, // built in 6A (R75)
  { id: 'import', name: 'route.import', purpose: 'purpose.import', status: tbd('MS7'), reqs: ['FR-IMP-01', '-03', '-05', 'FR-STO-10'], design: null },
  // 4A (backlinks.md R16): vault checks, reached from the palette only (D-284).
  { id: 'broken-links', name: 'route.brokenLinks', purpose: 'purpose.brokenLinks', status: { built: true, due: { milestone: 'MS4', slice: '4A' } }, reqs: ['FR-LNK-04'], design: null },
  { id: 'duplicate-titles', name: 'route.duplicateTitles', purpose: 'purpose.duplicateTitles', status: { built: true, due: { milestone: 'MS4', slice: '4A' } }, reqs: ['FR-LNK-14'], design: null },
  { id: 'conflicts', name: 'route.conflicts', purpose: 'purpose.conflicts', status: built, reqs: ['FR-SYN-04', 'FR-SYN-05'], design: null },
  // 5B R62 (D-563): `capture` is a window, not a route.
  { id: 'settings/appearance', name: 'route.settings.appearance', purpose: 'purpose.settings.appearance', status: built, reqs: ['FR-SET-02'], design: null },
  { id: 'settings/date-time', name: 'route.settings.dateTime', purpose: 'purpose.settings.dateTime', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-SET-03'], design: null },
  { id: 'settings/vault', name: 'route.settings.vault', purpose: 'purpose.settings.vault', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-SET-01'], design: null },
  { id: 'settings/shortcuts', name: 'route.settings.shortcuts', purpose: 'purpose.settings.shortcuts', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-SET-04'], design: null },
  { id: 'settings/menu-bar', name: 'route.settings.menuBar', purpose: 'purpose.settings.menuBar', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-SET-05'], design: null },
  { id: 'settings/trash-history', name: 'route.settings.trashHistory', purpose: 'purpose.settings.trashHistory', status: tbd('v1.0'), reqs: ['FR-SET-06'], design: null },
  // D-608: Help › Keyboard Shortcuts (FR-UX-03 AC-14).
  { id: 'help/shortcuts', name: 'route.help.shortcuts', purpose: 'purpose.help.shortcuts', status: { built: true, due: { milestone: 'MS5' } }, reqs: ['FR-UX-03'], design: null },
  { id: 'settings/previews', name: 'route.settings.previews', purpose: 'purpose.settings.previews', status: tbd('v1.0'), reqs: ['FR-SET-07'], design: null },
];

export const PANEL_TABS: TabDef[] = [
  { id: 'backlinks', name: 'tab.backlinks', status: { built: true, due: { milestone: 'MS4', slice: '4A' } }, reqs: ['FR-LNK-01', 'FR-LNK-02'] }, // built in 4A (D-293)
  { id: 'outline', name: 'tab.outline', status: tbd('v1.0'), reqs: ['FR-EDT-11'] }, // 5B R62 (D-376)
  { id: 'graph', name: 'tab.graph', status: tbd('v1.0'), reqs: ['FR-GRP-01'] },
];

const d = (milestone: Milestone, slice?: Slice): Due => (slice ? { milestone, slice } : { milestone });

export const DISABLED_CONTROLS: DisabledControl[] = [
  { label: 'ctl.newTab', where: 'title bar', due: d('v1.0'), req: 'FR-NAV-06' },
  { label: 'ctl.copyBlockLink', where: 'block menu', due: d('v1.0'), req: 'FR-LNK-06' },
  // 3D (types.md R3 changes): the type page's Filter, Sort, Views and New <Type>, New type and Starter vault are built.
  { label: 'ctl.filter', where: 'type page', due: d('v1.0'), req: 'FR-QRY-01' },
  { label: 'ctl.group', where: 'type page', due: d('v1.0'), req: 'FR-QRY-05' },
  { label: 'ctl.addView', where: 'type page', due: d('v1.0'), req: 'FR-QRY-07' },
  { label: 'ctl.moveExisting', where: 'type settings, General', due: d('MS4'), req: 'FR-STO-03' },
  { label: 'ctl.renameKeys', where: 'type settings, property key field', due: d('MS4'), req: 'FR-TYP-04' },
  { label: 'ctl.removeValues', where: 'type settings, Delete property dialog', due: d('MS4'), req: 'FR-TYP-04' },
  { label: 'ctl.changeTheirType', where: 'type settings, Delete type dialog', due: d('MS4'), req: 'FR-TYP-05' },
  { label: 'ctl.trashObjects', where: 'type settings, Delete type dialog', due: d('MS4'), req: 'FR-TYP-05' },
  { label: 'ctl.newTemplate', where: 'type settings, Templates', due: d('v1.0'), req: 'FR-TPL-01' },
  { label: 'ctl.editTemplate', where: 'type settings, Templates', due: d('v1.0'), req: 'FR-TPL-01' },
  { label: 'ctl.addViewSettings', where: 'type settings, Views', due: d('v1.0'), req: 'FR-QRY-07' },
  { label: 'ctl.editView', where: 'type settings, Views', due: d('v1.0'), req: 'FR-QRY-07' },
  { label: 'ctl.rowColor', where: 'attribute panel row', due: d('MS4'), req: 'FR-TAG-05' },
  { label: 'ctl.rowRecurrence', where: 'attribute panel row', due: d('v1.0'), req: 'FR-TSK-01' }, // D-381
  // 5A-1 (tasks.md R45 R3).
  { label: 'tasks.sort', where: 'Tasks page toolbar', due: d('v1.0'), req: 'FR-QRY-05' },
  // 5B R62 (D-565): the four Appearance extras are v1.0.
  { label: 'ctl.font', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02' },
  { label: 'ctl.fontSize', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02' },
  { label: 'ctl.editorWidth', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02' },
  { label: 'ctl.accentColor', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02' },
  // 5B R62: shortcut editing (D-548). 6A (R75): the Inbox's and task card's Move to trash, the capture drop zone and the
  // File row are built.
  { label: 'settings.shortcuts.change', where: 'Settings: Shortcuts', due: d('v1.0'), req: 'FR-SET-04' },
  // 4A (backlinks.md R16). 5B R62: the Create offer's type picker is built (FR-VLT-05).
  { label: 'duplicates.merge', where: 'Duplicate titles page', due: d('MS4', '4C'), req: 'FR-LNK-14' },
  { label: 'backlinks.unlinked', where: 'Backlinks panel', due: d('v1.x'), req: 'FR-LNK-05' },
];

export const SHORTCUTS: ShortcutDef[] = [
  { keys: '⌘K', command: 'app.palette' },
  { keys: '⇧⌘P', command: 'app.palette' },
  { keys: '⌘O', command: 'app.switcher' },
  { keys: '⌘N', command: 'object.new' },
  { keys: '⇧⌘F', command: 'goto.search' },
  { keys: '⌘D', command: 'daily.today' },
  // 4B (R17, D-329): on daily routes only.
  { keys: '⌥⌘←', command: 'daily.previous' },
  { keys: '⌥⌘→', command: 'daily.next' },
  { keys: '⇧⌘I', command: 'goto.inbox' },
  { keys: '⌘\\', command: 'view.toggleRightPanel' },
  { keys: '⌃⌘S', command: 'view.toggleSidebar' },
  { keys: '⇧⌘\\', command: 'view.toggleFocus' },
  { keys: '⌘,', command: 'goto.settings/appearance' },
  { keys: '⇧⌘/', command: 'help.shortcuts' },
  { keys: '⌥⌘U', command: 'note.toggleSource' },
  { keys: '⌘T', command: 'nav.newTab' },
  { keys: '⌘[', command: 'nav.back' },
  { keys: '⌘]', command: 'nav.forward' },
  // D-219: the recent vaults of the title-bar switcher (FR-VLT-01 AC-17).
  { keys: '⌃⌘1', command: 'vault.recent.1' },
  { keys: '⌃⌘2', command: 'vault.recent.2' },
  { keys: '⌃⌘3', command: 'vault.recent.3' },
  { keys: '⌃⌘4', command: 'vault.recent.4' },
  { keys: '⌃⌘5', command: 'vault.recent.5' },
  { keys: '⌃⌘6', command: 'vault.recent.6' },
  { keys: '⌃⌘7', command: 'vault.recent.7' },
  { keys: '⌃⌘8', command: 'vault.recent.8' },
  { keys: '⌃⌘9', command: 'vault.recent.9' },
  // R8 (editor.md, D-183): editor commands, acting on the note route's editor.
  { keys: '⌘Z', command: 'edit.undo' },
  { keys: '⇧⌘Z', command: 'edit.redo' },
  { keys: '⌘B', command: 'edit.bold' },
  { keys: '⌘I', command: 'edit.italic' },
  { keys: '⇧⌘S', command: 'edit.strike' },
  { keys: '⌘E', command: 'edit.code' },
  { keys: '⇧⌘H', command: 'edit.highlight' },
  { keys: '⇧⌘K', command: 'edit.link' },
  { keys: '⇧⌘↑', command: 'edit.moveBlockUp' },
  { keys: '⇧⌘↓', command: 'edit.moveBlockDown' },
  { keys: '⌘/', command: 'edit.blockMenu' },
  { keys: 'Esc', command: 'edit.selectBlock' },
  { keys: '⌘↩', command: 'edit.openOrToggle' },
  { keys: '⇧⌘V', command: 'edit.pastePlain' },
  { keys: '⌘S', command: 'edit.saveNow' },
  // 5A-2 (conversion.md R53).
  { keys: '⇧⌘T', command: 'edit.turnIntoTask' },
  { keys: '⇧⌘O', command: 'edit.turnIntoObject' },
  // 6A (trash-media.md R75): on a note page, a focused card or row / in an editor.
  { keys: '⌘⌫', command: 'object.trash' },
  { keys: '⇧⌘A', command: 'media.add' },
];

/** R6 (editor.md, D-189): the slash menu. Labels are catalog keys; later items are disabled with their milestone. */
export type SlashDef = { id: string; group: 'objects' | 'blocks' | 'media' | 'advanced'; label: string; status: RouteDef['status']; due?: Due; reqs: string[] };
const slash = (id: string, group: SlashDef['group'], reqs: string[], due?: Due): SlashDef =>
  ({ id, group, label: `slash.${id}`, status: due ? { built: false, due } : built, ...(due ? { due } : {}), reqs });
export const SLASH_ITEMS: SlashDef[] = [
  slash('task', 'objects', ['FR-TSK-01', 'FR-CNV-01']), // built in 5A-2 (R53)
  slash('turnIntoObject', 'objects', ['FR-CNV-01']),
  slash('embedObject', 'objects', ['FR-EMB-01']),
  slash('text', 'blocks', ['FR-EDT-02']),
  slash('heading1', 'blocks', ['FR-EDT-02']),
  slash('heading2', 'blocks', ['FR-EDT-02']),
  slash('heading3', 'blocks', ['FR-EDT-02']),
  slash('bulletList', 'blocks', ['FR-EDT-02']),
  slash('orderedList', 'blocks', ['FR-EDT-02']),
  slash('checklist', 'blocks', ['FR-EDT-02', 'FR-TSK-11']),
  slash('quote', 'blocks', ['FR-EDT-02']),
  slash('callout', 'blocks', ['FR-EDT-02']),
  slash('codeBlock', 'blocks', ['FR-EDT-02']),
  slash('divider', 'blocks', ['FR-EDT-02']),
  slash('table', 'blocks', ['FR-EDT-02']),
  slash('image', 'media', ['FR-ATT-01', 'FR-ATT-03']), // built in 6A (R75)
  slash('pdf', 'media', ['FR-ATT-02']),
  slash('blockEmbed', 'advanced', ['FR-EMB-01', 'FR-LNK-06'], d('v1.0')),
  slash('query', 'advanced', ['FR-QRY-06', 'FR-FMT-06'], d('v1.0')),
  slash('mindmap', 'advanced', ['FR-MMP-01'], d('v1.0')),
];

const ORDER: Milestone[] = ['MS3', 'MS4', 'MS5', 'MS6', 'MS7', 'MS8', 'v1.0', 'v1.x'];
const rank = (m: string) => (m === 'MS1' || m === 'MS2' ? -1 : ORDER.indexOf(m as Milestone));

export function showDue(due: Due): string {
  return due.slice ? `${due.milestone} (${due.slice})` : due.milestone;
}

export function routeDef(id: string): RouteDef | undefined {
  return ROUTES.find((r) => r.id === id);
}

/** Entries still TBD or disabled with a milestone at or before `milestone` (D-124), for the milestone gate. */
export function overdue(milestone: Milestone | string): string[] {
  const limit = rank(milestone);
  if (limit < 0) return [];
  const out: string[] = [];
  for (const r of [...ROUTES, ...PANEL_TABS]) {
    if (!r.status.built && rank(r.status.due.milestone) <= limit) out.push(`${r.id} (${showDue(r.status.due)})`);
  }
  for (const c of DISABLED_CONTROLS) {
    if (rank(c.due.milestone) <= limit) out.push(`${String(en[c.label] ?? c.label)} (${showDue(c.due)})`);
  }
  for (const p of IN_NOTE_PLACEHOLDERS) {
    if (rank(p.due.milestone) <= limit) out.push(`${p.id} (${showDue(p.due)})`);
  }
  for (const i of SLASH_ITEMS) {
    if (i.due && rank(i.due.milestone) <= limit) out.push(`${String(en[i.label] ?? i.label)} (${showDue(i.due)})`);
  }
  return out;
}
