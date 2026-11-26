// Slice AND-2 (docs/contracts/android-phone.md §10; FR-UX-03 AC-58, AR-03 AC-13, D-2405): the command registry on the
// phone. The phone has no palette; every control still runs a registered command, and none of RA11's hidden commands
// is listed.
import type { Command, ShellContext } from '../shell/commands';
import { pageCommandIds } from './contentCommands';

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
  'preview.*', 'link.edit', 'link.remove', 'outline.*', 'panel.*', 'related.toggleLinked', 'graph.*',
  'sidebar.pinned.moveUp', 'sidebar.pinned.moveDown', 'tags.new', 'tag.*', 'queries.new', 'query.edit',
  'query.rename', 'query.trash', 'query.saveAs', 'query.columns', 'views.new', 'views.menu', 'views.remove', 'views.edit',
  'views.moveLeft', 'views.moveRight', 'board.*', 'sort.*', 'columns.*', 'typePage.*', 'type.*', 'task.*',
  'tasks.schedule', 'tasks.kanban', 'tasks.search', 'types.restoreDefaultViews', 'note.changeType', 'note.editProperties',
  'media.add', 'trash.*', 'goto.trash', 'goto.brokenLinks', 'goto.duplicateTitles',
  'goto.settings/shortcuts', 'goto.settings/menu-bar', 'goto.settings/trash-history', 'goto.settings/previews',
  'settings.backups', 'job.*', 'capture.*', 'import.open', 'inbox.*', 'duplicates.merge', 'vault.open',
  'vault.addStarterTypes', 'app.about', 'nav.newTab', 'edit.copyBlockLink', 'typeSettings.*', 'panel.editRecurrence',
  'settings.font', 'settings.fontSize', 'settings.accentColor', 'settings.changeShortcut',
  // Slice OC's card command that opens type settings, a route the phone doesn't offer (D-2480).
  'card.edit',
  // Slice MM3: no folds on the phone (D-2622, D-2655).
  'mindmap.toggleFold', 'mindmap.addChild',
];

/** Slice AND-3 (android-edit §13.2): the editing commands the phone shows inside hidden prefixes, with their `:` forms. */
const PHONE_EDIT = ['task.complete', 'edit.undo', 'edit.redo', 'edit.bold', 'edit.italic', 'edit.link', 'edit.blockType', 'edit.tag', 'edit.bulletList', 'edit.checklist', 'edit.indent', 'edit.outdent'];

/** Exceptions inside hidden prefixes: `inbox.open`, the board's folds (§10) and AND-3's editing commands stay. */
export function phoneHidden(id: string): boolean {
  if (id === 'inbox.open' || /^board\..*(fold|collapse|expand)/i.test(id)) return false;
  if (PHONE_EDIT.some((e) => id === e || id.startsWith(`${e}:`))) return false;
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
    // Kept page controls (§10, FR-UX-03 AC-58): All tags' sort, the tag page's breadcrumb, sort and grouping, Search's
    // Type filter; each runs the control it is on.
    { id: 'tagsPage.c4', title: 'tag.sortMenu', section: 'view', needsVault: true, run: p('tagsPage.c4') },
    { id: 'tagPage.c12', title: 'tag.breadcrumbAll', section: 'navigate', needsVault: true, run: p('tagPage.c12') },
    { id: 'tagPage.c6', title: 'tag.sortMenu', section: 'view', needsVault: true, run: p('tagPage.c6') },
    { id: 'tagPage.c5', title: 'tag.noGrouping', section: 'view', needsVault: true, run: p('tagPage.c5') },
    { id: 'search.type', title: 'search.typeLabel', section: 'view', needsVault: true, run: p('search.type') },
  ];
  // D-2474, D-2475: the page-local commands the shown page's controls carry (content folds and embeds, board cards,
  // lane folds, view tabs), each running its control's tap.
  const titles: Record<string, string> = {
    // Slice AND-3 (android-edit §13.3).
    'task.complete:': 'cmd.task.complete', 'note.markReviewed': 'cmd.markReviewed', 'note.markUnreviewed': 'cmd.markUnreviewed',
    'daily.markReviewed': 'cmd.markReviewed', 'daily.markUnreviewed': 'cmd.markUnreviewed', 'phone.prop': 'cmd.phone.editProperty',
    'edit.blockType': 'cmd.edit.blockType', 'edit.tag': 'cmd.edit.tag', 'edit.bulletList': 'cmd.edit.bulletList', 'edit.checklist': 'cmd.edit.checklist',
    'edit.indent': 'cmd.edit.indent', 'edit.outdent': 'cmd.edit.outdent', 'edit.bold': 'toolbar.bold', 'edit.italic': 'toolbar.italic', 'edit.link': 'toolbar.link',
    'edit.undo': 'phone.edit.undo', 'edit.redo': 'phone.edit.redo', 'phone.link.remove': 'linkField.remove', 'phone.merge.compare': 'merge.compare',
    'phone.merge.keepMine': 'merge.keepMine', 'phone.merge.keepTheirs': 'merge.keepTheirs', 'phone.merge.keepBoth': 'merge.keepBoth',
    'phone.deleted.restore': 'deleted.restore', 'phone.deleted.discard': 'deleted.discard', 'phone.offer.create': 'createLink.title',
    'phone.conflict.keep:': 'phone.keepThis', 'phone.conflict.merge': 'conflicts.merge', 'phone.conflict.newId': 'conflicts.newId',
    'phone.conflict.confirm': 'conflicts.move', 'phone.conflict.cancel': 'conflicts.cancel', 'phone.conflictMerge.done': 'conflicts.done',
    'phone.conflictMerge.cancel': 'conflicts.cancel', 'phone.notice.undo': 'save.undo',
    'read.fold:': 'cmd.phone.fold', 'read.openEmbed:': 'cmd.phone.openEmbed', 'board.openCard:': 'cmd.phone.openCard', 'board.openSource:': 'cmd.phone.openSource', 'views.tab:': 'cmd.phone.viewTab', 'board.toggleLane': 'cmd.phone.foldLane' };
  const known = new Set(list.map((c) => c.id));
  for (const id of pageCommandIds()) {
    if (known.has(id)) continue;
    const title = Object.entries(titles).find(([k]) => id.startsWith(k))?.[1] ?? 'cmd.phone.more';
    list.push({ id, title, section: 'view', needsVault: true, run: p(id) });
  }
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
 *  the same id (its control's tap) replaces them (FR-UX-03 AC-58, D-2447; QA review of AND-2). */
const PHONE_REPLACES = new Set(['mindmap.showMap', 'mindmap.showList']);

export function phoneCommands(list: readonly Command[], ctx: ShellContext = { vault: null, types: [], counts: {} }): Command[] {
  const kept = list.filter((c) => !phoneHidden(c.id) && !NO_PHONE_GOTO.has(c.id) && !PHONE_REPLACES.has(c.id));
  const ids = new Set(kept.map((c) => c.id));
  const out = [...kept];
  for (const c of own(ctx)) if (!ids.has(c.id)) out.push(c);
  return out;
}

/** Slice AND-3 (android-edit §4.4; FR-EDT-03 AC-6, D-2505): the slash items the phone offers. */
export const PHONE_SLASH: readonly string[] = ['text', 'heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'checklist', 'quote', 'callout', 'codeBlock', 'divider'];

/** `PHONE_SLASH`'s ids in `items`' order. */
export function phoneSlashItems<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter((i) => PHONE_SLASH.includes(i.id));
}
