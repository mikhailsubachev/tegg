// Slice Q (docs/contracts/v1-queries.md §4.2 `model.ts`): the pure part of the query editor, the block's Columns menu and
// the new-object footer. R139's attribute list and operators, the run-time validity of a row (as the core's evaluator
// reads it, §1.6), the columns rules of FR-QRY-05 AC-3…AC-5 (AP-1294), the footer's pre-filled values (D-1439) and the
// Limit field (1…1000). No IPC, no DOM.
import { columnChoices as typeColumnChoices } from '../types/columns';
import type { TypeDto } from '../ipc/types';
import type { BrokenReason, FilterItemDto, QueryDefDto, QueryOp } from '../ipc/queries';

const nfc = (s: string) => s.normalize('NFC');

/** R139's kinds (types.md R10 grouped by their operators); `links` is `links_to` / `linked_from`. */
export type QueryKind = 'links' | 'text' | 'select' | 'review' | 'multi' | 'tags' | 'date' | 'datetime' | 'number' | 'checkbox' | 'relation';
const KIND_OF: Record<string, QueryKind> = {
  text: 'text', 'long-text': 'text', url: 'text', email: 'text', select: 'select', 'multi-select': 'multi', date: 'date',
  'date-time': 'datetime', number: 'number', rating: 'number', currency: 'number', checkbox: 'checkbox', relation: 'relation',
};
/** `Every object` (R139), in board order, with their kinds and the type page's labels. */
export const UNIVERSAL: { key: string; kind: QueryKind; label: string }[] = [
  { key: 'title', kind: 'text', label: 'typePage.title' },
  { key: 'tags', kind: 'tags', label: 'attr.tags' },
  { key: 'created', kind: 'datetime', label: 'attr.created' },
  { key: 'modified', kind: 'datetime', label: 'attr.modified' },
  { key: 'review', kind: 'review', label: 'attr.review' },
  { key: 'source', kind: 'relation', label: 'attr.source' },
  { key: 'aliases', kind: 'text', label: 'attr.aliases' },
];
export const LINK_KEYS: { key: 'links_to' | 'linked_from'; label: string }[] = [
  { key: 'links_to', label: 'query.editor.linksTo' },
  { key: 'linked_from', label: 'query.editor.linkedFrom' },
];

/** R139: operators per kind, in R139's order. */
export const OPS: Record<QueryKind, QueryOp[]> = {
  links: ['links_to'],
  text: ['is', 'is_not', 'contains', 'is_empty', 'is_not_empty'],
  select: ['is', 'is_not', 'is_any_of', 'is_empty'],
  review: ['is', 'is_not', 'is_any_of', 'is_empty'],
  multi: ['has_any_of', 'has_all_of', 'has_none_of'],
  tags: ['has_any_of', 'has_all_of', 'has_none_of'],
  date: ['is', 'before', 'after', 'between', 'today', 'this_week', 'within_next_days', 'overdue', 'is_empty'],
  datetime: ['is', 'before', 'after', 'between', 'today', 'this_week', 'within_next_days', 'overdue', 'is_empty'],
  number: ['eq', 'ne', 'lt', 'gt', 'between'],
  checkbox: ['is'],
  relation: ['links_to', 'is_empty', 'is_not_empty'],
};
/** Operators whose value is the flag `true` (R138 `{ is_empty: true }`). */
export const FLAG_OPS = new Set<QueryOp>(['is_empty', 'is_not_empty', 'today', 'this_week', 'overdue']);

export type AttrItem = { key: string; kind: QueryKind; label: string; userNamed: boolean; options: { label: string; state: string | null }[]; to: string[] | null };
export type AttrGroup = { id: 'links' | 'every' | 'type'; label: string; userNamed: boolean; items: AttrItem[] };

/** The kind of `key` on one type (schema attributes, date-range halves, the universal keys); null when it lacks it,
 *  `unsupported` for `recurrence`, `file`, `cover`, `icon` and unknown R10 types. */
function attrOf(type: TypeDto | undefined, key: string): AttrItem | 'unsupported' | null {
  const k = nfc(key);
  const u = UNIVERSAL.find((x) => x.key === k);
  if (u) return { key: u.key, kind: u.kind, label: u.label, userNamed: false, options: [], to: null };
  if (!type) return null;
  for (const a of type.attributes ?? []) {
    const ak = nfc(a.key);
    if (a.type === 'date-range' && (k === `${ak}-start` || k === `${ak}-end`)) return { key: k, kind: 'date', label: `${a.name} (${k.slice(ak.length + 1)})`, userNamed: true, options: [], to: null };
    if (ak === k) {
      const kind = KIND_OF[a.type];
      if (!kind) return 'unsupported';
      return { key: ak, kind, label: a.name, userNamed: true, options: (a.options ?? []).map((o) => ({ label: nfc(o.label), state: o.state ?? null })), to: a.to ?? null };
    }
  }
  return null;
}

/** The chosen types' shared attributes (same key and kind), in the first type's schema order. */
function sharedAttributes(types: TypeDto[], chosen: string[]): AttrItem[] {
  const ts = chosen.map((c) => types.find((t) => nfc(t.key) === nfc(c)));
  if (!ts.length || ts.some((t) => !t)) return [];
  const out: AttrItem[] = [];
  for (const a of ts[0]!.attributes ?? []) {
    const keys = a.type === 'date-range' ? [`${nfc(a.key)}-start`, `${nfc(a.key)}-end`] : [nfc(a.key)];
    for (const key of keys) {
      const first = attrOf(ts[0], key);
      if (!first || first === 'unsupported') continue;
      const all = ts.every((t) => { const x = attrOf(t, key); return x && x !== 'unsupported' && x.kind === first.kind; });
      if (all) out.push(first);
    }
  }
  return out;
}

/** R139's listbox groups: Links, Every object, then the chosen types' (shared) attributes; no third group when they
 *  share none or no type is chosen. */
export function attributeGroups(types: TypeDto[], chosen: string[]): AttrGroup[] {
  const groups: AttrGroup[] = [
    { id: 'links', label: 'query.editor.links', userNamed: false, items: LINK_KEYS.map((l) => ({ key: l.key, kind: 'links', label: l.label, userNamed: false, options: [], to: null })) },
    { id: 'every', label: 'query.editor.every', userNamed: false, items: UNIVERSAL.map((u) => ({ key: u.key, kind: u.kind, label: u.label, userNamed: false, options: [], to: null })) },
  ];
  const own = sharedAttributes(types, chosen);
  if (own.length) {
    const names = chosen.map((c) => types.find((t) => nfc(t.key) === nfc(c))?.name ?? c);
    groups.push({ id: 'type', label: names.join(', '), userNamed: true, items: own });
  }
  return groups;
}

/** The attribute `key` as the chosen types read it (null: not an attribute of every chosen type). */
export function attributeOf(types: TypeDto[], chosen: string[], key: string): AttrItem | null {
  const k = nfc(key);
  if (k === 'links_to' || k === 'linked_from') return { key: k, kind: 'links', label: LINK_KEYS.find((l) => l.key === k)!.label, userNamed: false, options: [], to: null };
  if (!chosen.length) { const u = attrOf(undefined, k); return u && u !== 'unsupported' ? u : null; }
  let first: AttrItem | null = null;
  for (const c of chosen) {
    const a = attrOf(types.find((t) => nfc(t.key) === nfc(c)), k);
    if (!a || a === 'unsupported') return null;
    if (first && first.kind !== a.kind) return null;
    first ??= a;
  }
  return first;
}

export type OpEntry = { op: QueryOp; label: string; arg?: boolean };
/** R139's operators for a kind, in order, with their label keys; the checkbox pair is `is: true` / `is: false`. */
export function operatorsFor(kind: string): OpEntry[] {
  if (kind === 'checkbox') return [{ op: 'is', arg: true, label: 'query.op.checked' }, { op: 'is', arg: false, label: 'query.op.notChecked' }];
  const ops = OPS[kind as QueryKind] ?? [];
  return ops.map((op) => ({ op, label: `query.op.${op}` }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (x: unknown) => typeof x === 'string' && DATE.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const linkValue = (v: unknown) => typeof v === 'string' && /^\[\[[^\]]+\]\]$/.test(v.trim());

/** Run-time validity of an editor row against the chosen types (R139, contract §1.6): null, or the broken reason.
 *  `chosenTypes`: the chosen types' definitions (empty: all types). A group is broken only when it holds a group. */
export function isValidRow(row: FilterItemDto, chosenTypes: TypeDto[]): BrokenReason | null {
  if (row.kind === 'raw') return 'shape';
  if (row.kind === 'group') return row.filters.some((f) => f.kind === 'group') ? 'nestedGroup' : null;
  const chosen = chosenTypes.map((t) => t.key);
  const key = nfc(row.key);
  const v = row.value;
  if (key === 'links_to' || key === 'linked_from') {
    if (row.op !== 'is' && row.op !== 'links_to') return 'operatorKind';
    return v === 'this' || linkValue(v) ? null : 'value';
  }
  let info: AttrItem | null = null;
  if (!chosen.length) {
    const u = attrOf(undefined, key);
    if (!u) return 'notAttribute';
    info = u as AttrItem;
  } else {
    for (const t of chosenTypes) {
      const a = attrOf(t, key);
      if (!a) return 'notAttribute';
      if (a === 'unsupported') return 'operatorKind';
      if (info && info.kind !== a.kind) return 'notAttribute';
      info ??= a;
    }
  }
  const kind = info!.kind;
  if (!OPS[kind].includes(row.op)) return 'operatorKind';
  let ok = true;
  switch (row.op) {
    case 'is_empty': case 'is_not_empty': case 'today': case 'this_week': case 'overdue': ok = v === true; break;
    case 'is': case 'is_not':
      if (kind === 'checkbox') ok = typeof v === 'boolean';
      else if (kind === 'date' || kind === 'datetime') ok = isDate(v) || (row.op === 'is' && v === 'this');
      else ok = typeof v === 'string' || typeof v === 'number';
      break;
    case 'contains': ok = typeof v === 'string' || typeof v === 'number'; break;
    case 'is_any_of': case 'has_any_of': case 'has_all_of': case 'has_none_of': ok = isStrList(v) && v.length > 0; break;
    case 'before': case 'after': ok = isDate(v) || v === 'this'; break;
    case 'between':
      ok = kind === 'number'
        ? Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') && (v[0] as number) <= (v[1] as number)
        : Array.isArray(v) && v.length === 2 && v.every(isDate) && (v[0] as string) <= (v[1] as string);
      break;
    case 'within_next_days': ok = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3650; break;
    case 'eq': case 'ne': case 'lt': case 'gt': ok = typeof v === 'number'; break;
    case 'links_to': ok = v === 'this' || linkValue(v); break;
  }
  return ok ? null : 'value';
}

/** Column keys every object has (the mixed table's choices, AP-1294), `type` first. */
const MIXED_KEYS = ['type', 'tags', 'source', 'aliases', 'created', 'modified'];
const UNIVERSAL_COLUMN = new Set(['title', 'type', 'tags', 'source', 'aliases', 'review', 'created', 'modified']);

/** FR-QRY-05 AC-5: one type → several (or all): the universal keys stay in order and `type` is appended; several → one
 *  and mixed → mixed: unchanged. */
export function columnsAfterTypes(columns: string[], before: string[], after: string[], _types?: TypeDto[]): string[] {
  const wasOne = before.length === 1;
  const isOne = after.length === 1;
  if (!wasOne || isOne) return columns;
  const kept = columns.filter((c) => UNIVERSAL_COLUMN.has(nfc(c)));
  return kept.includes('type') ? kept : [...kept, 'type'];
}

/** The Columns menu's rows after Title (R130 for one type; the universal rows plus `type` when mixed, AP-1294), `title`
 *  first. */
export function columnChoices(def: QueryDefDto, types: TypeDto[]): string[] {
  if (def.types.length === 1) {
    const t = types.find((x) => nfc(x.key) === nfc(def.types[0]));
    if (t) return ['title', ...typeColumnChoices(t)];
  }
  return ['title', ...MIXED_KEYS];
}

/** The `columns` list to write for a toggle: a checked key is appended, an unchecked one removed. */
export function toggleColumn(def: QueryDefDto, key: string, on: boolean): string[] {
  const k = nfc(key);
  const list = def.columns.filter((c) => nfc(c) !== k);
  return on ? [...def.columns.filter((c) => nfc(c) !== k), k] : list;
}

const stemOf = (path: string) => nfc((path.split('/').pop() ?? path).replace(/\.md$/i, ''));

/** D-1439 (FR-QRY-08): the new-object footer of a one-type `match: all` query: `source` linking the host when a top-level
 *  filter links to `this`, plus every top-level Select `is` value; null when no footer is offered. `types`, when given,
 *  decides which attributes are Select; without it a plain text value of an `is` filter counts. */
export function prefill(def: QueryDefDto, host: string | null, types?: TypeDto[]): { type: string; values: [string, unknown][] } | null {
  if (def.types.length !== 1 || def.match !== 'all') return null;
  const type = def.types[0];
  const t = types?.find((x) => nfc(x.key) === nfc(type));
  const values: [string, unknown][] = [];
  const top = def.filters.filter((f): f is Extract<FilterItemDto, { kind: 'filter' }> => f.kind === 'filter');
  const linksHere = top.some((f) => (nfc(f.key) === 'links_to' && f.value === 'this') || (nfc(f.key) === 'source' && f.op === 'links_to' && f.value === 'this'));
  if (linksHere && host) values.push(['source', `[[${stemOf(host)}]]`]);
  for (const f of top) {
    const key = nfc(f.key);
    if (f.op !== 'is' || typeof f.value !== 'string' || f.value === 'this') continue;
    if (key === 'links_to' || key === 'linked_from' || UNIVERSAL.some((u) => u.key === key)) continue;
    if (t) {
      const a = t.attributes.find((x) => nfc(x.key) === key);
      if (!a || a.type !== 'select') continue;
    } else if (DATE.test(f.value) || linkValue(f.value)) continue;
    if (!values.some(([k]) => k === key)) values.push([key, f.value]);
  }
  return { type, values };
}

/** The `Limit` field: an integer 1…1000, else null (FR-QRY-01 AC-4). */
export function parseLimit(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 1000 ? n : null;
}

/** Items without their file positions (`src`): what the core compares for a commit. */
function plain(items: FilterItemDto[]): unknown[] {
  return items.map((f) => (f.kind === 'filter' ? { k: nfc(f.key), op: f.op, v: f.value }
    : f.kind === 'group' ? { g: f.match, f: plain(f.filters) } : { raw: f.src }));
}
/** Two definitions with the same effective values (title included). */
export function defEquals(a: QueryDefDto, b: QueryDefDto): boolean {
  const norm = (d: QueryDefDto) => JSON.stringify([nfc(d.title), d.types.map(nfc), d.match, plain(d.filters), nfc(d.sort.by), d.sort.order, d.limit, d.view, d.columns.map(nfc)]);
  return norm(a) === norm(b);
}
