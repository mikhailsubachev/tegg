// Slice AND-2 (docs/contracts/android-phone.md §10; FR-UX-03 AC-54, AR-03 AC-13, D-2059): the command registry on the
// phone. The phone has no palette; every control still runs a registered command, and none of RA11's hidden commands
// is listed.
import type { Command, ShellContext } from '../shell/commands';

/** The frame's commands, new or kept (`goto.type:<key>` stands for each type entry). */
export const PHONE_FRAME_COMMANDS: readonly string[] = [
  'nav.back', 'object.new', 'phone.menu', 'phone.more', 'phone.properties', 'phone.sheet.close', 'note.toggleSource',
  'goto.inbox', 'goto.search', 'goto.conflicts', 'goto.settings', 'goto.settings/appearance', 'goto.settings/date-time',
  'goto.settings/vault', 'goto.settings/storage', 'daily.today', 'daily.previous', 'daily.next', 'daily.pickDate',
  'tasks.go', 'tags.go', 'queries.go', 'goto.type:<key>', 'vault.switch', 'vault.recent.1', 'vault.recent.2',
  'vault.recent.3', 'vault.recent.4', 'vault.recent.5', 'vault.recent.6', 'vault.recent.7', 'vault.recent.8',
  'vault.recent.9', 'vault.openFolder', 'vault.create', 'app.logoMenu', 'theme.system', 'theme.light', 'theme.dark',
  'mindmap.showMap', 'mindmap.showList', 'mindmap.zoomIn', 'mindmap.zoomOut', 'mindmap.fit', 'mindmap.fullScreen',
  'mindmap.closeFullScreen', 'android.openSettings',
];

/** RA11: commands not listed on the phone (exact ids; an entry ending in `*` is a prefix). */
export const PHONE_HIDDEN_COMMANDS: readonly string[] = [
  'app.palette', 'help.shortcuts', 'nav.forward', 'view.toggleSidebar', 'view.toggleRightPanel', 'view.toggleFocus',
  'note.toggleProperties', 'note.width.*', 'edit.*', 'editor.insertQuery', 'mindmap.layoutRight', 'mindmap.layoutSpider',
  'preview.*', 'link.edit', 'link.remove', 'outline.*', 'panel.*', 'related.toggleLinked', 'graph.*', 'sidebar.pin',
  'sidebar.unpin', 'sidebar.pinned.moveUp', 'sidebar.pinned.moveDown', 'tags.new', 'tag.*', 'queries.new', 'query.edit',
  'query.rename', 'query.trash', 'query.saveAs', 'query.columns', 'views.new', 'views.menu', 'views.remove', 'views.edit',
  'views.moveLeft', 'views.moveRight', 'board.*', 'sort.*', 'columns.*', 'typePage.*', 'type.*', 'task.*',
  'tasks.schedule', 'tasks.kanban', 'tasks.search', 'types.restoreDefaultViews', 'note.markReviewed',
  'note.markUnreviewed', 'daily.markReviewed', 'daily.markUnreviewed', 'note.changeType', 'note.editProperties',
  'object.trash', 'media.add', 'trash.*', 'goto.trash', 'goto.brokenLinks', 'goto.duplicateTitles',
  'goto.settings/shortcuts', 'goto.settings/menu-bar', 'goto.settings/trash-history', 'goto.settings/previews',
  'settings.backups', 'job.*', 'capture.*', 'import.open', 'inbox.*', 'duplicates.merge', 'vault.open',
  'vault.addStarterTypes', 'app.about', 'nav.newTab', 'edit.copyBlockLink', 'typeSettings.*', 'panel.editRecurrence',
  'settings.font', 'settings.fontSize', 'settings.accentColor', 'settings.changeShortcut',
];

/** Exceptions inside hidden prefixes: `inbox.open` and the board's folds stay (§10). */
export function phoneHidden(id: string): boolean {
  if (id === 'inbox.open' || /^board\..*(fold|collapse|expand)/i.test(id)) return false;
  return PHONE_HIDDEN_COMMANDS.some((h) => (h.endsWith('*') ? id.startsWith(h.slice(0, -1)) : id === h));
}

/** Routes whose `goto.*` command the phone never lists: not offered (§7) or the desktop's right-panel tabs. */
const NO_PHONE_GOTO = new Set(['goto.backlinks', 'goto.related', 'goto.graph', 'goto.embed-image', 'goto.chooser', 'goto.home']);

const a = (c: ShellContext) => c.actions;

/** The phone's own commands (§10), run through `actions.phone(id)` or the shared actions. */
function own(ctx: ShellContext): Command[] {
  const p = (id: string) => (c: ShellContext) => a(c)?.phone?.(id);
  const route = ctx.route?.id;
  const list: Command[] = [
    { id: 'phone.menu', title: 'cmd.phone.menu', section: 'navigate', needsVault: true, run: p('phone.menu') },
    { id: 'phone.sheet.close', title: 'cmd.phone.closeSheet', section: 'view', needsVault: true, run: p('phone.sheet.close') },
    // The drawer's Pinned header and rows (§10: kept page controls).
    { id: 'sidebar.pinned.toggle', title: 'pinned.section', section: 'view', needsVault: true, run: p('sidebar.pinned.toggle') },
    { id: 'sidebar.pinned.open', title: 'pinned.section', section: 'navigate', needsVault: true, run: p('sidebar.pinned.open') },
    { id: 'goto.settings', title: 'cmd.goto.settings', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'settings' }) },
    { id: 'goto.settings/storage', title: 'cmd.goto.settings.storage', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'settings/storage' }) },
    { id: 'vault.switch', title: 'cmd.switchVault', section: 'vault', needsVault: true, run: p('vault.switch') },
    { id: 'app.logoMenu', title: 'cmd.logoMenu', section: 'app', needsVault: false, run: p('app.logoMenu') },
    { id: 'android.openSettings', title: 'cmd.android.openSettings', section: 'app', needsVault: false, run: p('android.openSettings') },
    // The read view's Map / List switch: the desktop's commands act on the editor (PHONE_REPLACES).
    { id: 'mindmap.showMap', title: 'cmd.mindmap.showMap', section: 'view', needsVault: true, run: p('mindmap.showMap') },
    { id: 'mindmap.showList', title: 'cmd.mindmap.showList', section: 'view', needsVault: true, run: p('mindmap.showList') },
    { id: 'mindmap.zoomIn', title: 'cmd.mindmap.zoomIn', section: 'view', needsVault: true, run: p('mindmap.zoomIn') },
    { id: 'mindmap.zoomOut', title: 'cmd.mindmap.zoomOut', section: 'view', needsVault: true, run: p('mindmap.zoomOut') },
    { id: 'mindmap.fit', title: 'cmd.mindmap.fit', section: 'view', needsVault: true, run: p('mindmap.fit') },
    { id: 'mindmap.fullScreen', title: 'cmd.mindmap.fullScreen', section: 'view', needsVault: true, run: p('mindmap.fullScreen') },
    { id: 'mindmap.closeFullScreen', title: 'cmd.mindmap.closeFullScreen', section: 'view', needsVault: true, run: p('mindmap.closeFullScreen') },
    // Kept page controls (§10, FR-UX-03 AC-54): All tags' sort, the tag page's breadcrumb, sort and grouping, Search's
    // Type filter; each runs the control it is on.
    { id: 'tagsPage.c4', title: 'tag.sortMenu', section: 'view', needsVault: true, run: p('tagsPage.c4') },
    { id: 'tagPage.c12', title: 'tag.breadcrumbAll', section: 'navigate', needsVault: true, run: p('tagPage.c12') },
    { id: 'tagPage.c6', title: 'tag.sortMenu', section: 'view', needsVault: true, run: p('tagPage.c6') },
    { id: 'tagPage.c5', title: 'tag.noGrouping', section: 'view', needsVault: true, run: p('tagPage.c5') },
    { id: 'search.type', title: 'search.typeLabel', section: 'view', needsVault: true, run: p('search.type') },
  ];
  if (route === 'note/<path>' || route === 'daily/YYYY-MM-DD' || route === 'today') {
    list.push(
      { id: 'phone.more', title: 'cmd.phone.more', section: 'view', needsVault: true, run: p('phone.more') },
      { id: 'phone.properties', title: 'cmd.phone.properties', section: 'view', needsVault: true, run: p('phone.properties') },
    );
  }
  return list;
}

/** The desktop list minus the hidden commands and routes not offered, plus the phone's own commands. */
/** Desktop commands whose action needs the editor, which the phone's read view doesn't have: the phone's own command of
 *  the same id (its control's tap) replaces them (FR-UX-03 AC-54, D-2101; QA review of AND-2). */
const PHONE_REPLACES = new Set(['mindmap.showMap', 'mindmap.showList']);

export function phoneCommands(list: readonly Command[], ctx: ShellContext = { vault: null, types: [], counts: {} }): Command[] {
  const kept = list.filter((c) => !phoneHidden(c.id) && !NO_PHONE_GOTO.has(c.id) && !PHONE_REPLACES.has(c.id));
  const ids = new Set(kept.map((c) => c.id));
  const out = [...kept];
  for (const c of own(ctx)) if (!ids.has(c.id)) out.push(c);
  // `object.new` stays listed but does nothing until AND-3 (D-2055).
  return out.map((c) => (c.id === 'object.new' ? { ...c, run: () => undefined, disabled: () => 'phone.newLater' } : c));
}
