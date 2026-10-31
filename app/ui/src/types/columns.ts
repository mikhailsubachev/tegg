// The type page's column model (FR-TYP-09 AC-18…AC-30; docs/contracts/type-columns.md §3, R130). The chosen columns
// are the type file's `columns:` list (D-1240), else the preview properties plus Modified; Title is always first and
// never part of the list. Every write builds on the list as written, so hand-written entries keep their places (D-1245).
import type { TypeDto } from '../ipc/types';

/** The open type page's handler for the palette commands `Choose columns…` and `Reset column widths` (D-1249). */
export const columnsRequest: { current: ((what: 'choose' | 'reset') => void) | null } = { current: null };

export const UNIVERSAL_COLUMNS = ['tags', 'source', 'aliases', 'review', 'created', 'modified'] as const;
/** The universal keys a preview fallback shows (D-260: Modified is appended, Review isn't shown there). */
const FALLBACK_UNIVERSAL = ['tags', 'source', 'aliases', 'created'];

const nfc = (s: string) => s.normalize('NFC');

/** R130 menu choices in order (Title excluded): attributes in schema order, then the universal keys; `review` only
 *  when the workflow is on or locked (D-1242). */
export function columnChoices(type: TypeDto): string[] {
  const review = type.review === 'on' || type.review === 'locked';
  return [...type.attributes.map((a) => nfc(a.key)), ...UNIVERSAL_COLUMNS.filter((k) => k !== 'review' || review)];
}

/** Effective columns after Title: `columns` when present (unknown keys, `title` and repeats dropped, NFC-matched) else
 *  `preview`'s known keys + `modified` (D-1240); `review` dropped while the workflow is off. */
export function effectiveColumns(type: TypeDto | null | undefined): string[] {
  if (!type) return ['modified'];
  const choices = new Set(columnChoices(type));
  const out: string[] = [];
  if (type.columns) {
    for (const k of type.columns.map(nfc)) if (choices.has(k) && !out.includes(k)) out.push(k);
    return out;
  }
  const attrs = new Set(type.attributes.map((a) => nfc(a.key)));
  for (const k of type.preview.map(nfc)) if ((attrs.has(k) || FALLBACK_UNIVERSAL.includes(k)) && !out.includes(k)) out.push(k);
  return [...out, 'modified'];
}

/** The list as written, seeded from the effective columns when the key is absent (D-1243). */
const written = (type: TypeDto) => type.columns ?? effectiveColumns(type);

/** The list to write for a toggle: a checked key is appended, an unchecked one loses every entry (D-1243, D-1244). */
export function toggleColumn(type: TypeDto, key: string, on: boolean): string[] {
  const k = nfc(key);
  const list = written(type);
  return on ? [...list, k] : list.filter((c) => nfc(c) !== k);
}

/** The list with `key` moved before `before` (null = at the end) or after `after`; hand-written entries stay put. */
function place(type: TypeDto, key: string, at: { before: string | null } | { after: string }): string[] {
  const k = nfc(key);
  const list = written(type).filter((c) => nfc(c) !== k);
  if ('after' in at) {
    const i = list.findIndex((c) => nfc(c) === at.after);
    return [...list.slice(0, i + 1), k, ...list.slice(i + 1)];
  }
  const i = at.before === null ? -1 : list.findIndex((c) => nfc(c) === at.before);
  return i < 0 ? [...list, k] : [...list.slice(0, i), k, ...list.slice(i)];
}

/** The list to write when moving `key` by `delta` places among the effective columns (D-1244); null when it can't. */
export function moveColumn(type: TypeDto, key: string, delta: number): string[] | null {
  const eff = effectiveColumns(type);
  const i = eff.indexOf(nfc(key));
  const j = i + delta;
  if (i < 0 || delta === 0 || j < 0 || j >= eff.length) return null;
  return delta < 0 ? place(type, key, { before: eff[j] }) : place(type, key, { after: eff[j] });
}

/** The list to write when dropping `key` before `beforeKey` (null = at the end); null when nothing would change. */
export function dropColumn(type: TypeDto, key: string, beforeKey: string | null): string[] | null {
  const eff = effectiveColumns(type);
  const k = nfc(key);
  if (!eff.includes(k) || beforeKey === 'title') return null;
  const before = beforeKey === null ? null : nfc(beforeKey);
  if (before === k || (before !== null && !eff.includes(before))) return null; // dropped on itself: no move
  const order = eff.filter((c) => c !== k);
  const at = before === null ? order.length : order.indexOf(before);
  if ([...order.slice(0, at), k, ...order.slice(at)].join('\n') === eff.join('\n')) return null;
  return place(type, key, { before });
}

/** Default sort (D-1246): `modified`/`desc` when `modified` is shown, else `title`/`asc`. */
export function defaultSort(cols: string[]): { column: string; dir: 'asc' | 'desc' } {
  return cols.includes('modified') ? { column: 'modified', dir: 'desc' } : { column: 'title', dir: 'asc' };
}

export const WIDTH = { default: 160, min: 80, max: 960, titleMin: 160, titleFill: 240 } as const; // R130, D-1248

/** A width within R130's limits (`title` has its own minimum). */
export function clampWidth(key: string, px: number): number {
  return Math.round(Math.min(WIDTH.max, Math.max(key === 'title' ? WIDTH.titleMin : WIDTH.min, px)));
}
