// Slice Q2: the sort model of views, query blocks and query pages (docs/contracts/v1-views.md §4.2, R188; D-1766,
// D-1768, D-1784). Pure (L1): every function takes the levels as written and answers the levels to write.
import type { SortDto } from '../ipc/queries';
import type { TypeDto } from '../ipc/types';
import { t } from '../i18n/catalog';

const nfc = (s: string) => s.normalize('NFC');
/** R138's default and what `Clear` writes (AP-1502). */
const DEFAULT: SortDto = { by: 'modified', order: 'desc' };
const flip = (o: 'asc' | 'desc'): 'asc' | 'desc' => (o === 'asc' ? 'desc' : 'asc');

/** The levels in effect: a key used at two levels counts at its first (R185). */
export function levels(sort: readonly SortDto[]): SortDto[] {
  const seen = new Set<string>();
  const out: SortDto[] = [];
  for (const l of sort) {
    const by = nfc(l.by);
    if (seen.has(by)) continue;
    seen.add(by);
    out.push({ by, order: l.order === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

/** Two sorts with the same levels in effect. */
export function sameSort(a: readonly SortDto[], b: readonly SortDto[]): boolean {
  const x = levels(a), y = levels(b);
  return x.length === y.length && x.every((l, i) => l.by === y[i].by && l.order === y[i].order);
}

/** A header click (D-1784, AP-1500): without ⇧ the column becomes the only level (a click on the only level flips it,
 *  a column at a level of several keeps its order, an unsorted one is ascending); with ⇧ a level flips in place and an
 *  unsorted column is appended ascending. */
export function headerClick(sort: readonly SortDto[], key: string, shift: boolean): SortDto[] {
  const ls = levels(sort);
  const k = nfc(key);
  const at = ls.findIndex((l) => l.by === k);
  if (shift) {
    if (at < 0) return [...ls, { by: k, order: 'asc' }];
    return ls.map((l, i) => (i === at ? { by: k, order: flip(l.order) } : l));
  }
  if (at < 0) return [{ by: k, order: 'asc' }];
  if (ls.length === 1) return [{ by: k, order: flip(ls[0].order) }];
  return [{ by: k, order: ls[at].order }];
}

/** `+ Add sort`: the first choice not used at a level, ascending; unchanged when every choice is used. */
export function addLevel(sort: readonly SortDto[], choices: readonly string[]): SortDto[] {
  const ls = levels(sort);
  const free = choices.map(nfc).find((c) => !ls.some((l) => l.by === c));
  return free === undefined ? ls : [...ls, { by: free, order: 'asc' }];
}

/** `Remove` on level `i`; removing the last level leaves R138's default (AP-1502). */
export function removeLevel(sort: readonly SortDto[], i: number): SortDto[] {
  const ls = levels(sort);
  const out = ls.filter((_, j) => j !== i);
  return out.length ? out : [{ ...DEFAULT }];
}

/** A level dragged from place `from` to place `to`. */
export function moveLevel(sort: readonly SortDto[], from: number, to: number): SortDto[] {
  const ls = levels(sort);
  if (from < 0 || from >= ls.length) return ls;
  const [l] = ls.splice(from, 1);
  ls.splice(Math.max(0, Math.min(ls.length, to)), 0, l);
  return ls;
}

/** `Clear`: one level, Modified ↓ (AP-1502). */
export function clearSort(): SortDto[] {
  return [{ ...DEFAULT }];
}

/** The popover's column choices (D-1818): Title, Created, Modified, then the type's attributes in schema order. */
export function sortChoices(type: TypeDto | null | undefined): string[] {
  const out = ['title', 'created', 'modified'];
  for (const a of type?.attributes ?? []) {
    const k = nfc(a.key);
    if (a.type === 'date-range') continue;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

type OrderKind = 'text' | 'date' | 'number' | 'check' | 'option';
function orderKind(key: string, type: TypeDto | null | undefined): { kind: OrderKind; options: string[] } {
  const k = nfc(key);
  if (k === 'title' || k === 'tags' || k === 'aliases' || k === 'source') return { kind: 'text', options: [] };
  if (k === 'created' || k === 'modified') return { kind: 'date', options: [] };
  const a = type?.attributes.find((x) => nfc(x.key) === k);
  if (!a) return { kind: 'text', options: [] };
  switch (a.type) {
    case 'date': case 'date-time': return { kind: 'date', options: [] };
    case 'number': case 'rating': case 'currency': return { kind: 'number', options: [] };
    case 'checkbox': return { kind: 'check', options: [] };
    case 'select': {
      const options = (a.options ?? []).map((o) => nfc(o.label));
      return options.length ? { kind: 'option', options } : { kind: 'text', options: [] };
    }
    default: return { kind: 'text', options: [] };
  }
}

/** The order combobox's two texts for a column (AP-1502): Select by its first / last option, dates, numbers, checkbox,
 *  everything else A → Z. */
export function orderLabels(key: string, type: TypeDto | null | undefined): { asc: string; desc: string } {
  const { kind, options } = orderKind(key, type);
  switch (kind) {
    case 'date': return { asc: t('sort.order.dateAsc'), desc: t('sort.order.dateDesc') };
    case 'number': return { asc: t('sort.order.numberAsc'), desc: t('sort.order.numberDesc') };
    case 'check': return { asc: t('sort.order.checkAsc'), desc: t('sort.order.checkDesc') };
    case 'option': return { asc: t('sort.order.optionFirst', { option: options[0] }), desc: t('sort.order.optionFirst', { option: options[options.length - 1] }) };
    default: return { asc: t('sort.order.textAsc'), desc: t('sort.order.textDesc') };
  }
}

/** The header markers (AP-1500, AP-1501): ↑ / ↓ per sorted column, the level number only with two or more levels. */
export function markers(sort: readonly SortDto[]): Map<string, { arrow: '↑' | '↓'; n: number | null }> {
  const ls = levels(sort);
  return new Map(ls.map((l, i) => [l.by, { arrow: l.order === 'asc' ? '↑' : '↓', n: ls.length >= 2 ? i + 1 : null }]));
}

/** The sort button's text: the first level (`Finished ↓`) and how many more there are (`+2`). */
export function buttonText(sort: readonly SortDto[], nameOf: (key: string) => string): { text: string; more: number } {
  const ls = levels(sort);
  if (!ls.length) return { text: '', more: 0 };
  return { text: `${nameOf(ls[0].by)} ${ls[0].order === 'asc' ? '↑' : '↓'}`, more: ls.length - 1 };
}
