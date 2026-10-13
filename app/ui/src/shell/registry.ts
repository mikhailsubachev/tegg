// Route, panel, disabled-control and shortcut registries (D-116, D-124, docs/contracts/ms3-shell.md §3.2).
// Their content equals tables R1–R4 of docs/acceptance/app-shell.md; each later slice or milestone flips its
// entries to built in the commit that builds them.
import { en } from '../i18n/catalog';

export type Milestone = 'MS3' | 'MS4' | 'MS5' | 'MS6' | 'MS7' | 'MS8' | 'v1.0' | 'v1.x';
export type Slice = '3A' | '3B' | '3C' | '3D' | '3E';
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
  id: 'embed-note' | 'embed-image' | 'embed-pdf' | 'embed-other' | 'query' | 'mindmap';
  name: string;
  due: Due;
  reqs: string[];
};
const built = { built: true } as const;
const tbd = (milestone: Milestone, slice?: Slice) => ({ built: false as const, due: slice ? { milestone, slice } : { milestone } });

export const IN_NOTE_PLACEHOLDERS: InNotePlaceholderDef[] = [
  { id: 'embed-note', name: 'ph.embedNote', due: { milestone: 'MS4' }, reqs: ['FR-EMB-01', '-02', '-04'] },
  { id: 'embed-image', name: 'ph.embedImage', due: { milestone: 'MS6' }, reqs: ['FR-ATT-03', 'FR-ATT-07'] },
  { id: 'embed-pdf', name: 'ph.embedPdf', due: { milestone: 'MS6' }, reqs: ['FR-ATT-02'] },
  { id: 'embed-other', name: 'ph.embedOther', due: { milestone: 'MS6' }, reqs: ['FR-ATT-07'] },
  { id: 'query', name: 'ph.query', due: { milestone: 'v1.0' }, reqs: ['FR-QRY-01', 'FR-FMT-06'] },
  { id: 'mindmap', name: 'ph.mindmap', due: { milestone: 'v1.0' }, reqs: ['FR-MMP-01', '-02', 'FR-FMT-05'] },
];

export const ROUTES: RouteDef[] = [
  { id: 'chooser', name: 'route.chooser', purpose: 'purpose.chooser', status: built, reqs: ['FR-VLT-01', 'FR-VLT-02'], design: null },
  { id: 'home', name: 'route.home', purpose: 'purpose.home', status: tbd('MS5'), reqs: ['FR-HOM-01', 'FR-HOM-02'], design: 'Home' },
  { id: 'inbox', name: 'route.inbox', purpose: 'purpose.inbox', status: tbd('MS5'), reqs: ['FR-INB-01…04'], design: 'Home' },
  { id: 'today', name: 'route.today', purpose: 'purpose.today', status: tbd('MS4'), reqs: ['FR-DLY-01…06'], design: 'Home' },
  { id: 'tasks', name: 'route.tasks', purpose: 'purpose.tasks', status: tbd('MS5'), reqs: ['FR-TSK-04…06'], design: 'Home' },
  { id: 'search', name: 'route.search', purpose: 'purpose.search', status: built, reqs: ['FR-SRC-01…04'], design: null },
  { id: 'type/<type>', name: 'route.type', purpose: 'purpose.type', status: built, reqs: ['FR-TYP-09'], design: 'Ideas' },
  { id: 'type-settings/<type>', name: 'route.typeSettings', purpose: 'purpose.typeSettings', status: tbd('MS3', '3D'), reqs: ['FR-TYP-01…03', '-05', '-11', '-12'], design: 'TypeSettings' },
  { id: 'tags', name: 'route.tags', purpose: 'purpose.tags', status: tbd('MS4'), reqs: ['FR-TAG-06', 'FR-TAG-07'], design: 'Main' },
  { id: 'pinned', name: 'route.pinned', purpose: 'purpose.pinned', status: tbd('MS5'), reqs: ['FR-HOM-02'], design: null },
  { id: 'saved-queries', name: 'route.savedQueries', purpose: 'purpose.savedQueries', status: tbd('v1.0'), reqs: ['FR-QRY-06'], design: null },
  { id: 'note/<path>', name: 'route.note', purpose: 'purpose.note', status: built, reqs: [], design: 'Main' },
  { id: 'graph', name: 'route.graph', purpose: 'purpose.graph', status: tbd('v1.0'), reqs: ['FR-GRP-01…08'], design: 'Graph' },
  { id: 'trash', name: 'route.trash', purpose: 'purpose.trash', status: tbd('MS6'), reqs: ['FR-HIS-01', 'FR-HIS-02'], design: null },
  { id: 'import', name: 'route.import', purpose: 'purpose.import', status: tbd('MS7'), reqs: ['FR-IMP-01', '-03', '-05', 'FR-STO-10'], design: null },
  { id: 'conflicts', name: 'route.conflicts', purpose: 'purpose.conflicts', status: tbd('MS3', '3C'), reqs: ['FR-SYN-04', 'FR-SYN-05'], design: null },
  { id: 'capture', name: 'route.capture', purpose: 'purpose.capture', status: tbd('MS5'), reqs: ['FR-CAP-01…05'], design: 'Home' },
  { id: 'settings/appearance', name: 'route.settings.appearance', purpose: 'purpose.settings.appearance', status: built, reqs: ['FR-SET-02'], design: null },
  { id: 'settings/date-time', name: 'route.settings.dateTime', purpose: 'purpose.settings.dateTime', status: tbd('MS3', '3E'), reqs: ['FR-SET-03'], design: null },
  { id: 'settings/vault', name: 'route.settings.vault', purpose: 'purpose.settings.vault', status: tbd('MS5'), reqs: ['FR-SET-01'], design: null },
  { id: 'settings/shortcuts', name: 'route.settings.shortcuts', purpose: 'purpose.settings.shortcuts', status: tbd('MS5'), reqs: ['FR-SET-04'], design: null },
  { id: 'settings/menu-bar', name: 'route.settings.menuBar', purpose: 'purpose.settings.menuBar', status: tbd('MS5'), reqs: ['FR-SET-05'], design: null },
  { id: 'settings/trash-history', name: 'route.settings.trashHistory', purpose: 'purpose.settings.trashHistory', status: tbd('v1.0'), reqs: ['FR-SET-06'], design: null },
  { id: 'settings/previews', name: 'route.settings.previews', purpose: 'purpose.settings.previews', status: tbd('v1.0'), reqs: ['FR-SET-07'], design: null },
];

export const PANEL_TABS: TabDef[] = [
  { id: 'backlinks', name: 'tab.backlinks', status: tbd('MS4'), reqs: ['FR-LNK-01…04'] },
  { id: 'outline', name: 'tab.outline', status: tbd('MS5'), reqs: ['FR-EDT-11'] },
  { id: 'graph', name: 'tab.graph', status: tbd('v1.0'), reqs: ['FR-GRP-01'] },
];

const d = (milestone: Milestone, slice?: Slice): Due => (slice ? { milestone, slice } : { milestone });

export const DISABLED_CONTROLS: DisabledControl[] = [
  { label: 'ctl.newTab', where: 'title bar', due: d('v1.0'), req: 'FR-NAV-06' },
  { label: 'ctl.back', where: 'title bar', due: d('MS5'), req: 'FR-NAV-03' },
  { label: 'ctl.forward', where: 'title bar', due: d('MS5'), req: 'FR-NAV-03' },
  { label: 'ctl.newType', where: 'sidebar, Types header', due: d('MS3', '3D'), req: 'FR-TYP-01' },
  { label: 'ctl.starterVault', where: 'chooser, New vault form', due: d('MS3', '3D'), req: 'FR-VLT-02' },
  { label: 'ctl.edit', where: 'note toolbar', due: d('MS3', '3C'), req: 'FR-EDT-01' },
  { label: 'ctl.addIcon', where: 'note header', due: d('MS3', '3E'), req: 'FR-TYP-14' },
  { label: 'ctl.addCover', where: 'note header', due: d('MS3', '3E'), req: 'FR-TYP-14' },
  { label: 'ctl.filter', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09' },
  { label: 'ctl.sort', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09' },
  { label: 'ctl.views', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09' },
  { label: 'ctl.newOfType', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09' },
  { label: 'ctl.font', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02' },
  { label: 'ctl.fontSize', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02' },
  { label: 'ctl.editorWidth', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02' },
  { label: 'ctl.accentColor', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02' },
  { label: 'ctl.typePicker', where: 'New object dialog', due: d('MS5'), req: 'FR-VLT-05' },
];

export const SHORTCUTS: ShortcutDef[] = [
  { keys: '⌘K', command: 'app.palette' },
  { keys: '⇧⌘P', command: 'app.palette' },
  { keys: '⌘O', command: 'app.switcher' },
  { keys: '⌘N', command: 'object.new' },
  { keys: '⇧⌘F', command: 'goto.search' },
  { keys: '⌘D', command: 'goto.today' },
  { keys: '⇧⌘I', command: 'goto.inbox' },
  { keys: '⌘\\', command: 'view.toggleRightPanel' },
  { keys: '⌃⌘S', command: 'view.toggleSidebar' },
  { keys: '⇧⌘\\', command: 'view.toggleFocus' },
  { keys: '⌘,', command: 'goto.settings/appearance' },
  { keys: '⌥⌘U', command: 'note.toggleSource' },
  { keys: '⌘T', command: 'nav.newTab' },
  { keys: '⌘[', command: 'nav.back' },
  { keys: '⌘]', command: 'nav.forward' },
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
  return out;
}
