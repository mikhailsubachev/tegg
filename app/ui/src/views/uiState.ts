// Slice Q2: the views' machine-local state in `ui-state.json` (docs/contracts/v1-views.md §4.7, §1.10; D-1765,
// D-1767, D-1797; FR-STO-07, never in the vault): the remembered tab per type, the column widths per saved query and
// the folded lanes per board; Q2.1 keys widths and folds by usage (R198). The app owns the UI state and registers how to read and change it, so one writer keeps
// the whole state and each change is one `ui_state_set`.
import type { UiStateDto } from '../ipc/types';
import { movedUsageState } from './usage';

type ViewsUi = Pick<UiStateDto, 'typeViews' | 'usageColumnWidths' | 'usageFolded' | 'tagFilter'>;
let impl: { get: () => ViewsUi | undefined; update: (f: <U extends ViewsUi>(u: U) => U) => void } | null = null;

export function registerViewsUiState(i: typeof impl): void {
  impl = i;
}

const nfc = (s: string) => s.normalize('NFC');

/** The remembered tab of `typeKey` (null: `All <plural>`, also when nothing is remembered). */
export function lastTab(typeKey: string): string | null {
  return impl?.get()?.typeViews?.lastTab?.[nfc(typeKey)] ?? null;
}

/** Q2-T (§29.1, D-1903): the remembered tab as stored: undefined when the type has no entry, null for `All <plural>`. */
export function lastTabOf(typeKey: string): string | null | undefined {
  const all = impl?.get()?.typeViews?.lastTab;
  const k = nfc(typeKey);
  return all && Object.prototype.hasOwnProperty.call(all, k) ? all[k] ?? null : undefined;
}

/** One `ui_state_set` per tab switch (FR-QRY-07 AC-13); nothing when the tab is already remembered. */
export function setLastTab(typeKey: string, name: string | null): void {
  const k = nfc(typeKey);
  const v = name === null ? null : nfc(name);
  // An absent entry differs from `null` (`All <plural>` chosen; Task's first open, D-1903).
  if (!impl || (lastTabOf(k) !== undefined && (impl.get()?.typeViews?.lastTab?.[k] ?? null) === v)) return;
  impl.update((u) => ({ ...u, typeViews: { ...(u.typeViews ?? {}), lastTab: { ...(u.typeViews?.lastTab ?? {}), [k]: v } } }));
}

/** The folded rows of a usage's horizontal board (lane ids; R198 `usageFolded[<usage key>]`, D-1845). Q2-T (§29.4):
 *  `!<lane id>` records that the user unfolded a lane whose initial fold is folded. */
export function foldedOf(usageKey: string): string[] {
  return [...(impl?.get()?.usageFolded?.[usageKey.normalize('NFC')] ?? [])];
}

/** One `ui_state_set` per fold toggle (R198); an empty list drops the usage's entry. `boardFolded` (0.4.0) stays. */
export function setFolded(usageKey: string, ids: string[]): void {
  if (!impl) return;
  const k = usageKey.normalize('NFC');
  impl.update((u) => {
    const all = { ...(u.usageFolded ?? {}) };
    if (ids.length) all[k] = ids; else delete all[k];
    return { ...u, usageFolded: all };
  });
}

/** On the `query-rename` job's `done` and on its Undo (D-1797, §19.3): one `ui_state_set` moving R198's usage keys and
 *  the remembered tabs of `from` to `to`; `queryColumnWidths` and `boardFolded` (0.4.0) stay untouched. */
export function moveQueryState(from: string, to: string): void {
  if (!impl) return;
  const cur = impl.get();
  if (!cur || movedUsageState(cur, from, to) === cur) return;
  impl.update((u) => movedUsageState(u, from, to));
}

// ---------------------------------------------------------------- slice Q2-T (v1-views §30.3; R206; D-1893)

/** The stored tag selection of a tab or `All <plural>` (`views/tagFilter.ts` `tagFilterKey`). */
export function tagFilterOf(key: string): string[] {
  return [...(impl?.get()?.tagFilter?.[nfc(key)] ?? [])];
}

/** One `ui_state_set` per change; `[]` deletes the key; nothing when unchanged. */
export function setTagFilter(key: string, tags: string[]): void {
  if (!impl) return;
  const k = nfc(key);
  const next = tags.map(nfc);
  const cur = impl.get()?.tagFilter?.[k] ?? [];
  if (cur.length === next.length && cur.every((x, i) => x === next[i])) return;
  impl.update((u) => {
    const all = { ...(u.tagFilter ?? {}) };
    if (next.length) all[k] = next; else delete all[k];
    return { ...u, tagFilter: all };
  });
}

type TasksUiLike = { view?: string; doneExpanded?: boolean } & Record<string, unknown>;
type AdoptUi = { tasks?: TasksUiLike | null; typeViews?: { lastTab?: Record<string, string | null | undefined> }; usageFolded?: Record<string, string[] | undefined> } & Record<string, unknown>;

/** AP-1538: the 5A Tasks page's state adopted once, when `ui.tasks` exists and `lastTab` has no `task` key: the last
 *  view → `lastTab.task` (`Schedule` / `Kanban` / null = All Tasks), Done expanded → `!done` on the Schedule tab;
 *  the grouping, date filter and tag selection are dropped; `ui.tasks` stays as it is. The same object otherwise. */
export function adoptTasksUi<U extends AdoptUi>(ui: U): U {
  const old = ui.tasks;
  if (!old || typeof old !== 'object') return ui;
  const tabs = ui.typeViews?.lastTab ?? {};
  if (Object.prototype.hasOwnProperty.call(tabs, 'task')) return ui;
  const tab = old.view === 'kanban' ? 'Kanban' : old.view === 'all' ? null : 'Schedule';
  const out: U = { ...ui, typeViews: { ...(ui.typeViews ?? {}), lastTab: { ...tabs, task: tab } } };
  if (old.doneExpanded === true) {
    const k = 'tab:task/schedule';
    const cur = ui.usageFolded?.[k] ?? [];
    out.usageFolded = { ...(ui.usageFolded ?? {}), [k]: cur.includes('!done') ? cur : [...cur, '!done'] };
  }
  return out;
}
