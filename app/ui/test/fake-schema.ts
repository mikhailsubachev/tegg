// Fake core, slice 3D part (docs/contracts/ms3-shell.md §14.8): type files and typed objects over the in-memory vault.
// Test code, not product code. Runs in the Playwright (Node) process; the in-page fake (fake-core.ts) forwards the 3D
// commands here through `page.exposeFunction` with a snapshot of the vault files and their versions, and applies the
// returned writes. Type files are read with the `yaml` package by §14.1.1 and patched by the line rules of §14.1.4;
// rules, validity and type matching come from `@tegg/schema`, note text from `@tegg/doc` (D-241). Starter and
// built-in bytes are read from tests/fixtures/vaults/new-starter/ and new-empty/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseDocument, parse as parseYaml } from 'yaml';

const REPO = resolve(import.meta.dirname, '../../..');
const SYSTEM = ['page', 'task', 'quick-note', 'daily-note', 'tag', 'image', 'pdf'];
const R10 = ['text', 'long-text', 'number', 'checkbox', 'date', 'date-time', 'date-range', 'select', 'multi-select', 'url', 'email', 'relation'];
const UNIVERSAL_PREVIEW = ['tags', 'source', 'aliases', 'created', 'modified'];
const TOP = ['version', 'name', 'plural', 'system', 'folder', 'icon', 'color', 'description', 'review', 'preview', 'template', 'attributes'];
const ITEM = ['key', 'name', 'type', 'default', 'required', 'options', 'to', 'multiple', 'description'];
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
    state: 'ok', error: null, declaredVersion: null, description: null, review: 'off', preview: [], previewIgnored: [], template: null, attributes: [],
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
    options: (a.options ?? []).map((o: any) => ({ label: String(o.label), color: o.color ?? null })),
    to: Array.isArray(a.to) ? a.to : null, multiple: a.multiple === true, description: a.description ?? null, builtIn: builtinKeys.includes(a.key),
  }));
  const preview: string[] = Array.isArray(y.preview) ? y.preview.map(String) : [];
  const declared = typeof y.version === 'number' ? y.version : null;
  return {
    ...base,
    name: y.name ?? key, plural: y.plural ?? y.name ?? key, folder: y.folder ?? y.plural ?? y.name ?? key,
    icon: y.icon ?? 'file-text', color: y.color ?? 'gray', system: typeof y.system === 'boolean' ? y.system : system,
    state: declared !== null && declared > 1 ? 'newer' : 'ok', declaredVersion: declared, description: y.description ?? null,
    review: y.review === 'locked' ? 'locked' : y.review === true ? 'on' : 'off', preview,
    previewIgnored: preview.filter((p) => !attributes.some((a: any) => a.key === p) && !UNIVERSAL_PREVIEW.includes(p)),
    template: y.template ?? null, attributes,
  };
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
    return { path, data, type: m.key, single: m.single, title: typeof data.title === 'string' ? data.title : stem, id: typeof data.id === 'string' ? data.id : null };
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
const optionLine = (o: { label: string; color: string | null }) => `      - { label: ${scalar(o.label)}${o.color ? `, color: ${o.color}` : ''} }\n`;

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

async function patchText(key: string, text: string, ops: any[], t: TypeDto, all: TypeDto[]): Promise<{ text: string } | { error: Record<string, unknown> }> {
  const s = await schema();
  const es = entries(text);
  const others = all.filter((x) => x.key !== key);
  const rule = (r: any) => ({ error: err('Rule', `rule: ${r.reason}`, r) });
  const builtIn = (k: string) => t.attributes.find((a: any) => a.key === k)?.builtIn === true;
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
      setTop(es, op.field, v === null || v === '' ? null : `${op.field}: ${scalar(op.field === 'folder' ? v.replace(/\/+$/, '') : v)}\n`);
    } else if (op.op === 'review') {
      if (t.review === 'locked') return { error: err('ReviewLocked', 'review is locked') };
      if ((t.review === 'on') === op.on) continue;
      setTop(es, 'review', `review: ${op.on}\n`);
    } else if (op.op === 'preview') {
      if (op.keys.length > 4) return rule({ reason: 'previewFull' });
      if (JSON.stringify(op.keys) === JSON.stringify(t.preview)) continue;
      setTop(es, 'preview', `preview: ${flow(op.keys)}\n`);
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
      } else if (op.op === 'moveAttribute') {
        const i = find(op.key);
        if (i < 0 || i === op.to) continue;
        const [it] = its.splice(i, 1);
        its.splice(Math.max(0, Math.min(op.to, its.length)), 0, it);
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
      es[ai] = { key: 'attributes', lines: body ? ['attributes:\n', body] : ['attributes: []\n'] };
    }
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
      const out = await patchText(key, text, a.ops ?? [], t, types());
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
          for (const k of t?.preview ?? []) {
            const at = t?.attributes.find((x: any) => x.key === k);
            if (at?.type === 'date-range') { for (const h of ['start', 'end']) if (o.data[`${k}-${h}`] !== undefined) values[`${k}-${h}`] = o.data[`${k}-${h}`]; continue; }
            if (o.data[k] === undefined) continue;
            values[k] = o.data[k];
            if (at?.type === 'relation' || k === 'source') for (const v of ([] as unknown[]).concat(o.data[k] as any)) { const l = resolveLink(v); if (l) links.push(l); }
          }
          return { path: o.path, id: o.id, title: o.title, created: (o.data.created as string) ?? null, modified: (o.data.modified as string) ?? null, values, links, typeSingle: o.single };
        }),
      };
    }
    case 'note_create': {
      const key = nfc(String(a.type));
      const t = getType(files, vers, key);
      if (!t) return { error: err('UnknownType', `no type ${key}`) };
      const folder = t.folder.replace(/\/+$/, '');
      const path = unique(files, folder, sanitize(String(a.title)), '.md');
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
