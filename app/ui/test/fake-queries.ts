// Fake core, slice Q (docs/contracts/v1-queries.md §5): the TypeScript twin of §1.2…§1.6 (the query-file reader and
// patcher of R138, the fence reader of R140, the evaluator of R139 / R146) over the fake's in-memory files, and the
// Node side of every §2 command (`handle`). Checked against tests/fixtures/queries-files/ and expected.json
// (app/test/queries_twin.ac.test.ts, L3); crates/tegg-core/tests/ac_queries.rs reads the same files. Runs in Node
// (installFakeCore exposes it to the page as `__teggQueries`). Test code, not product code.
//
// Values come from the `yaml` package (YAML 1.2); positions from a line scanner (the graph presets / pins twins' rules),
// so a commit replaces only the changed top-level keys' lines (D-1436, D-1454…D-1457). Objects, links and tags come from
// the real `@tegg/doc` through fake-links.ts (`objectsWith`, `resolver`); types from fake-schema.ts (`listTypes`).
import { parseAllDocuments, parse as parseYaml, isMap, isScalar, isSeq, type Document } from 'yaml';
import { listTypes, type TypeDto } from './fake-schema';
import { objectsWith, resolver, type Obj } from './fake-links';

// ------------------------------------------------------------------------------------------------ DTOs (contract §2)

export type VersionDto = { mtimeNs: string; size: number; hash: string };
export type QueryOp = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty' | 'is_any_of' | 'has_any_of' | 'has_all_of'
  | 'has_none_of' | 'before' | 'after' | 'between' | 'today' | 'this_week' | 'within_next_days' | 'overdue'
  | 'eq' | 'ne' | 'lt' | 'gt' | 'links_to';
export const QUERY_OPS: QueryOp[] = ['is', 'is_not', 'contains', 'is_empty', 'is_not_empty', 'is_any_of', 'has_any_of', 'has_all_of',
  'has_none_of', 'before', 'after', 'between', 'today', 'this_week', 'within_next_days', 'overdue', 'eq', 'ne', 'lt', 'gt', 'links_to'];
export type FilterItemDto =
  | { kind: 'filter'; key: string; op: QueryOp; value: unknown; src: number[] | null }
  | { kind: 'group'; match: 'all' | 'any'; filters: FilterItemDto[]; src: number[] | null }
  | { kind: 'raw'; src: number[] };
export type QueryDefDto = {
  title: string; types: string[]; match: 'all' | 'any'; filters: FilterItemDto[];
  sort: { by: string; order: 'asc' | 'desc' }; limit: number; view: 'list' | 'table'; columns: string[];
};
export type BrokenReason = 'badValue' | 'shape' | 'operator' | 'nestedGroup' | 'notAttribute' | 'operatorKind' | 'value' | 'noType';
export type BrokenDto = { reason: BrokenReason; at: number[] | null; key: string; type: string | null };
export type LookupDto = 'ok' | 'newer' | 'unreadable' | 'missing' | 'trashed';
export type QuerySummaryDto = {
  name: string; title: string; path: string; state: 'ok' | 'newer' | 'unreadable'; line: number | null;
  created: string | null; modified: string | null; usesThis: boolean; version: VersionDto | null;
};
export type QueryDto = {
  name: string; path: string; state: LookupDto; line: number | null; reason: string | null;
  version: VersionDto | null; text: string | null; def: QueryDefDto | null; broken: BrokenDto[]; usesThis: boolean;
  created: string | null; modified: string | null; trashedPath: string | null;
};
export type QuerySourceDto =
  | { kind: 'saved'; name: string }
  | { kind: 'fence'; body: string }
  | { kind: 'def'; def: QueryDefDto; name: string | null };
export type QueryEnvDto = { today: string; zone: string; weekStart: number; locale: string };
export type QueryRowDto = {
  path: string; id: string | null; title: string; type: string; created: string | null; modified: string | null;
  values: Record<string, unknown>; links: unknown[];
  task: { status: string | null; state: 'open' | 'in-progress' | 'done' | 'cancelled'; due: string | null } | null;
};
export type QueryResultDto = {
  form: 'reference' | 'inline' | 'unreadable' | 'empty' | 'def'; name: string | null; lookup: LookupDto | null;
  line: number | null; version: VersionDto | null; def: QueryDefDto | null;
  state: 'ok' | 'noType' | 'needsHost' | 'needsContext'; broken: BrokenDto[]; targets: string[];
  usesRelative: boolean; total: number; rows: QueryRowDto[]; indexReady: boolean;
};
export type QueryUsageDto = { path: string; title: string; type: string | null; template: boolean };
/** §1.8 `QueryPatch` (only `objectMoved` has an emitter in this slice, D-1469). */
export type QueryPatchDto =
  | { kind: 'objectMoved'; from: string; to: string; paths: string[] }
  | { kind: 'optionRenamed'; type: string; key: string; from: string; to: string }
  | { kind: 'keyRenamed'; type: string; from: string; to: string }
  | { kind: 'typeKeyRenamed'; from: string; to: string };
export type QueriesErrKind = 'Conflict' | 'Gone' | 'NewerVersion' | 'Unreadable' | 'NameTaken' | 'EmptyName' | 'NotFound' | 'Limit' | 'NothingToDo' | 'Io' | 'NoVault';
export type QueriesErr = { kind: QueriesErrKind; message: string; disk?: QueryDto };

export const QUERIES_DIR = '.tegg/queries';
export const TRASHED_QUERIES_DIR = '.trash/.tegg/queries';
export const HEADER = '# Tegg saved query (FR-QRY-06). Edit it in Tegg: Queries › ';
/** R138 create order; also the order "the nearest earlier / later known key" is looked up in (§1.4). */
const ORDER = ['version', 'title', 'types', 'match', 'filters', 'sort', 'limit', 'view', 'columns', 'created', 'modified'] as const;
const DEFAULT_SORT = { by: 'modified', order: 'desc' as const };

const nfc = (s: string) => s.normalize('NFC');
const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
/** D-1434: names compare trimmed, NFC, case-insensitively (no locale). */
export const nameKey = (s: string) => nfc(trimWs(s)).toLowerCase();
/** D-109 / D-1445: NFC, lower case, diacritics folded. */
export const fold = (s: string) => nfc(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
/** tags.md R79's tag key. */
export const tagKeyOf = (s: string) => nfc(trimWs(s)).replace(/^#/, '').toLowerCase();
const blank = (l: string) => l.trim() === '';
const comment = (l: string) => l.trimStart().startsWith('#');
const content = (l: string) => !blank(l) && !comment(l);
const spaces = (l: string) => l.length - l.replace(/^ +/, '').length;
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(nfc(a)), Buffer.from(nfc(b)));
const json = (v: unknown) => JSON.stringify(v);

// ------------------------------------------------------------------------------------------------ lines

type Line = { text: string; end: string };
export function splitLines(text: string): Line[] {
  const out: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|$)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '' && m.index >= text.length) break;
    out.push({ text: m[1], end: m[2] });
    if (m[2] === '') break;
  }
  return out;
}
const joinLines = (L: Line[]) => L.map((l) => l.text + l.end).join('');

/** The key starting at `at` of `body` and the index of its `:`, or null (plain or quoted key). */
function keyAt(body: string, at: number): { key: string; colon: number } | null {
  const s = body.slice(at);
  if (s === '' || s.startsWith('- ') || s === '-' || s.startsWith('#')) return null;
  let key: string;
  let after: number;
  if (s[0] === '"' || s[0] === '\'') {
    const q = s[0];
    let end = -1;
    for (let j = 1; j < s.length; j++) {
      if (q === '"' && s[j] === '\\') { j++; continue; }
      if (s[j] === q) { if (q === '\'' && s[j + 1] === '\'') { j++; continue; } end = j + 1; break; }
    }
    if (end < 0) return null;
    try { key = q === '"' ? (JSON.parse(s.slice(0, end)) as string) : s.slice(1, end - 1).replace(/''/g, '\''); } catch { key = s.slice(1, end - 1); }
    after = end;
  } else {
    let i = 0;
    for (;;) {
      const c = s.indexOf(':', i);
      if (c < 0) return null;
      if (c + 1 === s.length || s[c + 1] === ' ' || s[c + 1] === '\t') { key = s.slice(0, c).trimEnd(); after = c; break; }
      i = c + 1;
    }
  }
  const rest = s.slice(after);
  const colon = after + (rest.length - rest.replace(/^[ \t]+/, '').length);
  return s[colon] === ':' ? { key: nfc(key), colon: at + colon } : null;
}
/** Index of a trailing comment's leading whitespace on a one-line value (outside quotes), or -1. */
function trailingCommentAt(line: string, from: number): number {
  let q: string | null = null;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (q === '"') { if (c === '\\') i++; else if (c === '"') q = null; continue; }
    if (q === '\'') { if (c === '\'') q = null; continue; }
    if (c === '"' || c === '\'') { q = c; continue; }
    if (c === '#' && i > 0 && (line[i - 1] === ' ' || line[i - 1] === '\t')) {
      let s = i;
      while (s > from && (line[s - 1] === ' ' || line[s - 1] === '\t')) s--;
      return s;
    }
  }
  return -1;
}

/** The 1-based line of a YAML error: inside an unclosed `[` / `{`, the line where the outermost one opened (D-1120). */
function errorLine(text: string, offset: number | null, reported: number | null): number | null {
  if (offset === null) return reported;
  let depth = 0, opened = -1, q: string | null = null, inComment = false;
  for (let j = 0; j < Math.min(offset, text.length); j++) {
    const c = text[j];
    if (c === '\n') { inComment = false; if (q === '\'') q = null; continue; }
    if (inComment) continue;
    if (q) { if (c === q) q = null; else if (q === '"' && c === '\\') j++; continue; }
    if (c === '"' || c === '\'') { q = c; continue; }
    if (c === '#' && (j === 0 || /\s/.test(text[j - 1]))) { inComment = true; continue; }
    if (c === '[' || c === '{') { if (depth === 0) opened = j; depth++; }
    if ((c === ']' || c === '}') && depth > 0) depth--;
  }
  return depth > 0 && opened >= 0 ? text.slice(0, opened).split('\n').length : reported;
}

// ------------------------------------------------------------------------------------------------ reading (R138, R139)

type KeyRange = { key: string; start: number; end: number };
type ItemRange = { start: number; end: number; dash: number; children: ItemRange[] | null };
export type QueryLayout = { lines: Line[]; keys: KeyRange[]; items: ItemRange[] | null; eol: string; final: boolean; header: number };

export type QueryReadTwin = {
  state: 'ok' | 'newer' | 'unreadable';
  line: number | null;
  reason: string | null;
  def: QueryDefDto;
  broken: BrokenDto[];
  usesThis: boolean;
  created: string | null;
  modified: string | null;
  /** Top-level keys as written (to find unknown keys and the keys present). */
  present: string[];
  layout: QueryLayout | null;
};

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const normValue = (v: unknown): unknown => (typeof v === 'string' ? nfc(v) : Array.isArray(v) ? v.map(normValue) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [nfc(k), normValue(x)])) : v);

/** Parses one filter item (R139) at `src`; `inGroup`: nested groups are `nestedGroup`. */
function readItem(raw: unknown, src: number[], inGroup: boolean, broken: BrokenDto[]): FilterItemDto {
  const bad = (reason: BrokenReason, key: string): FilterItemDto => { broken.push({ reason, at: src, key, type: null }); return { kind: 'raw', src }; };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('shape', typeof raw === 'string' ? nfc(raw) : '');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length) return bad('shape', '');
  const [k0, v] = entries[0];
  const key = nfc(k0);
  if (key === 'group') {
    if (inGroup) return bad('nestedGroup', key);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return bad('shape', key);
    const g = v as Record<string, unknown>;
    const m = g.match === undefined ? 'all' : g.match;
    if ((m !== 'all' && m !== 'any') || (g.filters !== undefined && !Array.isArray(g.filters))) return bad('shape', key);
    const inner = ((g.filters ?? []) as unknown[]).map((x, j) => readItem(x, [...src, j], true, broken));
    return { kind: 'group', match: m, filters: inner, src };
  }
  if (Array.isArray(v)) return bad('shape', key);
  if (v && typeof v === 'object') {
    const ops = Object.entries(v as Record<string, unknown>);
    if (ops.length !== 1 || !QUERY_OPS.includes(ops[0][0] as QueryOp)) return bad('operator', key);
    return { kind: 'filter', key, op: ops[0][0] as QueryOp, value: normValue(ops[0][1]), src };
  }
  return { kind: 'filter', key, op: 'is', value: normValue(v === undefined ? null : v), src };
}

function usesThisIn(items: FilterItemDto[]): boolean {
  return items.some((i) => (i.kind === 'filter' ? i.value === 'this' : i.kind === 'group' ? usesThisIn(i.filters) : false));
}

/** Line ranges of the top-level keys and of the `filters:` items (null when they can't be lined up with YAML). */
function layoutOf(text: string, rawItems: unknown[] | null): QueryLayout {
  const lines = splitLines(text);
  const T = lines.map((l, i) => (i === 0 ? l.text.replace(/^﻿/, '') : l.text));
  const eol = lines[0]?.end || '\n';
  const final = lines.length === 0 || lines[lines.length - 1].end !== '';
  const starts: { key: string; at: number }[] = [];
  T.forEach((t, i) => {
    if (spaces(t) !== 0 || !content(t) || t.startsWith('---') || t.startsWith('...')) return;
    const k = keyAt(t, 0);
    if (k) starts.push({ key: k.key, at: i });
  });
  const keys: KeyRange[] = starts.map((s, n) => {
    let end = n + 1 < starts.length ? starts[n + 1].at : T.length;
    while (end - 1 > s.at && !content(T[end - 1])) end--;
    return { key: s.key, start: s.at, end };
  });
  let header = 0;
  while (header < T.length && comment(T[header])) header++;
  const f = keys.find((k) => k.key === 'filters');
  let items: ItemRange[] | null = null;
  if (f && rawItems) {
    const k = keyAt(T[f.start], 0)!;
    const inline = T[f.start].slice(k.colon + 1).trim();
    if (inline === '' || inline.startsWith('#')) items = itemsIn(T, f.start + 1, f.end, rawItems);
    else if (rawItems.length === 0) items = [];
  } else if (!f) items = [];
  return { lines, keys, items, eol, final, header };
}
function itemsIn(T: string[], from: number, to: number, raw: unknown[]): ItemRange[] | null {
  const out: ItemRange[] = [];
  let d: number | null = null;
  for (let i = from; i < to; i++) {
    const t = T[i];
    if (!content(t)) continue;
    const ind = spaces(t);
    d ??= ind;
    if (ind === d && (t.slice(ind) === '-' || t.slice(ind).startsWith('- '))) out.push({ start: i, end: to, dash: d, children: null });
  }
  for (let n = 0; n + 1 < out.length; n++) out[n].end = out[n + 1].start;
  if (out.length !== raw.length) return null;
  out.forEach((it, n) => {
    const r = raw[n];
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r)[0] !== 'group') return;
    const g = (r as Record<string, any>).group;
    const kids = Array.isArray(g?.filters) ? g.filters : [];
    for (let i = it.start + 1; i < it.end; i++) {
      if (/^\s*filters:\s*(#.*)?$/.test(T[i])) { it.children = itemsIn(T, i + 1, it.end, kids); break; }
    }
  });
  return out;
}

/** R138 read rules. `utf8` false: the bytes weren't valid UTF-8. `name`: the file stem (a missing title reads as it).
 *  `colsFor`: the default `columns` for the effective `types` (the single type's effective type-page columns, else
 *  `[type, modified]`; contract §1.4 Create). */
export function queryRead(text: string | null, utf8 = true, name = '', colsFor: (types: string[]) => string[] = defaultColumnsNoSchema): QueryReadTwin {
  const defaults = (): QueryDefDto => ({ title: nfc(name), types: [], match: 'all', filters: [], sort: { ...DEFAULT_SORT }, limit: 50, view: 'list', columns: colsFor([]) });
  const unreadable = (line: number | null, reason: string): QueryReadTwin => ({ state: 'unreadable', line, reason, def: defaults(), broken: [], usesThis: false, created: null, modified: null, present: [], layout: null });
  if (text === null) return unreadable(null, 'no file');
  if (!utf8) return unreadable(null, 'The file isn\'t valid UTF-8.');
  const docs = [...parseAllDocuments(text)] as Document[];
  const e = docs.flatMap((d) => d.errors)[0];
  if (e) return unreadable(errorLine(text, e.pos?.[0] ?? null, e.linePos?.[0]?.line ?? null), e.message.split('\n')[0]);
  const doc = docs[0];
  const top = doc?.contents ?? null;
  if (top === null || (isScalar(top) && top.value === null)) {
    const L = layoutOf(text, []);
    return { state: 'ok', line: null, reason: null, def: defaults(), broken: [], usesThis: false, created: null, modified: null, present: [], layout: L };
  }
  if (!isMap(top)) return unreadable(1, 'The top level isn\'t a mapping.');
  let y: Record<string, unknown>;
  try { y = doc.toJSON() as Record<string, unknown>; } catch (x) { return unreadable(null, (x as Error).message); }
  const lineOfKey = (k: string) => { const i = text.split(/\r?\n/).findIndex((l) => keyAt(l.replace(/^﻿/, ''), 0)?.key === k); return i < 0 ? null : i + 1; };
  const vNode = top.get('version', true);
  let version = 1;
  if (vNode !== undefined) {
    const ok = isScalar(vNode) && typeof vNode.value === 'number' && Number.isInteger(vNode.value) && vNode.value >= 1 && /^\+?[0-9]+$/.test(String(vNode.source ?? vNode.value));
    if (!ok) return unreadable(lineOfKey('version'), '`version` isn\'t a positive integer.');
    version = Number((vNode as { value: unknown }).value);
  }
  const broken: BrokenDto[] = [];
  const badKey = (key: string) => broken.push({ reason: 'badValue', at: null, key, type: null });
  const has = (k: string) => Object.prototype.hasOwnProperty.call(y, k);
  const def = defaults();
  if (has('title')) { if (typeof y.title === 'string' && trimWs(y.title) !== '') def.title = nfc(trimWs(y.title)); else badKey('title'); }
  if (has('types')) { if (isStrList(y.types)) def.types = y.types.map((t) => nfc(trimWs(t))); else badKey('types'); }
  if (has('match')) { if (y.match === 'all' || y.match === 'any') def.match = y.match; else badKey('match'); }
  let rawItems: unknown[] | null = [];
  if (has('filters')) {
    if (y.filters === null) rawItems = [];
    else if (Array.isArray(y.filters)) rawItems = y.filters;
    else { badKey('filters'); rawItems = null; }
  }
  if (has('sort')) {
    const s = y.sort as Record<string, unknown> | null;
    const ok = !!s && typeof s === 'object' && !Array.isArray(s) && typeof s.by === 'string' && trimWs(s.by) !== '' && (s.order === undefined || s.order === null || s.order === 'asc' || s.order === 'desc');
    if (ok) def.sort = { by: nfc(trimWs(s!.by as string)), order: (s!.order === 'desc' ? 'desc' : 'asc') };
    else badKey('sort');
  }
  if (has('limit')) { if (typeof y.limit === 'number' && Number.isInteger(y.limit) && y.limit >= 1 && y.limit <= 1000) def.limit = y.limit; else badKey('limit'); }
  if (has('view')) { if (y.view === 'list' || y.view === 'table') def.view = y.view; else badKey('view'); }
  if (has('columns')) { if (isStrList(y.columns)) def.columns = y.columns.map(nfc); else { badKey('columns'); def.columns = colsFor(def.types); } }
  else def.columns = colsFor(def.types);
  const filterBroken: BrokenDto[] = [];
  def.filters = (rawItems ?? []).map((r, i) => readItem(r, [i], false, filterBroken));
  // File order: the broken top-level keys and the broken items by where they stand.
  const rank = (b: BrokenDto) => (b.at === null ? ORDER.indexOf(b.key as never) : ORDER.indexOf('filters')) * 10000 + (b.at?.[0] ?? 0) * 100 + (b.at?.[1] ?? 0);
  const all = [...broken, ...filterBroken].sort((a, b) => rank(a) - rank(b));
  const iso = (v: unknown) => (typeof v === 'string' && ISO_DT.test(v) ? v : null);
  return {
    state: version > 1 ? 'newer' : 'ok', line: null, reason: null, def, broken: all, usesThis: usesThisIn(def.filters),
    created: iso(y.created), modified: iso(y.modified), present: Object.keys(y).map(nfc), layout: layoutOf(text, rawItems),
  };
}
function defaultColumnsNoSchema(types: string[]): string[] {
  return types.length === 1 ? ['modified'] : ['type', 'modified'];
}

/** R140: a fence body as written. */
export function fenceRead(body: string, colsFor?: (types: string[]) => string[]): { form: 'empty' | 'reference' | 'inline' | 'unreadable'; name?: string; line?: number; read?: QueryReadTwin } {
  if (body.split(/\r?\n/).every((l) => blank(l) || comment(l))) return { form: 'empty' };
  const docs = [...parseAllDocuments(body)] as Document[];
  const e = docs.flatMap((d) => d.errors)[0];
  if (e) return { form: 'unreadable', line: errorLine(body, e.pos?.[0] ?? null, e.linePos?.[0]?.line ?? null) ?? 1 };
  const top = docs[0]?.contents ?? null;
  if (!top || !isMap(top)) return { form: 'unreadable', line: 1 };
  const y = docs[0].toJSON() as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(y, 'saved')) {
    if (typeof y.saved === 'string' && trimWs(y.saved) !== '') return { form: 'reference', name: nfc(trimWs(y.saved)) };
    const i = body.split(/\r?\n/).findIndex((l) => keyAt(l, 0)?.key === 'saved');
    return { form: 'unreadable', line: i < 0 ? 1 : i + 1 };
  }
  return { form: 'inline', read: queryRead(body, true, '', colsFor) };
}

// ------------------------------------------------------------------------------------------------ writing (§1.4)

/** D-230 (`yaml_text::scalar`): plain when YAML reads it back as the same string, else JSON double quotes. `flow`: also
 *  valid inside a flow collection (`[a, b]`, `{ by: x }`). */
export function scalar(v: string, flow = false): string {
  const s = nfc(v);
  let back: unknown;
  try { back = parseYaml(flow ? `k: [${s}]` : `k: ${s}`); } catch { back = null; }
  const got = back && typeof back === 'object' ? (back as Record<string, unknown>).k : undefined;
  const same = flow ? Array.isArray(got) && got.length === 1 && got[0] === s : got === s;
  const plain = s !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/\s$/.test(s) && !s.includes(': ') && !s.includes(' #')
    && (!flow || !/[,[\]{}]/.test(s)) && same;
  return plain ? s : JSON.stringify(s);
}
function valueText(v: unknown): string {
  if (typeof v === 'string') return scalar(v, true);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(valueText).join(', ')}]`;
  return `{ ${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${scalar(k, true)}: ${valueText(x)}`).join(', ')} }`;
}
const flowList = (xs: string[]) => `[${xs.map((x) => scalar(x, true)).join(', ')}]`;
/** One item's lines at `dash` indent (R138 style). */
function itemLines(it: FilterItemDto, dash: number): string[] {
  const d = ' '.repeat(dash);
  if (it.kind === 'group') {
    const k = ' '.repeat(dash + 4);
    const inner = it.filters.flatMap((f) => itemLines(f, dash + 6));
    return [`${d}- group:`, `${k}match: ${it.match}`, ...(inner.length ? [`${k}filters:`, ...inner] : [`${k}filters: []`])];
  }
  if (it.kind === 'raw') return [];
  const key = scalar(it.key, true);
  if (it.op === 'is') return [`${d}- ${key}: ${valueText(it.value)}`];
  return [`${d}- ${key}: { ${it.op}: ${valueText(it.value)} }`];
}
const topLine = (k: string, def: QueryDefDto): string[] | null => {
  switch (k) {
    case 'types': return [`types: ${flowList(def.types)}`];
    case 'match': return [`match: ${def.match}`];
    case 'sort': return [`sort: { by: ${scalar(def.sort.by, true)}, order: ${def.sort.order} }`];
    case 'limit': return [`limit: ${def.limit}`];
    case 'view': return [`view: ${def.view}`];
    case 'columns': return [`columns: ${flowList(def.columns)}`];
    default: return null;
  }
};

/** Semantic form of a definition's filters: `src` dropped except for raw items (which are their source). */
function normItems(items: FilterItemDto[], keepRawSrc = true): unknown[] {
  return items.map((i) => (i.kind === 'filter' ? { k: 'f', key: nfc(i.key), op: i.op, value: normValue(i.value) } : i.kind === 'group' ? { k: 'g', match: i.match, filters: normItems(i.filters, keepRawSrc) } : { k: 'r', src: keepRawSrc ? i.src : null }));
}
const sameItem = (a: FilterItemDto, b: FilterItemDto) => json(normItems([a])) === json(normItems([b]));
function effective(def: QueryDefDto, k: string, keepRawSrc = true): string {
  switch (k) {
    case 'types': return json(def.types.map(nfc));
    case 'match': return def.match;
    case 'filters': return json(normItems(def.filters, keepRawSrc));
    case 'sort': return json([nfc(def.sort.by), def.sort.order]);
    case 'limit': return String(def.limit);
    case 'view': return def.view;
    case 'columns': return json(def.columns.map(nfc));
    default: return '';
  }
}

/** The filters block for a commit: unchanged items keep their own lines (full-line comments dropped, D-1436); a changed
 *  item's first line is re-emitted and its extra-key lines kept; raw items keep their lines. */
function filtersBlock(def: QueryDefDto, read: QueryReadTwin): string[] {
  if (!def.filters.length) return ['filters: []'];
  const L = read.layout!;
  const T = L.lines.map((l) => l.text);
  const old = read.def.filters;
  const out = ['filters:'];
  for (const it of def.filters) {
    const at = it.src && it.src.length === 1 ? it.src[0] : null;
    const range = at !== null && L.items ? L.items[at] : undefined;
    const was = at !== null ? old[at] : undefined;
    const reindent = (l: string) => (range && range.dash !== 2 ? (range.dash > 2 ? l.slice(range.dash - 2) : ' '.repeat(2 - range.dash) + l) : l);
    const own = range ? T.slice(range.start, range.end).filter((l) => content(l)).map(reindent) : [];
    if (it.kind === 'raw' || (was && range && sameItem(it, was))) { out.push(...own); continue; }
    const fresh = itemLines(it, 2);
    if (range && was && was.kind === 'filter' && it.kind === 'filter') {
      // Extra keys: lines at the item's key indent that start another key, with their deeper lines.
      const extra: string[] = [];
      let inExtra = false;
      for (const l of own.slice(1)) {
        const ind = spaces(l);
        if (ind === 4 && keyAt(l, 4)) inExtra = true;
        else if (ind <= 4) inExtra = false;
        if (inExtra) extra.push(l);
      }
      out.push(...fresh, ...extra);
    } else out.push(...fresh);
  }
  return out;
}

/** §1.4 `patch`: the next text of a commit, `text: null` when it equals `text` (no write), or the refusal. */
export function queryPatch(text: string, read: QueryReadTwin, def: QueryDefDto, now: string): { text: string | null } | { error: QueriesErr } {
  if (read.state === 'newer') return { error: { kind: 'NewerVersion', message: 'fake: made by a newer version of Tegg' } };
  if (read.state === 'unreadable' || !read.layout) return { error: { kind: 'Unreadable', message: 'fake: the query file can\'t be read' } };
  if (!(Number.isInteger(def.limit) && def.limit >= 1 && def.limit <= 1000)) return { error: { kind: 'Limit', message: 'fake: limit outside 1…1000' } };
  const L = read.layout;
  const changed = (['types', 'match', 'filters', 'sort', 'limit', 'view', 'columns'] as const).filter((k) => effective(read.def, k) !== effective(def, k));
  if (!changed.length) return { text: null };
  const edits: { start: number; end: number; lines: string[]; order: number }[] = [];
  const emit = (k: string): string[] => (k === 'filters' ? filtersBlock(def, read) : k === 'modified' ? [`modified: ${now}`] : topLine(k, def)!);
  const placeOf = (k: string): number => {
    const idx = ORDER.indexOf(k as never);
    for (let j = idx - 1; j >= 0; j--) { const r = L.keys.find((x) => x.key === ORDER[j]); if (r) return r.end; }
    for (let j = idx + 1; j < ORDER.length; j++) { const r = L.keys.find((x) => x.key === ORDER[j]); if (r) return r.start; }
    return L.lines.length;
  };
  for (const k of [...changed, 'modified']) {
    const r = L.keys.find((x) => x.key === k);
    const lines = emit(k);
    if (r) {
      // A one-line key keeps its trailing comment (D-1457).
      if (r.end - r.start === 1 && lines.length === 1) {
        const old = L.lines[r.start].text;
        const c = trailingCommentAt(old, keyAt(old.replace(/^﻿/, ''), 0)!.colon + 1);
        if (c >= 0) lines[0] += old.slice(c);
      }
      edits.push({ start: r.start, end: r.end, lines, order: ORDER.indexOf(k as never) });
    } else edits.push({ start: placeOf(k), end: placeOf(k), lines, order: ORDER.indexOf(k as never) });
  }
  edits.sort((a, b) => b.start - a.start || b.order - a.order);
  const out = L.lines.map((l) => ({ ...l }));
  const bom = out[0]?.text.startsWith('﻿') ? '﻿' : '';
  for (const e of edits) {
    const add = e.lines.map((t) => ({ text: t, end: L.eol }));
    if (e.start === 0 && bom && add.length) add[0].text = bom + add[0].text.replace(/^﻿/, '');
    out.splice(e.start, e.end - e.start, ...add);
  }
  for (const l of out) if (l.end === '') l.end = L.eol;
  if (!L.final && out.length) out[out.length - 1].end = '';
  const next = joinLines(out);
  // Read-back check (D-1458): the new text must read as exactly `def` (the title aside).
  const back = queryRead(next, true, read.def.title);
  const want = { ...def, title: read.def.title };
  const keys = (['types', 'match', 'filters', 'sort', 'limit', 'view', 'columns'] as const).filter((k) => k !== 'columns' || back.present.includes('columns'));
  const ok = back.state === 'ok' && keys.every((k) => effective(back.def, k, false) === effective(want, k, false));
  if (!ok) return { error: { kind: 'Unreadable', message: 'fake: the written file would not read back as the query' } };
  return { text: next === text ? null : next };
}

/** §1.4 `create_text`. */
export function queryCreateText(def: QueryDefDto, now: string, tail?: string | null): string {
  const L = [
    `${HEADER}${nfc(def.title)}.`, 'version: 1', `title: ${scalar(def.title)}`, ...topLine('types', def)!, ...topLine('match', def)!,
    ...(def.filters.length ? ['filters:', ...def.filters.flatMap((f) => itemLines(f, 2))] : ['filters: []']),
    ...topLine('sort', def)!, ...topLine('limit', def)!, ...topLine('view', def)!, ...topLine('columns', def)!, `created: ${now}`, `modified: ${now}`,
  ];
  if (tail) L.push(...tail.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  return `${L.join('\n')}\n`;
}

/** §1.4 `from_inline`: the inline fence's definition and its unknown keys and comments (top level), as `create_text`
 *  inputs. */
export function queryFromInline(read: QueryReadTwin, body: string): { def: QueryDefDto; tail: string | null } {
  const T = splitLines(body).map((l) => l.text);
  const known = new Set<string>([...ORDER, 'saved']);
  const keep: string[] = [];
  let inUnknown = false;
  for (const t of T) {
    if (blank(t)) continue;
    if (spaces(t) === 0 && comment(t)) { keep.push(t); inUnknown = false; continue; }
    if (spaces(t) === 0) { const k = keyAt(t, 0); inUnknown = !!k && !known.has(k.key); if (inUnknown) keep.push(t); continue; }
    if (inUnknown) keep.push(t);
  }
  return { def: read.def, tail: keep.length ? keep.join('\n') : null };
}

/** Replaces (or inserts) one top-level one-line key, keeping a trailing comment. */
function setKey(L: QueryLayout, out: Line[], k: string, line: string, insertAt: () => number) {
  const r = L.keys.find((x) => x.key === k);
  if (r) {
    const old = L.lines[r.start].text;
    const c = trailingCommentAt(old, keyAt(old.replace(/^﻿/, ''), 0)!.colon + 1);
    out[r.start] = { text: (old.startsWith('﻿') ? '﻿' : '') + line + (c >= 0 && r.end - r.start === 1 ? old.slice(c) : ''), end: out[r.start].end };
    for (let i = r.start + 1; i < r.end; i++) out[i] = { text: '\u0000', end: '' };
  } else {
    const at = insertAt();
    (out as (Line & { ins?: string[] })[])[Math.max(0, at - 1)] ??= { text: '', end: L.eol };
    const host = out[Math.max(0, at - 1)] as Line & { ins?: string[] };
    if (at === 0) (out as any).pre = [...((out as any).pre ?? []), line];
    else host.ins = [...(host.ins ?? []), line];
  }
}
function rebuild(L: QueryLayout, out: (Line & { ins?: string[] })[]): string {
  const res: Line[] = [];
  for (const t of ((out as any).pre ?? []) as string[]) res.push({ text: t, end: L.eol });
  for (const l of out) {
    if (l.text !== '\u0000') res.push({ text: l.text, end: l.end });
    for (const t of l.ins ?? []) res.push({ text: t, end: L.eol });
  }
  for (const l of res) if (l.end === '') l.end = L.eol;
  if (!L.final && res.length) res[res.length - 1].end = '';
  return joinLines(res);
}
const placeAfterKnown = (L: QueryLayout, k: string) => () => {
  const idx = ORDER.indexOf(k as never);
  for (let j = idx - 1; j >= 0; j--) { const r = L.keys.find((x) => x.key === ORDER[j]); if (r) return r.end; }
  for (let j = idx + 1; j < ORDER.length; j++) { const r = L.keys.find((x) => x.key === ORDER[j]); if (r) return r.start; }
  return L.header;
};

/** §1.4 `duplicate_text`: only the `title:`, `created:`, `modified:` lines replaced (inserted when missing). */
export function queryDuplicateText(text: string, read: QueryReadTwin, title: string, now: string): string {
  const L = read.layout ?? layoutOf(text, []);
  const out = L.lines.map((l) => ({ ...l }));
  setKey(L, out, 'title', `title: ${scalar(title)}`, placeAfterKnown(L, 'title'));
  setKey(L, out, 'created', `created: ${now}`, placeAfterKnown(L, 'created'));
  setKey(L, out, 'modified', `modified: ${now}`, placeAfterKnown(L, 'modified'));
  return rebuild(L, out);
}
/** §1.4 `retitle_text`: only the `title:` line (after `version`, else first after the header comments, when missing). */
export function queryRetitleText(text: string, read: QueryReadTwin, title: string): string {
  const L = read.layout ?? layoutOf(text, []);
  const out = L.lines.map((l) => ({ ...l }));
  const v = L.keys.find((x) => x.key === 'version');
  setKey(L, out, 'title', `title: ${scalar(title)}`, () => (v ? v.end : L.header));
  return rebuild(L, out);
}

/** §1.8 `patch_job_text`: value tokens `"[[…]]"` that resolve to a moved note get its new D-184 text (alias and subpath
 *  kept); `this` and every other byte untouched; null when nothing matches or the file is newer / unreadable. */
export function queriesJobPatch(text: string, patches: QueryPatchDto[]): string | null {
  const read = queryRead(text);
  if (read.state !== 'ok' || !read.layout) return null;
  const f = read.layout.keys.find((k) => k.key === 'filters');
  if (!f) return null;
  const L = read.layout.lines.map((l) => ({ ...l }));
  let changed = false;
  for (const p of patches) {
    if (p.kind !== 'objectMoved') continue;
    const before = p.paths.map(nfc);
    const after = before.map((x) => (x === nfc(p.from) ? nfc(p.to) : x));
    const toText = linkText(nfc(p.to), after);
    for (let i = f.start; i < f.end; i++) {
      L[i].text = L[i].text.replace(/(["'])\[\[([^\]]*)\]\]\1/g, (m, _q: string, inner: string) => {
        const cut = inner.search(/[|#]/);
        const target = cut < 0 ? inner : inner.slice(0, cut);
        const rest = cut < 0 ? '' : inner.slice(cut);
        if (resolveRoot(target, before) !== nfc(p.from)) return m;
        changed = true;
        return JSON.stringify(`[[${toText}${rest}]]`);
      });
    }
  }
  if (!changed) return null;
  const next = joinLines(L);
  return next === text ? null : next;
}
/** D-184: the stem when it is unique among `paths`, else the path without `.md`. */
function linkText(path: string, paths: string[]): string {
  const stem = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
  const same = paths.filter((x) => (x.split('/').pop() ?? x).replace(/\.md$/i, '').toLowerCase() === stem.toLowerCase());
  return same.length <= 1 ? stem : path.replace(/\.md$/i, '');
}
/** D-291 from the vault root over `paths`: a path form, else the stem (root first, then the shortest path). */
function resolveRoot(target: string, paths: string[]): string | null {
  const t = nfc(trimWs(target)).replace(/\.md$/i, '').toLowerCase();
  if (!t) return null;
  const hit = paths.find((p) => p.replace(/\.md$/i, '').toLowerCase() === t);
  if (hit) return hit;
  if (t.includes('/')) return null;
  const c = paths.filter((p) => (p.split('/').pop() ?? p).replace(/\.md$/i, '').toLowerCase() === t)
    .sort((a, b) => Number(a.includes('/')) - Number(b.includes('/')) || [...a].length - [...b].length || byBytes(a, b));
  return c[0] ?? null;
}

/** v1-pinned §1.9 `QueryRenamed`: replaces the value token of every `query:` item whose name key is `from`'s. */
export function pinsQueryRenamed(text: string, from: string, to: string): string | null {
  const L = splitLines(text);
  let changed = false;
  for (const l of L) {
    const m = /^(\s*(?:-\s+)?query:[ \t]*)(.*?)([ \t]+#.*)?$/.exec(l.text);
    if (!m) continue;
    let v: unknown;
    try { v = parseYaml(`k: ${m[2]}`)?.k; } catch { continue; }
    if (typeof v !== 'string' || nameKey(v) !== nameKey(from)) continue;
    l.text = m[1] + scalar(to) + (m[3] ?? '');
    changed = true;
  }
  return changed ? joinLines(L) : null;
}

// ------------------------------------------------------------------------------------------------ fences in notes (§1.3)

export type QueryFenceTwin = { range: [number, number]; body: string; saved: string | null; nested: boolean; info: string };
let docMod: any = null;
let schemaMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));
const schema = async () => (schemaMod ??= await import('@tegg/schema'));

/** Every fenced code block whose info string's first word is exactly `query` (any depth; frontmatter skipped). `range`
 *  in UTF-8 bytes. */
export async function queryFencesOf(text: string): Promise<QueryFenceTwin[]> {
  const d = await doc();
  const start = d.parse(text).bodyStart as number;
  const body = text.slice(start);
  const tree = d.markdownTree(body);
  const out: QueryFenceTwin[] = [];
  const bytes = (i: number) => Buffer.byteLength(text.slice(0, start + i));
  const walk = (n: any, depth: number) => {
    if (n.type === 'code' && n.lang === 'query' && n.position) {
      const from = n.position.start.offset as number;
      let to = n.position.end.offset as number;
      if (body[to] === '\r' && body[to + 1] === '\n') to += 2; else if (body[to] === '\n') to += 1;
      const info = n.meta ? `${n.lang} ${n.meta}` : n.lang;
      const r = fenceRead(n.value ?? '');
      out.push({ range: [bytes(from), bytes(to)], body: n.value ?? '', saved: r.form === 'reference' ? r.name! : null, nested: depth > 1, info });
    }
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(tree, 0);
  return out;
}

// ------------------------------------------------------------------------------------------------ query files in the vault

const isQueryFile = (p: string) => p.startsWith(`${QUERIES_DIR}/`) && /^[^/.][^/]*\.yml$/.test(p.slice(QUERIES_DIR.length + 1)) && !p.includes('.tegg-tmp');
const stemOf = (p: string) => nfc((p.split('/').pop() ?? p).replace(/\.yml$/i, '').replace(/\.md$/i, ''));
export function liveQueryPaths(files: Record<string, string>): string[] {
  return Object.keys(files).map(nfc).filter(isQueryFile).sort((a, b) => byBytes(stemOf(a), stemOf(b)));
}
/** D-1475: exact NFC stem first, else the first name-key match in NFC byte order. */
export function findLive(files: Record<string, string>, name: string): string | null {
  const paths = liveQueryPaths(files);
  const n = nfc(trimWs(name));
  return paths.find((p) => stemOf(p) === n) ?? paths.find((p) => nameKey(stemOf(p)) === nameKey(n)) ?? null;
}
/** The newest trashed file of `name` (`<stem>.yml` or `<stem> (n).yml`; the highest `n` counts as newest). */
export function findTrashed(files: Record<string, string>, name: string): string | null {
  const k = nameKey(name);
  const c = Object.keys(files).map(nfc).filter((p) => p.startsWith(`${TRASHED_QUERIES_DIR}/`) && p.endsWith('.yml')).flatMap((p) => {
    const s = stemOf(p);
    const m = / \((\d+)\)$/.exec(s);
    if (nameKey(s) === k) return [[1, p] as const];
    if (m && nameKey(s.slice(0, m.index)) === k) return [[Number(m[1]), p] as const];
    return [];
  }).sort((a, b) => b[0] - a[0]);
  return c[0]?.[1] ?? null;
}
function freePath(files: Record<string, string>, dir: string, stem: string): string {
  const taken = new Set(Object.keys(files).map((p) => nameKey(p)));
  for (let n = 1; ; n++) {
    const p = `${dir}/${n === 1 ? stem : `${stem} (${n})`}.yml`;
    if (!taken.has(nameKey(p))) return p;
  }
}
/** D-51, D-52: forbidden characters as a space, runs of spaces as one, ≤ 200 UTF-8 bytes. */
export function sanitizeStem(t: string): string {
  const s = nfc(t).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim();
  let out = '';
  for (const ch of s) { if (Buffer.byteLength(out + ch) > 200) break; out += ch; }
  return out.trimEnd();
}

// ------------------------------------------------------------------------------------------------ types and columns

type Kind = 'text' | 'select' | 'review' | 'multi' | 'tags' | 'date' | 'datetime' | 'number' | 'checkbox' | 'relation' | 'unsupported';
const KIND_OF: Record<string, Kind> = {
  text: 'text', 'long-text': 'text', url: 'text', email: 'text', select: 'select', 'multi-select': 'multi', date: 'date',
  'date-time': 'datetime', number: 'number', rating: 'number', currency: 'number', checkbox: 'checkbox', relation: 'relation',
};
const UNIVERSAL: Record<string, Kind> = { title: 'text', tags: 'tags', created: 'datetime', modified: 'datetime', review: 'review', source: 'relation', aliases: 'text' };
/** R139: operators per kind, in R139 order. */
export const OPS_BY_KIND: Record<Exclude<Kind, 'unsupported'> | 'links', QueryOp[]> = {
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
type AttrInfo = { kind: Kind; options: { label: string; state: string | null }[] };
/** The attribute `key` of one type: schema attributes (date-range halves `<key>-start` / `<key>-end`), the universal
 *  ones; null when the type lacks it. */
function attrOf(t: TypeDto | undefined, key: string): AttrInfo | null {
  if (key in UNIVERSAL) return { kind: UNIVERSAL[key], options: [] };
  if (!t) return null;
  for (const a of (t.attributes ?? []) as any[]) {
    const k = nfc(String(a.key));
    if (a.type === 'date-range' && (key === `${k}-start` || key === `${k}-end`)) return { kind: 'date', options: [] };
    if (k === key) return { kind: KIND_OF[String(a.type)] ?? 'unsupported', options: (a.options ?? []).map((o: any) => ({ label: nfc(String(o.label)), state: o.state ?? null })) };
  }
  return null;
}
/** The effective type-page columns of one type (type-columns.md §3). */
export function effectiveColumnsOf(t: TypeDto | undefined): string[] {
  if (!t) return ['modified'];
  const review = t.review === 'on' || t.review === 'locked';
  const choices = new Set([...(t.attributes ?? []).map((a: any) => nfc(String(a.key))), 'tags', 'source', 'aliases', ...(review ? ['review'] : []), 'created', 'modified']);
  if (Array.isArray(t.columns)) {
    const out: string[] = [];
    for (const k of (t.columns as string[]).map(nfc)) if (choices.has(k) && !out.includes(k)) out.push(k);
    return out;
  }
  const attrs = new Set((t.attributes ?? []).map((a: any) => nfc(String(a.key))));
  const out: string[] = [];
  for (const k of ((t.preview ?? []) as string[]).map(nfc)) if ((attrs.has(k) || ['tags', 'source', 'aliases', 'created'].includes(k)) && !out.includes(k)) out.push(k);
  return [...out, 'modified'];
}
export function columnsDefault(types: TypeDto[]) {
  return (chosen: string[]) => (chosen.length === 1 ? effectiveColumnsOf(types.find((t) => t.key === chosen[0])) : ['type', 'modified']);
}

// ------------------------------------------------------------------------------------------------ the evaluator (§1.6)

const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const isoWeekday = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
const dateFmt = new Map<string, Intl.DateTimeFormat>();
/** A date as written; a date-time by its local date in `tz` (D-104); null otherwise. */
export function localDate(v: unknown, tz: string): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (DATE.test(s)) return s;
  if (!ISO_DT.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  let f = dateFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); dateFmt.set(tz, f); }
  return f.format(new Date(ms));
}
/** An instant in ms: a date-time as written, a date at its local midnight in `tz`. */
function instantMs(v: unknown, tz: string): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (ISO_DT.test(s)) { const ms = Date.parse(s); return Number.isNaN(ms) ? null : ms; }
  if (!DATE.test(s)) return null;
  const guess = Date.parse(`${s}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return guess - (asLocal - guess);
}
const isEmptyValue = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined && !(typeof x === 'string' && x.trim() === '')).map((x) => (typeof x === 'string' ? x : String(x)));
const linkTargetOf = (v: unknown): string | null => { const m = typeof v === 'string' ? /^\[\[([^\]|#]*)(?:[|#][^\]]*)?\]\]$/.exec(v.trim()) : null; return m ? nfc(m[1].trim()) : null; };

type Ctx = {
  objs: Obj[]; byPath: Map<string, Obj>; types: TypeDto[]; env: QueryEnvDto; host: string | null; hostObj: Obj | null; hostDaily: string | null;
  res: (from: string, target: string) => string | null; outLinks: Map<string, string[]>; targets: Set<string>;
};
type Check = { broken: BrokenReason | null; type: string | null; kind: Kind | 'links' | null; needsDate: boolean };

/** Run-time validity of one filter (R139): null when valid. */
function check(f: Extract<FilterItemDto, { kind: 'filter' }>, chosen: string[], ctx: Ctx): Check {
  const key = nfc(f.key);
  if (key === 'links_to' || key === 'linked_from') {
    const ok = f.op === 'is' && (f.value === 'this' || linkTargetOf(f.value) !== null);
    return { broken: ok ? null : f.op === 'is' ? 'value' : 'operatorKind', type: null, kind: 'links', needsDate: false };
  }
  let info: AttrInfo | null = null;
  if (chosen.length === 0) { if (key in UNIVERSAL) info = attrOf(undefined, key); else return { broken: 'notAttribute', type: null, kind: null, needsDate: false }; }
  else {
    for (const t of chosen) {
      const a = attrOf(ctx.types.find((x) => x.key === t), key);
      if (!a) return { broken: 'notAttribute', type: t, kind: null, needsDate: false };
      if (info && a.kind !== info.kind) return { broken: 'notAttribute', type: t, kind: null, needsDate: false };
      info ??= a;
    }
  }
  const kind = info!.kind;
  if (kind === 'unsupported' || !OPS_BY_KIND[kind].includes(f.op)) return { broken: 'operatorKind', type: null, kind, needsDate: false };
  const v = f.value;
  const isDate = (x: unknown) => typeof x === 'string' && DATE.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`));
  let ok = true, needsDate = false;
  switch (f.op) {
    case 'is_empty': case 'is_not_empty': case 'today': case 'this_week': case 'overdue': ok = v === true; break;
    case 'is': case 'is_not':
      if (kind === 'checkbox') ok = typeof v === 'boolean';
      else if (kind === 'date' || kind === 'datetime') { ok = isDate(v) || (f.op === 'is' && v === 'this'); needsDate = v === 'this'; }
      else ok = typeof v === 'string' || typeof v === 'number';
      break;
    case 'contains': ok = typeof v === 'string' || typeof v === 'number'; break;
    case 'is_any_of': case 'has_any_of': case 'has_all_of': case 'has_none_of': ok = isStrList(v) && v.length > 0; break;
    case 'before': case 'after': ok = isDate(v) || v === 'this'; needsDate = v === 'this'; break;
    case 'between':
      if (kind === 'number') ok = Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number') && (v[0] as number) <= (v[1] as number);
      else ok = Array.isArray(v) && v.length === 2 && v.every(isDate) && (v[0] as string) <= (v[1] as string);
      break;
    case 'within_next_days': ok = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3650; break;
    case 'eq': case 'ne': case 'lt': case 'gt': ok = typeof v === 'number'; break;
    case 'links_to': ok = v === 'this' || linkTargetOf(v) !== null; break;
  }
  return { broken: ok ? null : 'value', type: null, kind, needsDate };
}

function valueOf(o: Obj, key: string): unknown {
  if (key === 'title') return o.title;
  if (key === 'tags') return o.tags ?? [];
  return (o.attributes ?? {})[key];
}
function statusState(o: Obj, ctx: Ctx): string {
  const t = ctx.types.find((x) => x.key === o.type);
  const a = attrOf(t, 'status');
  const s = o.attributes?.status;
  const opt = a?.options.find((x) => typeof s === 'string' && fold(x.label) === fold(s));
  return opt?.state ?? 'open';
}
function targetOfValue(v: unknown, ctx: Ctx): string | null {
  if (v === 'this') return ctx.host;
  const t = linkTargetOf(v);
  if (t === null) return null;
  const p = ctx.res('', t);
  if (p) ctx.targets.add(p);
  return p;
}
function matches(f: Extract<FilterItemDto, { kind: 'filter' }>, c: Check, o: Obj, ctx: Ctx): boolean {
  const key = nfc(f.key);
  const v = f.value;
  if (c.kind === 'links') {
    const x = targetOfValue(v, ctx);
    if (!x) return false;
    if (key === 'links_to') return (ctx.outLinks.get(o.path) ?? []).includes(x);
    const from = x === ctx.host && ctx.hostObj ? ctx.hostObj : ctx.byPath.get(x);
    return !!from && linksOf(from, ctx).includes(o.path);
  }
  const raw = valueOf(o, key);
  const kind = c.kind as Kind;
  if (f.op === 'is_empty') return isEmptyValue(raw);
  if (f.op === 'is_not_empty') return !isEmptyValue(raw);
  switch (kind) {
    case 'text': case 'select': case 'review': {
      const vals = strs(raw).map(fold);
      if (f.op === 'is') return vals.includes(fold(String(v)));
      if (f.op === 'is_not') return vals.length > 0 && !vals.includes(fold(String(v)));
      if (f.op === 'contains') return vals.some((x) => x.includes(fold(String(v))));
      if (f.op === 'is_any_of') return (v as string[]).some((w) => vals.includes(fold(w)));
      return false;
    }
    case 'multi': case 'tags': {
      const norm = kind === 'tags' ? tagKeyOf : fold;
      const vals = strs(raw).map(norm);
      const want = (v as string[]).map(norm);
      if (f.op === 'has_any_of') return want.some((w) => vals.includes(w));
      if (f.op === 'has_all_of') return want.every((w) => vals.includes(w));
      if (f.op === 'has_none_of') return !want.some((w) => vals.includes(w));
      return false;
    }
    case 'date': case 'datetime': {
      const d = localDate(raw, ctx.env.zone);
      if (d === null) return false;
      const day = (x: unknown) => (x === 'this' ? ctx.hostDaily : (x as string));
      const today = ctx.env.today;
      switch (f.op) {
        case 'is': return d === day(v);
        case 'before': return d < day(v)!;
        case 'after': return d > day(v)!;
        case 'between': return d >= (v as string[])[0] && d <= (v as string[])[1];
        case 'today': return d === today;
        case 'this_week': { const s = addDays(today, -((isoWeekday(today) - ctx.env.weekStart + 7) % 7)); return d >= s && d <= addDays(s, 6); }
        case 'within_next_days': return d >= today && d <= addDays(today, v as number);
        case 'overdue': return d < today && (o.type !== 'task' || ['open', 'in-progress'].includes(statusState(o, ctx)));
      }
      return false;
    }
    case 'number': {
      if (typeof raw !== 'number') return false;
      if (f.op === 'eq') return raw === v;
      if (f.op === 'ne') return raw !== v;
      if (f.op === 'lt') return raw < (v as number);
      if (f.op === 'gt') return raw > (v as number);
      if (f.op === 'between') return raw >= (v as number[])[0] && raw <= (v as number[])[1];
      return false;
    }
    case 'checkbox': return v === true ? raw === true : raw !== true;
    case 'relation': {
      const x = targetOfValue(v, ctx);
      if (!x) return false;
      return o.links.filter((l: any) => l.inFrontmatter && nfc(String(l.attribute ?? '')) === key).some((l: any) => ctx.res(o.path, l.target) === x);
    }
  }
  return false;
}
function linksOf(o: Obj, ctx: Ctx): string[] {
  return o.links.map((l: any) => ctx.res(o.path, l.target)).filter((p: string | null): p is string => !!p);
}

type Active = { kind: 'filter'; f: Extract<FilterItemDto, { kind: 'filter' }>; c: Check } | { kind: 'group'; match: 'all' | 'any'; items: Active[] };
function activeItems(items: FilterItemDto[], chosen: string[], ctx: Ctx, broken: BrokenDto[]): Active[] {
  const out: Active[] = [];
  for (const it of items) {
    if (it.kind === 'raw') continue;
    if (it.kind === 'group') {
      const inner = activeItems(it.filters, chosen, ctx, broken);
      if (inner.length) out.push({ kind: 'group', match: it.match, items: inner });
      continue;
    }
    const c = check(it, chosen, ctx);
    if (c.broken) { broken.push({ reason: c.broken, at: it.src, key: nfc(it.key), type: c.type }); continue; }
    out.push({ kind: 'filter', f: it, c });
  }
  return out;
}
const evalItems = (items: Active[], match: 'all' | 'any', o: Obj, ctx: Ctx): boolean => {
  if (!items.length) return true;
  const one = (a: Active) => (a.kind === 'group' ? evalItems(a.items, a.match, o, ctx) : matches(a.f, a.c, o, ctx));
  return match === 'all' ? items.every(one) : items.some(one);
};
const walkActive = (items: Active[], f: (a: Extract<Active, { kind: 'filter' }>) => void) => { for (const a of items) { if (a.kind === 'group') walkActive(a.items, f); else f(a); } };

function sortRows(objs: Obj[], def: QueryDefDto, chosen: string[], ctx: Ctx, broken: BrokenDto[]): Obj[] {
  const coll = new Intl.Collator(ctx.env.locale, { sensitivity: 'base', numeric: true });
  let by = nfc(def.sort.by);
  let order = def.sort.order;
  let kind: Kind | null = by === 'title' ? 'text' : by === 'created' || by === 'modified' ? 'datetime' : null;
  let options: string[] = [];
  if (!kind) {
    const infos = chosen.length ? chosen.map((t) => attrOf(ctx.types.find((x) => x.key === t), by)) : [attrOf(undefined, by)];
    if (infos.every((a) => a && a.kind === infos[0]!.kind && a.kind !== 'unsupported')) { kind = infos[0]!.kind; options = infos[0]!.options.map((o) => fold(o.label)); }
    else { broken.push({ reason: 'badValue', at: null, key: 'sort', type: null }); by = DEFAULT_SORT.by; order = DEFAULT_SORT.order; kind = 'datetime'; }
  }
  type K = { empty: boolean; n: number; s: string };
  const keyOf = (o: Obj): K => {
    const raw = valueOf(o, by);
    if (by === 'title') return { empty: false, n: 0, s: o.title };
    switch (kind) {
      case 'number': return typeof raw === 'number' ? { empty: false, n: raw, s: '' } : { empty: true, n: 0, s: '' };
      case 'date': case 'datetime': { const ms = instantMs(raw, ctx.env.zone); return ms === null ? { empty: true, n: 0, s: '' } : { empty: false, n: ms, s: '' }; }
      case 'checkbox': return typeof raw === 'boolean' ? { empty: false, n: raw ? 1 : 0, s: '' } : { empty: true, n: 0, s: '' };
      case 'select': case 'review': {
        const s = strs(raw)[0];
        if (s === undefined) return { empty: true, n: 0, s: '' };
        const i = options.indexOf(fold(s));
        return { empty: false, n: i < 0 ? options.length : i, s };
      }
      default: { const s = strs(raw)[0]; return s === undefined ? { empty: true, n: 0, s: '' } : { empty: false, n: 0, s }; }
    }
  };
  const keys = new Map(objs.map((o) => [o.path, keyOf(o)]));
  const sign = order === 'desc' ? -1 : 1;
  return [...objs].sort((a, b) => {
    const x = keys.get(a.path)!, y = keys.get(b.path)!;
    if (x.empty !== y.empty) return x.empty ? 1 : -1;
    if (!x.empty) {
      const c = x.n - y.n || coll.compare(x.s, y.s);
      if (c) return sign * c;
    }
    return coll.compare(a.title, b.title) || byBytes(a.path, b.path);
  });
}

async function context(files: Record<string, string>, host: string | null, env: QueryEnvDto, types?: TypeDto[]): Promise<Ctx> {
  const d = await doc();
  const s = await schema();
  const objs = objectsWith(files, d, s);
  const byPath = new Map(objs.map((o) => [o.path, o]));
  const r = resolver(objs);
  const res = (from: string, target: string) => { const x = r(from, target); return x.kind === 'note' || x.kind === 'daily' ? x.path : null; };
  let hostObj: Obj | null = host ? byPath.get(nfc(host)) ?? null : null;
  if (host && !hostObj && files[nfc(host)] !== undefined) {
    // A host outside the index (a template opened as a file, a note in `.trash/`): its own reading.
    const one = objectsWith({ [`__host__/${(nfc(host).split('/').pop() ?? host)}`]: files[nfc(host)] }, d, s)[0];
    hostObj = one ? { ...one, path: nfc(host) } : null;
  }
  const ctx: Ctx = { objs, byPath, types: types ?? listTypes(files, {}), env, host: host ? nfc(host) : null, hostObj, hostDaily: hostObj?.daily ?? null, res, outLinks: new Map(), targets: new Set() };
  for (const o of objs) ctx.outLinks.set(o.path, linksOf(o, ctx));
  return ctx;
}

/** The evaluator over the fake's files (§1.6): every result, sorted (the page size is the UI's, D-1451). */
export async function evaluate(def: QueryDefDto, host: string | null, env: QueryEnvDto, files: Record<string, string>, types?: TypeDto[]):
  Promise<Pick<QueryResultDto, 'state' | 'broken' | 'targets' | 'usesRelative' | 'total' | 'rows'>> {
  const ctx = await context(files, host, env, types);
  const broken: BrokenDto[] = [];
  const chosen = def.types.map(nfc);
  const missing = chosen.filter((t) => !ctx.types.some((x) => x.key === t) && !ctx.objs.some((o) => o.type === t));
  if (missing.length) {
    for (const t of missing) broken.push({ reason: 'noType', at: null, key: t, type: null });
    return { state: 'noType', broken, targets: [], usesRelative: false, total: 0, rows: [] };
  }
  const active = activeItems(def.filters, chosen, ctx, broken);
  let usesThis = false, dateThis = false, relative = false;
  walkActive(active, (a) => {
    if (a.f.value === 'this') { usesThis = true; if (a.c.needsDate) dateThis = true; }
    if (['today', 'this_week', 'within_next_days', 'overdue'].includes(a.f.op) || a.c.needsDate) relative = true;
  });
  if (usesThis && !ctx.host) return { state: 'needsHost', broken, targets: [], usesRelative: relative, total: 0, rows: [] };
  if (dateThis && !ctx.hostDaily) return { state: 'needsContext', broken, targets: ctx.host ? [ctx.host] : [], usesRelative: relative, total: 0, rows: [] };
  if (usesThis && ctx.host) ctx.targets.add(ctx.host);
  const candidates = ctx.objs.filter((o) => o.path !== ctx.host && (!chosen.length || chosen.includes(o.type)));
  const hits = candidates.filter((o) => evalItems(active, def.match, o, ctx));
  const sorted = sortRows(hits, def, chosen, ctx, broken);
  const cols = [...new Set([...def.columns.map(nfc), 'type', 'tags'])];
  const rows: QueryRowDto[] = sorted.map((o) => {
    const values: Record<string, unknown> = {};
    for (const k of cols) values[k] = k === 'type' ? o.type : k === 'tags' ? (o.tags ?? []) : (o.attributes ?? {})[k] ?? null;
    const str = (x: unknown) => (typeof x === 'string' ? x : null);
    return {
      path: o.path, id: o.id, title: o.title, type: o.type, created: str(o.attributes?.created), modified: str(o.attributes?.modified), values, links: [],
      task: o.type === 'task' ? { status: str(o.attributes?.status), state: statusState(o, ctx) as any, due: localDate(o.attributes?.due, env.zone) } : null,
    };
  });
  return { state: 'ok', broken, targets: [...ctx.targets].sort(byBytes), usesRelative: relative, total: rows.length, rows };
}

/** §2 `query_run` over the fake's files. `_path` (stripped by the page) names the query file whose version is answered. */
export async function queryRun(source: QuerySourceDto, host: string | null, env: QueryEnvDto, files: Record<string, string>, types?: TypeDto[], o: { indexReady?: boolean; invalid?: string[] } = {}):
  Promise<QueryResultDto & { _path?: string | null }> {
  const tys = types ?? listTypes(files, {});
  const cols = columnsDefault(tys);
  const base: QueryResultDto & { _path?: string | null } = { form: 'def', name: null, lookup: null, line: null, version: null, def: null, state: 'ok', broken: [], targets: [], usesRelative: false, total: 0, rows: [], indexReady: o.indexReady ?? true, _path: null };
  const run = async (r: QueryResultDto & { _path?: string | null }, def: QueryDefDto, syntactic: BrokenDto[]) => {
    const e = await evaluate(def, host, env, files, tys);
    const rank = (b: BrokenDto) => (b.reason === 'noType' ? ORDER.indexOf('types') : b.at === null ? ORDER.indexOf(b.key as never) : ORDER.indexOf('filters')) * 10000 + (b.at?.[0] ?? 0) * 100 + (b.at?.[1] ?? 0);
    const broken = [...syntactic, ...e.broken].sort((a, b) => rank(a) - rank(b));
    return { ...r, def, ...e, broken };
  };
  const saved = async (name: string, form: 'reference' | 'def') => {
    const live = findLive(files, name);
    if (!live) {
      const t = findTrashed(files, name);
      return { ...base, form, name: nfc(trimWs(name)), lookup: (t ? 'trashed' : 'missing') as LookupDto, _path: null };
    }
    const read = queryRead(files[live], !(o.invalid ?? []).includes(live), stemOf(live), cols);
    const r = { ...base, form, name: stemOf(live), lookup: read.state as LookupDto, line: read.line, _path: live };
    if (read.state === 'unreadable') return r;
    return run(r, read.def, read.broken);
  };
  if (source.kind === 'saved') return saved(source.name, 'reference');
  if (source.kind === 'def') {
    const live = source.name ? findLive(files, source.name) : null;
    return run({ ...base, form: 'def', name: source.name ? nfc(source.name) : null, _path: live }, source.def, []);
  }
  const f = fenceRead(source.body, cols);
  if (f.form === 'empty') return { ...base, form: 'empty' };
  if (f.form === 'unreadable') return { ...base, form: 'unreadable', line: f.line ?? 1 };
  if (f.form === 'reference') return saved(f.name!, 'reference');
  const read = f.read!;
  if (read.state === 'unreadable') return { ...base, form: 'unreadable', line: read.line ?? 1 };
  return run({ ...base, form: 'inline' }, read.def, read.broken);
}

// ------------------------------------------------------------------------------------------------ §2 commands

export function queryDto(files: Record<string, string>, invalid: string[], name: string, types?: TypeDto[]): QueryDto {
  const cols = columnsDefault(types ?? listTypes(files, {}));
  const live = findLive(files, name);
  const asked = nfc(trimWs(name));
  const empty: QueryDto = { name: asked, path: `${QUERIES_DIR}/${asked}.yml`, state: 'missing', line: null, reason: null, version: null, text: null, def: null, broken: [], usesThis: false, created: null, modified: null, trashedPath: null };
  if (!live) {
    const t = findTrashed(files, name);
    return t ? { ...empty, state: 'trashed', trashedPath: t, text: files[t] } : empty;
  }
  const read = queryRead(files[live], !invalid.includes(live), stemOf(live), cols);
  return {
    name: stemOf(live), path: live, state: read.state, line: read.line, reason: read.reason, version: null, text: files[live],
    def: read.state === 'unreadable' ? null : read.def, broken: read.broken, usesThis: read.usesThis, created: read.created, modified: read.modified, trashedPath: null,
  };
}
export function querySummaries(files: Record<string, string>, invalid: string[]): QuerySummaryDto[] {
  return liveQueryPaths(files).map((p) => {
    const r = queryRead(files[p], !invalid.includes(p), stemOf(p));
    return { name: stemOf(p), title: r.state === 'unreadable' ? stemOf(p) : r.def.title, path: p, state: r.state, line: r.line, created: r.created, modified: r.modified, usesThis: r.usesThis, version: null };
  });
}
export async function queryUsages(files: Record<string, string>, name: string): Promise<QueryUsageDto[]> {
  const d = await doc();
  const s = await schema();
  const k = nameKey(name);
  const notes = Object.keys(files).map(nfc).filter((p) => p.endsWith('.md') && !p.split('/').some((seg, i, a) => i < a.length - 1 && seg.startsWith('.'))).sort(byBytes);
  const out: QueryUsageDto[] = [];
  for (const template of [false, true]) {
    for (const p of notes.filter((x) => x.startsWith('_templates/') === template)) {
      if (!template && p.split('/').slice(0, -1).includes('_templates')) continue;
      const fences = await queryFencesOf(files[p]);
      if (!fences.some((f) => f.saved !== null && nameKey(f.saved) === k)) continue;
      const x = d.extract(files[p], stemOf(p));
      const type = template ? null : (s.typeMatch(x.attributes && 'type' in x.attributes ? x.attributes.type : undefined).key as string);
      out.push({ path: p, title: nfc(String(x.title)), type, template });
    }
  }
  return out;
}

const defaults = (title: string, columns: string[]): QueryDefDto => ({ title, types: [], match: 'all', filters: [], sort: { ...DEFAULT_SORT }, limit: 50, view: 'list', columns });

export type HandleAnswer = { result?: unknown; error?: QueriesErr; writes?: Record<string, string | null>; moves?: { from: string; to: string }[] };
/** The Node side of the in-page fake (`__teggQueries`). Versions and base checks are the page's (it knows mtimes). */
export async function handle(cmd: string, a: any, files: Record<string, string>, invalid: string[] = [], indexReady = true): Promise<HandleAnswer> {
  const types = listTypes(files, {});
  const cols = columnsDefault(types);
  const fail = (kind: QueriesErrKind, message: string): HandleAnswer => ({ error: { kind, message: `fake: ${message}` } });
  const refuseRead = (r: QueryReadTwin) => (r.state === 'newer' ? fail('NewerVersion', 'made by a newer version of Tegg') : r.state === 'unreadable' ? fail('Unreadable', 'the query file can\'t be read') : null);
  switch (cmd) {
    case 'queries_list': return { result: querySummaries(files, invalid) };
    case 'query_get': return { result: queryDto(files, invalid, String(a.name ?? ''), types) };
    case 'query_run': return { result: await queryRun(a.source, a.host ?? null, a.env, files, types, { indexReady, invalid }) };
    case 'query_usages': return { result: await queryUsages(files, String(a.name ?? '')) };
    case 'query_apply': {
      const live = findLive(files, String(a.name ?? ''));
      if (!live) return fail('Gone', 'no such query');
      const read = queryRead(files[live], !invalid.includes(live), stemOf(live), cols);
      const r = queryPatch(files[live], read, a.def as QueryDefDto, String(a.now));
      if ('error' in r) return { error: r.error };
      const writes = r.text === null ? undefined : { [live]: r.text };
      const after = { ...files, ...(writes ?? {}) };
      return { result: { query: queryDto(after, invalid, stemOf(live), types), undo: r.text === null ? null : files[live] }, writes };
    }
    case 'query_revert': {
      const live = findLive(files, String(a.name ?? ''));
      if (!live) return fail('Gone', 'no such query');
      const bad = refuseRead(queryRead(files[live], !invalid.includes(live), stemOf(live)));
      if (bad) return bad;
      const writes = files[live] === a.text ? undefined : { [live]: String(a.text) };
      return { result: queryDto({ ...files, ...(writes ?? {}) }, invalid, stemOf(live), types), writes };
    }
    case 'query_create': {
      let title = nfc(trimWs(String(a.title ?? '')));
      if (!title) return fail('EmptyName', 'a blank name');
      let stem = sanitizeStem(title);
      if (!stem) return fail('EmptyName', 'the name sanitizes to nothing');
      const taken = (s: string) => liveQueryPaths(files).some((p) => nameKey(stemOf(p)) === nameKey(s));
      if (taken(stem)) {
        if (!a.free) return fail('NameTaken', 'a query with this name exists');
        let n = 2;
        while (taken(`${stem} (${n})`)) n++;
        stem = `${stem} (${n})`;
        title = `${title} (${n})`;
      }
      let def: QueryDefDto, tail: string | null = null;
      if (typeof a.fence === 'string') {
        const f = fenceRead(a.fence, cols);
        if (f.form !== 'inline' || !f.read || f.read.state === 'unreadable') return fail('Unreadable', 'the fence isn\'t an inline definition');
        const x = queryFromInline(f.read, a.fence);
        def = { ...x.def, title };
        tail = x.tail;
      } else def = a.def ? { ...(a.def as QueryDefDto), title } : defaults(title, cols([]));
      if (!(Number.isInteger(def.limit) && def.limit >= 1 && def.limit <= 1000)) return fail('Limit', 'limit outside 1…1000');
      const path = `${QUERIES_DIR}/${stem}.yml`;
      const text = queryCreateText(def, String(a.now), tail);
      return { result: queryDto({ ...files, [path]: text }, invalid, stem, types), writes: { [path]: text } };
    }
    case 'query_duplicate': {
      const live = findLive(files, String(a.name ?? ''));
      if (!live) return fail('NotFound', 'no such query');
      const read = queryRead(files[live], !invalid.includes(live), stemOf(live), cols);
      const bad = refuseRead(read);
      if (bad) return bad;
      const base = stemOf(live);
      let n = 2;
      while (liveQueryPaths(files).some((p) => nameKey(stemOf(p)) === nameKey(`${base} (${n})`))) n++;
      const stem = `${base} (${n})`;
      const path = `${QUERIES_DIR}/${stem}.yml`;
      const text = queryDuplicateText(files[live], read, `${read.def.title} (${n})`, String(a.now));
      return { result: queryDto({ ...files, [path]: text }, invalid, stem, types), writes: { [path]: text } };
    }
    case 'query_rename_plan': {
      const live = findLive(files, String(a.name ?? ''));
      if (!live) return fail('NotFound', 'no such query');
      const read = queryRead(files[live], !invalid.includes(live), stemOf(live), cols);
      const bad = refuseRead(read);
      if (bad) return bad;
      const title = nfc(trimWs(String(a.title ?? '')));
      const stem = sanitizeStem(title);
      if (!title || !stem) return fail('EmptyName', 'a blank name');
      if (title === read.def.title && stem === stemOf(live)) return fail('NothingToDo', 'the same name');
      if (liveQueryPaths(files).some((p) => p !== live && nameKey(stemOf(p)) === nameKey(stem))) return fail('NameTaken', 'a query with this name exists');
      const to = `${QUERIES_DIR}/${stem}.yml`;
      const usages = (await queryUsages(files, stemOf(live))).map((u) => u.path);
      return { result: { from: live, to, fromName: stemOf(live), toName: stem, pre: files[live], post: queryRetitleText(files[live], read, title), usages } };
    }
    case 'query_usage_patch': {
      // The usages' `saved:` lines through the one text engine (D-82, D-1468): `@tegg/doc` `rename-saved-query`.
      const d = await doc();
      const r = d.transform(String(a.path), String(a.text), [{ op: 'rename-saved-query', from: String(a.from), to: String(a.to) } as any]);
      return { result: r?.kind === 'bytes' ? r.text : null };
    }
    case 'pins_query_renamed': return { result: typeof a.text === 'string' ? pinsQueryRenamed(a.text, String(a.from), String(a.to)) : null };
    case 'query_trash': {
      const live = findLive(files, String(a.name ?? ''));
      if (!live) return fail('NotFound', 'no such query');
      const to = freePath(files, TRASHED_QUERIES_DIR, stemOf(live));
      return { result: { trashed: to }, moves: [{ from: live, to }] };
    }
    case 'query_restore': {
      const name = String(a.name ?? '');
      const t = a.path ? nfc(String(a.path)) : findTrashed(files, name);
      if (!t || files[t] === undefined) return fail('NotFound', 'no trashed query');
      // The query's own name: a ` (n)` the trash added is dropped again (D-1474).
      const st = stemOf(t);
      const base = name && nameKey(st) !== nameKey(name) ? st.replace(/ \(\d+\)$/, '') : st;
      const to = freePath(files, QUERIES_DIR, base);
      const after = { ...files, [to]: files[t] };
      delete after[t];
      return { result: queryDto(after, invalid, stemOf(to), types), moves: [{ from: t, to }] };
    }
    case 'queries_job': {
      const writes: Record<string, string> = {};
      for (const p of liveQueryPaths(files)) {
        if (invalid.includes(p)) continue;
        const out = queriesJobPatch(files[p], (a.patches ?? []) as QueryPatchDto[]);
        if (out !== null && out !== files[p]) writes[p] = out;
      }
      return { result: Object.keys(writes), writes };
    }
    case 'query_trash_rows': {
      const rows = Object.keys(files).map(nfc).filter((p) => p.startsWith(`${TRASHED_QUERIES_DIR}/`) && p.endsWith('.yml')).sort(byBytes).map((p) => {
        const r = queryRead(files[p], !invalid.includes(p), stemOf(p));
        return { path: p, kind: 'query', original: `${QUERIES_DIR}/${p.slice(TRASHED_QUERIES_DIR.length + 1)}`, folder: QUERIES_DIR, title: r.state === 'unreadable' ? stemOf(p) : r.def.title, type: null, files: [p], count: 1 };
      });
      return { result: rows };
    }
    case 'query_types_of': {
      // `query:stale`: the matched type key of each `.md` path now (null when it is no indexed object).
      const d = await doc();
      const s = await schema();
      const out: Record<string, string | null> = {};
      for (const p of (a.paths ?? []) as string[]) {
        const q = nfc(p);
        if (files[q] === undefined || q.split('/').some((seg, i, arr) => i < arr.length - 1 && (seg.startsWith('.') || seg === '_templates'))) { out[q] = null; continue; }
        const x = d.extract(files[q], stemOf(q));
        out[q] = s.typeMatch(x.attributes && 'type' in x.attributes ? x.attributes.type : undefined).key;
      }
      return { result: out };
    }
    default: return fail('Io', `unknown command ${cmd}`);
  }
}
