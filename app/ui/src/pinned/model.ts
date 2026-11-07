// Slice PIN (docs/contracts/v1-pinned.md §3.1): the pure part of the Pinned section. How a row is drawn and what a click
// does (R133), which pin a target is (NFC, D-1382), what the current route can pin (D-1382), whether pins can be edited
// (FR-HOM-02 AC-22, AC-23), where a drop lands (R135) and where ⌥⌘↑ / ⌥⌘↓ move a row.
import { t } from '../i18n/catalog';
import type { Route } from '../shell/routes';
import type { PinRequestDto, PinRowDto, PinsDto } from '../ipc/pins';

/** The fields of a Types list entry the rows use (ms3-shell §3 `typeEntries`). */
export type PinTypeEntry = { key: string; name: string; plural: string; icon?: string | null; color?: string | null };
/** A tag's display name and colour, as tags/store.ts gives them. */
export type PinTagLook = (key: string) => { name: string; color: string | null };

export type RowView = {
  label: string; icon: string; color: string | null; description: string; tooltip: string;
  route: Route | null;
  /** What a click or ⏎ does: open the route, open the Trash, show the missing alert, or nothing (pending). */
  opens: 'route' | 'trash' | 'alert' | 'none';
  /** Drawn muted (pending, trashed, missing). */
  muted: boolean;
};

const nfc = (s: string) => s.normalize('NFC');
const stem = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
export const tagKey = (s: string) => nfc(s.trim()).replace(/^#/, '').toLowerCase();

export function rowView(row: PinRowDto, types: PinTypeEntry[], tagLook: PinTagLook): RowView {
  const entry = (key: string | null) => (key ? types.find((e) => nfc(e.key) === nfc(key)) : undefined);
  const state = row.state;
  const tail = (kind: string | null, st: string | null) => [kind, st].filter(Boolean).join(', ');
  if (row.target.kind === 'tag') {
    const key = row.target.key;
    const look = tagLook(key);
    const label = `#${state === 'ok' ? look.name : key}`;
    const st = state === 'pending' ? t('pinned.state.pending') : state === 'noObjects' ? t('pinned.state.empty') : null;
    return {
      label, icon: entry('tag')?.icon ?? 'hash', color: look.color, description: tail(t('pinned.kind.tag'), st), tooltip: label,
      route: state === 'pending' ? null : { id: 'tag/<key>', param: key }, opens: state === 'pending' ? 'none' : 'route', muted: state === 'pending',
    };
  }
  if (row.target.kind === 'type') {
    const key = row.target.key;
    const e = entry(key);
    if (state === 'ok' && e) {
      return { label: e.plural, icon: e.icon ?? 'type', color: e.color ?? null, description: t('pinned.kind.type'), tooltip: e.plural, route: { id: 'type/<type>', param: key }, opens: 'route', muted: false };
    }
    const st = state === 'pending' ? 'pinned.state.pending' : 'pinned.state.missing';
    return { label: key, icon: 'type', color: null, description: tail(t('pinned.kind.type'), t(st)), tooltip: key, route: null, opens: state === 'pending' ? 'none' : 'alert', muted: true };
  }
  // An object.
  const stored = row.target.path ?? row.path ?? '';
  if (state === 'ok' || state === 'trashed') {
    const e = entry(row.type ?? 'page');
    const label = row.title ?? stem(row.path ?? stored);
    const shownPath = state === 'ok' ? row.path ?? stored : stored || (row.path ?? '').replace(/^\.trash\//, '');
    const route: Route = state === 'trashed' ? { id: 'trash' }
      : row.date ? { id: 'daily/YYYY-MM-DD', param: row.date }
        : { id: 'note/<path>', param: row.path ?? stored };
    return {
      label, icon: e?.icon ?? 'file', color: state === 'ok' ? e?.color ?? null : null,
      description: tail(e?.name ?? null, state === 'trashed' ? t('pinned.state.trashed') : null),
      tooltip: `${label}\n${shownPath}`, route, opens: state === 'trashed' ? 'trash' : 'route', muted: state === 'trashed',
    };
  }
  const label = stem(stored);
  return {
    label, icon: 'file', color: null, description: t(state === 'pending' ? 'pinned.state.pending' : 'pinned.state.missing'),
    tooltip: `${label}\n${stored}`, route: null, opens: state === 'pending' ? 'none' : 'alert', muted: true,
  };
}

/** The listed index of the pin of `target`, or null (NFC; a Tag object is pinned as its tag, D-1382). */
export function findPin(pins: PinsDto | null, target: PinRequestDto | null): number | null {
  if (!pins || !target) return null;
  const want: PinRequestDto = target.kind === 'object' && /^Tags\//.test(nfc(target.path))
    ? { kind: 'tag', key: tagKey(stem(target.path)) } : target;
  for (const r of pins.rows) {
    const s = r.target;
    if (want.kind === 'object' && s.kind === 'object') {
      const p = nfc(want.path);
      if ((r.path && nfc(r.path) === p) || (s.path && nfc(s.path) === p)) return r.index;
    } else if (want.kind === 'tag' && s.kind === 'tag') {
      if (tagKey(s.key) === tagKey(want.key)) return r.index;
    } else if (want.kind === 'type' && s.kind === 'type') {
      if (nfc(s.key) === nfc(want.key)) return r.index;
    }
  }
  return null;
}

/** What the route can pin (D-1382): an object with a file, a tag, a type page; `unsaved` for `new/<type>` and a virtual
 *  daily note; null where nothing can be pinned. */
export function targetOfRoute(route: (Route & { path?: string | null; date?: string }) | null | undefined): PinRequestDto | 'unsaved' | null {
  if (!route) return null;
  switch (route.id) {
    case 'note/<path>': { const p = route.path ?? route.param; return p ? { kind: 'object', path: nfc(p) } : null; }
    case 'daily/YYYY-MM-DD': return route.path ? { kind: 'object', path: nfc(route.path) } : 'unsaved';
    case 'tag/<key>': return route.param ? { kind: 'tag', key: route.param } : null;
    case 'type/<type>': return route.param ? { kind: 'type', key: route.param } : null;
    case 'new/<type>': return 'unsaved';
    default: return null;
  }
}

/** Why pins can't be edited now (FR-HOM-02 AC-22, AC-23), or null. */
export function editReason(pins: PinsDto | null): null | 'pinned.fixFile' | 'pinned.newer' {
  if (!pins || pins.state === 'missing') return null;
  if (pins.state === 'newer') return 'pinned.newer';
  if (pins.state === 'unreadable' || !pins.patchable) return 'pinned.fixFile';
  return null;
}

/** The 0-based final position for a pointer at `y` over rows with these rects (R135's line). `from`: the dragged row's
 *  index when reordering. */
export function dropIndex(rects: { top: number; bottom: number; height?: number }[], y: number, from?: number): number {
  const gap = rects.filter((r) => (r.top + r.bottom) / 2 < y).length;
  return from !== undefined && gap > from ? gap - 1 : gap;
}

/** Where ⌥⌘↑ (-1) / ⌥⌘↓ (1) moves row `index` of `n`, or null at the ends. */
export function moveTarget(index: number, dir: number, n: number): number | null {
  const j = index + dir;
  return j < 0 || j >= n ? null : j;
}
