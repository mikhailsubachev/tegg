// Slice Q2-T: the multi-level sort of `All <plural>` (docs/contracts/v1-views.md §28.1, §29.7; R206; D-1892, D-1907;
// FR-QRY-01 AC-20). Pure (L1). Part one §1.6's per-kind comparison: Select by option order then unknown values (by
// collation), Date by its valid `YYYY-MM-DD` only (CP-31, D-1923), date-times, `created`, `modified` by instant, numbers
// numerically, the rest by collation; an empty value is last at every level in both orders; ties by title, then path.
// D-2221: the same rules as the core's `sort_rows`, so a view's quick re-sort (R222) draws the run's order: a Select
// value matches its option after folding case and diacritics (the core's `fold`), a number sorts only from a number,
// and the last tie-break is the path's UTF-8 bytes.
import { parseDate, parseInstant } from '@tegg/doc';
import type { SortDto } from '../ipc/queries';
import type { TypeDto, TypeRowDto, TypeSortDto } from '../ipc/types';

const nfc = (s: string) => s.normalize('NFC');
/** The core's `fold` (`tegg_index::fold`): NFD, combining marks dropped, lower case, NFC. */
const fold = (s: string) => nfc(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC');
type Key = { rank: number; n: number | null; s: string | null } | null;

function scalar(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : nfc(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) { for (const x of v) { const s = scalar(x); if (s !== null) return s; } return null; }
  if (v && typeof v === 'object' && 'target' in (v as Record<string, unknown>)) return scalar((v as { target: unknown }).target);
  return null;
}

/** The sort key of one row at one level (null: empty). */
function keyOf(row: TypeRowDto, by: string, type: TypeDto): Key {
  const k = nfc(by);
  if (k === 'title') return { rank: 0, n: null, s: nfc(row.title) };
  if (k === 'created' || k === 'modified') {
    const v = row[k];
    const ms = typeof v === 'string' ? parseInstant(v) : null;
    return ms === null ? null : { rank: 0, n: ms, s: null };
  }
  const attr = type.attributes.find((a) => nfc(a.key) === k);
  const raw = row.values?.[k];
  if (!attr) { const s = scalar(raw); return s === null ? null : { rank: 0, n: null, s }; }
  switch (attr.type) {
    case 'select': {
      const s = scalar(raw);
      if (s === null) return null;
      const f = fold(s);
      const i = (attr.options ?? []).findIndex((o) => fold(o.label) === f);
      // The core compares the option's place, then the value as written by collation.
      return i >= 0 ? { rank: 0, n: i, s } : { rank: 1, n: null, s };
    }
    case 'date': {
      const d = typeof raw === 'string' ? parseDate(raw.trim()) : null;
      return d === null ? null : { rank: 0, n: null, s: d };
    }
    case 'date-time': {
      const ms = typeof raw === 'string' ? parseInstant(raw) : null;
      return ms === null ? null : { rank: 0, n: ms, s: null };
    }
    case 'number': {
      const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
      return n === null ? null : { rank: 0, n, s: null };
    }
    case 'checkbox':
      return typeof raw === 'boolean' ? { rank: 0, n: raw ? 1 : 0, s: null } : null;
    default: {
      const s = scalar(raw);
      return s === null ? null : { rank: 0, n: null, s };
    }
  }
}

function cmpKey(a: NonNullable<Key>, b: NonNullable<Key>, c: Intl.Collator): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.n !== null && b.n !== null && a.n !== b.n) return a.n < b.n ? -1 : 1;
  return c.compare(a.s ?? '', b.s ?? '');
}

/** UTF-8 byte order (= code point order; a plain `<` compares UTF-16 units, which differs above U+FFFF). */
function bytes(a: string, b: string): number {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length - y.length < 0 ? -1 : x.length > y.length ? 1 : 0;
}

/** §28.1: the rows in `levels` order (a key used twice counts at its first level). */
export function sortTypeRows(rows: TypeRowDto[], levels: SortDto[], type: TypeDto, collator: Intl.Collator): TypeRowDto[] {
  const seen = new Set<string>();
  const ls = levels.filter((l) => { const k = nfc(l.by); if (seen.has(k)) return false; seen.add(k); return true; });
  const keyed = rows.map((r) => ({ r, keys: ls.map((l) => keyOf(r, l.by, type)) }));
  keyed.sort((x, y) => {
    for (let i = 0; i < ls.length; i++) {
      const a = x.keys[i], b = y.keys[i];
      if (a === null || b === null) { if (a === b) continue; return a === null ? 1 : -1; }
      const d = cmpKey(a, b, collator);
      if (d !== 0) return ls[i].order === 'desc' ? -d : d;
    }
    return collator.compare(nfc(x.r.title), nfc(y.r.title)) || bytes(nfc(x.r.path), nfc(y.r.path));
  });
  return keyed.map((k) => k.r);
}

/** The stored `typeSort[<type>]` as levels: a list is the levels, a 0.4.x `{ column, dir }` one level; absent → []
 *  (the page's default). */
export function levelsOf(stored: SortDto[] | TypeSortDto | undefined | null): SortDto[] {
  if (!stored) return [];
  if (Array.isArray(stored)) return stored.filter((l) => l && typeof l.by === 'string').map((l) => ({ by: nfc(l.by), order: l.order === 'desc' ? 'desc' : 'asc' }));
  if (typeof (stored as TypeSortDto).column === 'string') return [{ by: nfc((stored as TypeSortDto).column), order: (stored as TypeSortDto).dir === 'desc' ? 'desc' : 'asc' }];
  return [];
}
