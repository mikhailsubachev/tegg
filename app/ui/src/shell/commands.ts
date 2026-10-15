// The command registry (FR-UX-03, docs/contracts/ms3-shell.md §3.3, §10). Every action of the frame is a command;
// controls reference theirs with `data-command`, and one key handler runs them by shortcut.
import type { TypeDefDto, VaultInfo } from '../ipc/types';
import { DISABLED_CONTROLS, ROUTES, SHORTCUTS, type Due } from './registry';
import type { Route } from './routes';
import { typeEntries } from './types';

export type ThemeChoice = 'system' | 'light' | 'dark';

export type ShellActions = {
  go: (r: Route) => void;
  openPalette: () => void;
  openSwitcher: () => void;
  newObject: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  toggleFocus: () => void;
  toggleSource: () => void;
  back: () => void;
  forward: () => void;
  toggleProperties: () => void;
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
  // 3D (R13, ms3-shell §14.7.2).
  newType?: () => void;
  openTypeSettings?: () => void;
  newObjectOfType?: (key: string) => void;
  changeType?: () => void;
  editProperties?: () => void;
  addStarterTypes?: () => void;
  /** 4A (R16): opens the Context panel on Backlinks and focuses its first entry. */
  showBacklinks?: () => void;
};

export type EditAction =
  | 'undo' | 'redo' | 'bold' | 'italic' | 'strike' | 'code' | 'highlight' | 'link' | 'moveBlockUp' | 'moveBlockDown'
  | 'blockMenu' | 'selectBlock' | 'openOrToggle' | 'pastePlain' | 'saveNow';

export type ShellContext = {
  vault: VaultInfo | null;
  types: TypeDefDto[];
  counts: Record<string, number>;
  actions?: ShellActions;
  /** The current route (3D: R13 commands depend on it); `param` is the type key or note path. */
  route?: { id: string; param?: string; key?: string; type?: string } | null;
};

export type Command = {
  id: string;
  title: string;
  vars?: Record<string, string>;
  section: 'navigate' | 'create' | 'view' | 'vault' | 'app' | 'edit';
  shortcut?: string;
  due?: Due;
  needsVault: boolean;
  run: (ctx: ShellContext) => void | Promise<void>;
};

const shortcutOf = (id: string) => SHORTCUTS.find((s) => s.command === id)?.keys;

/** Command ids of the R3 controls (D-130), in registry order. */
export const CONTROL_COMMANDS: Record<string, string> = {
  'ctl.newTab': 'nav.newTab',
  'ctl.turnIntoObject': 'edit.turnIntoObject',
  'ctl.copyBlockLink': 'edit.copyBlockLink',
  'ctl.filter': 'typePage.filter',
  'ctl.group': 'typePage.group',
  'ctl.addView': 'typePage.addView',
  'ctl.moveExisting': 'typeSettings.moveExisting',
  'ctl.renameKeys': 'typeSettings.renameKey',
  'ctl.removeValues': 'typeSettings.removeValues',
  'ctl.changeTheirType': 'typeSettings.changeTheirType',
  'ctl.trashObjects': 'typeSettings.trashObjects',
  'ctl.newTemplate': 'typeSettings.newTemplate',
  'ctl.editTemplate': 'typeSettings.editTemplate',
  'ctl.addViewSettings': 'typeSettings.addView',
  'ctl.editView': 'typeSettings.editView',
  'ctl.rowFile': 'panel.editFile',
  'ctl.rowColor': 'panel.editColor',
  'ctl.rowRecurrence': 'panel.editRecurrence',
  'ctl.font': 'settings.font',
  'ctl.fontSize': 'settings.fontSize',
  'ctl.editorWidth': 'settings.editorWidth',
  'ctl.accentColor': 'settings.accentColor',
  'ctl.typePicker': 'object.typePicker',
  'ctl.typePickerLink': 'createLink.typePicker',
  'duplicates.merge': 'duplicates.merge',
  'backlinks.unlinked': 'panel.unlinkedMentions',
};

const NO_GOTO = new Set(['chooser', 'type/<type>', 'type-settings/<type>', 'note/<path>', 'broken-links', 'duplicate-titles']);
const gotoKey = (id: string) => `cmd.goto.${id.replace(/^settings\//, 'settings.').replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;

export function commands(ctx: ShellContext): Command[] {
  const a = (ctx2: ShellContext) => ctx2.actions;
  const list: Command[] = [
    { id: 'app.palette', title: 'cmd.palette', section: 'app', shortcut: '⌘K', needsVault: false, run: (c) => a(c)?.openPalette() },
    { id: 'app.switcher', title: 'cmd.switcher', section: 'navigate', shortcut: shortcutOf('app.switcher'), needsVault: true, run: (c) => a(c)?.openSwitcher() },
    { id: 'nav.back', title: 'cmd.goBack', section: 'navigate', shortcut: shortcutOf('nav.back'), needsVault: true, run: (c) => a(c)?.back() },
    { id: 'nav.forward', title: 'cmd.goForward', section: 'navigate', shortcut: shortcutOf('nav.forward'), needsVault: true, run: (c) => a(c)?.forward() },
    { id: 'object.new', title: 'cmd.newObject', section: 'create', shortcut: shortcutOf('object.new'), needsVault: true, run: (c) => a(c)?.newObject() },
  ];
  for (const r of ROUTES) {
    if (NO_GOTO.has(r.id)) continue;
    const id = `goto.${r.id}`;
    list.push({ id, title: gotoKey(r.id), section: 'navigate', shortcut: shortcutOf(id), needsVault: r.id !== 'settings/appearance', run: (c) => a(c)?.go({ id: r.id }) });
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
  // R16 (backlinks.md): no shortcuts (D-281).
  list.push(
    { id: 'goto.brokenLinks', title: 'commands.gotoBrokenLinks', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'broken-links' }) },
    { id: 'goto.duplicateTitles', title: 'commands.gotoDuplicateTitles', section: 'navigate', needsVault: true, run: (c) => a(c)?.go({ id: 'duplicate-titles' }) },
  );
  if (ctx.route?.id === 'note/<path>') {
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
  if (definedType || route?.id === 'note/<path>') {
    list.push({ id: 'type.openSettings', title: 'cmd.openTypeSettings', section: 'navigate', needsVault: true, run: (c) => a(c)?.openTypeSettings?.() });
  }
  if (definedType) {
    const key = definedType.key;
    list.push({ id: 'type.newObject', title: 'cmd.newOfType', vars: { name: definedType.name }, section: 'create', needsVault: true, run: (c) => a(c)?.newObjectOfType?.(key) });
  }
  if (route?.id === 'note/<path>') {
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
  ];
  for (const [id, action, title] of EDIT) {
    list.push({ id, title, section: 'edit', shortcut: shortcutOf(id), needsVault: true, run: (c) => a(c)?.edit?.(action) });
  }
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
