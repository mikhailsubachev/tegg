// Slice Q2: the views' machine-local state in `ui-state.json` (docs/contracts/v1-views.md §4.7, §1.10; D-1765,
// D-1767, D-1797; FR-STO-07, never in the vault): the remembered tab per type, the column widths per saved query and
// the folded lanes per board; Q2.1 keys widths and folds by usage (R198). The app owns the UI state and registers how to read and change it, so one writer keeps
// the whole state and each change is one `ui_state_set`.
import type { UiStateDto } from '../ipc/types';
import { movedUsageState } from './usage';

type ViewsUi = Pick<UiStateDto, 'typeViews' | 'usageColumnWidths' | 'usageFolded'>;
let impl: { get: () => ViewsUi | undefined; update: (f: <U extends ViewsUi>(u: U) => U) => void } | null = null;

export function registerViewsUiState(i: typeof impl): void {
  impl = i;
}

const nfc = (s: string) => s.normalize('NFC');

/** The remembered tab of `typeKey` (null: `All <plural>`, also when nothing is remembered). */
export function lastTab(typeKey: string): string | null {
  return impl?.get()?.typeViews?.lastTab?.[nfc(typeKey)] ?? null;
}

/** One `ui_state_set` per tab switch (FR-QRY-07 AC-13); nothing when the tab is already remembered. */
export function setLastTab(typeKey: string, name: string | null): void {
  const k = nfc(typeKey);
  const v = name === null ? null : nfc(name);
  if (!impl || (impl.get()?.typeViews?.lastTab?.[k] ?? null) === v) return;
  impl.update((u) => ({ ...u, typeViews: { ...(u.typeViews ?? {}), lastTab: { ...(u.typeViews?.lastTab ?? {}), [k]: v } } }));
}

/** The folded rows of a usage's horizontal board (lane ids; R198 `usageFolded[<usage key>]`, D-1845). */
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
