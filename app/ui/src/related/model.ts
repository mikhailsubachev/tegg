// The Related tab's pure model (slice REL, docs/contracts/v1-related.md §3.1; related.md R178, FR-LNK-15 AC-25, AC-26,
// AC-28, AC-31): the stored switch, the path to ask for, where the focus goes after a live update, and what a chip opens.
import type { RelatedEntryDto, UiStateDto } from '../ipc/types';

type WithRelated = Omit<UiStateDto, 'related'> & { related?: unknown };

/** FR-LNK-15 AC-25 (D-1695, D-634): only `showLinked === true` reads as on; missing or any other value is off. */
export function showLinkedOf(ui: WithRelated): boolean {
  const r = ui.related as { showLinked?: unknown } | null | undefined;
  return !!r && typeof r === 'object' && r.showLinked === true;
}

/** The UI state with the switch set to `on`; the `related` object keeps its other keys, the rest is unchanged. */
export function withShowLinked<U extends WithRelated>(ui: U, on: boolean): U {
  const old = ui.related && typeof ui.related === 'object' ? (ui.related as Record<string, unknown>) : {};
  return { ...ui, related: { ...old, showLinked: on } };
}

/** The NFC path the tab asks for on a route, or null (no request: `new/<type>`, a virtual day; FR-LNK-15 AC-24, AC-31).
 *  `dailyFile` is the file of a `daily/<date>` route's note, null while the day has none. */
export function centrePath(route: { id: string; param?: string } | null | undefined, dailyFile: string | null): string | null {
  if (!route) return null;
  if (route.id === 'note/<path>') return route.param ? route.param.normalize('NFC') : null;
  if (route.id === 'daily/YYYY-MM-DD') return dailyFile ? dailyFile.normalize('NFC') : null;
  return null;
}

/** Where the focus goes after a live update (§3.5, AP-1472): `keep` when the focused entry is still listed (or the
 *  focus isn't in the list), else the entry now at its former index, else the previous one, else the switch. */
export function focusAfter(prev: string[], focused: string | null, next: string[]): { path: string } | 'switch' | 'keep' {
  if (focused === null) return 'keep';
  const f = focused.normalize('NFC');
  const nfc = next.map((p) => p.normalize('NFC'));
  if (nfc.includes(f)) return 'keep';
  const at = prev.map((p) => p.normalize('NFC')).indexOf(f);
  if (at < 0) return 'keep';
  if (next.length === 0) return 'switch';
  if (at < next.length) return { path: next[at] };
  return { path: next[next.length - 1] };
}

/** What a chip opens (contract §9.20, the graph panel's rule): a Daily Note with an ISO-date title opens its day. */
export function openRouteOf(entry: Pick<RelatedEntryDto, 'path' | 'type' | 'title'>): string {
  if (entry.type === 'daily-note' && /^\d{4}-\d{2}-\d{2}$/.test(entry.title)) return `daily/${entry.title}`;
  return `note/${entry.path.normalize('NFC')}`;
}
