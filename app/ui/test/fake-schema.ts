// Fake core, slice 3D part (docs/contracts/ms3-shell.md §14.8): type files and typed objects over the in-memory vault.
// Test code, not product code. Runs in the Playwright (Node) process; the in-page fake (fake-core.ts) forwards the 3D
// commands here through `page.exposeFunction` with a snapshot of the vault files and their versions, and applies the
// returned writes. Type files are read with the `yaml` package by §14.1.1 and patched by the line rules of §14.1.4;
// rules, validity and type matching come from `@tegg/schema`, note text from `@tegg/doc` (D-241). Starter and
// built-in bytes are read from tests/fixtures/vaults/new-starter/ and new-empty/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseDocument, parse as parseYaml } from 'yaml';
import { cardIgnored, cardList } from '../../../packages/schema/src/cards.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const SYSTEM = ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf'];
const R10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'];
const UNIVERSAL_PREVIEW = ['tags', 'source', 'aliases', 'created', 'modified'];
const TOP = ['version', 'name', 'plural', 'system', 'folder', 'icon', 'color', 'description', 'review', 'preview', 'card', 'hidden', 'columns', 'views', 'embed', 'template', 'attributes'];
/** R31 (D-417): the built-in default embed mode of a type key. */
const defaultEmbed = (key: string) => (['page', 'quick-note', 'daily-note'].includes(key) ? 'full' : 'card');
const embedMode = (raw: unknown): string | null => { const m = typeof raw === 'string' ? raw.trim().toLowerCase() : ''; return ['full', 'card', 'link'].includes(m) ? m : null; };
const ITEM = ['key', 'name', 'type', 'icon', 'default', 'required', 'options', 'to', 'multiple', 'description'];
const HEADER = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\n";

export type VersionDto = { mtimeNs: string; size: number; hash: string };
export type Files = Record<string, string>;
export type Answer = { result?: unknown; error?: Record<string, unknown>; writes?: Record<string, string | null> };

function readTree(rel: string): Files {
  const abs = resolve(REPO, rel);
  const out: Files = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(abs, p).normalize('NFC')] = readFileSync(p, 'utf8');
    }
  };
  walk(abs);
  return out;
}
export const STARTER: Files = readTree('tests/fixtures/vaults/new-starter');
const BUILTIN: Files = Object.fromEntries(Object.entries(readTree('tests/fixtures/vaults/new-empty/.tegg/types')).map(([p, t]) => [p.replace(/\.yml$/, ''), t]));

const nfc = (s: string) => s.normalize('NFC');
const typePath = (key: string) => `.tegg/types/${nfc(key)}.yml`;
const err = (kind: string, message: string, extra: Record<string, unknown> = {}) => ({ kind, message, ...extra });
const sameVersion = (a: VersionDto | null | undefined, b: VersionDto | null | undefined) => !!a && !!b && a.size === b.size && a.hash === b.hash;

// ------------------------------------------------------------------------------------------------ icons (slice OC, v1-cards §5)

type IconNode = [string, Record<string, string>][];
let iconData: { icons: Record<string, { n: IconNode }>; aliases: Record<string, string> } | null = null;
/** The bundled Lucide 0.460.0 set and the aliases, read once in Node (v1-cards §13). */
function icons() {
  if (!iconData) {
    const d = JSON.parse(readFileSync(resolve(REPO, 'packages/schema/data/lucide-0.460.0.json'), 'utf8'));
    iconData = { icons: d.icons, aliases: JSON.parse(readFileSync(resolve(REPO, 'packages/schema/data/icon-aliases.json'), 'utf8')) };
  }
  return iconData;
}
/** v1-cards §2.4 `resolve_icon`: the canonical name (itself, else its alias target); null for unknown or non-ASCII. */
export function canonicalIcon(name: unknown): string | null {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || !/^[\x00-\x7f]+$/.test(n)) return null;
  const set = icons();
  if (Object.hasOwn(set.icons, n)) return n;
  const t = Object.hasOwn(set.aliases, n) ? set.aliases[n] : null;
  return t && Object.hasOwn(set.icons, t) ? t : null;
}
/** v1-cards §5.4: `ResolvedIconDto` of a name as written. */
export function resolvedIcon(name: unknown): { name: string; node: IconNode } | null {
  const c = canonicalIcon(name);
  return c ? { name: c, node: icons().icons[c].n } : null;
}
const sameIcon = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim()) || (canonicalIcon(a) !== null && canonicalIcon(a) === canonicalIcon(b));

async function schema(): Promise<Record<string, any>> {
  return (await import('@tegg/schema')) as Record<string, any>;
}
async function doc(): Promise<Record<string, any>> {
  return (await import('@tegg/doc')) as Record<string, any>;
}

// ------------------------------------------------------------------------------------------------ reading (§14.1.1)

export type TypeDto = Record<string, any>;

export function readType(key: string, text: string, exists: boolean, version: VersionDto | null): TypeDto {
  const system = SYSTEM.includes(key);
  const base: TypeDto = {
    key, name: key, plural: key, folder: key, icon: 'file-text', color: 'gray', system, invalid: false, exists, version,
    state: 'ok', error: null, declaredVersion: null, description: null, review: 'off', preview: [], previewIgnored: [], hidden: [], columns: null, columnsIgnored: [], columnsUnreadable: false, embed: defaultEmbed(key), embedRaw: null, template: null, attributes: [],
    views: null, viewsUnreadable: false, viewItems: null, viewsSource: null,
    // Slice OC (v1-cards §4.2): a type without a readable file draws R210's fallback; `resolvedIcon` of `file-text`.
    cardList: ['tags', 'body', 'modified'], cardDefault: true, cardKeys: ['tags', 'body', 'modified'], cardIgnored: [], cardUnreadable: false, resolvedIcon: resolvedIcon('file-text'),
  };
  const invalid = (message: string, line: number) => ({ ...base, invalid: true, state: 'invalid', error: { message, line } });
  const d = parseDocument(text, { prettyErrors: false });
  if (d.errors.length) {
    const e = d.errors[0] as any;
    // Without pretty errors there is no linePos: count lines up to the error offset.
    let line = e.linePos?.[0]?.line ?? (Array.isArray(e.pos) ? text.slice(0, e.pos[0]).split('\n').length : text.split('\n').length);
    // An unclosed quote points at the line that opens it (as @tegg/doc).
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) if (/:\s*["'][^"']*$/.test(lines[i]) && i + 1 <= line) { line = i + 1; break; }
    return invalid(String(e.message ?? 'invalid YAML').split('\n')[0], line);
  }
  const y = d.toJS() as any;
  if (!y || typeof y !== 'object' || Array.isArray(y)) return invalid('the top level is not a mapping', 1);
  const lineOf = (k: string) => Math.max(1, text.split('\n').findIndex((l) => l.startsWith(`${k}:`)) + 1);
  if ('version' in y) {
    const raw = text.split('\n')[lineOf('version') - 1]?.replace(/^version:\s*/, '').trim() ?? '';
    if (!/^[1-9]\d*$/.test(raw)) return invalid('version must be a positive integer', lineOf('version'));
  }
  if ('attributes' in y && !Array.isArray(y.attributes)) return invalid('attributes must be a list', lineOf('attributes'));
  const keys = new Set<string>();
  for (const a of y.attributes ?? []) {
    if (!a || typeof a.key !== 'string' || typeof a.type !== 'string') return invalid('an attribute needs a key and a type', lineOf('attributes'));
    if (keys.has(a.key)) return invalid(`duplicate attribute ${a.key}`, lineOf('attributes'));
    keys.add(a.key);
  }
  const builtinKeys = system && BUILTIN[key] ? ((parseYaml(BUILTIN[key]) as any).attributes ?? []).map((a: any) => a.key) : [];
  const attributes = (y.attributes ?? []).map((a: any) => ({
    key: nfc(a.key), name: a.name ?? a.key, type: a.type, supported: R10.includes(a.type),
    readOnlyReason: R10.includes(a.type) ? null : ['file', 'color', 'recurrence'].includes(a.type) ? a.type : 'unsupported',
    default: a.default ?? null, required: a.required === true,
    options: (a.options ?? []).map((o: any) => ({ label: String(o.label), color: o.color ?? null, state: o.state ?? null })),
    to: Array.isArray(a.to) ? a.to : null, multiple: a.multiple === true, description: a.description ?? null, builtIn: builtinKeys.includes(a.key),
    // Slice OC (v1-cards §4.2, D-2070): `icon:` as written (trimmed; not a string → null) and its drawing.
    icon: typeof a.icon === 'string' && a.icon.trim() ? a.icon.trim() : null, resolvedIcon: typeof a.icon === 'string' ? resolvedIcon(a.icon) : null,
  }));
  const preview: string[] = Array.isArray(y.preview) ? y.preview.map(String) : [];
  const declared = typeof y.version === 'number' ? y.version : null;
  // Slice OC (v1-cards §2.1, §2.2; D-2076): `card:` as `columns`, the card list from @tegg/schema's twin.
  const cardOk = Array.isArray(y.card) && y.card.every((x: unknown) => typeof x === 'string');
  const card: string[] | null = cardOk ? y.card : null;
  const cardUnreadable = y.card !== undefined && y.card !== null && !cardOk;
  const cl = cardList({ key, state: declared !== null && declared > 1 ? 'newer' : 'ok', card, cardUnreadable, preview: preview.map((p) => nfc(p)), attributes });
  const iconText = y.icon ?? 'file-text';
  return {
    ...base,
    cardList: cl.list, cardDefault: cl.default, cardKeys: cl.keys, cardIgnored: cardIgnored({ key, attributes }, card ?? []), cardUnreadable,
    resolvedIcon: resolvedIcon(typeof iconText === 'string' ? iconText : String(iconText)),
    name: y.name ?? key, plural: y.plural ?? y.name ?? key, folder: y.folder ?? y.plural ?? y.name ?? key,
    icon: y.icon ?? 'file-text', color: y.color ?? 'gray', system: typeof y.system === 'boolean' ? y.system : system,
    state: declared !== null && declared > 1 ? 'newer' : 'ok', declaredVersion: declared, description: y.description ?? null,
    review: y.review === 'locked' ? 'locked' : y.review === true ? 'on' : 'off', preview,
    previewIgnored: preview.filter((p) => !attributes.some((a: any) => a.key === p) && !UNIVERSAL_PREVIEW.includes(p)),
    hidden: Array.isArray(y.hidden) ? y.hidden.map((x: unknown) => String(x).normalize('NFC')) : [],
    // D-1240, D-1245 (type-columns §2): `columns` as written; a value that isn't a list of strings reads as absent.
    ...columnsOf(y, attributes),
    // 4F (D-417, ms4-embeds §3): the raw value and the effective mode.
    embed: embedMode(y.embed) ?? defaultEmbed(key), embedRaw: y.embed === undefined || y.embed === null || String(y.embed).trim() === '' ? null : String(y.embed).trim(),
    template: y.template ?? null, attributes,
    // Slice Q2 (v1-views §1.3, R184) and Q2.1 (§14.1, R196): `views` as written (NFC names), its items and its lines.
    ...viewsOf(text),
  };
}

function viewsOf(text: string): { views: string[] | null; viewsUnreadable: boolean; viewItems: ViewItemDto[] | null; viewsSource: string | null } {
  const m = viewsModel(text);
  if (!m) return { views: null, viewsUnreadable: false, viewItems: null, viewsSource: null };
  if (m.items === null) return { views: null, viewsUnreadable: true, viewItems: null, viewsSource: m.source };
  if (m.absent) return { views: null, viewsUnreadable: false, viewItems: null, viewsSource: m.source };
  return {
    views: m.items.map((it) => it.name), viewsUnreadable: false, viewsSource: m.source,
    viewItems: m.items.map((it) => ({
      name: it.name, sort: Array.isArray(it.sort) ? it.sort : null, sortBroken: it.sort === 'broken',
      columns: Array.isArray(it.columns) ? it.columns : null, columnsBroken: it.columns === 'broken', plain: it.plain,
      // Slice Q3 (v1-views §39.2): the five display and grouping keys and their `…Broken` flags.
      view: val(it.q3.view), viewBroken: it.q3.view === 'broken', group: val(it.q3.group), groupBroken: it.q3.group === 'broken',
      lanes: val(it.q3.lanes), lanesBroken: it.q3.lanes === 'broken', laneOrder: val(it.q3.laneOrder), laneOrderBroken: it.q3.laneOrder === 'broken',
      widths: val(it.q3.widths), widthsBroken: it.q3.widths === 'broken',
    })),
  };
}

// ------------------------------------------------------------------------------------------------ `views:` items (Q2.1)

/** v1-views §17.3 `ViewItemDto`. */
export type UsageSort = { by: string; order: 'asc' | 'desc' };
export type UsageGroup = { none: true } | { none: false; key: string; period: boolean };
export type ViewItemDto = {
  name: string; sort: UsageSort[] | null; sortBroken: boolean; columns: string[] | null; columnsBroken: boolean; plain: boolean;
  view: 'list' | 'table' | 'wall' | null; viewBroken: boolean; group: UsageGroup | null; groupBroken: boolean;
  lanes: 'columns' | 'rows' | null; lanesBroken: boolean; laneOrder: string[] | null; laneOrderBroken: boolean;
  widths: [string, number][] | null; widthsBroken: boolean;
};
type Bk<T> = T | 'broken' | null;
/** Slice Q3 (v1-views §35): a `views:` item's own display and grouping values. */
type Q3 = { view: Bk<'list' | 'table' | 'wall'>; group: Bk<UsageGroup>; lanes: Bk<'columns' | 'rows'>; laneOrder: Bk<string[]>; widths: Bk<[string, number][]> };
const NO_Q3: Q3 = { view: null, group: null, lanes: null, laneOrder: null, widths: null };
const val = <T,>(v: Bk<T>): T | null => (v === 'broken' ? null : v);
function q3Of(x: Record<string, unknown>): Q3 {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(x, k);
  const view = (v: unknown) => (v === 'list' || v === 'table' || v === 'wall' ? v : v === 'board' ? 'wall' as const : 'broken' as const);
  const lanes = (v: unknown) => (v === 'columns' || v === 'vertical' ? 'columns' as const : v === 'rows' || v === 'horizontal' ? 'rows' as const : 'broken' as const);
  const group = (v: unknown): UsageGroup | 'broken' => {
    if (v === 'none') return { none: true };
    if (typeof v === 'string') return trimWs(v) === '' ? 'broken' : { none: false, key: nfc(trimWs(v)), period: false };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const e = Object.entries(v as Record<string, unknown>);
      if (e.length === 1 && trimWs(e[0][0]) !== '' && e[0][1] === 'period') return { none: false, key: nfc(trimWs(e[0][0])), period: true };
    }
    return 'broken';
  };
  const widths = (v: unknown): [string, number][] | 'broken' => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return 'broken';
    const out: [string, number][] = [];
    for (const [k, w] of Object.entries(v as Record<string, unknown>)) {
      if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 100000) return 'broken';
      out.push([nfc(k), w]);
    }
    return out;
  };
  return {
    view: has('view') ? view(x.view) : null, group: has('group_by') ? group(x.group_by) : null, lanes: has('lanes') ? lanes(x.lanes) : null,
    laneOrder: has('lane_order') ? usageColumnsOf(x.lane_order) : null, widths: has('widths') ? widths(x.widths) : null,
  };
}
const Q3_KEYS = ['view', 'group_by', 'lanes', 'lane_order', 'widths'];
/** R221's key order inside an item. */
const KEY_ORDER = ['name', 'view', 'group_by', 'lanes', 'lane_order', 'sort', 'columns', 'widths'];
type Field = { key: string; lines: string[] };
/** One item of `views:` (R196): its values, and its lines when the list is a block list (null: flow style). */
type VItem = {
  name: string; sort: UsageSort[] | 'broken' | null; columns: string[] | 'broken' | null; plain: boolean; q3: Q3;
  /** Slice Q3 (CP-35, D-2200): a changed item written field by field from these (lines without the dash). */
  out?: Field[];
  unknown: { key: string; value: unknown }[]; lines: string[] | null; fields: Field[] | null;
};
type VModel = { lines: string[]; start: number; end: number; source: string; items: VItem[] | null; absent: boolean; dash: number };

const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const viewKey = (s: string) => nfc(trimWs(s)).toLowerCase();
/** R185's shape rules for a usage's own `sort` (one mapping or a list of mappings; a missing `order` is `asc`). */
function usageSortOf(v: unknown): UsageSort[] | 'broken' {
  const level = (x: unknown): UsageSort | null => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const m = x as Record<string, unknown>;
    if (typeof m.by !== 'string' || trimWs(m.by) === '') return null;
    if (!(m.order === undefined || m.order === null || m.order === 'asc' || m.order === 'desc')) return null;
    return { by: nfc(trimWs(m.by)), order: m.order === 'desc' ? 'desc' : 'asc' };
  };
  const ls = Array.isArray(v) ? v.map(level) : [level(v)];
  return ls.every((l) => l !== null) ? (ls as UsageSort[]) : 'broken';
}
const usageColumnsOf = (v: unknown): string[] | 'broken' => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).map(nfc) : 'broken');

/** The `views` key's lines (the key line, then indented lines and `- ` lines) and its items; null when absent. */
function viewsModel(text: string): VModel | null {
  const lines = text.split(/(?<=\n)/);
  const start = lines.findIndex((l) => /^views:(?=[ \t\r\n]|$)/.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && (/^[ \t]+\S/.test(lines[end]) || /^-(?:[ \t]|\r?\n|$)/.test(lines[end]))) end++;
  const source = lines.slice(start, end).join('');
  const base = { lines, start, end, source, dash: 2 };
  let y: any;
  try { y = parseYaml(text); } catch { return { ...base, items: null, absent: false }; }
  const v = y?.views;
  if (v === null || v === undefined) return { ...base, items: [], absent: true };
  if (!Array.isArray(v)) return { ...base, items: null, absent: false };
  const items: VItem[] = [];
  for (const x of v) {
    if (typeof x === 'string') { items.push({ name: nfc(x), sort: null, columns: null, plain: true, q3: NO_Q3, unknown: [], lines: null, fields: null }); continue; }
    if (!x || typeof x !== 'object' || Array.isArray(x) || typeof x.name !== 'string' || trimWs(x.name) === '') return { ...base, items: null, absent: false };
    const has = (k: string) => Object.prototype.hasOwnProperty.call(x, k);
    const unknown = Object.keys(x).filter((k) => !['name', 'sort', 'columns', ...Q3_KEYS].includes(k)).map((k) => ({ key: k, value: x[k] }));
    items.push({
      name: nfc(trimWs(x.name)), sort: has('sort') ? usageSortOf(x.sort) : null, columns: has('columns') ? usageColumnsOf(x.columns) : null,
      q3: q3Of(x), plain: Object.keys(x).length === 1, unknown, lines: null, fields: null,
    });
  }
  // A block list: each item's own lines (deeper comments included; comments at the dash's indent are between items).
  const body = lines.slice(start + 1, end);
  const first = body.find((l) => /^[ \t]*-(?:[ \t]|\r?\n|$)/.test(l));
  let dash = 2;
  if (first) {
    dash = /^[ \t]*/.exec(first)![0].length;
    const chunks: string[][] = [];
    for (const l of body) {
      const ind = /^[ \t]*/.exec(l)![0].length;
      const isComment = /^[ \t]*#/.test(l);
      if (ind === dash && /^[ \t]*-(?:[ \t]|\r?\n|$)/.test(l)) chunks.push([l]);
      else if (isComment && ind <= dash && !chunks.length) continue;
      else if (chunks.length) chunks[chunks.length - 1].push(l);
    }
    if (chunks.length === items.length) chunks.forEach((c, i) => { items[i].lines = c; items[i].fields = fieldsOf(c, dash); });
  }
  return { ...base, items, absent: false, dash };
}

/** The key fields of a block mapping item (`  - name: …` then `    key: …` lines); comments dropped; null for a flow
 *  mapping or a plain item. */
function fieldsOf(chunk: string[], dash: number): Field[] | null {
  const head = /^([ \t]*-[ \t]+)(.*)$/s.exec(chunk[0]);
  if (!head || !/^[^\s#'"{[\]-][^:]*:(?:[ \t]|\r?\n|$)/.test(head[2])) return null;
  const col = head[1].length;
  const out: Field[] = [];
  const keyAt = (t: string) => /^([^\s#'"{[\]][^:]*):(?:[ \t]|\r?\n|$)/.exec(t)?.[1] ?? null;
  out.push({ key: keyAt(head[2])!, lines: [' '.repeat(col) + head[2]] });
  for (const l of chunk.slice(1)) {
    const ind = /^[ \t]*/.exec(l)![0].length;
    if (/^[ \t]*#/.test(l)) continue;
    const k = ind === col ? keyAt(l.slice(ind)) : null;
    if (k !== null) out.push({ key: k, lines: [l] });
    else out[out.length - 1].lines.push(l);
  }
  void dash;
  return out;
}

const levelText = (l: UsageSort) => `{ by: ${flowItem(l.by)}, order: ${l.order} }`;
function flowValue(v: unknown): string {
  if (typeof v === 'string') return flowItem(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(flowValue).join(', ')}]`;
  return `{ ${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${flowItem(k)}: ${flowValue(x)}`).join(', ')} }`;
}

/** R196's write style for the items (`dash`: the list's dash indent), or the one flow line when every item is plain. */
function renderViews(items: VItem[], changed: Set<VItem>, dash: number, eol: string): string {
  if (items.every((it) => it.plain)) return `views: [${items.map((it) => flowItem(it.name)).join(', ')}]${eol}`;
  const d = ' '.repeat(dash), k = ' '.repeat(dash + 2);
  let out = `views:${eol}`;
  for (const it of items) {
    if (!changed.has(it) && it.lines) { out += it.lines.map((l) => (/\n$/.test(l) ? l : l + eol)).join(''); continue; }
    if (it.plain) { out += `${d}- ${flowItem(it.name)}${eol}`; continue; }
    if (it.out) {
      // Field-level (CP-35): every field's lines as kept or set, the first on the dash line.
      it.out.forEach((f, n) => f.lines.forEach((l, j) => { out += (n === 0 && j === 0 ? `${d}- ` : k) + l.replace(/\r?\n$/, '') + eol; }));
      continue;
    }
    const field = (key: string) => it.fields?.find((f) => f.key === key)?.lines.map((l) => (/\n$/.test(l) ? l : l + eol)).join('') ?? '';
    out += `${d}- name: ${flowItem(it.name)}${eol}`;
    if (Array.isArray(it.sort)) {
      if (it.sort.length === 0) out += `${k}sort: []${eol}`;
      else if (it.sort.length === 1) out += `${k}sort: ${levelText(it.sort[0])}${eol}`;
      else out += `${k}sort:${eol}` + it.sort.map((l) => `${k}  - ${levelText(l)}${eol}`).join('');
    } else if (it.sort === 'broken') out += field('sort');
    if (Array.isArray(it.columns)) out += `${k}columns: [${it.columns.map(flowItem).join(', ')}]${eol}`;
    else if (it.columns === 'broken') out += field('columns');
    for (const u of it.unknown) out += it.fields?.some((f) => f.key === u.key) ? field(u.key) : `${k}${flowItem(u.key)}: ${flowValue(u.value)}${eol}`;
  }
  return out;
}

/** v1-views §14.2: one views op (`views`, `viewSort`, `viewColumns`, `viewsSource`) on a type file's text. */
export function viewsOp(text: string, op: any): { text: string } | { error: Record<string, unknown> } {
  const rule = (reason: string) => ({ error: err('Rule', `rule: ${reason}`, { reason }) });
  const m = viewsModel(text);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  if (op.op === 'viewsSource') {
    const src = String(op.source ?? '');
    // Q2-T (§25.3): an empty source removes the key's lines; without a key it is a no-op.
    if (src === '' && !m) return { text };
    let out: string;
    if (m) out = m.lines.slice(0, m.start).join('') + src + m.lines.slice(m.end).join('');
    else { const es = entries(text); setTop(es, 'views', src); out = join_(es); }
    const back = viewsModel(out);
    if (back && back.items === null) return rule('viewsUnreadable');
    return { text: out };
  }
  if (m && m.items === null) return rule('viewsUnreadable');
  const cur: VItem[] = m?.items ?? [];
  const changed = new Set<VItem>();
  let next: VItem[];
  if (op.op === 'views') {
    const names: string[] = (op.names ?? []).map((n: string) => nfc(String(n)));
    next = names.map((n) => cur.find((it) => viewKey(it.name) === viewKey(n)) ?? (() => { const it: VItem = { name: n, sort: null, columns: null, plain: true, q3: NO_Q3, unknown: [], lines: null, fields: null }; changed.add(it); return it; })());
    // The same names in the same order on an existing key: no write (Q2; a repeat keeps its own item).
    if (m && !m.absent && next.length === cur.length && next.every((it, i) => it.name === cur[i].name)) return { text };
  } else if (op.op === 'viewSort' || op.op === 'viewColumns') {
    const at = cur.findIndex((it) => viewKey(it.name) === viewKey(String(op.name ?? '')));
    if (!m || m.absent || at < 0) return rule('viewNotListed');
    const it = cur[at];
    const value = op.op === 'viewSort'
      ? (op.sort === null || op.sort === undefined ? null : (op.sort as UsageSort[]).map((l) => ({ by: nfc(trimWs(l.by)), order: l.order === 'desc' ? 'desc' as const : 'asc' as const })))
      : (op.columns === null || op.columns === undefined ? null : (op.columns as string[]).map(nfc));
    const old = op.op === 'viewSort' ? it.sort : it.columns;
    if (JSON.stringify(old) === JSON.stringify(value)) return { text };
    const nu: VItem = { ...it, [op.op === 'viewSort' ? 'sort' : 'columns']: value };
    nu.plain = nu.sort === null && nu.columns === null && nu.unknown.length === 0;
    changed.add(nu);
    next = cur.map((x, i) => (i === at ? nu : x));
  } else if (['viewDisplay', 'viewGroup', 'viewLanes', 'viewLaneOrder', 'viewWidths', 'viewCopy'].includes(op.op)) {
    const at = cur.findIndex((it) => viewKey(it.name) === viewKey(String(op.op === 'viewCopy' ? op.to : op.name ?? '')));
    if (!m || m.absent || at < 0) return rule('viewNotListed');
    const nu = q3Op(cur[at], op, cur);
    if (nu === null) return rule('viewNotListed');
    if (nu === cur[at]) return { text };
    changed.add(nu);
    next = cur.map((x, i) => (i === at ? nu : x));
  } else return { text };
  const rendered = renderViews(next, changed, m?.dash ?? 2, eol);
  if (!m) { const es = entries(text); setTop(es, 'views', rendered); return { text: join_(es) }; }
  let tail = rendered;
  // The key was the file's last line without a final newline: so is its last line now.
  if (m.end === m.lines.length && !/\n$/.test(m.lines[m.end - 1])) tail = tail.replace(/\r?\n$/, '');
  return { text: m.lines.slice(0, m.start).join('') + tail + m.lines.slice(m.end).join('') };
}

/** An item's fields without the dash and indentation (`key: …` lines; deeper lines keep their extra indent). */
function bareFields(it: VItem): Field[] {
  if (it.fields) {
    const col = /^[ \t]*/.exec(it.fields[0].lines[0])![0].length;
    return it.fields.map((f) => ({ key: f.key, lines: f.lines.map((l) => l.replace(/\r?\n$/, '').slice(Math.min(col, /^[ \t]*/.exec(l)![0].length))) }));
  }
  return [{ key: 'name', lines: [`name: ${flowItem(it.name)}`] }];
}
const comment = (line: string): string => { const m = /([ \t]+#.*)$/.exec(line); return m && !/["']/.test(line.slice(0, m.index).replace(/^[^:]*:\s*/, '').slice(0, 1)) ? m[1] : ''; };
function setVField(fs: Field[], key: string, lines: string[] | null): Field[] {
  const out = fs.map((f) => ({ ...f, lines: [...f.lines] }));
  const i = out.findIndex((f) => f.key === key);
  if (lines === null) { if (i >= 0) out.splice(i, 1); return out; }
  if (i >= 0) {
    const old = out[i].lines;
    const l = [...lines];
    if (old.length === 1 && l.length === 1) l[0] += comment(old[0]);
    out[i] = { key, lines: l };
    return out;
  }
  const rank = KEY_ORDER.indexOf(key);
  let after = -1;
  for (const k of KEY_ORDER.slice(0, rank).reverse()) { after = out.findIndex((f) => f.key === k); if (after >= 0) break; }
  out.splice(after + 1, 0, { key, lines });
  return out;
}
const sameWidths = (a: [string, number][], b: [string, number][]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
/** v1-views §36.2: one Q3 op on an item: the item after it (field-level, CP-35), the same item for a no-op, null when
 *  `viewCopy`'s source isn't listed. */
function q3Op(it: VItem, op: any, all: VItem[]): VItem | null {
  let fs = bareFields(it);
  const q3 = { ...it.q3 };
  if (op.op === 'viewCopy') {
    const src = all.find((x) => viewKey(x.name) === viewKey(String(op.from)));
    if (!src) return null;
    const sf = bareFields(src);
    let any = false;
    for (const k of [...Q3_KEYS, 'sort', 'columns']) {
      const n = sf.find((f) => f.key === k)?.lines ?? null;
      const o = fs.find((f) => f.key === k)?.lines ?? null;
      if (JSON.stringify(n) !== JSON.stringify(o)) { any = true; fs = setVField(fs, k, n); }
    }
    if (!any) return it;
    return { ...it, q3: { ...src.q3 }, sort: src.sort, columns: src.columns, plain: fs.every((f) => f.key === 'name'), out: fs };
  }
  if (op.op === 'viewDisplay') {
    const v = op.view === 'board' ? 'wall' : op.view ?? null;
    if (v === null ? !fs.some((f) => f.key === 'view') : q3.view === v) return it;
    fs = setVField(fs, 'view', v === null ? null : [`view: ${v}`]); q3.view = v;
  } else if (op.op === 'viewLanes') {
    const v = op.lanes === 'vertical' ? 'columns' : op.lanes === 'horizontal' ? 'rows' : op.lanes ?? null;
    if (v === null ? !fs.some((f) => f.key === 'lanes') : q3.lanes === v) return it;
    fs = setVField(fs, 'lanes', v === null ? null : [`lanes: ${v}`]); q3.lanes = v;
  } else if (op.op === 'viewGroup') {
    const g: UsageGroup | null = op.group ? (op.group.none ? { none: true } : { none: false, key: nfc(trimWs(op.group.key)), period: !!op.group.period }) : null;
    if (g === null) {
      if (!fs.some((f) => ['group_by', 'lanes', 'lane_order'].includes(f.key))) return it;
      for (const k of ['group_by', 'lanes', 'lane_order']) fs = setVField(fs, k, null);
      q3.group = null; q3.lanes = null; q3.laneOrder = null;
    } else {
      if (JSON.stringify(q3.group) === JSON.stringify(g)) return it;
      fs = setVField(fs, 'group_by', [g.none ? 'group_by: none' : g.period ? `group_by: { ${flowItem(g.key)}: period }` : `group_by: ${scalar(g.key)}`]); q3.group = g;
    }
  } else if (op.op === 'viewLaneOrder') {
    const v: string[] | null = op.laneOrder === null || op.laneOrder === undefined ? null : (op.laneOrder as string[]).map(nfc);
    if (v === null ? !fs.some((f) => f.key === 'lane_order') : JSON.stringify(q3.laneOrder) === JSON.stringify(v)) return it;
    fs = setVField(fs, 'lane_order', v === null ? null : [`lane_order: [${v.map(flowItem).join(', ')}]`]); q3.laneOrder = v;
  } else if (op.op === 'viewWidths') {
    const v: [string, number][] | null = op.widths && op.widths.length ? (op.widths as [string, number][]).map(([k, w]) => [nfc(k), w]) : null;
    if (v === null ? !fs.some((f) => f.key === 'widths') : Array.isArray(q3.widths) && sameWidths(q3.widths, v)) return it;
    fs = setVField(fs, 'widths', v === null ? null : [`widths: { ${v.map(([k, w]) => `${flowItem(k)}: ${w}`).join(', ')} }`]); q3.widths = v;
  }
  return { ...it, q3, plain: fs.every((f) => f.key === 'name'), out: fs };
}

const UNIVERSAL_COLUMNS = ['tags', 'source', 'aliases', 'review', 'created', 'modified'];
function columnsOf(y: any, attributes: { key: string }[]) {
  const v = y.columns;
  const ok = Array.isArray(v) && v.every((x: unknown) => typeof x === 'string');
  const columns: string[] | null = ok ? v : null;
  const ignored: string[] = [];
  for (const c of (columns ?? []).map((x) => x.normalize('NFC'))) {
    if (c !== 'title' && !attributes.some((a) => a.key === c) && !UNIVERSAL_COLUMNS.includes(c) && !ignored.includes(c)) ignored.push(c);
  }
  return { columns, columnsIgnored: ignored, columnsUnreadable: v !== undefined && v !== null && !ok };
}

export function listTypes(files: Files, vers: Record<string, VersionDto>): TypeDto[] {
  const out: TypeDto[] = [];
  for (const [p, text] of Object.entries(files)) {
    const m = /^\.tegg\/types\/([^/]+)\.yml$/.exec(p);
    if (m) out.push(readType(nfc(m[1]), text, true, vers[p] ?? null));
  }
  for (const k of SYSTEM) if (!out.some((t) => t.key === k)) out.push(readType(k, BUILTIN[k], false, null));
  return out;
}
const getType = (files: Files, vers: Record<string, VersionDto>, key: string) => listTypes(files, vers).find((t) => t.key === nfc(key)) ?? null;

// ------------------------------------------------------------------------------------------------ objects

const excluded = (p: string) => !p.endsWith('.md') || p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));

async function objects(files: Files) {
  const d = await doc();
  const s = await schema();
  return Object.entries(files).filter(([p]) => !excluded(p)).map(([path, text]) => {
    const parsed = d.parse(text);
    const data = (parsed.frontmatter?.data ?? {}) as Record<string, unknown>;
    const m = s.typeMatch(parsed.frontmatter ? ('type' in data ? data.type : undefined) : undefined) as { key: string; single: boolean };
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    // Slice Q2-T (v1-views §27.1): the tag keys, frontmatter and inline (tags.md R79: NFC, case-folded), sorted, unique.
    const fm = (Array.isArray(data.tags) ? data.tags : data.tags == null ? [] : [data.tags]).filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
    let inline: string[] = [];
    try { inline = ((d.tags(parsed) as { name: string }[]) ?? []).map((x) => String(x.name)); } catch { inline = []; }
    const tagKeys = [...new Set([...fm, ...inline].map((x) => nfc(x).trim().replace(/^#/, '').toLowerCase()).filter((x) => x !== ''))]
      .sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
    return { path, data, type: m.key, single: m.single, title: typeof data.title === 'string' ? data.title : stem, id: typeof data.id === 'string' ? data.id : null, tags: tagKeys };
  });
}

// ------------------------------------------------------------------------------------------------ writing (§14.1.4)

function scalar(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = nfc(String(v));
  try {
    const back = (parseYaml(`x: ${s}`) as any)?.x;
    if (back === s && s.trim() === s && s !== '' && !s.includes('\n')) return s;
  } catch { /* quoted below */ }
  return JSON.stringify(s);
}
const flow = (xs: string[]) => `[${xs.map(scalar).join(', ')}]`;
/** D-230 inside a flow list: plain only when it can't end or split the list (`Čtu, až bude čas` is quoted). */
const flowItem = (v: string) => { const q = scalar(v); return q.startsWith('"') || !/[,[\]{}]/.test(q) ? q : JSON.stringify(nfc(v)); };
const optionLine = (o: { label: string; color: string | null; state?: string | null }) => `      - { label: ${scalar(o.label)}${o.state ? `, state: ${o.state}` : ''}${o.color ? `, color: ${o.color}` : ''} }\n`;

type Entry = { key: string | null; lines: string[] };
function entries(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split(/(?<=\n)/)) {
    const m = /^([^\s#][^:]*):/.exec(line);
    if (m) out.push({ key: m[1], lines: [line] });
    else if (/^\s/.test(line) && line.trim() !== '' && out.length && out[out.length - 1].key) out[out.length - 1].lines.push(line);
    else out.push({ key: null, lines: [line] });
  }
  return out;
}
const join_ = (es: Entry[]) => es.map((e) => e.lines.join('')).join('');

function setTop(es: Entry[], key: string, line: string | null) {
  const i = es.findIndex((e) => e.key === key);
  if (i >= 0) {
    if (line === null) es.splice(i, 1);
    else es[i] = { key, lines: [line] };
    return;
  }
  if (line === null) return;
  const order = TOP.indexOf(key);
  let at = -1;
  for (let k = order - 1; k >= 0 && at < 0; k--) at = es.findIndex((e) => e.key === TOP[k]);
  es.splice(at + 1, 0, { key, lines: [line] });
}

type Item = { fields: { key: string; lines: string[] }[] };
function items(attr: Entry | undefined): Item[] {
  if (!attr) return [];
  const out: Item[] = [];
  for (const line of attr.lines.slice(1)) {
    const first = /^ {2}- ([^:]+):/.exec(line);
    const field = /^ {4}([^\s:][^:]*):/.exec(line);
    if (first) out.push({ fields: [{ key: first[1], lines: [line.replace(/^ {2}- /, '    ')] }] });
    else if (field && out.length) out[out.length - 1].fields.push({ key: field[1], lines: [line] });
    else if (out.length) out[out.length - 1].fields[out[out.length - 1].fields.length - 1].lines.push(line);
  }
  return out;
}
function itemText(it: Item): string {
  const t = it.fields.map((f) => f.lines.join('')).join('');
  return t.replace(/^ {4}/, '  - ');
}
function setField(it: Item, key: string, lines: string[] | null) {
  const i = it.fields.findIndex((f) => f.key === key);
  if (i >= 0) {
    if (lines === null) it.fields.splice(i, 1);
    else it.fields[i] = { key, lines };
    return;
  }
  if (lines === null) return;
  const order = ITEM.indexOf(key);
  let at = -1;
  for (let k = order - 1; k >= 0 && at < 0; k--) at = it.fields.findIndex((f) => f.key === ITEM[k]);
  it.fields.splice(at + 1, 0, { key, lines });
}
/** v1-cards §2.3: the `card` key as one flow line (its trailing comment and line end kept), removed when null. */
function setCardLine(es: Entry[], keys: string[] | null) {
  const i = es.findIndex((e) => e.key === 'card');
  if (keys === null) { if (i >= 0) es.splice(i, 1); return; }
  const flowLine = `card: ${flow(keys.map((k) => nfc(k)))}`;
  if (i >= 0) {
    const head = es[i].lines[0];
    const eol = head.endsWith('\r\n') ? '\r\n' : head.endsWith('\n') ? '\n' : '';
    const bare = head.slice(0, head.length - eol.length);
    const tail = es[i].lines.length === 1 ? (/\s+#.*$/.exec(bare)?.[0] ?? '') : '';
    es[i] = { key: 'card', lines: [`${flowLine}${tail}${eol || '\n'}`] };
    return;
  }
  const crlf = es.some((e) => e.lines.some((l) => l.endsWith('\r\n')));
  setTop(es, 'card', `${flowLine}${crlf ? '\r\n' : '\n'}`);
}

function itemFrom(a: any): Item {
  const it: Item = { fields: [] };
  const put = (k: string, lines: string[] | null) => { if (lines) it.fields.push({ key: k, lines }); };
  put('key', [`    key: ${scalar(a.key)}\n`]);
  put('name', [`    name: ${scalar(a.name)}\n`]);
  put('type', [`    type: ${a.type}\n`]);
  put('default', a.default === null || a.default === undefined ? null : [`    default: ${scalar(a.default)}\n`]);
  put('required', a.required ? ['    required: true\n'] : null);
  put('options', a.options?.length ? ['    options:\n', ...a.options.map(optionLine)] : null);
  put('to', a.to ? [`    to: ${flow(a.to)}\n`] : null);
  put('multiple', a.multiple ? ['    multiple: true\n'] : null);
  put('description', a.description ? [`    description: ${scalar(a.description)}\n`] : null);
  return it;
}

const OPTION_OPS = ['setOptionState', 'addOption', 'setOptionColor', 'moveOption', 'removeOption', 'renameOption'];

async function patchText(key: string, text: string, ops: any[], t: TypeDto, all: TypeDto[], used: (attr: string, label: string) => number = () => 0): Promise<{ text: string } | { error: Record<string, unknown> }> {
  const s = await schema();
  const es = entries(text);
  const others = all.filter((x) => x.key !== key);
  const rule = (r: any) => ({ error: err('Rule', `rule: ${r.reason}`, r) });
  const builtIn = (k: string) => t.attributes.find((a: any) => a.key === k)?.builtIn === true;
  const working: Record<string, any[]> = {};
  for (const op of ops) {
    if (op.op === 'set') {
      const v = op.value === null ? null : nfc(String(op.value));
      if ((op.field === 'name' || op.field === 'plural') && t.system) return { error: err('SystemType', 'system type names can’t be changed') };
      if (op.field === 'name' || op.field === 'plural') {
        const name = op.field === 'name' ? v ?? '' : t.name;
        const plural = op.field === 'plural' ? v ?? '' : t.plural;
        const r = s.checkTypeName(name, plural, others, []);
        if (r && r.reason !== 'keyTaken' && r.reason !== 'folderTaken') return rule(r);
      }
      if (op.field === 'folder') { const r = s.checkFolder(v ?? '', all, key); if (r) return rule(r); }
      const cur = (parseYaml(text) as any)?.[op.field] ?? null;
      if ((cur ?? null) === v) continue;
      // v1-cards §2.3 (D-2103): the same icon by its canonical name writes nothing (`check-square` stays as written).
      if (op.field === 'icon' && v !== null && sameIcon(cur ?? 'file-text', v)) continue;
      setTop(es, op.field, v === null || v === '' ? null : `${op.field}: ${scalar(op.field === 'folder' ? v.replace(/\/+$/, '') : v)}\n`);
    } else if (op.op === 'review') {
      if (t.review === 'locked') return { error: err('ReviewLocked', 'review is locked') };
      if ((t.review === 'on') === op.on) continue;
      setTop(es, 'review', `review: ${op.on}\n`);
    } else if (op.op === 'preview') {
      if (op.keys.length > 4) return rule({ reason: 'previewFull' });
      if (JSON.stringify(op.keys) === JSON.stringify(t.preview)) continue;
      setTop(es, 'preview', `preview: ${flow(op.keys)}\n`);
    } else if (op.op === 'columns') {
      // D-1240, D-1245: one flow line in NFC; an unreadable value is refused; the same list on an existing key is no write.
      if (t.columnsUnreadable) return rule({ reason: 'columnsUnreadable' });
      if (t.columns && JSON.stringify(op.keys) === JSON.stringify(t.columns)) continue;
      setTop(es, 'columns', `columns: ${flow(op.keys.map((k: string) => k.normalize('NFC')))}\n`);
    } else if (op.op === 'card') {
      // v1-cards §2.3 (D-2076): one flow line in NFC at its TOP place (after `preview`, else the nearest preceding key),
      // a block list replaced, null removes the lines; an unreadable value is refused; an equal list is no write.
      if (t.cardUnreadable) return rule({ reason: 'cardUnreadable' });
      const cur = (parseYaml(join_(es)) as any)?.card;
      const now: string[] | null = Array.isArray(cur) ? cur.map((x: unknown) => nfc(String(x))) : null;
      const keys: string[] | null = op.keys === null || op.keys === undefined ? null : op.keys.map((k: string) => nfc(k));
      if (JSON.stringify(now) === JSON.stringify(keys)) continue;
      setCardLine(es, keys);
    } else if (['views', 'viewSort', 'viewColumns', 'viewsSource', 'viewDisplay', 'viewGroup', 'viewLanes', 'viewLaneOrder', 'viewWidths', 'viewCopy'].includes(op.op)) {
      // Slice Q2 (v1-views §1.3, D-1803) and Q2.1 (§14.2, R196; D-1840, D-1852, D-1857): the views ops on the text so
      // far (several in one patch apply in order and are written once); plain names as one flow line, items with own
      // values as a block list; an unchanged item keeps its lines; an unreadable value is refused.
      const r = viewsOp(join_(es), op);
      if ('error' in r) return r;
      es.splice(0, es.length, ...entries(r.text));
    } else if (op.op === 'embed') {
      // D-417: the same value (any case) is no write; otherwise the line is replaced or inserted after hidden/preview.
      if (String(t.embedRaw ?? '').toLowerCase() === op.mode) continue;
      setTop(es, 'embed', `embed: ${op.mode}\n`);
    } else if (op.op === 'hidden') {
      // FR-TYP-17, D-316: a flow list after `preview`.
      const keys: string[] = [...new Set<string>(op.keys.map((k: string) => k.normalize('NFC')))];
      if (JSON.stringify(keys) === JSON.stringify(t.hidden)) continue;
      setTop(es, 'hidden', `hidden: ${flow(keys)}\n`);
    } else {
      const ai = es.findIndex((e) => e.key === 'attributes');
      const its = items(es[ai]);
      const find = (k: string) => its.findIndex((it) => it.fields[0]?.lines[0].replace(/^ {4}key:\s*/, '').trim().replace(/^"|"$/g, '') === nfc(k));
      if (op.op === 'addAttribute') {
        const r = s.checkAttrKey(op.attribute.key, t, op.attribute.type);
        if (r) return rule(r);
        its.push(itemFrom(op.attribute));
      } else if (op.op === 'removeAttribute') {
        if (builtIn(op.key)) return { error: err('BuiltInChanged', 'built-in attribute') };
        const i = find(op.key);
        if (i < 0) continue;
        its.splice(i, 1);
        if (t.preview.includes(op.key)) setTop(es, 'preview', `preview: ${flow(t.preview.filter((p: string) => p !== op.key))}\n`);
        if (t.hidden.includes(nfc(op.key))) {
          const rest = t.hidden.filter((p: string) => p !== nfc(op.key));
          setTop(es, 'hidden', `hidden: ${flow(rest)}\n`);
        }
        if (t.columns?.some((c: string) => nfc(c) === nfc(op.key))) setTop(es, 'columns', `columns: ${flow(t.columns.filter((c: string) => nfc(c) !== nfc(op.key)).map(nfc))}\n`);
        // v1-cards §2.3 (D-2077): and every card entry of it (an unreadable `card` is left as it is).
        const card = (parseYaml(join_(es)) as any)?.card;
        if (!t.cardUnreadable && Array.isArray(card) && card.some((c: unknown) => nfc(String(c)) === nfc(op.key))) {
          setCardLine(es, card.map((c: unknown) => String(c)).filter((c: string) => nfc(c) !== nfc(op.key)));
        }
      } else if (op.op === 'attributeIcon') {
        // v1-cards §2.3 (D-2070, D-2099, D-2103): right after the item's `type:` line, replaced, removed; allowed on
        // built-in attributes; the current icon (also by its canonical name) writes nothing.
        const i = find(op.key);
        if (i < 0) continue;
        const cur = t.attributes.find((a: any) => a.key === nfc(op.key))?.icon ?? null;
        const next = typeof op.icon === 'string' && op.icon.trim() ? nfc(op.icon.trim()) : null;
        if ((cur === null && next === null) || (cur !== null && next !== null && sameIcon(cur, next))) continue;
        setField(its[i], 'icon', next === null ? null : [`    icon: ${scalar(next)}\n`]);
      } else if (op.op === 'moveAttribute') {
        const i = find(op.key);
        if (i < 0 || i === op.to) continue;
        const [it] = its.splice(i, 1);
        its.splice(Math.max(0, Math.min(op.to, its.length)), 0, it);
      } else if (OPTION_OPS.includes(op.op)) {
        // ms5-tasks §2.2 (D-473): one option line per op, also on built-in options; the Task status keeps an Open and a
        // Done state; a used label isn't renamed (D-501).
        const i = find(op.attr);
        if (i < 0) continue;
        const it = its[i];
        const cur = t.attributes.find((a: any) => a.key === nfc(op.attr));
        // The ops of one patch apply in order: each starts from the options the previous one left.
        const opts: any[] = (working[nfc(op.attr)] ??= cur.options.map((o: any) => ({ label: o.label, color: o.color ?? null, state: o.state ?? null })));
        const at = (l: string) => opts.findIndex((o) => o.label === nfc(String(l)));
        const lower = (l: string) => nfc(l).trim().toLowerCase();
        if (op.op === 'setOptionState') { const j = at(op.label); if (j < 0 || opts[j].state === op.state) continue; opts[j].state = op.state; }
        else if (op.op === 'setOptionColor') { const j = at(op.label); if (j < 0 || opts[j].color === op.color) continue; opts[j].color = op.color; }
        else if (op.op === 'removeOption') { const j = at(op.label); if (j < 0) continue; opts.splice(j, 1); }
        else if (op.op === 'moveOption') { const j = at(op.label); const to = Math.max(0, Math.min(op.to, opts.length - 1)); if (j < 0 || j === to) continue; const [x] = opts.splice(j, 1); opts.splice(to, 0, x); }
        else if (op.op === 'addOption') {
          const l = nfc(String(op.option.label)).trim();
          if (!l) return rule({ reason: 'optionEmpty', field: 'optionLabel' });
          if (opts.some((o) => lower(o.label) === lower(l))) return rule({ reason: 'optionDuplicate', field: 'optionLabel' });
          opts.push({ label: l, color: op.option.color ?? null, state: op.option.state ?? null });
        } else if (op.op === 'renameOption') {
          const j = at(op.from);
          const l = nfc(String(op.to)).trim();
          if (j < 0 || opts[j].label === l) continue;
          if (!l) return rule({ reason: 'optionEmpty', field: 'optionLabel' });
          if (used(op.attr, opts[j].label) > 0) return rule({ reason: 'optionUsed', field: 'optionLabel', label: opts[j].label });
          if (opts.some((o, k) => k !== j && lower(o.label) === lower(l))) return rule({ reason: 'optionDuplicate', field: 'optionLabel' });
          opts[j].label = l;
        }
        setField(it, 'options', opts.length ? ['    options:\n', ...opts.map(optionLine)] : null);
      } else if (op.op === 'updateAttribute') {
        if (builtIn(op.key)) return { error: err('BuiltInChanged', 'built-in attribute') };
        const i = find(op.key);
        if (i < 0) continue;
        const it = its[i];
        const c = op.change ?? {};
        const cur = t.attributes.find((a: any) => a.key === nfc(op.key));
        if (c.name !== undefined && c.name !== cur.name) setField(it, 'name', [`    name: ${scalar(c.name)}\n`]);
        if (c.type !== undefined && c.type !== cur.type) {
          setField(it, 'type', [`    type: ${c.type}\n`]);
          if (!['select', 'multi-select'].includes(c.type)) setField(it, 'options', null);
          if (c.type !== 'relation') { setField(it, 'to', null); setField(it, 'multiple', null); }
        }
        if (c.default !== undefined && JSON.stringify(c.default) !== JSON.stringify(cur.default)) setField(it, 'default', c.default === null ? null : [`    default: ${scalar(c.default)}\n`]);
        if (c.required !== undefined && c.required !== cur.required) setField(it, 'required', c.required ? ['    required: true\n'] : null);
        if (c.multiple !== undefined && c.multiple !== cur.multiple) setField(it, 'multiple', c.multiple ? ['    multiple: true\n'] : null);
        if (c.to !== undefined && JSON.stringify(c.to) !== JSON.stringify(cur.to)) setField(it, 'to', c.to === null || c.to.length === 0 ? null : [`    to: ${flow(c.to)}\n`]);
        if (c.description !== undefined && (c.description || null) !== cur.description) setField(it, 'description', c.description ? [`    description: ${scalar(c.description)}\n`] : null);
        if (c.options !== undefined && JSON.stringify(c.options) !== JSON.stringify(cur.options)) {
          const labels = c.options.map((o: any) => nfc(String(o.label)).trim().toLowerCase());
          if (labels.some((l: string) => l === '')) return rule({ reason: 'optionEmpty', field: 'optionLabel' });
          if (new Set(labels).size !== labels.length) return rule({ reason: 'optionDuplicate', field: 'optionLabel' });
          setField(it, 'options', c.options.length ? ['    options:\n', ...c.options.map(optionLine)] : null);
        }
      }
      const body = its.map(itemText).join('');
      // One line per entry, so a later op of the same patch reads the items again (D-512).
      es[ai] = { key: 'attributes', lines: body ? ['attributes:\n', ...body.split(/(?<=\n)/)] : ['attributes: []\n'] };
    }
  }
  if (key === 'task' && working.status) {
    // Only a change that removes the last Open / Done status is refused (tegg-schema check_task_states, PR #47 review).
    const states = (o: any[]) => o.map((x) => s.taskState(x));
    const before = states(t.attributes.find((a: any) => a.key === 'status')?.options ?? []);
    const after = states(working.status);
    if (before.includes('open') && !after.includes('open')) return rule({ reason: 'needOpen', field: 'optionLabel' });
    if (before.includes('done') && !after.includes('done')) return rule({ reason: 'needDone', field: 'optionLabel' });
  }
  let out = join_(es);
  if (out !== text && t.declaredVersion === null) {
    const lines = out.split(/(?<=\n)/);
    let i = 0;
    while (i < lines.length && lines[i].startsWith('#')) i++;
    lines.splice(i, 0, 'version: 1\n');
    out = lines.join('');
  }
  return { text: out };
}

/** v1-views §1.3 `rename_view` (the query rename job's patch): every `views:` entry whose name key (trimmed, NFC, lower
 *  case) is `from`'s gets `to` in place (D-230 quoting), flow or block style kept, every other byte kept; null when
 *  nothing matches, `views` is absent or unreadable, or the file is newer or invalid. */
export function renameView(key: string, text: string, from: string, to: string): string | null {
  const t = readType(key, text, true, null);
  if (t.state !== 'ok' || t.viewsUnreadable || !t.views) return null;
  const nk = (v: string) => nfc(v.trim()).toLowerCase();
  const hit = (src: string) => { try { const v = parseYaml(`x: [${src}]`)?.x; return Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && nk(v[0]) === nk(from); } catch { return false; } };
  const es = entries(text);
  const e = es.find((x) => x.key === 'views');
  if (!e) return null;
  let changed = false;
  // Q2.1 (v1-views §14.3, D-1843): a flow mapping item's `name:` value token.
  const inMaps = (l: string) => l.replace(/(\{[^{}]*?\bname:[ \t]*)("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,}]*?)([ \t]*[,}])/g, (all, a: string, v: string, b: string) => {
    if (!hit(v)) return all;
    changed = true;
    return a + flowItem(to) + b;
  });
  const flowM = /^(views:[ \t]*\[)(.*)(\].*)$/s.exec(e.lines[0]);
  if (e.lines.length === 1 && flowM && flowM[2].includes('{')) {
    e.lines[0] = inMaps(e.lines[0]);
  } else if (e.lines.length === 1 && flowM) {
    const parts: string[] = [];
    let cur = '', q: string | null = null;
    for (let i = 0; i < flowM[2].length; i++) {
      const c = flowM[2][i];
      if (q) { cur += c; if (c === q && !(q === '"' && flowM[2][i - 1] === '\\')) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === ',') { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    const out = parts.map((part) => {
      const m = /^(\s*)(.*?)(\s*)$/s.exec(part)!;
      if (!m[2] || !hit(m[2])) return part;
      changed = true;
      return m[1] + flowItem(to) + m[3];
    });
    e.lines[0] = flowM[1] + out.join(',') + flowM[3];
  } else {
    e.lines = e.lines.map((l, i) => {
      if (i === 0) return l;
      // Q2.1 (§14.3): a block mapping item's `name:` value (`  - name: X` or `    name: X`), a flow mapping's.
      const nm = /^(\s*(?:-[ \t]+)?name:[ \t]*)(.*?)([ \t]+#.*)?(\r?\n)?$/s.exec(l);
      if (nm && /^\s+/.test(l)) {
        if (!hit(nm[2])) return l;
        changed = true;
        return nm[1] + flowItem(to) + (nm[3] ?? '') + (nm[4] ?? '');
      }
      if (/^\s*-[ \t]+\{/.test(l)) return inMaps(l);
      const m = /^(\s*-[ \t]+)(.*?)([ \t]+#.*)?(\r?\n)?$/s.exec(l);
      if (!m || !hit(m[2])) return l;
      changed = true;
      return m[1] + scalar(to) + (m[3] ?? '') + (m[4] ?? '');
    });
  }
  return changed ? join_(es) : null;
}

function newTypeFile(name: string, plural: string, folder?: string): string {
  return `${HEADER}version: 1\nname: ${scalar(name)}\nplural: ${scalar(plural)}\nsystem: false\nfolder: ${scalar(folder || plural)}\nicon: file-text\ncolor: gray\nreview: false\npreview: []\nattributes: []\n`;
}

const sanitize = (title: string) => nfc(title).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim();
function unique(files: Files, dir: string, stem: string, ext: string): string {
  let p = `${dir ? `${dir}/` : ''}${stem}${ext}`;
  const taken = (x: string) => Object.keys(files).some((f) => f.toLowerCase() === x.toLowerCase());
  for (let n = 2; taken(p); n++) p = `${dir ? `${dir}/` : ''}${stem} (${n})${ext}`;
  return p;
}

// ------------------------------------------------------------------------------------------------ commands

export async function handle(cmd: string, a: any, files: Files, vers: Record<string, VersionDto>): Promise<Answer> {
  const types = () => listTypes(files, vers);
  const s = await schema();
  switch (cmd) {
    case 'vault_types':
      return { result: types() };
    case 'type_get':
      return { result: getType(files, vers, String(a.key)) };
    case 'type_create': {
      const name = nfc(String(a.name)).trim(), plural = nfc(String(a.plural)).trim();
      const folder = a.folder == null ? undefined : nfc(String(a.folder)).trim();
      const r = s.checkTypeName(name, plural, types(), []) ?? (folder ? s.checkFolder(folder, types()) : null);
      if (r) return { error: err('Rule', `rule: ${r.reason}`, r) };
      const key = s.typeKey(name);
      const p = typePath(key);
      if (files[p] !== undefined) return { error: err('NameTaken', 'A type with this name already exists') };
      const text = newTypeFile(name, plural, folder);
      return { result: readType(key, text, true, null), writes: { [p]: text } };
    }
    case 'type_patch': {
      const key = nfc(String(a.key));
      const t = getType(files, vers, key);
      if (!t) return { error: err('UnknownType', `no type ${key}`) };
      if (t.state === 'newer') return { error: err('NewerVersion', 'made by a newer version') };
      if (t.state === 'invalid') return { error: err('InvalidType', 'invalid type definition') };
      const p = typePath(key);
      if (t.exists ? !sameVersion(a.base, vers[p]) : (a.base !== null || files[p] !== undefined)) return { error: err('Conflict', 'changed on disk', { disk: getType(files, vers, key) }) };
      const text = t.exists ? files[p] : BUILTIN[key];
      const objs = (a.ops ?? []).some((o: any) => o.op === 'renameOption') ? (await objects(files)).filter((o) => o.type === key) : [];
      const usedOf = (attr: string, label: string) => objs.filter((o) => ([] as unknown[]).concat(o.data[attr] ?? []).map((x) => nfc(String(x))).includes(label)).length;
      const out = await patchText(key, text, a.ops ?? [], t, types(), usedOf);
      if ('error' in out) return { error: out.error };
      if (t.exists && out.text === text) return { result: t };
      return { result: readType(key, out.text, true, null), writes: { [p]: out.text } };
    }
    case 'type_delete': {
      const key = nfc(String(a.key));
      if (SYSTEM.includes(key)) return { error: err('SystemType', 'system types can’t be deleted') };
      const t = getType(files, vers, key);
      const p = typePath(key);
      if (!t || !t.exists) return { error: err('UnknownType', `no type ${key}`) };
      if (!sameVersion(a.base, vers[p])) return { error: err('Conflict', 'changed on disk', { disk: t }) };
      const count = (await objects(files)).filter((o) => o.type === key).length;
      if (count > 0) return { error: err('HasObjects', `${count} objects`, { count }) };
      const writes: Record<string, string | null> = {};
      const trashed: string[] = [];
      const move = (from: string) => {
        const dot = from.lastIndexOf('.');
        const [stem, ext] = dot > from.lastIndexOf('/') ? [from.slice(0, dot), from.slice(dot)] : [from, ''];
        let to = `.trash/${from}`;
        for (let n = 2; files[to] !== undefined || writes[to] !== undefined; n++) to = `.trash/${stem} (${n})${ext}`;
        writes[to] = files[from];
        writes[from] = null;
        trashed.push(to);
      };
      move(p);
      const tdir = `_templates/${t.name}/`;
      for (const f of Object.keys(files)) if (f.startsWith(tdir)) move(f);
      return { result: trashed, writes };
    }
    case 'type_template': {
      const t = getType(files, vers, String(a.key));
      const path = t?.template ? nfc(t.template) : null;
      if (!path || path.startsWith('.trash/') || files[path] === undefined) return { result: null };
      return { result: { path, text: files[path] } };
    }
    case 'type_usage': {
      const key = nfc(String(a.type));
      const t = getType(files, vers, key);
      const objs = (await objects(files)).filter((o) => o.type === key);
      const values: Record<string, number> = {};
      const options: Record<string, Record<string, number>> = {};
      const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      for (const at of t?.attributes ?? []) {
        values[at.key] = objs.filter((o) => (at.type === 'date-range' ? !empty(o.data[`${at.key}-start`]) || !empty(o.data[`${at.key}-end`]) : !empty(o.data[at.key]))).length;
        if (at.type === 'select' || at.type === 'multi-select') {
          options[at.key] = {};
          for (const op of at.options) options[at.key][op.label] = objs.filter((o) => ([] as unknown[]).concat(o.data[at.key] ?? []).map((x) => nfc(String(x))).includes(op.label)).length;
        }
      }
      return { result: { objects: objs.length, values, options } };
    }
    case 'type_misfits': {
      const key = nfc(String(a.type));
      const objs = (await objects(files)).filter((o) => o.type === key);
      const as = { ...a.as, supported: true, readOnlyReason: null, builtIn: false };
      return { result: objs.filter((o) => { const v = s.validate(as, o.data); return v.state === 'invalid'; }).length };
    }
    case 'index_type_rows': {
      const key = nfc(String(a.type));
      const t = getType(files, vers, key);
      const objs = (await objects(files)).filter((o) => o.type === key);
      const all = await objects(files);
      const resolveLink = (v: unknown) => {
        const m = /^\[\[([^\]|#]+)/.exec(String(v));
        if (!m) return null;
        const target = nfc(m[1]).trim().toLowerCase();
        const hit = all.find((o) => o.path.toLowerCase().replace(/\.md$/, '') === target || o.path.split('/').pop()!.toLowerCase().replace(/\.md$/, '') === target);
        return { target: String(v), kind: hit ? 'note' : 'unresolved', path: hit?.path ?? null, title: hit?.title ?? null, type: hit?.type ?? null };
      };
      return {
        result: objs.map((o) => {
          const values: Record<string, unknown> = {};
          const links: unknown[] = [];
          // D-1240: a value for every effective column key (the `columns` list, else the preview keys).
          for (const k of (t?.columns ?? t?.preview ?? []).map(nfc)) {
            const at = t?.attributes.find((x: any) => x.key === k);
            if (at?.type === 'date-range') { for (const h of ['start', 'end']) if (o.data[`${k}-${h}`] !== undefined) values[`${k}-${h}`] = o.data[`${k}-${h}`]; continue; }
            if (o.data[k] === undefined) continue;
            values[k] = o.data[k];
            if (at?.type === 'relation') for (const v of ([] as unknown[]).concat(o.data[k] as any)) { const l = resolveLink(v); if (l) links.push(l); }
            // Links inside Text, Long text and source values (D-249, D-257).
            else if ((k === 'source' || at?.type === 'text' || at?.type === 'long-text') && typeof o.data[k] === 'string') {
              for (const m of (o.data[k] as string).matchAll(/\[\[([^[\]\n]+?)\]\]/g)) { const l = resolveLink(`[[${m[1]}]]`); if (l) links.push({ ...l, target: m[1] }); }
            }
          }
          return { path: o.path, id: o.id, title: o.title, created: (o.data.created as string) ?? null, modified: (o.data.modified as string) ?? null, values, links, typeSingle: o.single, tags: o.tags };
        }),
      };
    }
    case 'note_create': {
      const key = nfc(String(a.type));
      const t = getType(files, vers, key);
      if (!t) return { error: err('UnknownType', `no type ${key}`) };
      const folder = t.folder.replace(/\/+$/, '');
      // D-291: a stem no other indexed file has anywhere in the vault (templates and .trash/ don't count).
      const stems = new Set(Object.keys(files).filter((p) => !excluded(p)).map((p) => nfc(p.split('/').pop()!.replace(/\.md$/, '')).toLowerCase()));
      const base = sanitize(String(a.title));
      let stem = base;
      for (let n = 2; stems.has(nfc(stem).toLowerCase()); n++) stem = `${base} (${n})`;
      const path = unique(files, folder, stem, '.md');
      return { result: path, writes: { [path]: String(a.text) } };
    }
    case 'starter_plan':
    case 'starter_add': {
      const starterTypes = Object.keys(STARTER).filter((p) => p.startsWith('.tegg/types/'));
      const order = ['book', 'reading-note', 'idea', 'meeting', 'person', 'project', 'trip'];
      const existing = types();
      const add: string[] = [], skip: { key: string; reason: string; folder?: string }[] = [], skipTemplates: string[] = [];
      for (const k of order) {
        const st = readType(k, STARTER[`.tegg/types/${k}.yml`], true, null);
        if (existing.some((t) => t.key === k)) skip.push({ key: k, reason: 'nameExists' });
        else if (existing.some((t) => nfc(t.folder).toLowerCase() === nfc(st.folder).toLowerCase())) skip.push({ key: k, reason: 'folderUsed', folder: st.folder });
        else {
          add.push(k);
          if (st.template && files[st.template] !== undefined) skipTemplates.push(st.template);
        }
      }
      void starterTypes;
      if (cmd === 'starter_plan') return { result: { add, skip, skipTemplates } };
      const writes: Record<string, string> = {};
      for (const k of add) {
        writes[`.tegg/types/${k}.yml`] = STARTER[`.tegg/types/${k}.yml`];
        const tp = readType(k, STARTER[`.tegg/types/${k}.yml`], true, null).template;
        if (tp && files[tp] === undefined) writes[tp] = STARTER[tp];
      }
      return { result: { add, skip, skipTemplates }, writes };
    }
  }
  return { error: err('Io', `fake schema: unknown command ${cmd}`) };
}
