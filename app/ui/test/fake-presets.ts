// Fake core, slice G3 (docs/contracts/v1-graph.md §16.6): `graph_presets_get` and `graph_presets_apply` over the fake's
// `.tegg/graph.yml`, a TypeScript twin of §16.1's parser and patcher (R118 read and write rules), checked against the
// Rust module on every tests/fixtures/graph-presets/ input and expected/ output (app/test/graph_presets.ac.test.ts and
// crates/tegg-core/tests/ac_graph_presets.rs read the same files). Runs in Node (installFakeCore exposes it to the page
// as `__teggPresets`). Test code, not product code.
//
// Values come from the `yaml` package (YAML 1.2, as NFR-POR-01 AC-3's standard parser); positions from a line scanner,
// so a patch changes only the operated item's lines (AP-921).
import { parse, parseDocument, isMap, isScalar, isSeq } from 'yaml';
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
const indentOf = (l: string) => l.length - l.trimStart().length;
const blank = (l: string) => l.trim() === '';
const comment = (l: string) => l.trimStart().startsWith('#');
const err = (kind: PresetsErr['kind'], message: string, more: Partial<PresetsErr> = {}): { error: PresetsErr } => ({ error: { kind, message, ...more } });

// ------------------------------------------------------------------------------------------------ reading (R118)

/** A listed preset and the index of its item in the `presets` list. */
type Listed = GraphPresetDto & { item: number };
type Parsed = { read: PresetsRead; listed: Listed[]; hasVersion: boolean };

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
  const unreadable = (line: number | null, reason: string): Parsed => ({ read: { state: 'unreadable', error: { line, reason }, presets: [] }, listed: [], hasVersion: true });
  if (text === null) return { read: { state: 'missing', error: null, presets: [] }, listed: [], hasVersion: false };
  if (!utf8) return unreadable(null, 'The file isn\'t valid UTF-8.');
  const doc = parseDocument(text);
  if (doc.errors.length) {
    const e = doc.errors[0];
    return unreadable(errorLine(text, e.pos?.[0] ?? null, e.linePos?.[0]?.line ?? null), e.message.split('\n')[0]);
  }
  const top = doc.contents;
  if (top === null || (isScalar(top) && top.value === null)) return { read: { state: 'ok', error: null, presets: [] }, listed: [], hasVersion: false };
  if (!isMap(top)) return unreadable(null, 'The top level isn\'t a mapping.');
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
  if (pNode !== undefined && pNode !== null && !(isScalar(pNode) && pNode.value === null) && !isSeq(pNode)) return unreadable(null, '`presets` isn\'t a list.');
  const items = isSeq(pNode) ? (pNode.toJSON() as unknown[]) : [];
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
  return { read: { state: version > 1 ? 'newer' : 'ok', error: null, presets }, listed, hasVersion };
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
  let depth = 0;
  let q: string | null = null;
  for (let j = start; j < s.length; j++) {
    const x = s[j];
    if (q) { if (x === q) q = null; continue; }
    if (x === '"' || x === '\'') { q = x; continue; }
    if (x === '[' || x === '{') depth++;
    if (x === ']' || x === '}') { depth--; if (depth === 0) return j + 1; }
  }
  return null;
}
/** A trailing ` # comment` of a plain value, with the spaces before it; '' when there is none. */
function trailing(value: string): string {
  for (let j = 1; j < value.length; j++) {
    if (value[j] === '#' && /\s/.test(value[j - 1])) {
      let s = j;
      while (s > 0 && /\s/.test(value[s - 1])) s--;
      return value.slice(s);
    }
  }
  return '';
}

/** A line with its own ending (`\r\n`, `\n`, or '' for a last line without one). */
type Line = { text: string; end: string };
type Item = { start: number; end: number; dash: number; key: number };
type Key = { name: string; line: number; end: number; colon: number };
type Layout = { presetsLine: number; items: Item[]; dash: number | null; key: number | null };

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

/** The `presets` key's line and each item of its block list: from its `- ` line at the dash indent (the first content
 *  line after `presets:`) to the last non-blank line before the next non-blank line indented at most as far. */
function layout(lines: string[]): Layout {
  const presetsLine = lines.findIndex((l) => /^presets\s*:/.test(l));
  if (presetsLine < 0) return { presetsLine: -1, items: [], dash: null, key: null };
  const first = lines.findIndex((l, i) => i > presetsLine && !blank(l));
  const dash = first >= 0 && indentOf(lines[first]) > 0 ? indentOf(lines[first]) : first >= 0 && /^-(\s|$)/.test(lines[first]) ? 0 : null;
  const items: Item[] = [];
  if (dash === null) return { presetsLine, items, dash, key: null };
  for (let i = first; i < lines.length; i++) {
    const l = lines[i];
    if (blank(l)) continue;
    if (indentOf(l) < dash || (indentOf(l) === dash && !comment(l) && !/^\s*-(\s|$)/.test(l))) break;
    if (indentOf(l) === dash && /^\s*-(\s|$)/.test(l)) items.push({ start: i, end: i, dash, key: -1 });
  }
  for (const it of items) {
    let end = it.start;
    for (let i = it.start + 1; i < lines.length; i++) {
      if (blank(lines[i])) continue;
      if (indentOf(lines[i]) <= dash) break;
      end = i;
    }
    it.end = end;
    const l = lines[it.start];
    let k = dash + 1;
    while (l[k] === ' ') k++;
    if (k >= l.length || l[k] === '#') {
      const c = lines.findIndex((x, i) => i > it.start && i <= end && !blank(x) && !comment(x));
      k = c >= 0 ? indentOf(lines[c]) : dash + 2;
    }
    it.key = k;
  }
  return { presetsLine, items, dash, key: items[0]?.key ?? null };
}

/** The keys of an item's mapping at its key column, each with its block-list continuation lines. Null when the item
 *  isn't a block mapping the scanner can patch (a flow `- {…}` item, a quoted key). */
function keysOf(lines: string[], it: Item): Key[] | null {
  const out: Key[] = [];
  if (lines[it.start][it.key] === '{' || lines[it.start][it.key] === '"' || lines[it.start][it.key] === '\'') return null;
  for (let i = it.start; i <= it.end; i++) {
    const l = lines[i];
    if (i !== it.start && (blank(l) || indentOf(l) !== it.key || comment(l))) continue;
    if (i === it.start && it.key >= l.length) continue;
    const rest = l.slice(it.key);
    if (/^["']/.test(rest)) return null;
    if (/^-(\s|$)/.test(rest)) continue;
    const m = /^([^\s#][^:]*?)\s*:(\s|$)/.exec(rest);
    if (!m) continue;
    let end = i;
    for (let j = i + 1; j <= it.end; j++) {
      const x = lines[j];
      if (blank(x) || (comment(x) && indentOf(x) >= it.key)) continue; // comments between list lines go with them
      if (indentOf(x) > it.key || (indentOf(x) === it.key && /^\s*-(\s|$)/.test(x))) { end = j; continue; }
      break;
    }
    out.push({ name: m[1], line: i, end, colon: it.key + m[0].lastIndexOf(':') });
  }
  return out;
}

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
  const types = (v: string[], prev: string[]) => flowList(ordered(v, typeOrder, prev));
  const kinds = (v: string[], prev: string[]) => flowList(ordered(v, KINDS, prev));
  const item = (d: number, k: number, name: string, ht: string[], hk: string[]) => [
    `${' '.repeat(d)}-${' '.repeat(Math.max(1, k - d - 1))}name: ${scalar(nfc(trimWs(name)))}`, `${' '.repeat(k)}hidden-types: ${types(ht, [])}`, `${' '.repeat(k)}hidden-kinds: ${kinds(hk, [])}`,
  ];

  if (text === null) {
    if (op.op !== 'save') return err('NoSuchPreset', 'fake: no presets file');
    const bad = named(op.name);
    if (bad) return bad;
    return done([HEADER, 'version: 1', 'presets:', ...item(2, 4, op.name, op.hiddenTypes, op.hiddenKinds)].join('\n') + '\n');
  }

  const L = splitLines(text);
  const lines = L.map((l) => l.text);
  const nl = L.find((l) => l.end !== '')?.end ?? '\n';
  const lay = layout(lines);
  // The raw items must line up with what YAML read, else the file can't be patched line by line.
  const rawCount = (() => { const doc = parseDocument(text); const n = isMap(doc.contents) ? doc.contents.get('presets', true) : undefined; return isSeq(n) ? n.items.length : null; })();
  const pLine = lay.presetsLine >= 0 ? lines[lay.presetsLine] : '';
  const pRest = pLine.replace(/^presets\s*:/, '');
  const emptyFlow = /^\s*\[\s*\]/.test(pRest);
  if (rawCount !== null && rawCount > 0 && (rawCount !== lay.items.length || /^\s*\[/.test(pRest))) return unpatchable();
  const itemOf = (x: Listed) => lay.items[x.item];
  if (lay.items.some((it) => /^[{["']/.test(lines[it.start].slice(it.key)))) return unpatchable(); // a flow `- {…}` item, a quoted key

  /** Replaces `del` lines at `at` with `texts`: new lines take the file's first ending; a replaced block's last ending
   *  stays on the last new line; an append after a last line without an ending moves it to the new last line. */
  const splice = (at: number, del: number, texts: string[]) => {
    if (del > 0) {
      const lastEnd = L[at + del - 1].end;
      const add = texts.map((t2, i) => ({ text: t2, end: i === texts.length - 1 ? lastEnd : nl }));
      if (!add.length && at + del === L.length && lastEnd === '' && at > 0) L[at - 1].end = '';
      L.splice(at, del, ...add);
      return;
    }
    const add = texts.map((t2) => ({ text: t2, end: nl }));
    if (at === L.length && at > 0 && L[at - 1].end === '') { L[at - 1].end = nl; if (add.length) add[add.length - 1].end = ''; }
    L.splice(at, 0, ...add);
  };

  switch (op.op) {
    case 'save': {
      const bad = named(op.name);
      if (bad) return bad;
      const d = lay.items.length ? lay.dash! : 2, k = lay.items.length ? lay.key! : 4;
      const add = item(d, k, op.name, op.hiddenTypes, op.hiddenKinds);
      if (lay.presetsLine < 0) splice(L.length, 0, ['presets:', ...add]);
      else if (lay.items.length) splice(lay.items[lay.items.length - 1].end + 1, 0, add);
      else if (emptyFlow) splice(lay.presetsLine, 1, [`presets:${pRest.replace(/^\s*\[\s*\]/, '')}`, ...add]);
      else splice(lay.presetsLine + 1, 0, add);
      break;
    }
    case 'update': {
      const x = find(op.name);
      if (!x) return err('NoSuchPreset', `fake: no preset ${op.name}`);
      const sameT = sameSet(op.hiddenTypes, x.hiddenTypes), sameK = sameSet(op.hiddenKinds, x.hiddenKinds);
      if (sameT && sameK) return done(text); // D-1114
      const it = itemOf(x);
      const keys = keysOf(lines, it);
      if (!keys) return unpatchable();
      const values: [string, string, boolean][] = [
        ['hidden-types', types(op.hiddenTypes, x.hiddenTypes), sameT],
        ['hidden-kinds', kinds(op.hiddenKinds, x.hiddenKinds), sameK],
      ];
      const edits: { at: number; del: number; lines: string[] }[] = [];
      const appended: string[] = [];
      for (const [name, v, same] of values) {
        const key = keys.find((y) => y.name === name);
        if (!key) { appended.push(`${' '.repeat(it.key)}${name}: ${v}`); continue; }
        if (same) continue;
        const l = lines[key.line];
        const after = l.slice(key.colon + 1);
        const lead = /^\s*/.exec(after)![0];
        const body = after.slice(lead.length);
        let line: string;
        if (body === '' || body.startsWith('#')) line = `${l.slice(0, key.colon + 1)} ${v}${after}`; // a block list
        else if (body.startsWith('[')) {
          const close = closeOf(after, lead.length);
          if (close === null) return unpatchable();
          line = `${l.slice(0, key.colon + 1)}${lead}${v}${after.slice(close)}`;
        } else return unpatchable();
        edits.push({ at: key.line, del: key.end - key.line + 1, lines: [line] });
      }
      if (appended.length) edits.push({ at: it.end + 1, del: 0, lines: appended });
      edits.sort((e1, e2) => e2.at - e1.at);
      for (const e of edits) splice(e.at, e.del, e.lines);
      break;
    }
    case 'rename': {
      const x = find(op.from);
      if (!x) return err('NoSuchPreset', `fake: no preset ${op.from}`);
      const bad = named(op.to, x.name);
      if (bad) return bad;
      const to = nfc(trimWs(op.to));
      if (to === x.name) return done(text);
      const keys = keysOf(lines, itemOf(x));
      const key = keys?.find((y) => y.name === 'name');
      if (!key) return unpatchable();
      const l = lines[key.line];
      const after = l.slice(key.colon + 1);
      const lead = /^\s*/.exec(after)![0];
      const body = after.slice(lead.length);
      let tail: string;
      if (body.startsWith('"') || body.startsWith('\'')) {
        const close = closeOf(after, lead.length);
        if (close === null) return unpatchable();
        tail = after.slice(close);
      } else tail = trailing(body);
      splice(key.line, 1, [`${l.slice(0, key.colon + 1)}${lead || ' '}${scalar(to)}${tail}`]);
      break;
    }
    case 'delete': {
      const x = find(op.name);
      if (!x) return err('NoSuchPreset', `fake: no preset ${op.name}`);
      const it = itemOf(x);
      splice(it.start, it.end - it.start + 1, []);
      if (lay.items.length === 1) L[lay.presetsLine] = { ...L[lay.presetsLine], text: `presets: []${pRest}` };
      break;
    }
  }
  // A missing `version` is written as `version: 1` after the leading comment lines (AR-07).
  if (!p.hasVersion) {
    let at = 0;
    while (at < L.length && comment(L[at].text)) at++;
    splice(at, 0, ['version: 1']);
  }
  const next = L.map((l) => l.text + l.end).join('');
  return done(next === text ? text : next);
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
