// The command registry (FR-UX-03, docs/contracts/ms3-shell.md §3.3, §10). Every action of the frame is a command;
// controls reference theirs with `data-command`, and one key handler runs them by shortcut.
import type { TypeDefDto, VaultInfo } from '../ipc/types';
import { t } from '../i18n/catalog';
import { reviewable } from '../review';
import { DISABLED_CONTROLS, ROUTES, SHORTCUTS, type Due } from './registry';
import type { Route } from './routes';
import { typeEntries } from './types';

export type ThemeChoice = 'system' | 'light' | 'dark';

export type ShellActions = {
  go: (r: Route) => void;
  openPalette: () => void;
  /** D-760: the `search` route with the caret in its field and the query selected (⇧⌘F, the sidebar `Search`). */
  openSearch: () => void;
  newObject: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  toggleFocus: () => void;
  toggleSource: () => void;
  back: () => void;
  forward: () => void;
  toggleProperties: () => void;
  /** Slice PW (page-width.md, AP-756): the open note page's width; nothing off a note route. */
  setPageWidth?: (width: 'normal' | 'wide') => void;
  openChooser: (form: boolean) => void;
  /** D-219: open the n-th recent vault (1-based); nothing for the open, a missing or an absent entry. */
  openRecent: (n: number) => void;
  /** D-219: the folder picker, then open that folder as the vault. */
  openFolder: () => void;
  /** D-220: the standard About panel. */
  about: () => void;
  setTheme: (t: ThemeChoice) => void;
  /** Runs an R8 editor action on the note route's editor; a no-op elsewhere (editor.md R8). */
  edit?: (action: EditAction) => void;
  /** 5A-2 (FR-CNV-01 AC-5): why `Turn into object` can't run on the note now (read view, read-only, a nested editor,
   *  a template), or null. */
  convertBlocked?: () => string | null;
  // 3D (R13, ms3-shell §14.7.2).
  newType?: () => void;
  openTypeSettings?: () => void;
  newObjectOfType?: (key: string) => void;
  changeType?: () => void;
  editProperties?: () => void;
  addStarterTypes?: () => void;
  /** 4A (R16): opens the Context panel on Backlinks and focuses its first entry. */
  showBacklinks?: () => void;
  /** 4B (R17): the calendar of the open daily route (or of today), and the review toggle. */
  pickDate?: () => void;
  setReviewed?: (reviewed: boolean) => void;
  /** 5A-1 (tasks.md R45): open the Tasks page at its last view (D-481); run a Tasks page or card command. */
  goTasks?: () => void;
  taskCommand?: (id: string) => void;
  /** 4C (ms4-jobs §10): undo the last rename; open the "Links not updated" list. */
  undoRename?: () => void;
  /** 4E-1 (R100, D-830): undo the last undoable job of `kind`, if it is the last undoable job. */
  undoJob?: (kind: 'type-move' | 'folder-move' | 'value-remove' | 'type-delete') => void;
  showNotUpdated?: () => void;
  /** 5B (inbox.md R62, D-578): open the capture window (`default` or `task`). */
  capture?: (kind: 'default' | 'task') => void;
  /** 4D-lite (tags.md R87): `New tag…`; a tag page command on `tag/<key>`; `Merge…` of the focused duplicate group. */
  newTag?: () => void;
  tagCommand?: (id: string) => void;
  mergeFocused?: () => void;
  /** 5B (R62): run an Inbox command on the focused card or the selection; nothing without either. */
  inboxCommand?: (id: string) => void;
  /** 5B (D-562): mark the open note reviewed or unreviewed. */
  setNoteReviewed?: (reviewed: boolean) => void;
  /** 6A (R75): move the open note, the focused card or row to the trash; why it can't, or null. */
  trashObject?: () => void;
  trashBlocked?: () => string | null;
  /** 6A (R75): the Trash page's Restore and Delete permanently… on the focused row. */
  trashCommand?: (id: 'restore' | 'delete') => void;
  /** 6A (R75): the file picker, then add the files at the editor's caret. */
  addMedia?: () => void;
  /** Slice P (R106): the focused reference's or the editor chip's preview; the Object preview setting; the link at the
   *  caret's `Edit link` dialog and `Remove link`. Each does nothing without a reference or a chip (FR-UX-03 AC-19). */
  showPreview?: () => void;
  setPreviewMode?: (mode: 'click' | 'hover' | 'off') => void;
  editLink?: () => void;
  removeLink?: () => void;
  /** Slice G1 (graph.md FR-UX-03 AC-20, D-918): the full view of the current object; a graph route command. */
  openGraph?: () => void;
  graphCommand?: (id: GraphCommandId) => void;
  /** Slice G3 (R123): the shown graph's view and preset state, for the commands' listing and `disabled()` reasons. */
  graphStatus?: () => GraphStatus | null;
};

/** Slice G1 and G3 (v1-graph §4, §16.3): the graph route's commands, run by the shown graph page. */
export type GraphCommandId = 'depth1' | 'depth2' | 'depth3' | 'recenter' | 'preset.apply' | 'preset.save' | 'preset.update' | 'preset.revert'
  | 'preset.rename' | 'preset.delete' | 'view.list' | 'view.graph';
/** Slice G3 (R123): what the reasons depend on. `file` is the presets file's state (§16.2); `stored` a listed preset is
 *  current (else Default). */
export type GraphStatus = { view: 'graph' | 'list'; stored: boolean; modified: boolean; file: 'missing' | 'ok' | 'newer' | 'unreadable' };

export type EditAction =
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'moveBlockUp' | 'moveBlockDown'
  | 'blockMenu' | 'selectBlock' | 'openOrToggle' | 'pastePlain' | 'saveNow' | 'embedObject' | 'openEmbed' | 'displayEmbedAs'
  | 'turnIntoTask' | 'turnIntoObject' | 'addMedia' | 'mindmapMap' | 'mindmapList' | 'mindmapLayoutRight' | 'mindmapLayoutSpider';

export type ShellContext = {
  vault: VaultInfo | null;
  types: TypeDefDto[];
  counts: Record<string, number>;
  actions?: ShellActions;
  /** The current route (3D: R13 commands depend on it); `param` is the type key or note path. */
  route?: { id: string; param?: string; key?: string; type?: string; date?: string; path?: string | null; review?: unknown; hasFrontmatter?: boolean } | null;
};

export type Command = {
  id: string;
  title: string;
  vars?: Record<string, string>;
  section: 'navigate' | 'create' | 'view' | 'vault' | 'app' | 'edit';
  shortcut?: string;
  due?: Due;
  /** 5A-2 (FR-CNV-01 AC-5): why the command can't run here now, or null; listed disabled with the reason. */
  disabled?: () => string | null;
  needsVault: boolean;
  run: (ctx: ShellContext) => void | Promise<void>;
};

const shortcutOf = (id: string) => SHORTCUTS.find((s) => s.command === id)?.keys;

/** Command ids of the R3 controls (D-130), in registry order. */
export const CONTROL_COMMANDS: Record<string, string> = {
  'ctl.newTab': 'nav.newTab',
  'ctl.copyBlockLink': 'edit.copyBlockLink',
  'ctl.filter': 'typePage.filter',
  'ctl.group': 'typePage.group',
  'ctl.addView': 'typePage.addView',
  'ctl.newTemplate': 'typeSettings.newTemplate',
  'ctl.editTemplate': 'typeSettings.editTemplate',
  'ctl.addViewSettings': 'typeSettings.addView',
  'ctl.editView': 'typeSettings.editView',
  'ctl.rowRecurrence': 'panel.editRecurrence',
  'ctl.font': 'settings.font',
  'ctl.fontSize': 'settings.fontSize',
  'ctl.accentColor': 'settings.accentColor',
  'settings.shortcuts.change': 'settings.changeShortcut',
  'tasks.sort': 'tasks.sort',
};

const NO_GOTO = new Set(['tags', 'tag/<key>', 'settings/backups', 'help/shortcuts', 'tasks', 'tasks/kanban', 'chooser', 'type/<type>', 'type-settings/<type>', 'note/<path>', 'new/<type>', 'broken-links', 'duplicate-titles', 'today', 'daily/YYYY-MM-DD', 'graph/<path>']);
const gotoKey = (id: string) => `cmd.goto.${id.replace(/^settings\//, 'settings.').replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;

export function commands(ctx: ShellContext): Command[] {
  const a = (ctx2: ShellContext) => ctx2.actions;
  const list: Command[] = [
    { id: 'app.palette', title: 'cmd.palette', section: 'app', shortcut: '⌘K', needsVault: false, run: (c) => a(c)?.openPalette() },
    { id: 'nav.back', title: 'cmd.goBack', section: 'navigate', shortcut: shortcutOf('nav.back'), needsVault: true, run: (c) => a(c)?.back() },
    { id: 'nav.forward', title: 'cmd.goForward', section: 'navigate', shortcut: shortcutOf('nav.forward'), needsVault: true, run: (c) => a(c)?.forward() },
    { id: 'object.new', title: 'cmd.newObject', section: 'create', shortcut: shortcutOf('object.new'), needsVault: true, run: (c) => a(c)?.newObject() },
    { id: 'help.shortcuts', title: 'cmd.keyboardShortcuts', section: 'app', shortcut: shortcutOf('help.shortcuts'), needsVault: false, run: (c) => a(c)?.go({ id: 'help/shortcuts' }) },
  ];
  for (const r of ROUTES) {
    if (NO_GOTO.has(r.id)) continue;
    const id = `goto.${r.id}`;
    list.push({ id, title: gotoKey(r.id), section: 'navigate', shortcut: shortcutOf(id), needsVault: r.id !== 'settings/appearance', run: (c) => (r.id === 'search' ? a(c)?.openSearch() : a(c)?.go({ id: r.id })) });
  }
  for (const e of typeEntries(ctx.types, ctx.counts)) {
    list.push({ id: `goto.type:${e.key}`, title: 'cmd.gotoType', vars: { plural: e.plural }, section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'type/<type>', param: e.key }) });
  }
  list.push(
    { id: 'view.toggleSidebar', title: 'cmd.toggleSidebar', section: 'view', shortcut: shortcutOf('view.toggleSidebar'), needsVault: true, run: (c) => a(c)?.toggleSidebar() },
    { id: 'view.toggleRightPanel', title: 'cmd.toggleRightPanel', section: 'view', shortcut: shortcutOf('view.toggleRightPanel'), needsVault: true, run: (c) => a(c)?.toggleRightPanel() },
    { id: 'view.toggleFocus', title: 'cmd.toggleFocus', section: 'view', shortcut: shortcutOf('view.toggleFocus'), needsVault: true, run: (c) => a(c)?.toggleFocus() },
    { id: 'note.toggleProperties', title: 'cmd.toggleProperties', section: 'view', needsVault: true, run: (c) => a(c)?.toggleProperties() },
    { id: 'note.toggleSource', title: 'cmd.toggleSource', section: 'view', shortcut: shortcutOf('note.toggleSource'), needsVault: true, run: (c) => a(c)?.toggleSource() },
    { id: 'vault.open', title: 'cmd.openVault', section: 'vault', needsVault: false, run: (c) => a(c)?.openChooser(false) },
    { id: 'vault.create', title: 'cmd.createVault', section: 'vault', needsVault: false, run: (c) => a(c)?.openChooser(true) },
    { id: 'vault.openFolder', title: 'cmd.openFolderAsVault', section: 'vault', needsVault: true, run: (c) => a(c)?.openFolder() },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): Command => ({ id: `vault.recent.${n}`, title: `cmd.openRecentVault${n}`, section: 'vault', shortcut: shortcutOf(`vault.recent.${n}`), needsVault: true, run: (c) => a(c)?.openRecent(n) })),
    { id: 'app.about', title: 'cmd.about', section: 'app', needsVault: false, run: (c) => a(c)?.about() },
    { id: 'theme.system', title: 'cmd.theme.system', section: 'app', needsVault: false, run: (c) => a(c)?.setTheme('system') },
    { id: 'theme.light', title: 'cmd.theme.light', section: 'app', needsVault: false, run: (c) => a(c)?.setTheme('light') },
    { id: 'theme.dark', title: 'cmd.theme.dark', section: 'app', needsVault: false, run: (c) => a(c)?.setTheme('dark') },
  );
  // Slice PW (page-width.md FR-UX-03 AC-17, AP-756): on note routes only, no shortcut.
  if (ctx.route?.id === 'note/<path>' || ctx.route?.id === 'daily/YYYY-MM-DD' || ctx.route?.id === 'new/<type>') {
    list.push(
      { id: 'note.width.normal', title: 'cmd.width.normal', section: 'view', needsVault: true, run: (c) => a(c)?.setPageWidth?.('normal') },
      { id: 'note.width.wide', title: 'cmd.width.wide', section: 'view', needsVault: true, run: (c) => a(c)?.setPageWidth?.('wide') },
    );
  }
  // 4C (ms4-jobs §10, FR-UX-03).
  list.push(
    { id: 'job.undoRename', title: 'cmd.undoRename', section: 'edit', needsVault: true, run: (c) => a(c)?.undoRename?.() },
    { id: 'job.showNotUpdated', title: 'cmd.showNotUpdated', section: 'view', needsVault: true, run: (c) => a(c)?.showNotUpdated?.() },
    // 4E-1 (R100, D-830): always listed; each runs only while a job of its kind is the last undoable one.
    { id: 'job.undo.typeChange', title: 'cmd.undoTypeChange', section: 'edit', needsVault: true, run: (c) => a(c)?.undoJob?.('type-move') },
    { id: 'job.undo.move', title: 'cmd.undoMove', section: 'edit', needsVault: true, run: (c) => a(c)?.undoJob?.('folder-move') },
    { id: 'job.undo.valueRemove', title: 'cmd.undoValueRemove', section: 'edit', needsVault: true, run: (c) => a(c)?.undoJob?.('value-remove') },
    { id: 'job.undo.typeDelete', title: 'cmd.undoTypeDelete', section: 'edit', needsVault: true, run: (c) => a(c)?.undoJob?.('type-delete') },
  );
  // R45 (tasks.md, D-234): no shortcuts. Page and card commands run on the Tasks page only; elsewhere they do nothing.
  const tc = (id: string) => (c: ShellContext) => a(c)?.taskCommand?.(id);
  list.push(
    { id: 'tasks.go', title: 'cmd.goto.tasks', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'tasks' }) },
    { id: 'tasks.schedule', title: 'cmd.tasks.schedule', section: 'view', needsVault: true, run: (c) => a(c)?.go({ id: 'tasks' }) },
    { id: 'tasks.kanban', title: 'cmd.tasks.kanban', section: 'view', needsVault: true, run: (c) => a(c)?.go({ id: 'tasks/kanban' }) },
    ...([
      ['tasks.groupStatus', 'cmd.tasks.groupStatus'], ['tasks.groupTag', 'cmd.tasks.groupTag'], ['tasks.filterAll', 'cmd.tasks.filterAll'],
      ['tasks.filterToday', 'cmd.tasks.filterToday'], ['tasks.filterWeek', 'cmd.tasks.filterWeek'], ['tasks.add', 'cmd.tasks.add'],
      ['task.complete', 'cmd.task.complete'], ['task.setStatus', 'cmd.task.setStatus'], ['task.moveNext', 'cmd.task.moveNext'], ['task.movePrevious', 'cmd.task.movePrevious'],
    ] as const).map(([id, title]): Command => ({ id, title, section: id.startsWith('tasks.add') ? 'create' : 'edit', needsVault: true, run: tc(id) })),
  );
  // 4D-lite (tags.md R87, D-234: no shortcuts): Tags, New tag and Backups everywhere; tag page commands run on
  // `tag/<key>` only (elsewhere they do nothing); Merge… on `duplicate-titles`.
  const onTag = (id: string) => (c: ShellContext) => (c.route?.id === 'tag/<key>' ? a(c)?.tagCommand?.(id) : undefined);
  list.push(
    { id: 'tags.go', title: 'cmd.tagsGo', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'tags' }) },
    { id: 'tags.new', title: 'cmd.tagsNew', section: 'create', needsVault: true, run: (c) => a(c)?.newTag?.() },
    { id: 'settings.backups', title: 'cmd.settingsBackups', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'settings/backups' }) },
  );
  if (ctx.route?.id === 'tag/<key>') {
    list.push(
      ...([
        ['tag.rename', 'cmd.tagRename', 'edit'], ['tag.delete', 'cmd.tagDelete', 'edit'], ['tag.colour', 'cmd.tagColour', 'edit'],
        ['tag.groupType', 'cmd.tagGroupType', 'view'], ['tag.groupNone', 'cmd.tagGroupNone', 'view'],
      ] as const).map(([id, title, section]): Command => ({ id, title, section, needsVault: true, run: onTag(id) })),
    );
  }
  if (ctx.route?.id === 'duplicate-titles') {
    list.push({ id: 'duplicates.merge', title: 'duplicates.merge', section: 'edit', needsVault: true, run: (c) => a(c)?.mergeFocused?.() });
  }
  // 5B (inbox.md R62): capture from the palette (D-578); Inbox commands on `inbox` (D-561); review on notes (D-562).
  list.push(
    { id: 'capture.quick', title: 'cmd.quickCapture', section: 'create', needsVault: true, run: (c) => a(c)?.capture?.('default') },
    { id: 'capture.task', title: 'cmd.captureTask', section: 'create', needsVault: true, run: (c) => a(c)?.capture?.('task') },
  );
  if (ctx.route?.id === 'inbox') {
    const ic = (id: string) => (c: ShellContext) => a(c)?.inboxCommand?.(id);
    list.push(
      ...([
        ['inbox.markReviewed', 'cmd.markReviewed'], ['inbox.markUnreviewed', 'cmd.markUnreviewed'], ['inbox.convert', 'cmd.inbox.convert'],
        ['inbox.append', 'cmd.inbox.append'], ['inbox.link', 'cmd.inbox.link'], ['inbox.tags', 'cmd.inbox.tags'],
        ['inbox.selectAll', 'cmd.inbox.selectAll'], ['inbox.clearSelection', 'cmd.inbox.clearSelection'],
        ['inbox.markAll', 'cmd.inbox.markAll'], ['inbox.showAll', 'cmd.inbox.showAll'],
      ] as const).map(([id, title]): Command => ({ id, title, section: 'edit', needsVault: true, run: ic(id) })),
    );
  }
  if (ctx.route?.id === 'note/<path>') {
    const key = (ctx.route.type ?? '').normalize('NFC');
    const typeReview = ctx.types.find((x) => x.key.normalize('NFC') === key)?.review;
    // D-591: the objects with the review toggle (before the note is read, the type decides).
    if (reviewable({ path: ctx.route.path ?? '', type: key, hasFrontmatter: ctx.route.hasFrontmatter ?? true, review: ctx.route.review, typeReview })) {
      list.push(
        { id: 'note.markReviewed', title: 'cmd.markReviewed', section: 'edit', needsVault: true, run: (c) => a(c)?.setNoteReviewed?.(true) },
        { id: 'note.markUnreviewed', title: 'cmd.markUnreviewed', section: 'edit', needsVault: true, run: (c) => a(c)?.setNoteReviewed?.(false) },
      );
    }
  }
  // Slice G1 (graph.md FR-UX-03 AC-20, D-918, D-987): ⌘⇧G on a route with an object file; the graph route's commands.
  const r = ctx.route;
  const hasObject = r?.id === 'note/<path>' || r?.id === 'graph/<path>' || ((r?.id === 'daily/YYYY-MM-DD' || r?.id === 'tag/<key>') && !!r.path);
  list.push({ id: 'graph.open', title: 'cmd.graph.open', section: 'navigate', shortcut: shortcutOf('graph.open'), needsVault: true,
    disabled: () => (hasObject ? null : t('cmd.needsObject')), run: (c) => a(c)?.openGraph?.() });
  if (r?.id === 'graph/<path>') {
    list.push(
      ...(['depth1', 'depth2', 'depth3', 'recenter'] as const).map((id): Command => ({ id: `graph.${id}`, title: `cmd.graph.${id}`, section: 'navigate', needsVault: true, run: (c) => a(c)?.graphCommand?.(id) })),
    );
    // Slice G3 (R123, AP-932): presets and the view; no shortcuts. Each lists its reason while it can't run.
    const st = () => a(ctx)?.graphStatus?.() ?? null;
    const fileReason = () => { const f = st()?.file; return f === 'unreadable' ? t('graph.preset.fixFile') : f === 'newer' ? t('graph.preset.newer') : null; };
    const defaultReason = () => (st()?.stored ? null : t('graph.preset.isDefault'));
    const modifiedReason = () => (st()?.modified ? null : t('graph.preset.notModified'));
    const preset = (id: 'apply' | 'save' | 'update' | 'revert' | 'rename' | 'delete', title: string, disabled: () => string | null): Command =>
      ({ id: `graph.preset.${id}`, title, section: 'navigate', needsVault: true, disabled, run: (c) => a(c)?.graphCommand?.(`preset.${id}`) });
    list.push(
      preset('apply', 'cmd.graph.applyPreset', () => null),
      preset('save', 'cmd.graph.savePreset', fileReason),
      preset('update', 'cmd.graph.updatePreset', () => fileReason() ?? defaultReason() ?? modifiedReason()),
      preset('revert', 'cmd.graph.revertPreset', modifiedReason),
      preset('rename', 'cmd.graph.renamePreset', () => fileReason() ?? defaultReason()),
      preset('delete', 'cmd.graph.deletePreset', () => fileReason() ?? defaultReason()),
    );
    // Listed only when it changes something (AP-932).
    if ((st()?.view ?? 'graph') === 'graph') list.push({ id: 'graph.view.list', title: 'cmd.graph.showList', section: 'navigate', needsVault: true, run: (c) => a(c)?.graphCommand?.('view.list') });
    else list.push({ id: 'graph.view.graph', title: 'cmd.graph.showGraph', section: 'navigate', needsVault: true, run: (c) => a(c)?.graphCommand?.('view.graph') });
  }
  // R16 (backlinks.md): no shortcuts (D-281).
  list.push(
    { id: 'goto.brokenLinks', title: 'commands.gotoBrokenLinks', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'broken-links' }) },
    { id: 'goto.duplicateTitles', title: 'commands.gotoDuplicateTitles', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'duplicate-titles' }) },
  );
  // R17 (daily-notes.md, D-329, D-330): Go to Today and Go to date… everywhere; the rest on daily routes only.
  list.push(
    { id: 'daily.today', title: 'cmd.goto.today', section: 'navigate', shortcut: shortcutOf('daily.today'), needsVault: true, run: (c) => a(c)?.go({ id: 'today' }) },
    { id: 'daily.pickDate', title: 'daily.goToDate', section: 'navigate', needsVault: true, run: (c) => a(c)?.pickDate?.() },
  );
  const dailyDate = ctx.route?.id === 'daily/YYYY-MM-DD' ? (ctx.route.date ?? ctx.route.param) : undefined;
  if (dailyDate) {
    const step = (n: number) => (c: ShellContext) => {
      const [y, m, d] = dailyDate.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + n));
      const iso = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
      a(c)?.go({ id: 'daily/YYYY-MM-DD', param: iso });
    };
    list.push(
      { id: 'daily.previous', title: 'daily.previous', section: 'navigate', shortcut: shortcutOf('daily.previous'), needsVault: true, run: step(-1) },
      { id: 'daily.next', title: 'daily.next', section: 'navigate', shortcut: shortcutOf('daily.next'), needsVault: true, run: step(1) },
      { id: 'daily.markReviewed', title: 'daily.markReviewed', section: 'edit', needsVault: true, run: (c) => a(c)?.setReviewed?.(true) },
      { id: 'daily.markUnreviewed', title: 'daily.markUnreviewed', section: 'edit', needsVault: true, run: (c) => a(c)?.setReviewed?.(false) },
    );
  }
  if (ctx.route?.id === 'note/<path>' || ctx.route?.id === 'new/<type>' || dailyDate) {
    list.push({ id: 'panel.backlinks', title: 'commands.showBacklinks', section: 'view', needsVault: true, run: (c) => a(c)?.showBacklinks?.() });
  }
  // R13 (types.md, ms3-shell §14.7.2): no shortcuts (D-234).
  const route = ctx.route ?? null;
  const routeKey = route ? (route.param ?? route.key ?? route.type ?? '').normalize('NFC') : '';
  const definedType = route?.id === 'type/<type>' ? ctx.types.find((x) => x.key.normalize('NFC') === routeKey) : undefined;
  list.push(
    { id: 'type.new', title: 'cmd.newType', section: 'create', needsVault: true, run: (c) => a(c)?.newType?.() },
    { id: 'vault.addStarterTypes', title: 'cmd.addStarterTypes', section: 'vault', needsVault: true, run: (c) => a(c)?.addStarterTypes?.() },
  );
  const onNote = route?.id === 'note/<path>' || route?.id === 'new/<type>' || route?.id === 'daily/YYYY-MM-DD';
  if (definedType || onNote) {
    list.push({ id: 'type.openSettings', title: 'cmd.openTypeSettings', section: 'navigate', needsVault: true, run: (c) => a(c)?.openTypeSettings?.() });
  }
  // FR-TSK-04 AC-17 (D-520): `New Task` from anywhere opens the Tasks page's quick-add row (on `type/task` the type's
  // own `New Task` is that command).
  if (!(definedType && definedType.key === 'task') && ctx.types.some((x) => x.key === 'task')) {
    list.push({ id: 'task.new', title: 'cmd.newOfType', vars: { name: ctx.types.find((x) => x.key === 'task')!.name }, section: 'create', needsVault: true, run: (c) => a(c)?.newObjectOfType?.('task') });
  }
  if (definedType) {
    const key = definedType.key;
    list.push({ id: 'type.newObject', title: 'cmd.newOfType', vars: { name: definedType.name }, section: 'create', needsVault: true, run: (c) => a(c)?.newObjectOfType?.(key) });
  }
  // 6A (trash-media.md R75): Move to trash (⌘⌫) wherever there is an object to trash; Add image or PDF… in an editor.
  list.push({ id: 'object.trash', title: 'cmd.trash', section: 'edit', shortcut: shortcutOf('object.trash'), needsVault: true, run: (c) => a(c)?.trashObject?.(),
    disabled: () => a(ctx)?.trashBlocked?.() ?? null });
  if (onNote) list.push({ id: 'media.add', title: 'cmd.mediaAdd', section: 'create', shortcut: shortcutOf('media.add'), needsVault: true, run: (c) => a(c)?.addMedia?.() });
  if (route?.id === 'trash') {
    list.push(
      { id: 'trash.restore', title: 'cmd.trashRestore', section: 'edit', needsVault: true, run: (c) => a(c)?.trashCommand?.('restore') },
      { id: 'trash.delete', title: 'cmd.trashDelete', section: 'edit', needsVault: true, run: (c) => a(c)?.trashCommand?.('delete') },
    );
  }
  if (onNote) {
    list.push(
      { id: 'note.changeType', title: 'cmd.changeType', section: 'edit', needsVault: true, run: (c) => a(c)?.changeType?.() },
      { id: 'note.editProperties', title: 'cmd.editProperties', section: 'edit', needsVault: true, run: (c) => a(c)?.editProperties?.() },
    );
  }
  const EDIT: [string, EditAction, string][] = [
    ['edit.undo', 'undo', 'cmd.edit.undo'], ['edit.redo', 'redo', 'cmd.edit.redo'], ['edit.bold', 'bold', 'cmd.edit.bold'],
    ['edit.italic', 'italic', 'cmd.edit.italic'], ['edit.strike', 'strike', 'cmd.edit.strike'], ['edit.code', 'code', 'cmd.edit.code'],
    ['edit.highlight', 'highlight', 'cmd.edit.highlight'], ['edit.link', 'link', 'cmd.edit.link'],
    ['edit.moveBlockUp', 'moveBlockUp', 'cmd.edit.moveBlockUp'], ['edit.moveBlockDown', 'moveBlockDown', 'cmd.edit.moveBlockDown'],
    ['edit.blockMenu', 'blockMenu', 'cmd.edit.blockMenu'], ['edit.selectBlock', 'selectBlock', 'cmd.edit.selectBlock'],
    ['edit.openOrToggle', 'openOrToggle', 'cmd.edit.openOrToggle'], ['edit.pastePlain', 'pastePlain', 'cmd.edit.pastePlain'],
    ['edit.saveNow', 'saveNow', 'cmd.edit.saveNow'],
    // 4F (R32, D-428): no shortcuts.
    ['edit.embedObject', 'embedObject', 'commands.embedObject'], ['edit.openEmbed', 'openEmbed', 'commands.openEmbed'],
    ['edit.displayEmbedAs', 'displayEmbedAs', 'commands.displayEmbedAs'],
    // 5A-2 (R53): ⇧⌘T, ⇧⌘O.
    ['edit.turnIntoTask', 'turnIntoTask', 'cmd.edit.turnIntoTask'], ['edit.turnIntoObject', 'turnIntoObject', 'cmd.edit.turnIntoObject'],
    // Slice MM (R94, D-770): no shortcuts.
    ['mindmap.showMap', 'mindmapMap', 'cmd.mindmap.showMap'], ['mindmap.showList', 'mindmapList', 'cmd.mindmap.showList'],
    // Slice MM2 (R97, D-792): the layout switch's commands, no shortcuts.
    ['mindmap.layoutRight', 'mindmapLayoutRight', 'cmd.mindmap.layoutRight'], ['mindmap.layoutSpider', 'mindmapLayoutSpider', 'cmd.mindmap.layoutSpider'],
  ];
  for (const [id, action, title] of EDIT) {
    const convert = action === 'turnIntoTask' || action === 'turnIntoObject';
    list.push({ id, title, section: 'edit', shortcut: shortcutOf(id), needsVault: true, run: (c) => a(c)?.edit?.(action),
      ...(convert && onNote ? { disabled: () => a(ctx)?.convertBlocked?.() ?? null } : {}) });
  }
  // Slice P (previews.md R106, D-928): ⌥Space acts only at a reference or a chip; the mode on every route with a vault.
  list.push(
    { id: 'preview.show', title: 'cmd.preview.show', section: 'navigate', shortcut: shortcutOf('preview.show'), needsVault: true, run: (c) => a(c)?.showPreview?.() },
    { id: 'preview.mode.click', title: 'cmd.preview.mode.click', section: 'view', needsVault: true, run: (c) => a(c)?.setPreviewMode?.('click') },
    { id: 'preview.mode.hover', title: 'cmd.preview.mode.hover', section: 'view', needsVault: true, run: (c) => a(c)?.setPreviewMode?.('hover') },
    { id: 'preview.mode.off', title: 'cmd.preview.mode.off', section: 'view', needsVault: true, run: (c) => a(c)?.setPreviewMode?.('off') },
    { id: 'link.edit', title: 'cmd.link.edit', section: 'edit', shortcut: '⇧⌘K', needsVault: true, run: (c) => a(c)?.editLink?.() }, // ⇧⌘K at a chip (R4's edit.link)
    { id: 'link.remove', title: 'linkField.remove', section: 'edit', needsVault: true, run: (c) => a(c)?.removeLink?.() },
  );
  for (const ctl of DISABLED_CONTROLS) {
    const id = CONTROL_COMMANDS[ctl.label];
    list.push({ id, title: ctl.label, section: 'app', shortcut: shortcutOf(id), due: ctl.due, needsVault: true, run: () => {} });
  }
  return list;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');

function inOrder(q: string, s: string): number | null {
  let i = 0;
  let gaps = 0;
  let last = -1;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      if (last >= 0) gaps += j - last - 1;
      last = j;
      i++;
    }
  }
  return i === q.length ? gaps : null;
}

/** Folded (case, diacritics, NFC/NFD) ranking: exact, prefix, word prefix, substring, then letters in order. */
export function rank<T extends { title: string }>(query: string, list: T[], text: (c: T) => string = (c) => c.title): T[] {
  const q = fold(query.trim());
  if (!q) return list;
  const scored: [number, number, number, T][] = [];
  list.forEach((c, idx) => {
    const s = fold(text(c));
    let tier = -1;
    let extra = 0;
    if (s === q) tier = 0;
    else if (s.startsWith(q)) tier = 1;
    else if (s.split(/[\s:]+/).some((w) => w.startsWith(q))) tier = 2;
    else if (s.includes(q)) tier = 3;
    else {
      const g = inOrder(q.replace(/\s+/g, ''), s.replace(/\s+/g, ''));
      if (g !== null) { tier = 4; extra = g; }
    }
    if (tier >= 0) scored.push([tier, extra, idx, c]);
  });
  scored.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  return scored.map((x) => x[3]);
}
