// Tables R1–R4 of docs/acceptance/app-shell.md, transcribed for the MS3 slice 3A AC tests (D-61). Test data only:
// no assertions here. Used by the Vitest registry tests (app/test) and the Playwright WebKit tests (app/webkit).

export type Due = { milestone: string; slice?: string };

/** Today's local date, read when used (not at import, PR #38 review): the page name of the daily routes (4B, D-320). */
const today = () => new Date().toLocaleDateString('sv');

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
  // 6A (trash-media.md R75, D-613): `home` is removed (returns with FR-HOM-01 in v1.0); the Inbox is built (5B, board `Inbox`).
  { id: 'inbox', page: 'Inbox', built: true, due: d('MS5'), reqs: 'FR-INB-01…04', design: 'Inbox', goto: 'Go to Inbox' },
  // Built in 4B (daily-notes.md R17, D-321): `today` redirects to the daily route, whose page is named by its date.
  { id: 'today', get page() { return today(); }, built: true, due: d('MS4', '4B'), reqs: 'FR-DLY-01…06', design: 'Home', goto: 'Go to Today' },
  { id: 'daily/YYYY-MM-DD', get page() { return today(); }, built: true, due: d('MS4', '4B'), reqs: 'FR-DLY-01…06', design: 'Home', goto: 'Go to Today' },
  // Built in 5A-1 (tasks.md R45, D-489): the Schedule and the Kanban.
  { id: 'tasks', page: 'Tasks', built: true, due: d('MS5'), reqs: 'FR-TSK-04, FR-TSK-05', design: 'Tasks', goto: 'Go to Tasks' },
  { id: 'tasks/kanban', page: 'Tasks', built: true, due: d('MS5'), reqs: 'FR-TSK-04, FR-TSK-05', design: 'TasksBoard', goto: 'Show Kanban' },
  { id: 'search', page: 'Search', built: true, due: d('MS2'), reqs: 'FR-SRC-01…04', design: null, goto: 'Go to Search' },
  { id: 'type/<type>', page: 'Type page', built: true, due: d('MS3'), reqs: 'FR-TYP-09', design: 'Ideas', goto: null },
  { id: 'type-settings/<type>', page: 'Type settings', built: true, due: d('MS3', '3D'), reqs: 'FR-TYP-01…03, -05, -11, -12', design: 'TypeSettings', goto: null }, // built in 3D (types.md R1)
  // 4D-lite (tags.md R87): All tags is built (board TagsAll); the tag page and Settings › Backups are new built routes.
  { id: 'tags', page: 'Tags', built: true, due: d('MS4'), reqs: 'FR-TAG-06, FR-TAG-07', design: 'TagsAll', goto: 'Go to Tags' },
  { id: 'tag/<key>', page: 'Tag page', built: true, due: d('MS4'), reqs: 'FR-TAG-06', design: 'TagPage', goto: null },
  // Slice PIN (pinned.md FR-NAV-04 AC-10, AP-1232 = D-1375): the `pinned` route and `Go to Pinned` are removed.
  // Slice Q (queries.md "Existing criteria this slice changes", AP-1304 = D-1447; v1-queries §4.1): `saved-queries` is
  // removed; `queries` (board QueriesAll) and `query/<name>` (board QueryPage) are built.
  { id: 'queries', page: 'Queries', built: true, due: d('v1.0'), reqs: 'FR-QRY-06, FR-NAV-04', design: 'QueriesAll', goto: 'Go to Queries' },
  { id: 'query/<name>', page: 'Query', built: true, due: d('v1.0'), reqs: 'FR-QRY-06', design: 'QueryPage', goto: null },
  { id: 'note/<path>', page: 'Edit note', built: true, due: d('MS3'), reqs: '', design: 'Main', goto: null },
  // D-520 (5A-1 feedback, ms5-tasks §12.2): the unsaved draft of a new object; no sidebar entry, no Go to command.
  { id: 'new/<type>', page: 'New object', built: true, due: d('MS5'), reqs: 'FR-TYP-09, FR-EDT-01', design: 'Main', goto: null },
  // Slice G1 (graph.md, app-shell changes in the commit that builds G1; D-914): the full view is `graph/<path>`, built.
  { id: 'graph/<path>', page: 'Graph', built: true, due: d('v1.0'), reqs: 'FR-GRP-01…08', design: 'Graph', goto: null },
  { id: 'trash', page: 'Trash', built: true, due: d('MS6'), reqs: 'FR-HIS-01, FR-HIS-02', design: null, goto: 'Go to Trash' }, // built in 6A (R75)
  // Slice I2 (import-capacities.md R154, D-1531, D-1571): the `import` route and `Go to Import` are removed; the import is
  // a window opened by `import.open` (`Import…`, STATIC_COMMANDS).
  // 4A (backlinks.md R16): vault checks, palette only (D-284).
  { id: 'broken-links', page: 'Broken links', built: true, due: d('MS4', '4A'), reqs: 'FR-LNK-04', design: null, goto: 'Go to Broken links' },
  { id: 'duplicate-titles', page: 'Duplicate titles', built: true, due: d('MS4', '4A'), reqs: 'FR-LNK-14', design: null, goto: 'Go to Duplicate titles' },
  { id: 'conflicts', page: 'Conflicts', built: true, due: d('MS3', '3C'), reqs: 'FR-SYN-04, FR-SYN-05', design: null, goto: 'Go to Conflicts' }, // built in 3C (editor.md R1)
  // 5B R62 (AP-491): `capture` is removed (capture is a window, not a route).
  { id: 'settings/appearance', page: 'Settings: Appearance', built: true, due: d('MS3'), reqs: 'FR-SET-02', design: null, goto: 'Go to Settings: Appearance' },
  // 5B R62: built (FR-SET-03 by D-565; settings/shortcuts read-only, D-71, editing is FR-SET-04 in v1.0).
  { id: 'settings/date-time', page: 'Settings: Date & time', built: true, due: d('MS5'), reqs: 'FR-SET-03', design: null, goto: 'Go to Settings: Date & time' },
  { id: 'settings/vault', page: 'Settings: Vault', built: true, due: d('MS5'), reqs: 'FR-SET-01', design: null, goto: 'Go to Settings: Vault' },
  { id: 'settings/shortcuts', page: 'Settings: Shortcuts', built: true, due: d('MS5'), reqs: 'FR-SET-04', design: null, goto: 'Go to Settings: Shortcuts' },
  // v0.52 (D-608): Help › Keyboard Shortcuts; no `Go to` command (palette `Keyboard shortcuts`, ⇧⌘/).
  { id: 'help/shortcuts', page: 'Keyboard shortcuts', built: true, due: d('MS5'), reqs: 'FR-UX-03', design: null, goto: 'Keyboard shortcuts' },
  { id: 'settings/menu-bar', page: 'Settings: Menu bar and startup', built: true, due: d('MS5'), reqs: 'FR-SET-05', design: null, goto: 'Go to Settings: Menu bar and startup' },
  { id: 'settings/backups', page: 'Settings: Backups', built: true, due: d('MS4'), reqs: 'FR-HIS-04, NFR-REL-04', design: null, goto: 'Go to Settings: Backups' },
  { id: 'settings/trash-history', page: 'Settings: Trash and history', built: false, due: d('v1.0'), reqs: 'FR-SET-06', design: null, goto: 'Go to Settings: Trash and history' },
  // Built in slice P (previews.md R106, FR-SET-07 AC-1; D-943).
  { id: 'settings/previews', page: 'Settings: Previews', built: true, due: d('v1.0'), reqs: 'FR-SET-07', design: null, goto: 'Go to Settings: Previews' },
];

export type R2Row = { id: 'backlinks' | 'outline' | 'graph'; tab: string; built: boolean; due: Due; reqs: string };
export const R2: R2Row[] = [
  { id: 'backlinks', tab: 'Backlinks', built: true, due: d('MS4', '4A'), reqs: 'FR-LNK-01, FR-LNK-02' }, // built in 4A (backlinks.md R16, D-293)
  { id: 'outline', tab: 'Outline', built: true, due: d('v1.0'), reqs: 'FR-EDT-11, FR-NAV-05' }, // slice OL (outline.md R170, D-1624)
  { id: 'graph', tab: 'Graph', built: true, due: d('v1.0'), reqs: 'FR-GRP-01, FR-NAV-05' }, // G2 (graph-panel.md, D-920)
];

/** R3, one entry per control (a table row may name several controls). `shortcut` controls are in R4 as well. */
export type R3Control = { label: string; where: string; due: Due; req: string; route: string | null };
export const R3: R3Control[] = [
  { label: 'New tab', where: 'title bar', due: d('v1.0'), req: 'FR-NAV-06', route: null },
  // 3D (types.md R3 changes): `New type` and `Starter vault` are built.
  // 3C (editor.md R3): `Edit` removed (the body is the editor); two controls added. 5A-2 (R53, D-499): `Turn into
  // object` is built.
  { label: 'Copy link to block', where: 'block menu', due: d('v1.0'), req: 'FR-LNK-06', route: null },
  // 3D (types.md R3 changes): Filter, Sort, Views and New <Type> of the type page are built; these are added.
  { label: 'Filter', where: 'type page', due: d('v1.0'), req: 'FR-QRY-01', route: 'type/<type>' },
  { label: 'Group', where: 'type page', due: d('v1.0'), req: 'FR-QRY-05', route: 'type/<type>' },
  { label: 'Add view', where: 'type page', due: d('v1.0'), req: 'FR-QRY-07', route: 'type/<type>' },
  // D-372, D-748: slice 4E is v1.0.
  { label: 'New template', where: 'type settings, Templates', due: d('v1.0'), req: 'FR-TPL-01', route: 'type-settings/<type>' },
  { label: 'Edit', where: 'type settings, Templates', due: d('v1.0'), req: 'FR-TPL-01', route: 'type-settings/<type>' },
  { label: 'Add view', where: 'type settings, Views', due: d('v1.0'), req: 'FR-QRY-07', route: 'type-settings/<type>' },
  { label: 'Edit', where: 'type settings, Views', due: d('v1.0'), req: 'FR-QRY-07', route: 'type-settings/<type>' },
  // 6A (trash-media.md R75): the `File` row (`ctl.rowFile`) is built.
  // 4D-lite (R87): the Tag `color` row is removed (a Tag has no note page, D-692).
  { label: 'recurrence', where: 'attribute panel row', due: d('v1.0'), req: 'FR-TSK-01', route: 'note/<path>' }, // D-381 (5A-1)
  // 5A-1 (tasks.md R45 R3).
  { label: 'Sort tasks', where: 'Tasks page toolbar', due: d('v1.0'), req: 'FR-QRY-05', route: 'tasks' },
  // 6A (R75): the task card's `Move to trash` is built.
  // 5B R62 (D-565): the four Appearance extras are relabelled v1.0.
  { label: 'Font', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02', route: 'settings/appearance' },
  { label: 'Font size', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02', route: 'settings/appearance' },
  { label: 'Accent color', where: 'Settings: Appearance', due: d('v1.0'), req: 'FR-SET-02', route: 'settings/appearance' },
  // 5B R62: Inbox trash (D-560), the capture drop zone (D-545), shortcut editing (D-548).
  // 6A (R75): the Inbox's `Move to trash` and the capture drop zone `Add an image or PDF` are built.
  { label: 'Change…', where: 'Settings: Shortcuts', due: d('v1.0'), req: 'FR-SET-04', route: 'settings/shortcuts' },
  // 4A (backlinks.md R16). 5B R62: the Create offer's type picker is built (FR-VLT-05), `ctl.typePickerLink` removed.
  // 4D-lite (R87, D-705): `Merge…` on the Duplicate titles page is built (FR-LNK-14 AC-11).
  // D-635: `Unlinked mentions` (Backlinks panel, v1.x, FR-LNK-05) is removed from the panel and from R3.
];

/** R4. `keys` in ⌃⌥⇧⌘ order as displayed (AP-70); `press` is the Playwright chord; `command` the R4 command text
 *  (⌘[ / ⌘]: the command titles `Go back` / `Go forward` of FR-NAV-03 AC-2 and ms3-shell §12.2, D-165). */
export type R4Row = { keys: string; press: string; command: string; enabled: boolean };
export const R4: R4Row[] = [
  { keys: '⌘K', press: 'Meta+k', command: 'Open command palette', enabled: true },
  { keys: '⇧⌘P', press: 'Meta+Shift+p', command: 'Open command palette', enabled: true },
  // D-760 (search-navigation.md FR-NAV-01 AC-18): ⌘O is unbound and `Open quick switcher` is gone.
  // D-1431 (capture.md FR-VLT-05 AC-14): ⌘N runs `New object…`, which opens the type picker.
  { keys: '⌘N', press: 'Meta+n', command: 'New object…', enabled: true },
  { keys: '⇧⌘F', press: 'Meta+Shift+f', command: 'Go to Search', enabled: true },
  { keys: '⌘D', press: 'Meta+d', command: 'Go to Today', enabled: true },
  { keys: '⇧⌘I', press: 'Meta+Shift+i', command: 'Go to Inbox', enabled: true },
  { keys: '⌘\\', press: 'Meta+Backslash', command: 'Toggle right panel', enabled: true },
  { keys: '⌃⌘S', press: 'Control+Meta+s', command: 'Toggle sidebar', enabled: true },
  { keys: '⇧⌘\\', press: 'Meta+Shift+Backslash', command: 'Toggle focus mode', enabled: true },
  { keys: '⌘,', press: 'Meta+Comma', command: 'Go to Settings', enabled: true },
  { keys: '⇧⌘/', press: 'Meta+Shift+Slash', command: 'Keyboard shortcuts', enabled: true }, // D-608
  { keys: '⌥⌘U', press: 'Alt+Meta+KeyU', command: 'Toggle Markdown source', enabled: true },
  // 4B (daily-notes.md R17, D-329): on daily routes only.
  { keys: '⌥⌘←', press: 'Alt+Meta+ArrowLeft', command: 'Previous day', enabled: true },
  { keys: '⌥⌘→', press: 'Alt+Meta+ArrowRight', command: 'Next day', enabled: true },
  { keys: '⌘T', press: 'Meta+t', command: 'New tab', enabled: false },
  { keys: '⌘[', press: 'Meta+BracketLeft', command: 'Go back', enabled: true },
  { keys: '⌘]', press: 'Meta+BracketRight', command: 'Go forward', enabled: true },
  // D-219: the title-bar vault switcher's recent vaults (FR-VLT-01 AC-17).
  { keys: '⌃⌘1', press: 'Control+Meta+1', command: 'Open recent vault 1', enabled: true },
  { keys: '⌃⌘2', press: 'Control+Meta+2', command: 'Open recent vault 2', enabled: true },
  { keys: '⌃⌘3', press: 'Control+Meta+3', command: 'Open recent vault 3', enabled: true },
  { keys: '⌃⌘4', press: 'Control+Meta+4', command: 'Open recent vault 4', enabled: true },
  { keys: '⌃⌘5', press: 'Control+Meta+5', command: 'Open recent vault 5', enabled: true },
  { keys: '⌃⌘6', press: 'Control+Meta+6', command: 'Open recent vault 6', enabled: true },
  { keys: '⌃⌘7', press: 'Control+Meta+7', command: 'Open recent vault 7', enabled: true },
  { keys: '⌃⌘8', press: 'Control+Meta+8', command: 'Open recent vault 8', enabled: true },
  { keys: '⌃⌘9', press: 'Control+Meta+9', command: 'Open recent vault 9', enabled: true },
  // 3C (editor.md R4 gets the rows of R8).
  { keys: '⌘Z', press: 'Meta+z', command: 'Undo', enabled: true },
  { keys: '⇧⌘Z', press: 'Meta+Shift+z', command: 'Redo', enabled: true },
  { keys: '⌘B', press: 'Meta+b', command: 'Bold', enabled: true },
  { keys: '⌘I', press: 'Meta+i', command: 'Italic', enabled: true },
  { keys: '⇧⌘S', press: 'Meta+Shift+s', command: 'Strikethrough', enabled: true },
  { keys: '⌘E', press: 'Meta+e', command: 'Inline code', enabled: true },
  { keys: '⇧⌘H', press: 'Meta+Shift+h', command: 'Highlight', enabled: true },
  { keys: '⇧⌘K', press: 'Meta+Shift+k', command: 'Insert link', enabled: true },
  { keys: '⇧⌘↑', press: 'Meta+Shift+ArrowUp', command: 'Move block up', enabled: true },
  { keys: '⇧⌘↓', press: 'Meta+Shift+ArrowDown', command: 'Move block down', enabled: true },
  { keys: '⌘/', press: 'Meta+Slash', command: 'Open block menu', enabled: true },
  { keys: 'Esc', press: 'Escape', command: 'Select block', enabled: true },
  { keys: '⌘↩', press: 'Meta+Enter', command: 'Open link or toggle checklist item', enabled: true },
  { keys: '⇧⌘V', press: 'Meta+Shift+v', command: 'Paste as plain text', enabled: true },
  { keys: '⌘S', press: 'Meta+s', command: 'Save now', enabled: true },
  // 5A-2 (conversion.md R53, D-499).
  { keys: '⇧⌘T', press: 'Meta+Shift+t', command: 'Turn into task', enabled: true },
  { keys: '⇧⌘O', press: 'Meta+Shift+o', command: 'Turn into object…', enabled: true },
  // 6A (trash-media.md R75): on a note page, a focused card or row / in an editor.
  { keys: '⌘⌫', press: 'Meta+Backspace', command: 'Move to trash', enabled: true },
  { keys: '⇧⌘A', press: 'Meta+Shift+a', command: 'Add image or PDF…', enabled: true },
];
/** Slice P's R4 row (previews.md R106, D-943): ⌥Space `Show preview` (`preview.show`, section `navigate`), run only with a
 *  focused reference or the caret at a chip. Kept apart from `R4` because previews_catalog.ac.test.ts checks the
 *  shortcut table as `R4` plus ⌥Space; the registry tests compare against `[...R4, ...R4_P]`. */
export const R4_P: R4Row[] = [
  { keys: '⌥Space', press: 'Alt+Space', command: 'Show preview', enabled: true },
];
/** Slice G1's R4 row (graph.md FR-UX-03 AC-20, D-918): ⇧⌘G `Open graph` (`graph.open`, section `navigate`). */
export const R4_G1: R4Row[] = [
  { keys: '⇧⌘G', press: 'Meta+Shift+g', command: 'Open graph', enabled: true },
];
/** Slice PIN's R4 rows (pinned.md R136, AP-1243 = D-1386): ⌥⌘↑ / ⌥⌘↓ move the focused pinned row (`sidebar.pinned.moveUp`,
 *  `sidebar.pinned.moveDown`, section `edit`), listed and run only while a pinned row has the focus. */
export const R4_PIN: R4Row[] = [
  { keys: '⌥⌘↑', press: 'Alt+Meta+ArrowUp', command: 'Move up', enabled: true },
  { keys: '⌥⌘↓', press: 'Alt+Meta+ArrowDown', command: 'Move down', enabled: true },
];
/** Slice OL's R4 row (outline.md R175, D-1617, D-1624): ⌘J `Outline: jump to heading…` (`outline.jump`, section `view`),
 *  listed on note routes only (so the registry loop over R4 rows, run without a route, doesn't check it; outline_registry
 *  does). */
export const R4_OL: R4Row[] = [
  { keys: '⌘J', press: 'Meta+j', command: 'Outline: jump to heading…', enabled: true },
];
/** R106: the palette command `link.edit` (`Edit link`) shows ⇧⌘K, shared with R4's `edit.link` (`Insert link`): at a chip
 *  ⇧⌘K opens `Edit link` (FR-LNK-13 AC-6). The only pair FR-UX-03 AC-7's conflict check exempts (as previews_catalog). */
export const SHARED_SHORTCUT: { keys: string; ids: string[] } = { keys: '⇧⌘K', ids: ['edit.link', 'link.edit'] };
/** Shortcuts used by more than one enabled command, except the R106 pair `SHARED_SHORTCUT`. */
export function shortcutClashes(cmds: { id: string; shortcut?: string | null; due?: unknown }[]): string[] {
  const owners = new Map<string, string[]>();
  for (const c of cmds) if (!c.due && c.shortcut) owners.set(c.shortcut, [...(owners.get(c.shortcut) ?? []), c.id]);
  return [...owners]
    .filter(([k, v]) => v.length > 1 && !(k === SHARED_SHORTCUT.keys && v.every((x) => SHARED_SHORTCUT.ids.includes(x))))
    .map(([k]) => k);
}

/** Shortcuts macOS reserves (FR-UX-03 AC-7). */
export const RESERVED = ['⌘Q', '⌘H', '⌥⌘H', '⌘M', '⌘Tab', '⌘Space', '⌘`'];

/** FR-UX-03 AC-3: the non-navigation commands every vault has. */
export const STATIC_COMMANDS = [
  'Open vault…', 'Create new vault…', 'Open folder as vault…', 'About Tegg', 'Open recent vault 1', 'Open recent vault 2', 'Open recent vault 3', 'Open recent vault 4', 'Open recent vault 5', 'Open recent vault 6', 'Open recent vault 7', 'Open recent vault 8', 'Open recent vault 9', 'New object…' /* D-1431 */, 'Toggle sidebar', 'Toggle right panel',
  'Toggle focus mode', 'Theme: System', 'Theme: Light', 'Theme: Dark', 'Import…' /* slice I2: import.open (R154, D-1531) */,
];
/** Slice I2 (import-capacities.md R154; v1-import-window §4.2): the command `import.open`, section `file`, no shortcut, also
 *  listed with no vault open (D-137 gains it, D-1531). */
export const IMPORT_COMMAND = { id: 'import.open', title: 'cmd.import', text: 'Import…', section: 'file', shortcut: null, needsVault: false } as const;

/** FR-UX-02 AC-4 (fixture, collation cs): label and count of each Types entry, in order. D-516: Task is not in the
 *  list (the sidebar's `Tasks` entry covers it, tasks.md FR-TSK-04 AC-15). */
export const TYPES_CS: [string, number][] = [
  ['Pages', 2], ['Quick Notes', 2], ['Daily Notes', 0], ['Cesty', 0], ['Čajovny', 0], ['Schůzky', 1],
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

/** R5 of docs/acceptance/read-view.md (slice 3B): in-note placeholders (D-144). `shown`: the "Also shown" column. */
/** 4F (D-431, R32): the `embed-note` row is built and removed. 6A (D-630): `embed-image` and `embed-pdf` are retired
 *  (trash-media.md R77 renders images and PDF cards) and `embed-other` is a built card (file name, `Reveal in Finder`). */
/** Slice MM (D-679): the `mindmap` row is removed; a mindmap is a `[!mindmap]` callout drawn by Tegg. */
/** Slice Q (queries.md "Existing criteria this slice changes": read-view R5's `query` row becomes built, the block of
 *  R141): like 4F's `embed-note` row, it leaves the placeholder table, which is now empty. */
export type R5Row = { id: 'query'; due: Due; reqs: string };
export const R5: R5Row[] = [];

// ------------------------------------------------------------------------------------------------ slice 3D tables
// R10–R14 of docs/acceptance/types.md, transcribed for the 3D AC tests (D-61). Test data only.

/** R10: `type` string, catalog label, in the order the `Type` control offers them. */
export const R10: [string, string][] = [
  ['text', 'Text'], ['long-text', 'Long text'], ['number', 'Number'], ['checkbox', 'Checkbox'], ['date', 'Date'],
  ['date-time', 'Date-time'], ['date-range', 'Date range'], ['select', 'Select'], ['multi-select', 'Multi-select'],
  ['url', 'URL'], ['email', 'Email'], ['relation', 'Relation'],
];

/** R11: name, plural, key/folder, icon, colour, attributes (key: type), preview, template headings. */
export type R11Row = { name: string; plural: string; key: string; folder: string; icon: string; color: string; attrs: [string, string][]; preview: string[]; template: string[] };
export const R11: R11Row[] = [
  { name: 'Book', plural: 'Books', key: 'book', folder: 'Books', icon: 'book', color: 'orange', attrs: [['author', 'text'], ['year', 'number'], ['status', 'select'], ['finished', 'date']], preview: ['author', 'status'], template: ['Summary', 'Notes', 'Quotes'] },
  { name: 'Reading Note', plural: 'Reading Notes', key: 'reading-note', folder: 'Reading Notes', icon: 'book-open', color: 'purple', attrs: [['book', 'relation'], ['pages', 'text']], preview: ['book'], template: ['Key points', 'My thoughts'] },
  { name: 'Idea', plural: 'Ideas', key: 'idea', folder: 'Ideas', icon: 'lightbulb', color: 'yellow', attrs: [['status', 'select'], ['related', 'relation'], ['origin-url', 'url']], preview: ['status', 'tags', 'source'], template: ['Idea', 'Why it matters'] },
  { name: 'Meeting', plural: 'Meetings', key: 'meeting', folder: 'Meetings', icon: 'users', color: 'teal', attrs: [['date', 'date'], ['attendees', 'relation'], ['project', 'relation'], ['location', 'text']], preview: ['date', 'attendees'], template: ['Agenda', 'Notes', 'Decisions'] },
  { name: 'Person', plural: 'People', key: 'person', folder: 'People', icon: 'user', color: 'purple', attrs: [['email', 'email'], ['organization', 'text'], ['role', 'text']], preview: ['organization', 'role'], template: ['Notes'] },
  { name: 'Project', plural: 'Projects', key: 'project', folder: 'Projects', icon: 'folder', color: 'orange', attrs: [['status', 'select'], ['timeframe', 'date-range']], preview: ['status', 'timeframe'], template: ['Goal', 'Plan', 'Notes'] },
  { name: 'Trip', plural: 'Trips', key: 'trip', folder: 'Trips', icon: 'map', color: 'blue', attrs: [['destination', 'text'], ['dates', 'date-range']], preview: ['destination', 'dates'], template: ['Plan', 'Packing list', 'Notes'] },
];

/** R12: type settings sections in order (section navigation links and region names). */
/** 4F (D-431, R32): `Embeds` between `Hidden properties` and `Review workflow`. */
export const R12_SECTIONS = ['General', 'Properties', 'Built in on every type', 'Preview properties', 'Embeds', 'Review workflow', 'Templates', 'Views', 'Delete type'];
export const R12_BUILT_IN = ['title', 'description', 'aliases', 'tags', 'source', 'review', 'created', 'modified'];

/** R13 (with ms3-shell §14.7.2 ids and sections): palette title, id, section, routes it is present on. */
export type R13Row = { title: string; id: string; section: string; on: 'vault' | 'type' | 'type+note' | 'note' };
export const R13: R13Row[] = [
  { title: 'New type…', id: 'type.new', section: 'create', on: 'vault' },
  { title: 'Open type settings', id: 'type.openSettings', section: 'navigate', on: 'type+note' },
  { title: 'New {name}', id: 'type.newObject', section: 'create', on: 'type' },
  { title: 'Change type…', id: 'note.changeType', section: 'edit', on: 'note' },
  { title: 'Edit properties', id: 'note.editProperties', section: 'edit', on: 'note' },
  { title: 'Add starter types…', id: 'vault.addStarterTypes', section: 'vault', on: 'vault' },
];

/** R14: colour tokens and labels; icon names in the order `Change icon` offers them. */
export const R14_COLORS: [string, string][] = [
  ['gray', 'Gray'], ['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['purple', 'Purple'], ['red', 'Red'], ['teal', 'Teal'], ['yellow', 'Yellow'],
];
export const R14_ICONS = [
  'file-text', 'check-square', 'zap', 'calendar', 'hash', 'image', 'file', 'book', 'book-open', 'lightbulb', 'users', 'user',
  'folder', 'map', 'star', 'flag', 'bookmark', 'briefcase', 'coffee', 'globe', 'graduation-cap', 'pen-line', 'utensils', 'plane',
];
