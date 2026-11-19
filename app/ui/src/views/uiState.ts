// Slice Q2: the views' machine-local state in `ui-state.json` (docs/contracts/v1-views.md §4.7, §1.10; D-1765,
// D-1767, D-1797; FR-STO-07, never in the vault): the remembered tab per type, the column widths per saved query and
// the folded lanes per board. The app owns the UI state and registers how to read and change it, so one writer keeps
// the whole state and each change is one `ui_state_set`.
import type { UiStateDto } from '../ipc/types';

type ViewsUi = Pick<UiStateDto, 'typeViews' | 'queryColumnWidths' | 'boardFolded'>;
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

/** The state after a query rename (§1.10): `queryColumnWidths[from]`, `boardFolded[from]` and every remembered tab
 *  `from` renamed to `to` (by name key); the same object when nothing names `from`. */
export function movedQueryState<U extends ViewsUi>(u: U, from: string, to: string): U {
  const key = (s: string) => nfc(s.trim()).toLowerCase();
  const f = key(from);
  const t = nfc(to);
  let changed = false;
  const rekey = <V,>(m: Record<string, V | undefined> | undefined): Record<string, V | undefined> | undefined => {
    if (!m) return m;
    const hit = Object.keys(m).find((k) => key(k) === f);
    if (hit === undefined) return m;
    changed = true;
    const out: Record<string, V | undefined> = {};
    for (const [k, v] of Object.entries(m)) out[k === hit ? t : k] = v;
    return out;
  };
  const widths = rekey(u.queryColumnWidths);
  const folded = rekey(u.boardFolded);
  let typeViews = u.typeViews;
  const tabs = u.typeViews?.lastTab;
  if (tabs && Object.values(tabs).some((v) => typeof v === 'string' && key(v) === f)) {
    changed = true;
    typeViews = { ...u.typeViews, lastTab: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, typeof v === 'string' && key(v) === f ? t : v])) };
  }
  if (!changed) return u;
  return { ...u, queryColumnWidths: widths, boardFolded: folded, typeViews } as U;
}

/** On the `query-rename` job's `done` and on its Undo (D-1797): one `ui_state_set` moving the machine-local keys. */
export function moveQueryState(from: string, to: string): void {
  if (!impl) return;
  const cur = impl.get();
  if (!cur || movedQueryState(cur, from, to) === cur) return;
  impl.update((u) => movedQueryState(u, from, to));
}
