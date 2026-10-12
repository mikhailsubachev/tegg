// Tables R1–R4 of docs/acceptance/app-shell.md, transcribed for the MS3 slice 3A AC tests (D-61). Test data only:
// no assertions here. Used by the Vitest registry tests (app/test) and the Playwright WebKit tests (app/webkit).

export type Due = { milestone: string; slice?: string };

export type R1Row = {
  id: string;
  page: string;
  built: boolean;
  due: Due;
  reqs: string; // as written in the table
  design: string | null;
  /** "Go to <Page>" command expected by FR-UX-03 AC-3 (null: no Go-to command, see the report's AP points). */
  goto: string | null;
};

const d = (milestone: string, slice?: string): Due => (slice ? { milestone, slice } : { milestone });

export const R1: R1Row[] = [
  { id: 'chooser', page: 'Vault chooser', built: true, due: d('MS3'), reqs: 'FR-VLT-01, FR-VLT-02', design: null, goto: null },
  { id: 'home', page: 'Home', built: false, due: d('MS5'), reqs: 'FR-HOM-01, FR-HOM-02', design: 'Home', goto: 'Go to Home' },
  { id: 'inbox', page: 'Inbox', built: false, due: d('MS5'), reqs: 'FR-INB-01…04', design: 'Home', goto: 'Go to Inbox' },
  { id: 'today', page: 'Today', built: false, due: d('MS4'), reqs: 'FR-DLY-01…06', design: 'Home', goto: 'Go to Today' },
  { id: 'tasks', page: 'Tasks', built: false, due: d('MS5'), reqs: 'FR-TSK-04…06', design: 'Home', goto: 'Go to Tasks' },
  { id: 'search', page: 'Search', built: true, due: d('MS2'), reqs: 'FR-SRC-01…04', design: null, goto: 'Go to Search' },
  { id: 'type/<type>', page: 'Type page', built: true, due: d('MS3'), reqs: 'FR-TYP-09', design: 'Ideas', goto: null },
  { id: 'type-settings/<type>', page: 'Type settings', built: false, due: d('MS3', '3D'), reqs: 'FR-TYP-01…03, -05, -11, -12', design: 'TypeSettings', goto: null },
  { id: 'tags', page: 'Tags', built: false, due: d('MS4'), reqs: 'FR-TAG-06, FR-TAG-07', design: 'Main', goto: 'Go to Tags' },
  { id: 'pinned', page: 'Pinned', built: false, due: d('MS5'), reqs: 'FR-HOM-02', design: null, goto: 'Go to Pinned' },
  { id: 'saved-queries', page: 'Saved queries', built: false, due: d('v1.0'), reqs: 'FR-QRY-06', design: null, goto: 'Go to Saved queries' },
  { id: 'note/<path>', page: 'Edit note', built: true, due: d('MS3'), reqs: '', design: 'Main', goto: null },
  { id: 'graph', page: 'Graph', built: false, due: d('v1.0'), reqs: 'FR-GRP-01…08', design: 'Graph', goto: 'Go to Graph' },
  { id: 'trash', page: 'Trash', built: false, due: d('MS6'), reqs: 'FR-HIS-01, FR-HIS-02', design: null, goto: 'Go to Trash' },
  { id: 'import', page: 'Import', built: false, due: d('MS7'), reqs: 'FR-IMP-01, -03, -05, FR-STO-10', design: null, goto: 'Go to Import' },
  { id: 'conflicts', page: 'Conflicts', built: false, due: d('MS3', '3C'), reqs: 'FR-SYN-04, FR-SYN-05', design: null, goto: 'Go to Conflicts' },
  { id: 'capture', page: 'Quick capture', built: false, due: d('MS5'), reqs: 'FR-CAP-01…05', design: 'Home', goto: 'Go to Quick capture' },
  { id: 'settings/appearance', page: 'Settings: Appearance', built: true, due: d('MS3'), reqs: 'FR-SET-02', design: null, goto: 'Go to Settings: Appearance' },
  { id: 'settings/date-time', page: 'Settings: Date & time', built: false, due: d('MS3', '3E'), reqs: 'FR-SET-03', design: null, goto: 'Go to Settings: Date & time' },
  { id: 'settings/vault', page: 'Settings: Vault', built: false, due: d('MS5'), reqs: 'FR-SET-01', design: null, goto: 'Go to Settings: Vault' },
  { id: 'settings/shortcuts', page: 'Settings: Shortcuts', built: false, due: d('MS5'), reqs: 'FR-SET-04', design: null, goto: 'Go to Settings: Shortcuts' },
  { id: 'settings/menu-bar', page: 'Settings: Menu bar and startup', built: false, due: d('MS5'), reqs: 'FR-SET-05', design: null, goto: 'Go to Settings: Menu bar and startup' },
  { id: 'settings/trash-history', page: 'Settings: Trash and history', built: false, due: d('v1.0'), reqs: 'FR-SET-06', design: null, goto: 'Go to Settings: Trash and history' },
  { id: 'settings/previews', page: 'Settings: Previews', built: false, due: d('v1.0'), reqs: 'FR-SET-07', design: null, goto: 'Go to Settings: Previews' },
];

export type R2Row = { id: 'backlinks' | 'outline' | 'graph'; tab: string; built: boolean; due: Due; reqs: string };
export const R2: R2Row[] = [
  { id: 'backlinks', tab: 'Backlinks', built: false, due: d('MS4'), reqs: 'FR-LNK-01…04' },
  { id: 'outline', tab: 'Outline', built: false, due: d('MS5'), reqs: 'FR-EDT-11' },
  { id: 'graph', tab: 'Graph', built: false, due: d('v1.0'), reqs: 'FR-GRP-01' },
];

/** R3, one entry per control (a table row may name several controls). `shortcut` controls are in R4 as well. */
export type R3Control = { label: string; where: string; due: Due; req: string; route: string | null };
export const R3: R3Control[] = [
  { label: 'New tab', where: 'title bar', due: d('v1.0'), req: 'FR-NAV-06', route: null },
  { label: 'Back', where: 'title bar', due: d('MS5'), req: 'FR-NAV-03', route: null },
  { label: 'Forward', where: 'title bar', due: d('MS5'), req: 'FR-NAV-03', route: null },
  { label: 'New type', where: 'sidebar, Types header', due: d('MS3', '3D'), req: 'FR-TYP-01', route: null },
  { label: 'Starter vault', where: 'chooser, New vault form', due: d('MS3', '3D'), req: 'FR-VLT-02', route: 'chooser' },
  { label: 'Show Markdown source', where: 'note toolbar', due: d('MS3', '3B'), req: 'FR-EDT-10', route: 'note/<path>' },
  { label: 'Add icon', where: 'note header', due: d('MS3', '3E'), req: 'FR-TYP-14', route: 'note/<path>' },
  { label: 'Add cover', where: 'note header', due: d('MS3', '3E'), req: 'FR-TYP-14', route: 'note/<path>' },
  { label: 'Filter', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09', route: 'type/<type>' },
  { label: 'Sort', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09', route: 'type/<type>' },
  { label: 'Views', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09', route: 'type/<type>' },
  { label: 'New <Type>', where: 'type page', due: d('MS3', '3D'), req: 'FR-TYP-09', route: 'type/<type>' },
  { label: 'Font', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02', route: 'settings/appearance' },
  { label: 'Font size', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02', route: 'settings/appearance' },
  { label: 'Editor width', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02', route: 'settings/appearance' },
  { label: 'Accent color', where: 'Settings: Appearance', due: d('MS3', '3E'), req: 'FR-SET-02', route: 'settings/appearance' },
  { label: 'Type picker', where: 'New object dialog', due: d('MS5'), req: 'FR-VLT-05', route: null },
];

/** R4. `keys` in ⌃⌥⇧⌘ order as displayed (AP-70); `press` is the Playwright chord; `command` the R4 command text. */
export type R4Row = { keys: string; press: string; command: string; enabled: boolean };
export const R4: R4Row[] = [
  { keys: '⌘K', press: 'Meta+k', command: 'Open command palette', enabled: true },
  { keys: '⇧⌘P', press: 'Meta+Shift+p', command: 'Open command palette', enabled: true },
  { keys: '⌘O', press: 'Meta+o', command: 'Open quick switcher', enabled: true },
  { keys: '⌘N', press: 'Meta+n', command: 'New object', enabled: true },
  { keys: '⇧⌘F', press: 'Meta+Shift+f', command: 'Go to Search', enabled: true },
  { keys: '⌘D', press: 'Meta+d', command: 'Go to Today', enabled: true },
  { keys: '⇧⌘I', press: 'Meta+Shift+i', command: 'Go to Inbox', enabled: true },
  { keys: '⌘\\', press: 'Meta+Backslash', command: 'Toggle right panel', enabled: true },
  { keys: '⌃⌘S', press: 'Control+Meta+s', command: 'Toggle sidebar', enabled: true },
  { keys: '⇧⌘\\', press: 'Meta+Shift+Backslash', command: 'Toggle focus mode', enabled: true },
  { keys: '⌘,', press: 'Meta+Comma', command: 'Go to Settings', enabled: true },
  { keys: '⌘T', press: 'Meta+t', command: 'New tab', enabled: false },
  { keys: '⌘[', press: 'Meta+BracketLeft', command: 'Back', enabled: false },
  { keys: '⌘]', press: 'Meta+BracketRight', command: 'Forward', enabled: false },
];

/** Shortcuts macOS reserves (FR-UX-03 AC-7). */
export const RESERVED = ['⌘Q', '⌘H', '⌥⌘H', '⌘M', '⌘Tab', '⌘Space', '⌘`'];

/** FR-UX-03 AC-3: the non-navigation commands every vault has. */
export const STATIC_COMMANDS = [
  'Open vault…', 'Create new vault…', 'Open quick switcher', 'New object', 'Toggle sidebar', 'Toggle right panel',
  'Toggle focus mode', 'Theme: System', 'Theme: Light', 'Theme: Dark',
];

/** FR-UX-02 AC-4 (fixture, collation cs): label and count of each Types entry, in order. */
export const TYPES_CS: [string, number][] = [
  ['Pages', 2], ['Tasks', 1], ['Quick Notes', 2], ['Daily Notes', 0], ['Cesty', 0], ['Čajovny', 0], ['Schůzky', 1],
  ['Images', 0], ['PDFs', 0], ['recept', 1],
];
export const TYPE_KEYS: Record<string, string> = {
  Pages: 'page', Tasks: 'task', 'Quick Notes': 'quick-note', 'Daily Notes': 'daily-note', Cesty: 'cesta',
  'Čajovny': 'čajovna', 'Schůzky': 'schůzka', Images: 'image', PDFs: 'pdf', recept: 'recept',
};

/** Expands requirement lists as written in the tables ("FR-TYP-01…03, -05", "FR-INB-01…04") to full IDs. */
export function expandReqs(items: string[] | string): string[] {
  const parts = (Array.isArray(items) ? items : [items]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let prefix = '';
  for (const raw of parts) {
    const p = raw.replace('...', '…');
    const full = p.startsWith('-') ? prefix + p.slice(1) : p;
    const m = /^(.*-)(\d+)(?:…(\d+))?$/.exec(full);
    if (!m) { out.push(full); continue; }
    prefix = m[1];
    const width = m[2].length;
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    for (let n = from; n <= to; n++) out.push(prefix + String(n).padStart(width, '0'));
  }
  return [...new Set(out)].sort();
}

/** "MS5", "MS3 (3D)", "v1.0" (AP-68). */
export const showDue = (due: Due) => (due.slice ? `${due.milestone} (${due.slice})` : due.milestone);

export const MILESTONE_ORDER = ['MS1', 'MS2', 'MS3', 'MS4', 'MS5', 'MS6', 'MS7', 'MS8', 'v1.0', 'v1.x'];
