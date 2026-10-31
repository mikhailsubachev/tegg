// Fake core, slice G3 (docs/contracts/v1-graph.md §16.6): `graph_presets_get` and `graph_presets_apply` over the fake's
// `.tegg/graph.yml`, a TypeScript twin of §16.1's parser and patcher (R118 read and write rules), checked against the
// Rust module on every tests/fixtures/graph-presets/ input and expected/ output (app/test/graph_presets.ac.test.ts and
// crates/tegg-core/tests/ac_graph_presets.rs read the same files). Runs in Node (installFakeCore exposes it to the page
// as `__teggPresets`). Test code, not product code.
//
// Values come from the `yaml` package (YAML 1.2, as NFR-POR-01 AC-3's standard parser); positions from a line scanner,
// so a patch changes only the operated item's lines (AP-921).
import { parse, parseAllDocuments, isMap, isScalar, isSeq } from 'yaml';
import { validateName } from '../src/graph/presets';
import { vaultTypeOrder } from './fake-graph';
import type { GraphPresetDto, GraphPresetsDto, PresetOpDto } from '../src/graph/types';

export type PresetsErr = {
  kind: 'Conflict' | 'Gone' | 'NameEmpty' | 'NameTaken' | 'NameTooLong' | 'NameControl' | 'NoSuchPreset' | 'NewerVersion' | 'Unreadable' | 'NotUtf8' | 'Io' | 'NotImplemented';
  message: string;
  existing?: string;
  disk?: PresetsRead;
};
/** The file as read: `GraphPresetsDto` without the version (the fake adds it). */
export type PresetsRead = Omit<GraphPresetsDto, 'version'>;

const GRAPH_YML = '.tegg/graph.yml';
const HEADER = '# Tegg graph filter presets (FR-GRP-02, D-906, D-907). Edit them in the graph\'s Preset menu.';
const KINDS = ['link', 'relation', 'embed', 'tag'];
const nfc = (s: string) => s.normalize('NFC');
/** Unicode White_Space trim (not JS `trim`, which also strips U+FEFF), as the core. */
const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const low = (s: string) => nfc(trimWs(s)).toLowerCase();
const blank = (l: string) => l.trim() === '';
const comment = (l: string) => l.trimStart().startsWith('#');
const err = (kind: PresetsErr['kind'], message: string, more: Partial<PresetsErr> = {}): { error: PresetsErr } => ({ error: { kind, message, ...more } });

// ------------------------------------------------------------------------------------------------ reading (R118)

/** A listed preset and the index of its item in the `presets` list. */
type Listed = GraphPresetDto & { item: number };
type Parsed = {
  read: PresetsRead;
  listed: Listed[];
  hasVersion: boolean;
  /** `presets` as YAML read it: absent, null (no presets) or a list. */
  value: 'missing' | 'null' | 'list';
  /** The first document and the `presets` items as JSON (the parse-back check of every write compares against them). */
  doc: Record<string, unknown> | null;
  items: unknown[];
};

/** The 1-based line of a YAML error: when it falls inside an unclosed `[` or `{`, the line where the outermost one
 *  opened; else the parser's line. */
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

function parsed(text: string | null, utf8 = true): Parsed {
  const base = { hasVersion: false, value: 'missing' as const, doc: null, items: [] };
  const unreadable = (line: number | null, reason: string): Parsed => ({ ...base, read: { state: 'unreadable', error: { line, reason }, presets: [] }, listed: [], hasVersion: true });
  if (text === null) return { ...base, read: { state: 'missing', error: null, presets: [] }, listed: [] };
  if (!utf8) return unreadable(null, 'The file isn\'t valid UTF-8.');
  // As the core (`yaml_rust2`): every document must parse; the first one holds the presets.
  const docs = [...parseAllDocuments(text)];
  const e = docs.flatMap((d) => d.errors)[0];
  if (e) return unreadable(errorLine(text, e.pos?.[0] ?? null, e.linePos?.[0]?.line ?? null), e.message.split('\n')[0]);
  const doc = docs[0];
  const top = doc?.contents ?? null;
  if (top === null || (isScalar(top) && top.value === null)) return { ...base, doc: {}, read: { state: 'ok', error: null, presets: [] }, listed: [] };
  if (!isMap(top)) return unreadable(null, 'The top level isn\'t a mapping.');
  let json: Record<string, unknown>;
  try { json = doc.toJSON() as Record<string, unknown>; } catch (x) { return unreadable(null, (x as Error).message); } // an alias without its anchor
  const vNode = top.get('version', true);
  let version = 1;
  let hasVersion = false;
  if (vNode !== undefined) {
    hasVersion = true;
    const ok = isScalar(vNode) && typeof vNode.value === 'number' && Number.isInteger(vNode.value) && vNode.value >= 1 && /^\+?[0-9]+$/.test(String(vNode.source ?? vNode.value));
    if (!ok) return unreadable(null, '`version` isn\'t a positive integer.');
    version = Number((vNode as { value: unknown }).value);
  }
  const pNode = top.get('presets', true);
  const value = pNode === undefined ? 'missing' : pNode === null || (isScalar(pNode) && pNode.value === null) ? 'null' : 'list';
  if (value === 'list' && !isSeq(pNode)) return unreadable(null, '`presets` isn\'t a list.');
  const items = Array.isArray(json.presets) ? (json.presets as unknown[]) : [];
  const listed: Listed[] = [];
  const isStrings = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  items.forEach((raw, item) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const o = raw as Record<string, unknown>;
    if (typeof o.name !== 'string' || trimWs(o.name) === '') return;
    const name = nfc(trimWs(o.name));
    if (low(name) === 'default' || listed.some((p) => low(p.name) === low(name))) return;
    if (!isStrings(o['hidden-types']) || !isStrings(o['hidden-kinds'])) return;
    listed.push({ name, hiddenTypes: ((o['hidden-types'] ?? []) as string[]).map(nfc), hiddenKinds: ((o['hidden-kinds'] ?? []) as string[]).map(nfc), item });
  });
  const presets = listed.map(({ item: _i, ...p }) => p);
  return { read: { state: version > 1 ? 'newer' : 'ok', error: null, presets }, listed, hasVersion, value, doc: json, items };
}

/** R118 read rules. `text` null: no file; `utf8` false: the bytes weren't valid UTF-8. */
export function presetsRead(text: string | null, utf8 = true): PresetsRead {
  return parsed(text, utf8).read;
}

// ------------------------------------------------------------------------------------------------ writing (R118)

/** The `vault.yml` quoting rule (D-230, `yaml_text::scalar`): plain when YAML reads it back as the same string, else
 *  JSON double quotes (so `123`, `true`, `null` are quoted). */
function scalar(v: string): string {
  let back: unknown;
  try { back = parse(`k: ${v}`); } catch { back = null; }
  const plain = v !== '' && !/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(v) && !/\s$/.test(v) && !v.includes(': ') && !v.includes(' #')
    && !!back && typeof back === 'object' && (back as Record<string, unknown>).k === v;
  return plain ? v : JSON.stringify(v);
}
const flowList = (vs: string[]) => `[${vs.map((v) => scalar(v)).join(', ')}]`;
const dedupe = (vs: string[]) => [...new Set(vs.map(nfc))];
/** Known values in `known`'s order (types: the core's type order; kinds: link, relation, embed, tag), then unknown
 *  ones in their previous order, then new ones in the order given; NFC, deduplicated. */
function ordered(keys: string[], known: string[], previous: string[]): string[] {
  const ks = dedupe(keys);
  const order = known.map(nfc);
  const prev = previous.map(nfc);
  const k = ks.filter((x) => order.includes(x)).sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const rest = ks.filter((x) => !order.includes(x));
  const old = rest.filter((x) => prev.includes(x)).sort((x, y) => prev.indexOf(x) - prev.indexOf(y));
  return [...k, ...old, ...rest.filter((x) => !prev.includes(x))];
}
const sameSet = (a: string[], b: string[]) => { const x = new Set(a.map(nfc)), y = new Set(b.map(nfc)); return x.size === y.size && [...x].every((v) => y.has(v)); };

/** The end of a value written after `start` in `s`: past a quoted scalar or a balanced flow collection; null when it
 *  doesn't close on the line. */
function closeOf(s: string, start: number): number | null {
  const c = s[start];
  if (c === '"' || c === '\'') {
    for (let j = start + 1; j < s.length; j++) {
      if (c === '"' && s[j] === '\\') { j++; continue; }
      if (s[j] === c) { if (c === '\'' && s[j + 1] === '\'') { j++; continue; } return j + 1; }
    }
    return null;
  }
  return null;
}
/** The flow collection's end across lines, as the core's `flow_end`: the index after it closes in `s`, or null when it
 *  continues (`st` carries the depth and the open quote; a ` #` comment ends the line). */
function flowEnd(s: string, st: { depth: number; quote: string | null }): number | null {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (st.quote === '"') { if (c === '\\') i++; else if (c === '"') st.quote = null; continue; }
    if (st.quote === '\'') { if (c === '\'') { if (s[i + 1] === '\'') i++; else st.quote = null; } continue; }
    if (c === '"' || c === '\'') st.quote = c;
    else if (c === '[' || c === '{') st.depth++;
    else if (c === ']' || c === '}') { st.depth--; if (st.depth === 0) return i + 1; }
    else if (c === '#' && i > 0 && (s[i - 1] === ' ' || s[i - 1] === '\t')) return null;
  }
  return null;
}

/** A line with its own ending (`\r\n`, `\n`, or '' for a last line without one). */
type Line = { text: string; end: string };
type Item = { start: number; end: number; dash: number; keys: number };
type Layout = { presets: number | null; items: Item[] };
type KeyAt = { line: number; end: number; prefix: string; tail: string };

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

// The core's line rules (graph_presets.rs): spaces only count as indentation; comment lines are skipped like blank
// lines wherever a range is measured (QA G3), so only content lines end an item or a key's value.
const spaces = (l: string) => l.length - l.replace(/^ +/, '').length;
const content = (l: string) => !blank(l) && !comment(l);
const dashAt = (l: string, at: number) => { const r = l.slice(at); return r === '-' || r.startsWith('- '); };
const docMarker = (l: string, m: string) => l.startsWith(m) && (l.length === m.length || l[m.length] === ' ' || l[m.length] === '\t');

/** The mapping key starting at `at` of `body` and the index of its `:` (plain or quoted, as the core's `key_at`). */
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

/** The core's `scan`: the `presets` key line and its items' line ranges; null when the file can't be patched by lines
 *  (D-1122: a non-empty flow list, `presets: ~`, a flow item, items that don't line up with what YAML read). */
function layout(lines: string[], p: Parsed): Layout | null {
  const at = lines.findIndex((l) => spaces(l) === 0 && content(l) && keyAt(l, 0)?.key === 'presets');
  if (p.value === 'missing') return { presets: null, items: [] };
  if (at < 0) return null;
  const k = keyAt(lines[at], 0)!;
  const inline = lines[at].slice(k.colon + 1).trimStart();
  if (inline !== '' && !inline.startsWith('#')) return p.items.length === 0 && inline.startsWith('[') ? { presets: at, items: [] } : null;
  const items: Item[] = [];
  let d: number | null = null;
  let regionEnd = at;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!content(l)) continue;
    const ind = spaces(l);
    d ??= ind;
    if (ind < d || (ind === d && !dashAt(l, ind))) break;
    if (ind === d) items.push({ start: i, end: i, dash: d, keys: 0 });
    regionEnd = i;
  }
  if (items.length !== p.items.length) return null;
  if (items.some((it) => /^[{[]/.test(lines[it.start].slice(it.dash + 1).trimStart()))) return null;
  items.forEach((it, n) => {
    const limit = n + 1 < items.length ? items[n + 1].start - 1 : Math.max(regionEnd, it.start);
    let end = it.start;
    for (let i = it.start + 1; i <= Math.min(limit, lines.length - 1); i++) {
      if (!content(lines[i])) continue;
      if (spaces(lines[i]) <= it.dash) break;
      end = i;
    }
    it.end = end;
    const after = lines[it.start].slice(it.dash + 1);
    if (after.trim() === '') {
      const c = lines.slice(it.start + 1, end + 1).find(content);
      it.keys = c !== undefined ? spaces(c) : it.dash + 2;
    } else it.keys = it.dash + 1 + (after.length - after.replace(/^ +/, '').length);
  });
  return { presets: at, items };
}

/** The core's `find_key`: `key` among an item's lines (`il`, the dash line first) at column `k`, with the lines its
 *  value takes (a block list, a flow collection over several lines, a plain scalar's continuation). */
function findKey(il: string[], k: number, key: string): KeyAt | null {
  const line = il.findIndex((b, i) => (i === 0 ? b.length > k : content(b) && spaces(b) === k) && keyAt(b, k)?.key === key);
  if (line < 0) return null;
  const body = il[line];
  const { colon } = keyAt(body, k)!;
  const rest = body.slice(colon + 1);
  const vOff = colon + 1 + (rest.length - rest.replace(/^[ \t]+/, '').length);
  const v = body.slice(vOff);
  const blockEnd = () => {
    let end = line;
    for (let i = line + 1; i < il.length; i++) {
      const b = il[i];
      if (!content(b)) continue;
      const ind = spaces(b);
      if (ind > k || (ind === k && dashAt(b, ind))) end = i;
      else break;
    }
    return end;
  };
  if (v === '' || v.startsWith('#')) return { line, end: blockEnd(), prefix: `${body.slice(0, colon + 1)} `, tail: rest };
  const prefix = body.slice(0, vOff);
  if (v[0] === '[' || v[0] === '{') {
    const st = { depth: 0, quote: null as string | null };
    const p0 = flowEnd(v, st);
    if (p0 !== null) return { line, end: line, prefix, tail: v.slice(p0) };
    for (let i = line + 1; i < il.length; i++) {
      const p1 = flowEnd(il[i], st);
      if (p1 !== null) return { line, end: i, prefix, tail: il[i].slice(p1) };
    }
    return null;
  }
  if (v[0] === '"' || v[0] === '\'') {
    const close = closeOf(v, 0);
    return close === null ? null : { line, end: line, prefix, tail: v.slice(close) };
  }
  const cuts = [' #', '\t#'].map((m) => v.indexOf(m)).filter((x) => x >= 0);
  const cut = cuts.length ? Math.min(...cuts) : v.length;
  const valueLen = v.slice(0, cut).trimEnd().length;
  let end = line;
  for (let i = line + 1; i < il.length; i++) {
    const b = il[i];
    if (blank(b)) continue;
    if (spaces(b) > k && !comment(b) && cut === v.length) end = i;
    else break;
  }
  return { line, end, prefix, tail: end === line ? v.slice(valueLen) : '' };
}

/** Replaces `L[from..=to]` with `texts` (the file's `nl`; the replaced block's last ending stays on the last new line),
 *  keeping a missing final newline missing. */
function spliceLines(L: Line[], from: number, to: number, texts: string[], nl: string) {
  const lastEnd = L[to].end;
  const add = texts.map((t, i) => ({ text: t, end: i === texts.length - 1 ? lastEnd : nl }));
  const atEnd = to + 1 === L.length;
  L.splice(from, to - from + 1, ...add);
  if (!add.length && atEnd && lastEnd === '' && from > 0) L[from - 1].end = '';
}
/** Inserts `texts` after line `after` (null: at the start), keeping a missing final newline missing. */
function insertAfter(L: Line[], after: number | null, texts: string[], nl: string) {
  const at = after === null ? 0 : after + 1;
  const add = texts.map((t) => ({ text: t, end: nl }));
  if (after !== null && L[after].end === '') { L[after].end = nl; if (add.length) add[add.length - 1].end = ''; }
  L.splice(at, 0, ...add);
}

/** More than one YAML document: a `---` after content (or a second one), or a `...` (D-1122: never patched). */
function severalDocuments(lines: string[]): boolean {
  let started = false;
  for (const b of lines) {
    if (!content(b) || (!started && b.startsWith('%'))) continue;
    if (docMarker(b, '...') || (docMarker(b, '---') && started)) return true;
    started = true;
  }
  return false;
}
/** The leading lines `version: 1` goes after (D-1124, QA G3): comments, `%` directives and the first `---` line. */
function prelude(lines: string[]): number {
  let started = false, n = 0;
  for (const b of lines) {
    const start = docMarker(b, '---') && /^\s*(#|$)/.test(b.slice(3));
    if (comment(b) || (!started && (b.startsWith('%') || start))) { started ||= start; n++; } else break;
  }
  return n;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** R118 write rules: the file's next text after `op` (`text` null: no file), or the refusal. `typeOrder` is the
 *  vault's D-977 type order (§16.1). An operation that leaves the bytes equal returns the same text. */
export function presetsPatch(text: string | null, op: PresetOpDto, typeOrder: string[], utf8 = true): { text: string; presets: GraphPresetDto[] } | { error: PresetsErr } {
  const p = parsed(text, utf8);
  if (p.read.state === 'unreadable') return err('Unreadable', 'fake: the presets file can\'t be read');
  if (p.read.state === 'newer') return err('NewerVersion', 'fake: the presets file is from a newer version');
  const listed = p.listed;
  const find = (name: string) => listed.find((x) => low(x.name) === low(name));
  const done = (t: string) => ({ text: t, presets: presetsRead(t).presets });
  const unpatchable = () => err('Unreadable', 'fake: the presets list can\'t be patched line by line');
  const named = (name: string, renaming?: string) => {
    const e = validateName(name, listed, renaming);
    return e ? err(e.kind, `fake: ${e.kind}`, e.kind === 'NameTaken' ? { existing: e.existing } : {}) : null;
  };
  const item = (d: number, k: number, name: string, ht: string[], hk: string[]) => [
    `${' '.repeat(d)}-${' '.repeat(Math.max(1, k - d - 1))}name: ${scalar(name)}`, `${' '.repeat(d + 1 + Math.max(1, k - d - 1))}hidden-types: ${flowList(ht)}`, `${' '.repeat(d + 1 + Math.max(1, k - d - 1))}hidden-kinds: ${flowList(hk)}`,
  ];

  // The operation after validation: what the parse-back check expects of the `presets` list.
  type Want = { op: 'save'; name: string; types: string[]; kinds: string[] } | { op: 'update'; raw: number; types: string[]; kinds: string[]; t: boolean; k: boolean } | { op: 'rename'; raw: number; to: string } | { op: 'delete'; raw: number };
  let want: Want;
  switch (op.op) {
    case 'save': {
      const bad = named(op.name);
      if (bad) return bad;
      want = { op: 'save', name: nfc(trimWs(op.name)), types: ordered(op.hiddenTypes, typeOrder, []), kinds: ordered(op.hiddenKinds, KINDS, []) };
      break;
    }
    case 'update': {
      const x = find(op.name);
      if (!x) return err('NoSuchPreset', `fake: no preset ${op.name}`);
      const t = !sameSet(op.hiddenTypes, x.hiddenTypes), k = !sameSet(op.hiddenKinds, x.hiddenKinds);
      if (!t && !k) return done(text!); // D-1114
      want = { op: 'update', raw: x.item, types: ordered(op.hiddenTypes, typeOrder, x.hiddenTypes), kinds: ordered(op.hiddenKinds, KINDS, x.hiddenKinds), t, k };
      break;
    }
    case 'rename': {
      const x = find(op.from);
      if (!x) return err('NoSuchPreset', `fake: no preset ${op.from}`);
      const bad = named(op.to, x.name);
      if (bad) return bad;
      const to = nfc(trimWs(op.to));
      if (to === x.name) return done(text!);
      want = { op: 'rename', raw: x.item, to };
      break;
    }
    case 'delete': {
      const x = find(op.name);
      if (!x) return err('NoSuchPreset', `fake: no preset ${op.name}`);
      want = { op: 'delete', raw: x.item };
      break;
    }
  }

  if (text === null) {
    if (want.op !== 'save') return err('NoSuchPreset', 'fake: no presets file');
    return done([HEADER, 'version: 1', 'presets:', ...item(2, 4, want.name, want.types, want.kinds)].join('\n') + '\n');
  }

  // A UTF-8 BOM stays first: the lines are patched without it.
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const L = splitLines(text.slice(bom.length));
  const lines = L.map((l) => l.text);
  if (severalDocuments(lines)) return unpatchable();
  const lay = layout(lines, p);
  if (!lay) return unpatchable();
  const nl = L.find((l) => l.end !== '')?.end ?? '\n';

  switch (want.op) {
    case 'save': {
      const last = lay.items[lay.items.length - 1];
      const add = item(last ? last.dash : 2, last ? last.keys : 4, want.name, want.types, want.kinds);
      if (last) insertAfter(L, last.end, add, nl);
      else if (lay.presets !== null) {
        const body = L[lay.presets].text;
        const { colon } = keyAt(body, 0)!;
        const inline = body.slice(colon + 1).trimStart();
        if (inline.startsWith('[')) {
          // `presets: []` becomes `presets:` (a trailing comment stays).
          const close = flowEnd(inline, { depth: 0, quote: null });
          if (close === null) return unpatchable();
          L[lay.presets] = { ...L[lay.presets], text: `${body.slice(0, colon + 1)}${inline.slice(close)}` };
        }
        insertAfter(L, lay.presets, add, nl);
      } else insertAfter(L, L.length ? L.length - 1 : null, ['presets:', ...add], nl);
      break;
    }
    case 'update': {
      const it = lay.items[want.raw];
      const il = L.slice(it.start, it.end + 1);
      const ilt = il.map((l) => l.text);
      const found: [KeyAt, string][] = [];
      const add: string[] = [];
      for (const [key, values, changed] of [['hidden-types', want.types, want.t], ['hidden-kinds', want.kinds, want.k]] as const) {
        const at = findKey(ilt, it.keys, key);
        if (at) { if (changed) found.push([at, flowList(values)]); continue; }
        // YAML read the key but the scanner can't find it (the core's `old_has`): the file isn't patched.
        const raw = p.items[want.raw];
        if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, key)) return unpatchable();
        add.push(`${' '.repeat(it.keys)}${key}: ${flowList(values)}`);
      }
      found.sort((a, b) => b[0].line - a[0].line);
      for (const [at, v] of found) spliceLines(il, at.line, at.end, [`${at.prefix}${v}${at.tail}`], nl);
      if (add.length) insertAfter(il, il.length - 1, add, nl);
      L.splice(it.start, it.end - it.start + 1, ...il);
      break;
    }
    case 'rename': {
      const it = lay.items[want.raw];
      const il = L.slice(it.start, it.end + 1);
      const at = findKey(il.map((l) => l.text), it.keys, 'name');
      if (!at) return unpatchable();
      spliceLines(il, at.line, at.end, [`${at.prefix}${scalar(want.to)}${at.tail}`], nl);
      L.splice(it.start, it.end - it.start + 1, ...il);
      break;
    }
    case 'delete': {
      const it = lay.items[want.raw];
      spliceLines(L, it.start, it.end, [], nl);
      if (p.items.length === 1) {
        // AP-926: the last item leaves `presets: []`; the file stays.
        if (lay.presets === null) return unpatchable();
        const body = L[lay.presets].text;
        const { colon } = keyAt(body, 0)!;
        L[lay.presets] = { ...L[lay.presets], text: `${body.slice(0, colon + 1)} []${body.slice(colon + 1)}` };
      }
      break;
    }
  }
  // R118, D-1124: a missing `version` is written as `version: 1` after the leading comment lines (and leading `%`
  // directives and a `---` line, QA G3).
  if (!p.hasVersion) {
    const n = prelude(L.map((l) => l.text));
    insertAfter(L, n > 0 ? n - 1 : null, ['version: 1'], nl);
  }
  const next = bom + joinLines(L);
  if (next === text) return done(text);

  // The safety net (QA G3, as the core's `reads_back`): the new text reads as ok, every other top-level key is
  // unchanged, `version` is the old one (or 1), and `presets` is the old list with exactly this operation applied.
  const back = parsed(next);
  if (back.read.state !== 'ok' || !back.doc || !p.doc) return unpatchable();
  const others = (d: Record<string, unknown>) => Object.keys(d).filter((k) => k !== 'version' && k !== 'presets');
  const od = p.doc, nd = back.doc;
  if (others(od).length !== others(nd).length || others(od).some((k) => !(k in nd) || !same(od[k], nd[k]))) return unpatchable();
  if (!same(nd.version, p.hasVersion ? od.version : 1)) return unpatchable();
  const expected: unknown[] = structuredClone(p.items);
  switch (want.op) {
    case 'save': expected.push({ name: want.name, 'hidden-types': want.types, 'hidden-kinds': want.kinds }); break;
    case 'update': {
      const o = expected[want.raw] as Record<string, unknown>;
      for (const [key, values, changed] of [['hidden-types', want.types, want.t], ['hidden-kinds', want.kinds, want.k]] as const) {
        if (!(key in o) || changed) o[key] = values;
      }
      break;
    }
    case 'rename': (expected[want.raw] as Record<string, unknown>).name = want.to; break;
    case 'delete': expected.splice(want.raw, 1); break;
  }
  if (!Array.isArray(nd.presets) || !same(nd.presets, expected)) return unpatchable();
  return done(next);
}

// ------------------------------------------------------------------------------------------------ the fake's entry

/** The fake core's version hash (fake-core.ts `state.ver`): FNV-1a over the UTF-8 bytes. */
function versionOf(text: string): { size: number; hash: string } {
  const bytes = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return { size: bytes.length, hash: h.toString(16).padStart(8, '0') };
}

/** The fake core's entry: `files` the vault texts, `invalid` the paths whose bytes aren't UTF-8. `writes` maps a path to
 *  its new text. */
export async function handle(cmd: string, a: any, files: Record<string, string>, invalid: string[]): Promise<{ result?: unknown; error?: PresetsErr; writes?: Record<string, string> }> {
  const text = files[GRAPH_YML] ?? null;
  const utf8 = !invalid.map(nfc).includes(GRAPH_YML);
  switch (cmd) {
    case 'graph_presets_get':
      return { result: presetsRead(text, utf8) };
    case 'graph_presets_apply': {
      const base = (a?.base ?? null) as { size: number; hash: string } | null;
      const disk = presetsRead(text, utf8);
      // FR-SYN-03 AC-22, AC-24 (D-175): the version last read is the base; RENAME_EXCL for a first save.
      if (base === null && text !== null) return { error: { kind: 'Conflict', message: 'fake: graph.yml appeared', disk } };
      if (base !== null && text === null) return { error: { kind: 'Gone', message: 'fake: graph.yml is gone', disk } };
      if (base !== null && text !== null) {
        if (!utf8) return { error: { kind: 'Unreadable', message: 'fake: graph.yml can\'t be read' } };
        const v = versionOf(text);
        if (v.size !== base.size || v.hash !== base.hash) return { error: { kind: 'Conflict', message: 'fake: graph.yml changed', disk } };
      }
      const r = presetsPatch(text, a?.op as PresetOpDto, vaultTypeOrder(files), utf8);
      if ('error' in r) return { error: r.error };
      const result = presetsRead(r.text);
      return r.text === text ? { result } : { result, writes: { [GRAPH_YML]: r.text } };
    }
    default:
      return { error: { kind: 'NotImplemented', message: `fake-presets: unknown command ${cmd}` } };
  }
}
