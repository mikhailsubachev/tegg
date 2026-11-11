// Fake core, slice PIN (docs/contracts/v1-pinned.md §5): `pins_get` and `pins_apply` over the fake's `.tegg/pinned.yml`,
// a TypeScript twin of §1.2's parser and patcher (R131 read and write rules) and of §1.3's resolution over the fake's
// files, checked on every tests/fixtures/pinned-files/ input and expected/ output (app/test/fake_pins.contract.test.ts;
// crates/tegg-core/tests/ac_pinned.rs reads the same files). Runs in Node (installFakeCore exposes it to the page as
// `__teggPins`). Test code, not product code.
//
// Values come from the `yaml` package (YAML 1.2); positions from a line scanner (the graph presets twin's rules, D-1122,
// D-1124, D-1129), so a write changes only the operated item's lines (AP-1228 = D-1371).
import { parse, parseAllDocuments, isMap, isScalar, isSeq } from 'yaml';
import { findLive, findTrashed, queryRead } from './fake-queries';

// ------------------------------------------------------------------------------------------------ DTOs (contract §2)

export type VersionDto = { mtimeNs: string; size: number; hash: string };
export type PinStoredDto =
  | { kind: 'object'; id: string | null; path: string | null }
  | { kind: 'tag'; key: string }
  | { kind: 'type'; key: string }
  /** Slice Q (v1-queries §1.9, D-1484, D-1501): a saved query by name (NFC). */
  | { kind: 'query'; name: string };
export type PinState = 'ok' | 'pending' | 'trashed' | 'missing' | 'noObjects';
export type PinRowDto = {
  index: number;
  target: PinStoredDto;
  state: PinState;
  path: string | null;
  title: string | null;
  type: string | null;
  date: string | null;
};
export type PinsFileState = 'missing' | 'ok' | 'newer' | 'unreadable';
export type PinsDto = {
  version: VersionDto | null;
  state: PinsFileState;
  error: { line: number | null; reason: string } | null;
  patchable: boolean;
  indexReady: boolean;
  rows: PinRowDto[];
};
export type PinRequestDto = { kind: 'object'; path: string } | { kind: 'tag'; key: string } | { kind: 'type'; key: string } | { kind: 'query'; name: string };
export type PinOpDto =
  | { op: 'pin'; target: PinRequestDto; at: number | null }
  | { op: 'unpin'; index: number }
  | { op: 'move'; from: number; to: number };
/** §1.2's `PinEdit`: an op with the request already turned into a stored target. */
export type PinEditDto =
  | { edit: 'insert'; target: PinStoredDto; at: number | null }
  | { edit: 'remove'; index: number }
  | { edit: 'move'; from: number; to: number };
/** §1.6's `PinPatch`. */
export type PinPatchDto = { kind: 'moved'; from: string; to: string; id: string | null } | { kind: 'tagRenamed'; from: string; to: string };
export type PinsErrKind = 'Conflict' | 'Gone' | 'NewerVersion' | 'Unreadable' | 'NotPinnable' | 'NoSuchPin' | 'Io' | 'NoVault' | 'NotImplemented';
export type PinsErr = { kind: PinsErrKind; message: string; disk?: Omit<PinsDto, 'version'> };

/** The pure read of the file (§1.1 `PinsFile`): `lines` is the item's 0-based line range `[start, end)`, dash line first. */
export type PinItemRead = { target: PinStoredDto; lines: [number, number] };
export type PinsRead = {
  state: PinsFileState;
  error: { line: number | null; reason: string } | null;
  patchable: boolean;
  version: number | null;
  items: PinItemRead[];
};

export const PINNED_YML = '.tegg/pinned.yml';
export const HEADER = '# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.';

const nfc = (s: string) => s.normalize('NFC');
const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
/** tags.md `tag_key`: NFC, lower case, a leading `#` dropped. */
export const tagKey = (s: string) => nfc(trimWs(s)).replace(/^#/, '').toLowerCase();
const blank = (l: string) => l.trim() === '';
const comment = (l: string) => l.trimStart().startsWith('#');
const content = (l: string) => !blank(l) && !comment(l);
const spaces = (l: string) => l.length - l.replace(/^ +/, '').length;
const dashAt = (l: string, at: number) => { const r = l.slice(at); return r === '-' || r.startsWith('- '); };
const docMarker = (l: string, m: string) => l.startsWith(m) && (l.length === m.length || l[m.length] === ' ' || l[m.length] === '\t');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const err = (kind: PinsErrKind, message: string, more: Partial<PinsErr> = {}): { error: PinsErr } => ({ error: { kind, message, ...more } });

// ------------------------------------------------------------------------------------------------ reading (R131)

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

/** D-1434: query names compare trimmed, NFC, case-insensitively. */
export const queryNameKey = (s: string) => nfc(trimWs(s)).toLowerCase();
/** R131's item rules (slice Q: a `query:` item with a non-blank string is listed, §1.9): the stored target, or null when
 *  skipped. */
function targetOf(raw: unknown): PinStoredDto | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const kinds = [has('id') || has('path'), has('tag'), has('type'), has('query')].filter(Boolean).length;
  if (kinds !== 1) return null;
  if (has('query')) {
    if (typeof o.query !== 'string') return null;
    const name = nfc(trimWs(o.query));
    return name === '' ? null : { kind: 'query', name };
  }
  if (has('tag')) {
    if (typeof o.tag !== 'string') return null;
    const key = tagKey(o.tag);
    return key === '' ? null : { kind: 'tag', key };
  }
  if (has('type')) {
    if (typeof o.type !== 'string') return null;
    const key = nfc(trimWs(o.type));
    return key === '' ? null : { kind: 'type', key };
  }
  let id: string | null = null, path: string | null = null;
  if (has('id')) {
    if (typeof o.id !== 'string' || trimWs(o.id) === '') return null;
    id = nfc(trimWs(o.id));
  }
  if (has('path')) {
    if (typeof o.path !== 'string') return null;
    const p = nfc(o.path);
    const segs = p.split('/');
    if (p.startsWith('/') || segs.includes('..') || !p.endsWith('.md')) return null;
    if (['.tegg', '.trash', '_templates'].includes(segs[0])) return null;
    path = p;
  }
  return { kind: 'object', id, path };
}
/** AP-1236 (D-1379), D-1394: the same target as an earlier listed item. Object items are the same when they share an
 *  `id`, or when their NFC paths match and at least one of them is path-only, in either order (an id+path item after a
 *  path-only item with the same path is a duplicate; two different ids with the same path are not). As the core's
 *  `same_target` (AP-1275 = D-1418). */
function duplicateOf(t: PinStoredDto, listed: PinStoredDto[]): boolean {
  return listed.some((x) => {
    if (t.kind === 'tag' && x.kind === 'tag') return t.key === x.key;
    if (t.kind === 'type' && x.kind === 'type') return t.key === x.key;
    if (t.kind === 'query' && x.kind === 'query') return queryNameKey(t.name) === queryNameKey(x.name);
    if (t.kind === 'object' && x.kind === 'object') {
      if (t.id !== null && x.id !== null && t.id === x.id) return true;
      return (t.id === null || x.id === null) && t.path !== null && t.path === x.path;
    }
    return false;
  });
}

type Line = { text: string; end: string };
function splitLines(text: string): Line[] {
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

/** The key starting at `at` of `body` and the index of its `:` (plain or quoted). */
function keyAt(body: string, at: number): { key: string; colon: number } | null {
  const s = body.slice(at);
  if (s === '') return null;
  let key: string;
  let after: number;
  if (s[0] === '"' || s[0] === '\'') {
    const end = closeOf(s, 0);
    if (end === null) return null;
    const inner = s.slice(1, end - 1);
    if (s[0] === '\'') key = inner.replace(/''/g, '\'');
    else { try { key = JSON.parse(s.slice(0, end)) as string; } catch { key = inner; } }
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
  return s[colon] === ':' ? { key, colon: at + colon } : null;
}
function closeOf(s: string, start: number): number | null {
  const c = s[start];
  if (c !== '"' && c !== '\'') return null;
  for (let j = start + 1; j < s.length; j++) {
    if (c === '"' && s[j] === '\\') { j++; continue; }
    if (s[j] === c) { if (c === '\'' && s[j + 1] === '\'') { j++; continue; } return j + 1; }
  }
  return null;
}
/** Index after a flow collection that closes on the line `s`, or null. */
function flowEnd(s: string): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === '"') { if (c === '\\') i++; else if (c === '"') quote = null; continue; }
    if (quote === '\'') { if (c === '\'') { if (s[i + 1] === '\'') i++; else quote = null; } continue; }
    if (c === '"' || c === '\'') quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return null;
}

type Item = { start: number; end: number; dash: number; keys: number; flow: boolean };
type Layout = { pins: number | null; items: Item[]; inline: 'none' | 'empty-flow' };

type Parsed = {
  read: PinsRead;
  /** The raw `pins` items as JSON and, for each, its listed index (or null). */
  raw: unknown[];
  listedRaw: number[];
  hasVersion: boolean;
  doc: Record<string, unknown> | null;
  lay: Layout | null;
  lines: Line[];
  bom: string;
};

function severalDocuments(lines: string[]): boolean {
  let started = false;
  for (const b of lines) {
    if (!content(b) || (!started && b.startsWith('%'))) continue;
    if (docMarker(b, '...') || (docMarker(b, '---') && started)) return true;
    started = true;
  }
  return false;
}

/** The `pins` key line and its items' line ranges (comments and blank lines never end an item, D-1129); null when the
 *  items can't be lined up with what YAML read. */
function layout(lines: string[], rawCount: number, value: 'missing' | 'null' | 'list'): Layout | null {
  if (value === 'missing') return { pins: null, items: [], inline: 'none' };
  const at = lines.findIndex((l) => spaces(l) === 0 && content(l) && keyAt(l, 0)?.key === 'pins');
  if (at < 0) return null;
  const k = keyAt(lines[at], 0)!;
  const inline = lines[at].slice(k.colon + 1).trimStart();
  if (inline !== '' && !inline.startsWith('#')) {
    if (rawCount === 0 && inline.startsWith('[')) return { pins: at, items: [], inline: 'empty-flow' };
    return null;
  }
  const items: Item[] = [];
  let d: number | null = null;
  let regionEnd = at;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!content(l)) continue;
    const ind = spaces(l);
    d ??= ind;
    if (ind < d || (ind === d && !dashAt(l, ind))) break;
    if (ind === d) items.push({ start: i, end: i, dash: d, keys: 0, flow: false });
    regionEnd = i;
  }
  if (items.length !== rawCount) return null;
  for (const [n, it] of items.entries()) {
    const limit = n + 1 < items.length ? items[n + 1].start - 1 : Math.max(regionEnd, it.start);
    let end = it.start;
    for (let i = it.start + 1; i <= Math.min(limit, lines.length - 1); i++) {
      if (!content(lines[i])) continue;
      if (spaces(lines[i]) <= it.dash) break;
      end = i;
    }
    it.end = end;
    const after = lines[it.start].slice(it.dash + 1);
    const body = after.trimStart();
    if (body.startsWith('{') || body.startsWith('[')) {
      // A flow item is patchable only on one line (§1.2).
      if (end !== it.start || flowEnd(body) === null) return null;
      it.flow = true;
      it.keys = it.dash + 1 + (after.length - body.length);
    } else if (body === '' || body.startsWith('#')) {
      const c = lines.slice(it.start + 1, end + 1).find(content);
      it.keys = c !== undefined ? spaces(c) : it.dash + 2;
    } else it.keys = it.dash + 1 + (after.length - body.length);
  }
  return { pins: at, items, inline: 'none' };
}

function parsed(text: string | null, utf8 = true): Parsed {
  const empty = { raw: [], listedRaw: [], hasVersion: false, doc: null, lay: null, lines: [], bom: '' };
  const unreadable = (line: number | null, reason: string): Parsed => ({ ...empty, hasVersion: true, read: { state: 'unreadable', error: { line, reason }, patchable: false, version: null, items: [] } });
  if (text === null) return { ...empty, read: { state: 'missing', error: null, patchable: true, version: null, items: [] } };
  if (!utf8) return unreadable(null, 'The file isn\'t valid UTF-8.');
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const L = splitLines(text.slice(bom.length));
  const docs = [...parseAllDocuments(text)];
  const e = docs.flatMap((d) => d.errors)[0];
  if (e) return unreadable(errorLine(text, e.pos?.[0] ?? null, e.linePos?.[0]?.line ?? null), e.message.split('\n')[0]);
  const doc = docs[0];
  const top = doc?.contents ?? null;
  const ok = (version: number | null): Parsed => ({ ...empty, lines: L, bom, doc: {}, lay: { pins: null, items: [], inline: 'none' }, read: { state: 'ok', error: null, patchable: !severalDocuments(L.map((l) => l.text)), version, items: [] } });
  if (top === null || (isScalar(top) && top.value === null)) return ok(null);
  if (!isMap(top)) return unreadable(null, 'The top level isn\'t a mapping.');
  let json: Record<string, unknown>;
  try { json = doc.toJSON() as Record<string, unknown>; } catch (x) { return unreadable(null, (x as Error).message); }
  const vNode = top.get('version', true);
  let version = 1;
  let hasVersion = false;
  if (vNode !== undefined) {
    hasVersion = true;
    const good = isScalar(vNode) && typeof vNode.value === 'number' && Number.isInteger(vNode.value) && vNode.value >= 1 && /^\+?[0-9]+$/.test(String(vNode.source ?? vNode.value));
    if (!good) return unreadable(null, '`version` isn\'t a positive integer.');
    version = Number((vNode as { value: unknown }).value);
  }
  const pNode = top.get('pins', true);
  const value = pNode === undefined ? 'missing' : pNode === null || (isScalar(pNode) && pNode.value === null) ? 'null' : 'list';
  if (value === 'list' && !isSeq(pNode)) return unreadable(null, '`pins` isn\'t a list.');
  const raw = Array.isArray(json.pins) ? (json.pins as unknown[]) : [];
  const listed: PinStoredDto[] = [];
  const listedRaw: number[] = [];
  raw.forEach((r, i) => {
    const t = targetOf(r);
    if (t === null || duplicateOf(t, listed)) return;
    listed.push(t);
    listedRaw.push(i);
  });
  const lines = L.map((l) => l.text);
  const lay = severalDocuments(lines) ? null : layout(lines, raw.length, value);
  const items: PinItemRead[] = listed.map((target, n) => {
    const it = lay?.items[listedRaw[n]];
    return { target, lines: it ? [it.start, it.end + 1] : [0, 0] };
  });
  return {
    raw, listedRaw, hasVersion, doc: json, lay, lines: L, bom,
    read: { state: version > 1 ? 'newer' : 'ok', error: null, patchable: lay !== null && version === 1, version, items },
  };
}

/** R131's listed targets of raw `pins` items. */
function listedOf(raw: unknown[]): PinStoredDto[] {
  const listed: PinStoredDto[] = [];
  for (const r of raw) { const t = targetOf(r); if (t !== null && !duplicateOf(t, listed)) listed.push(t); }
  return listed;
}

/** R131 read rules. `text` null: no file; `utf8` false: the bytes weren't valid UTF-8. */
export function pinsRead(text: string | null, utf8 = true): PinsRead {
  return parsed(text, utf8).read;
}

// ------------------------------------------------------------------------------------------------ writing (R131)

/** The `vault.yml` quoting rule (D-230): plain when YAML reads it back as the same string, else JSON double quotes. */
export function scalar(v: string): string {
  let back: unknown;
  try { back = parse(`k: ${v}`); } catch { back = null; }
  const plain = v !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) && !/\s$/.test(v) && !v.includes(': ') && !v.includes(' #')
    && !!back && typeof back === 'object' && (back as Record<string, unknown>).k === v;
  return plain ? v : JSON.stringify(v);
}
function itemLines(t: PinStoredDto, dash: number, keys: number): string[] {
  const d = ' '.repeat(dash);
  const gap = ' '.repeat(Math.max(1, keys - dash - 1));
  const k = ' '.repeat(dash + 1 + gap.length);
  switch (t.kind) {
    case 'tag': return [`${d}-${gap}tag: ${scalar(nfc(t.key))}`];
    case 'type': return [`${d}-${gap}type: ${scalar(nfc(t.key))}`];
    case 'query': return [`${d}-${gap}query: ${scalar(nfc(t.name))}`];
    case 'object':
      if (t.id !== null && t.path !== null) return [`${d}-${gap}id: ${scalar(t.id)}`, `${k}path: ${scalar(nfc(t.path))}`];
      if (t.id !== null) return [`${d}-${gap}id: ${scalar(t.id)}`];
      return [`${d}-${gap}path: ${scalar(nfc(t.path ?? ''))}`];
  }
}
/** The leading lines `version: 1` goes after (D-1124): comments, `%` directives and the first `---` line. */
function prelude(lines: string[]): number {
  let started = false, n = 0;
  for (const b of lines) {
    const start = docMarker(b, '---') && /^\s*(#|$)/.test(b.slice(3));
    if (comment(b) || (!started && (b.startsWith('%') || start))) { started ||= start; n++; } else break;
  }
  return n;
}
/** Removes `L[from..=to]`, keeping a missing final newline missing. */
function cut(L: Line[], from: number, to: number): Line[] {
  const atEnd = to + 1 === L.length;
  const lastEnd = L[to].end;
  const removed = L.splice(from, to - from + 1);
  if (atEnd && lastEnd === '' && from > 0) { L[from - 1] = { ...L[from - 1], end: '' }; removed[removed.length - 1] = { ...removed[removed.length - 1], end: '' }; }
  return removed;
}
/** Inserts `add` before index `at` (at = L.length: at the end), keeping a missing final newline missing. */
function put(L: Line[], at: number, add: Line[], nl: string) {
  const block = add.map((l) => ({ text: l.text, end: l.end === '' ? nl : l.end }));
  if (at === L.length && at > 0 && L[at - 1].end === '') { L[at - 1] = { ...L[at - 1], end: nl }; block[block.length - 1].end = ''; }
  L.splice(at, 0, ...block);
}

type Target = { raw: unknown[]; listed: PinStoredDto[] };
const stored = (t: PinStoredDto): Record<string, string> =>
  (t.kind === 'object' ? { ...(t.id !== null ? { id: t.id } : {}), ...(t.path !== null ? { path: nfc(t.path) } : {}) } : t.kind === 'tag' ? { tag: t.key } : t.kind === 'query' ? { query: t.name } : { type: t.key });

/** R131 write rules: the next text after `edit` (`text` null: no file), `text: null` when the bytes stay equal, or the
 *  refusal. */
export function pinsPatch(text: string | null, edit: PinEditDto, utf8 = true): { text: string | null; read: PinsRead } | { error: PinsErr } {
  const p = parsed(text, utf8);
  if (p.read.state === 'unreadable') return err('Unreadable', 'fake: the pins file can\'t be read');
  if (p.read.state === 'newer') return err('NewerVersion', 'fake: the pins file is from a newer version');
  if (edit.edit === 'insert' && text === null) {
    const t = [HEADER, 'version: 1', 'pins:', ...itemLines(edit.target, 2, 4)].join('\n') + '\n';
    return { text: t, read: pinsRead(t) };
  }
  if (text === null) return err('NoSuchPin', 'fake: no pins file');
  if (!p.read.patchable || !p.lay) return err('Unreadable', 'fake: the pins list can\'t be patched line by line');
  const n = p.read.items.length;
  const nothing = { text: null, read: p.read };
  if (edit.edit === 'remove' && (edit.index < 0 || edit.index >= n)) return err('NoSuchPin', `fake: no pin ${edit.index}`);
  if (edit.edit === 'move' && (edit.from < 0 || edit.from >= n || edit.to < 0 || edit.to >= n)) return err('NoSuchPin', `fake: no pin ${edit.from} → ${edit.to}`);
  if (edit.edit === 'move' && edit.from === edit.to) return nothing;

  const L = p.lines.map((l) => ({ ...l }));
  const lay = p.lay;
  const nl = L.find((l) => l.end !== '')?.end ?? '\n';
  const listed = p.read.items.map((i) => i.target);
  const want: Target = { raw: structuredClone(p.raw), listed: [...listed] };
  const itemOf = (k: number) => lay.items[p.listedRaw[k]];
  const lastItem = lay.items[lay.items.length - 1];
  const dash = lastItem ? lastItem.dash : 2, keys = lastItem ? lastItem.keys : 4;
  /** The line index a new item goes before for final position `k` among the listed items left in `L` (the list after a
   *  removal: `skip` is the removed raw item). */
  const placeFor = (k: number, skip: number | null, shift: (i: number) => number): number | 'end' => {
    const left = p.listedRaw.filter((r) => r !== skip);
    if (k >= left.length) return 'end';
    return shift(lay.items[left[k]].start);
  };
  const endOfList = (shift: (i: number) => number, skip: number | null): number => {
    const rest = lay.items.filter((_, i) => i !== skip);
    if (rest.length) return shift(rest[rest.length - 1].end) + 1;
    return (lay.pins ?? -1) + 1;
  };
  const toEmptyFlow = () => {
    const at = lay.pins!;
    const body = L[at].text;
    const { colon } = keyAt(body, 0)!;
    L[at] = { ...L[at], text: `${body.slice(0, colon + 1)} []${body.slice(colon + 1)}` };
  };
  const fromEmptyFlow = () => {
    const at = lay.pins!;
    const body = L[at].text;
    const { colon } = keyAt(body, 0)!;
    const inline = body.slice(colon + 1).trimStart();
    const close = flowEnd(inline);
    L[at] = { ...L[at], text: `${body.slice(0, colon + 1)}${close === null ? '' : inline.slice(close)}` };
  };

  switch (edit.edit) {
    case 'insert': {
      const add = itemLines(edit.target, dash, keys).map((t) => ({ text: t, end: nl }));
      const k = edit.at === null ? n : Math.min(edit.at, n);
      if (lay.pins === null) {
        put(L, L.length, [{ text: 'pins:', end: nl }, ...add], nl);
      } else {
        if (lay.inline === 'empty-flow') fromEmptyFlow();
        const at = placeFor(k, null, (i) => i);
        put(L, at === 'end' ? endOfList((i) => i, null) : at, add, nl);
      }
      want.listed.splice(k, 0, edit.target);
      const before = k < n ? p.listedRaw[k] : null;
      const rawAt = before === null ? (lay.items.length) : before;
      want.raw.splice(rawAt, 0, stored(edit.target));
      break;
    }
    case 'remove': {
      const it = itemOf(edit.index);
      cut(L, it.start, it.end);
      if (lay.items.length === 1) toEmptyFlow();
      want.listed.splice(edit.index, 1);
      want.raw.splice(p.listedRaw[edit.index], 1);
      break;
    }
    case 'move': {
      const it = itemOf(edit.from);
      const size = it.end - it.start + 1;
      const shift = (i: number) => (i > it.end ? i - size : i);
      const moved = cut(L, it.start, it.end);
      const skip = p.listedRaw[edit.from];
      const at = placeFor(edit.to, skip, shift);
      put(L, at === 'end' ? endOfList(shift, skip) : at, moved, nl);
      const [t] = want.listed.splice(edit.from, 1);
      want.listed.splice(edit.to, 0, t);
      const [r] = want.raw.splice(skip, 1);
      const left = p.listedRaw.filter((x) => x !== skip).map((x) => (x > skip ? x - 1 : x));
      want.raw.splice(edit.to < left.length ? left[edit.to] : want.raw.length, 0, r);
      break;
    }
  }
  if (!p.hasVersion) {
    const k = prelude(L.map((l) => l.text));
    put(L, k, [{ text: 'version: 1', end: nl }], nl);
  }
  const next = p.bom + joinLines(L);
  if (next === text) return nothing;
  // D-1129's read-back check: the new text lists exactly the expected pins, every raw item and top-level key unchanged.
  const back = parsed(next);
  if (back.read.state !== 'ok' || !back.doc || !p.doc) return err('Unreadable', 'fake: the write wouldn\'t read back');
  const others = (d: Record<string, unknown>) => Object.keys(d).filter((k) => k !== 'version' && k !== 'pins').sort();
  if (!same(others(p.doc), others(back.doc)) || others(p.doc).some((k) => !same(p.doc![k], back.doc![k]))) return err('Unreadable', 'fake: a top-level key changed');
  // The expected pins are R131 applied to the expected items: a skipped duplicate of a removed item is listed afterwards
  // (red-test point AP-1250).
  if (!same(back.read.items.map((i) => i.target), listedOf(want.raw))) return err('Unreadable', 'fake: the listed pins don\'t read back');
  if (!same(back.raw, want.raw)) return err('Unreadable', 'fake: another item changed');
  return { text: next, read: back.read };
}

/** §1.6's job patch over the listed items; null when nothing changes or the file can't be patched. */
export function pinsJobPatch(text: string | null, patches: PinPatchDto[]): string | null {
  if (text === null) return null;
  const p = parsed(text);
  if (p.read.state !== 'ok' || !p.read.patchable || !p.lay) return null;
  const L = p.lines.map((l) => ({ ...l }));
  const nl = L.find((l) => l.end !== '')?.end ?? '\n';
  // Bottom-up, so earlier line numbers stay valid.
  const order = p.read.items.map((it, k) => ({ it, k })).sort((a, b) => b.it.lines[0] - a.it.lines[0]);
  for (const { it, k } of order) {
    const item = p.lay.items[p.listedRaw[k]];
    const t = it.target;
    for (const patch of patches) {
      if (patch.kind === 'tagRenamed' && t.kind === 'tag' && t.key === tagKey(patch.from)) {
        const to = tagKey(patch.to);
        const line = L[item.start].text;
        if (item.flow) {
          const m = /(\btag\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,}\]]*[^,}\]\s])/.exec(line);
          if (!m) continue;
          L[item.start] = { ...L[item.start], text: line.slice(0, m.index) + m[1] + scalar(to) + line.slice(m.index + m[0].length) };
        } else {
          const at = findValue(L, item, 'tag');
          if (!at) continue;
          L[at.line] = { ...L[at.line], text: at.prefix + scalar(to) + at.tail };
        }
      }
      if (patch.kind === 'moved' && t.kind === 'object') {
        const byId = t.id !== null && patch.id !== null && t.id === nfc(patch.id);
        const byPath = t.id === null && t.path !== null && t.path === nfc(patch.from);
        if (!byId && !byPath) continue;
        if (t.path === null) continue; // an id-only item resolves by id
        const at = findValue(L, item, 'path');
        if (!at || item.flow) continue;
        if (byPath && patch.id !== null && at.line === item.start) {
          // `- path: …` becomes `- id: <id>` / `path: <to>` (AP-4: the rename wrote an id).
          const dashLine = L[item.start].text;
          const head = dashLine.slice(0, at.prefix.length - 'path: '.length);
          const keys = ' '.repeat(head.length);
          L.splice(item.start, 1, { text: `${head}id: ${scalar(patch.id)}`, end: nl }, { text: `${keys}path: ${scalar(nfc(patch.to))}${at.tail}`, end: L[item.start].end });
        } else L[at.line] = { ...L[at.line], text: at.prefix + scalar(nfc(patch.to)) + at.tail };
      }
    }
  }
  if (!p.hasVersion) {
    const k = prelude(L.map((l) => l.text));
    put(L, k, [{ text: 'version: 1', end: nl }], nl);
  }
  const next = p.bom + joinLines(L);
  if (next === text) return null;
  const back = parsed(next);
  if (back.read.state !== 'ok' || back.read.items.length !== p.read.items.length) return null;
  return next;
}
/** The line of `key: <value>` inside an item (one-line plain or quoted values), with what comes before and after it. */
function findValue(L: Line[], item: Item, key: string): { line: number; prefix: string; tail: string } | null {
  for (let i = item.start; i <= item.end; i++) {
    const t = L[i].text;
    const col = i === item.start ? item.keys : spaces(t);
    if (i !== item.start && (!content(t) || col !== item.keys)) continue;
    const k = keyAt(t, col);
    if (!k || k.key !== key) continue;
    const rest = t.slice(k.colon + 1);
    const vOff = k.colon + 1 + (rest.length - rest.replace(/^[ \t]+/, '').length);
    const v = t.slice(vOff);
    let end: number;
    if (v.startsWith('"') || v.startsWith('\'')) { const c = closeOf(v, 0); if (c === null) return null; end = c; }
    else { const cuts = [' #', '\t#'].map((m) => v.indexOf(m)).filter((x) => x >= 0); end = (cuts.length ? Math.min(...cuts) : v.length); end = v.slice(0, end).trimEnd().length; }
    return { line: i, prefix: t.slice(0, vOff), tail: v.slice(end) };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ resolution (§1.3)

type Obj = { path: string; id: string | null; title: string; type: string | null; date: string | null; trashed: boolean };
/** Frontmatter keys of a note (flat `key: value` lines; enough for the fixtures). */
function front(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = /^([^\s:#][^:]*):[ \t]*(.*)$/.exec(l);
    if (kv) out[kv[1].trim()] = kv[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}
const stem = (p: string) => p.split('/').pop()!.replace(/\.md$/, '');
const stemOf = (p: string) => nfc(p.split('/').pop()!.replace(/\.yml$/i, ''));
function typeDefs(files: Record<string, string>): Record<string, { folder: string | null }> {
  const out: Record<string, { folder: string | null }> = {};
  for (const [p, t] of Object.entries(files)) {
    const m = /^\.tegg\/types\/(.+)\.yml$/.exec(p);
    if (!m) continue;
    out[nfc(m[1])] = { folder: /^folder:[ \t]*(.+)$/m.exec(t)?.[1]?.trim() ?? null };
  }
  return out;
}
function objects(files: Record<string, string>): Obj[] {
  const defs = typeDefs(files);
  const out: Obj[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('.md') || path.startsWith('.tegg/') || path.startsWith('_templates/') || path === 'README.md') continue;
    const fm = front(text);
    const trashed = path.startsWith('.trash/');
    const live = trashed ? path.slice('.trash/'.length) : path;
    const folder = live.includes('/') ? live.slice(0, live.indexOf('/')) : '';
    const type = fm.type ? nfc(fm.type).toLowerCase() : Object.entries(defs).find(([, d]) => d.folder === folder)?.[0] ?? null;
    out.push({ path, id: fm.id ? nfc(fm.id) : null, title: fm.title ? nfc(fm.title) : stem(path), type, date: type === 'daily-note' ? (fm.date ?? stem(path)) : null, trashed });
  }
  return out;
}
/** Tag keys in use (tags.md R79): `tags:` values, inline `#tags` of bodies, and Tag files. */
function tagKeys(files: Record<string, string>, objs: Obj[]): Set<string> {
  const keys = new Set<string>();
  for (const o of objs) {
    if (o.trashed) continue;
    const text = files[o.path];
    const fm = front(text);
    if (o.type === 'tag') keys.add(tagKey(fm.title ?? stem(o.path)));
    const block = /^tags:[ \t]*\r?\n((?:[ \t]+-.*\r?\n?)+)/m.exec(text);
    if (fm.tags) for (const v of fm.tags.replace(/^\[|\]$/g, '').split(',')) if (trimWs(v)) keys.add(tagKey(v.replace(/^["']|["']$/g, '')));
    if (block) for (const l of block[1].split(/\r?\n/)) { const v = /-\s*(.+)/.exec(l)?.[1]; if (v) keys.add(tagKey(v.replace(/^["']|["']$/g, ''))); }
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const m of body.matchAll(/(^|[\s(])#([\p{L}\p{N}_\-/]+)/gu)) if (/\p{L}/u.test(m[2])) keys.add(tagKey(m[2]));
  }
  return keys;
}

/** §1.3: one row per listed pin. `indexReady` false: the index is empty, as on the first open (AC-20). */
export function pinsResolve(read: PinsRead, files: Record<string, string>, indexReady: boolean): PinRowDto[] {
  const objs = objects(files);
  const live = objs.filter((o) => !o.trashed);
  const trash = objs.filter((o) => o.trashed);
  const defs = typeDefs(files);
  const tags = tagKeys(files, objs);
  return read.items.map(({ target: t }, index): PinRowDto => {
    const row: PinRowDto = { index, target: t, state: 'missing', path: null, title: null, type: null, date: null };
    const ok = (o: Obj, state: PinState): PinRowDto => ({ ...row, state, path: o.path, title: o.title, type: o.type, date: state === 'ok' ? o.date : null });
    if (t.kind === 'object') {
      if (!indexReady) return { ...row, state: 'pending' };
      if (t.id !== null) { const o = live.find((x) => x.id === t.id); if (o) return ok(o, 'ok'); }
      if (t.id !== null) { const o = trash.find((x) => x.id === t.id); if (o) return ok(o, 'trashed'); }
      if (t.path !== null) {
        // §1.3: a live file at `path` with no `id` or the same one; a file there with another `id` is never adopted, and
        // then `.trash/<path>` is checked as when no file is there (AP-1275 = D-1418, as the core).
        const o = live.find((x) => x.path === t.path);
        if (o && (o.id === null || o.id === t.id || t.id === null)) return ok(o, 'ok');
        const tr = trash.find((x) => x.path === `.trash/${t.path}`);
        if (tr) return ok(tr, 'trashed');
      }
      return row;
    }
    if (t.kind === 'tag') {
      if (!indexReady) return { ...row, state: 'pending' };
      return { ...row, state: tags.has(t.key) ? 'ok' : 'noObjects' };
    }
    // Slice Q (§1.9, D-1498): a query pin is resolved from the files, never pending.
    if (t.kind === 'query') {
      const live = findLive(files, t.name);
      if (live) {
        const r = queryRead(files[live], true, stemOf(live));
        return { ...row, state: 'ok', path: live, title: r.state === 'unreadable' ? stemOf(live) : r.def.title, type: null };
      }
      const tr = findTrashed(files, t.name);
      if (tr) {
        const r = queryRead(files[tr], true, stemOf(tr));
        return { ...row, state: 'trashed', path: tr, title: r.state === 'unreadable' ? stemOf(tr) : r.def.title, type: null };
      }
      return row;
    }
    if (defs[t.key]) return { ...row, state: 'ok' };
    if (!indexReady) return { ...row, state: 'pending' };
    return { ...row, state: live.some((o) => o.type === t.key) ? 'ok' : 'missing' };
  });
}

// ------------------------------------------------------------------------------------------------ the fake's entry

/** The fake core's version hash (fake-core.ts `state.ver`): FNV-1a over the UTF-8 bytes. */
function versionOf(text: string): { size: number; hash: string } {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return { size: bytes.length, hash: h.toString(16).padStart(8, '0') };
}
function dto(read: PinsRead, files: Record<string, string>, indexReady: boolean): Omit<PinsDto, 'version'> {
  return { state: read.state, error: read.error, patchable: read.state === 'missing' ? true : read.patchable, indexReady, rows: pinsResolve(read, files, indexReady) };
}
/** §1.4: what the UI asks to pin, as a stored target; null when it can't be pinned. */
export function requestTarget(req: PinRequestDto, files: Record<string, string>): PinStoredDto | null {
  if (req.kind === 'tag') { const key = tagKey(req.key ?? ''); return key ? { kind: 'tag', key } : null; }
  if (req.kind === 'type') { const key = nfc(trimWs(req.key ?? '')); return key ? { kind: 'type', key } : null; }
  if (req.kind === 'query') { const live = findLive(files, req.name ?? ''); return live ? { kind: 'query', name: stemOf(live) } : null; }
  const path = nfc(req.path ?? '');
  const segs = path.split('/');
  if (!path.endsWith('.md') || ['.tegg', '.trash', '_templates'].includes(segs[0]) || files[path] === undefined) return null;
  const fm = front(files[path]);
  if (fm.type && nfc(fm.type).toLowerCase() === 'tag') return { kind: 'tag', key: tagKey(fm.title ?? stem(path)) }; // D-1382
  return { kind: 'object', id: fm.id ? nfc(fm.id) : null, path };
}
const sameTarget = (a: PinStoredDto, b: PinStoredDto) => duplicateOf(b, [a]) || duplicateOf(a, [b]);

/** The fake core's entry: `files` the vault texts, `invalid` the paths whose bytes aren't UTF-8. `writes` maps a path to
 *  its new text. `indexReady` false answers as the first index build runs (`pinsNotReady`). */
export async function handle(cmd: string, a: any, files: Record<string, string>, invalid: string[], indexReady = true): Promise<{ result?: unknown; error?: PinsErr; writes?: Record<string, string> }> {
  const text = files[PINNED_YML] ?? null;
  const utf8 = !invalid.map(nfc).includes(PINNED_YML);
  switch (cmd) {
    case 'pins_get':
      return { result: dto(pinsRead(text, utf8), files, indexReady) };
    case 'pins_apply': {
      const base = (a?.base ?? null) as { size: number; hash: string } | null;
      const read = pinsRead(text, utf8);
      const disk = dto(read, files, indexReady);
      // FR-SYN-03 AC-26, AC-27 (D-175): the version last read is the base; RENAME_EXCL for the first pin.
      if (base === null && text !== null) return { error: { kind: 'Conflict', message: 'fake: pinned.yml appeared', disk } };
      if (base !== null && text === null) return { error: { kind: 'Gone', message: 'fake: pinned.yml is gone', disk } };
      if (base !== null && text !== null && utf8) {
        const v = versionOf(text);
        if (v.size !== base.size || v.hash !== base.hash) return { error: { kind: 'Conflict', message: 'fake: pinned.yml changed', disk } };
      }
      const op = a?.op as PinOpDto;
      let edit: PinEditDto;
      if (read.state === 'unreadable') return { error: { kind: 'Unreadable', message: 'fake: pinned.yml can\'t be read' } };
      if (read.state === 'newer') return { error: { kind: 'NewerVersion', message: 'fake: pinned.yml is from a newer version' } };
      if (op?.op === 'pin') {
        const t = requestTarget(op.target, files);
        if (!t) return { error: { kind: 'NotPinnable', message: 'fake: not pinnable' } };
        const at = read.items.findIndex((i) => sameTarget(i.target, t));
        const n = read.items.length;
        if (at >= 0) edit = { edit: 'move', from: at, to: Math.min(op.at ?? n - 1, n - 1) }; // D-1379
        else edit = { edit: 'insert', target: t, at: op.at };
      } else if (op?.op === 'unpin') edit = { edit: 'remove', index: op.index };
      else if (op?.op === 'move') edit = { edit: 'move', from: op.from, to: op.to };
      else return { error: { kind: 'NotImplemented', message: `fake-pins: unknown op ${JSON.stringify(op)}` } };
      const r = pinsPatch(text, edit, utf8);
      if ('error' in r) return { error: r.error };
      const out = r.text ?? text;
      const result = dto(pinsRead(out), files, indexReady);
      return r.text === null ? { result } : { result: dto(r.read, { ...files, [PINNED_YML]: r.text }, indexReady), writes: { [PINNED_YML]: r.text } };
    }
    case 'pins_job': {
      const next = pinsJobPatch(utf8 ? text : null, (a?.patches ?? []) as PinPatchDto[]);
      return { result: next };
    }
    default:
      return { error: { kind: 'NotImplemented', message: `fake-pins: unknown command ${cmd}` } };
  }
}
