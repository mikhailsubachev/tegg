// Fake core, MS4 slice 4A link commands (docs/contracts/ms4-links.md §6). Test code, not product code. Runs in Node
// (like fake-schema.ts) so it can use the real `@tegg/doc` extraction and `excerptWindow`; the rules mirror
// crates/tegg-core/src/links4a.rs and the resolution rules of ms3-shell §11.1 (D-291).
import { listTypes, type Answer, type Files, type VersionDto } from './fake-schema';

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const err = (kind: string, message: string, extra: Record<string, unknown> = {}) => ({ kind, message, ...extra });
const excluded = (p: string) => !p.endsWith('.md') || p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));
const FIRST = ['page', 'task', 'quick-note', 'daily-note'];
const LAST = ['image', 'pdf'];
const MAX = 160;
const BEFORE = 60;

let docMod: any = null;
let schemaMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));
const schema = async () => (schemaMod ??= await import('@tegg/schema'));

export type Obj = {
  path: string; stem: string; folder: string; title: string; id: string | null; type: string; raw: string | null;
  attributes: Record<string, any>; frontmatterError: boolean; links: any[]; blocks: any[];
  /** ms4-daily §2: a Daily Note's valid date (its displayed title, D-320) and its stored title when different. */
  daily: string | null; storedTitle: string | null;
  /** Tag keys, frontmatter and inline (D-185). */
  tags?: string[];
};

export async function objects(files: Files): Promise<Obj[]> {
  return objectsWith(files, await doc(), await schema());
}

/** `objects` with the modules already loaded (5A-1 fake-tasks.ts, ms5-tasks §7). */
export function objectsWith(files: Files, d: any, s: any): Obj[] {
  return Object.entries(files).filter(([p]) => !excluded(p)).map(([path, text]) => {
    const stem = path.split('/').pop()!.replace(/\.md$/, '');
    const x = d.extract(text, stem);
    const attributes = (x.attributes ?? {}) as Record<string, any>;
    const m = s.typeMatch(x.attributes && 'type' in attributes ? attributes.type : undefined) as { key: string };
    const raw = typeof attributes.type === 'string' && attributes.type.trim() ? nfc(attributes.type.trim()) : null;
    const daily = m.key === 'daily-note' && attributes.date != null ? d.parseDate(String(attributes.date).trim().slice(0, 10)) : null;
    const storedTitle = daily && nfc(String(x.title).trim()) !== daily ? x.title : null;
    return { path, stem, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', title: daily ?? x.title, id: x.id, type: m.key, raw, attributes, frontmatterError: x.frontmatterError, links: x.links, blocks: x.blocks, daily, storedTitle, tags: x.tags };
  });
}

type Res = { kind: 'note' | 'daily' | 'date-missing' | 'unresolved' | 'ignored' | 'trashed'; path: string | null };

/** 6A (ms6-trash-media §2): note-like objects under `.trash/`, with the prefix removed for resolution. */
type Trashed = { path: string; rest: string; stem: string; folder: string; id: string | null };
function trashedObjects(files: Files): Trashed[] {
  return Object.entries(files).filter(([p]) => p.startsWith('.trash/') && p.endsWith('.md')).map(([path, text]) => {
    const rest = path.slice('.trash/'.length);
    const id = /^id:\s*(\S+)\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '')?.[1] ?? null;
    return { path, rest, stem: (rest.split('/').pop() ?? rest).replace(/\.md$/, ''), folder: rest.includes('/') ? rest.slice(0, rest.lastIndexOf('/')) : '', id };
  });
}

/** D-628: broken links and backlinks treat links into `.trash/` as `trashed` (trash-media.md R74). */
const TRASHED_TARGETS = true;

export function resolver(objs: Obj[], trashed: Trashed[] = []) {
  const byPath = new Map<string, Obj>();
  const byId = new Map<string, Obj>();
  const byStem = new Map<string, Obj[]>();
  const sorted = [...objs].sort((a, b) => [...a.path].length - [...b.path].length || byCode(a.path, b.path));
  for (const o of sorted) {
    byPath.set(low(o.path).replace(/\.md$/, ''), o);
    if (o.id && !byId.has(o.id)) byId.set(o.id, o);
    const k = low(o.stem);
    byStem.set(k, [...(byStem.get(k) ?? []), o]);
  }
  const daily = new Map<string, Obj>();
  for (const [k, g] of dailyGroups(objs)) daily.set(k, g[0]);
  return (from: string, target: string): Res => {
    let t = nfc(target).trim();
    const cut = t.search(/[#|]/);
    if (cut >= 0) t = t.slice(0, cut).trim();
    if (!t) return { kind: 'unresolved', path: null };
    if (isDate(t)) { const o = daily.get(t); return o ? { kind: 'daily', path: o.path } : { kind: 'date-missing', path: null }; }
    const fromDir = nfc(from).includes('/') ? low(from.slice(0, from.lastIndexOf('/'))) : '';
    const key = low(t).replace(/\.md$/, '');
    const hit = (fromDir && byPath.get(`${fromDir}/${key}`)) || byPath.get(key) || byId.get(t)
      || (!key.includes('/') ? ((byStem.get(key) ?? []).find((o) => low(o.folder) === fromDir) ?? (byStem.get(key) ?? [])[0]) : undefined);
    if (hit) return { kind: 'note', path: hit.path };
    if (!isNoteTarget(t)) {
      // 6A (ms6-trash-media §3.2, FR-ATT-07): a link to a paired file counts as a link to its Image/PDF object.
      const name = low(t).split('/').pop()!;
      const owner = objs.filter((o) => (o.type === 'image' || o.type === 'pdf') && typeof o.attributes.file === 'string')
        .filter((o) => { const m = /\[\[([^\]|#]+)/.exec(String(o.attributes.file)); return !!m && low(m[1].trim()).split('/').pop() === name; })
        .sort((a, b) => byCode(a.path, b.path))[0];
      return owner ? { kind: 'note', path: owner.path } : { kind: 'unresolved', path: null };
    }
    // 6A (ms6-trash-media §2, D-615): a target that resolves only in `.trash/` is trashed, not broken.
    const th = trashed.find((o) => low(o.rest).replace(/\.md$/, '') === key) ?? (t && trashed.find((o) => o.id === t))
      ?? (!key.includes('/') ? (trashed.filter((o) => low(o.stem) === key).find((o) => low(o.folder) === fromDir) ?? trashed.filter((o) => low(o.stem) === key)[0]) : undefined);
    return th ? { kind: 'trashed', path: th.path } : { kind: 'unresolved', path: null };
  };
}

/** D-332: a valid `YYYY-MM-DD` calendar date. */
function isDate(t: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** D-319, D-335: per date, the Daily Notes newest first (latest created, then modified; missing is oldest), then path. */
function dailyGroups(objs: Obj[]): Map<string, Obj[]> {
  // The one copy of the rule in the fake: @tegg/doc dailyOrder, the twin of the Rust index (PR #38 review, D-365).
  const order = (a: Obj, b: Obj) => docMod.dailyOrder({ path: a.path, created: a.attributes.created, modified: a.attributes.modified }, { path: b.path, created: b.attributes.created, modified: b.attributes.modified });
  const out = new Map<string, Obj[]>();
  for (const o of objs) if (o.daily) out.set(o.daily, [...(out.get(o.daily) ?? []), o]);
  for (const g of out.values()) g.sort(order);
  return out;
}

function isNoteTarget(t: string): boolean {
  const name = nfc(t).trim().split('/').pop() ?? '';
  if (!name) return false;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return true;
  const ext = name.slice(dot + 1);
  return ext.toLowerCase() === 'md' || ext.includes(' ') || ext.length > 5;
}

type Ctx = { objs: Obj[]; byPath: Map<string, Obj>; res: Map<string, Res[]>; types: any[] };
async function context(files: Files, vers: Record<string, VersionDto>): Promise<Ctx> {
  const objs = await objects(files);
  // 6A (D-615, D-628): links into `.trash/` are trashed: not broken and not backlinks (trash-media.md R74).
  const r = resolver(objs, TRASHED_TARGETS ? trashedObjects(files) : []);
  const res = new Map<string, Res[]>();
  for (const o of objs) res.set(o.path, o.links.map((l: any) => (o.frontmatterError && l.inFrontmatter ? { kind: 'ignored', path: null } : r(o.path, l.target)) as Res));
  return { objs, byPath: new Map(objs.map((o) => [o.path, o])), res, types: listTypes(files, vers) };
}

function targetDto(ctx: Ctx, l: any, r: Res) {
  const o = r.path ? ctx.byPath.get(r.path) : undefined;
  return { target: l.target, kind: r.kind === 'ignored' ? 'unresolved' : r.kind, path: r.path, title: o?.title ?? null, type: o?.type ?? null };
}
function chipText(l: any, title: string | null): string {
  if (l.alias && String(l.alias).trim()) return l.alias;
  const base = title ?? l.target;
  return l.subpath ? `${base} › ${l.subpath}` : base;
}

/** Occurrences of `o` whose links satisfy `isHere` (ms4-links §3). */
async function entryFor(ctx: Ctx, o: Obj, isHere: (l: any, r: Res) => boolean) {
  const d = await doc();
  const rs = ctx.res.get(o.path)!;
  const seg = (i: number, marks: string[]) => {
    const l = o.links[i];
    const t = targetDto(ctx, l, rs[i]);
    return { kind: 'link', text: chipText(l, t.title), target: t, here: isHere(l, rs[i]), marks };
  };
  const def = ctx.types.find((t) => t.key === o.type);
  const occurrences: any[] = [];
  const seenAttr = new Set<string>();
  const seenBlock = new Set<number>();
  o.links.forEach((l: any, i: number) => {
    if (rs[i].kind === 'ignored' || !isHere(l, rs[i])) return;
    if (l.attribute !== null) {
      if (seenAttr.has(l.attribute)) return;
      seenAttr.add(l.attribute);
      const recs = o.links.map((x: any, j: number) => [x, j] as const).filter(([x]) => x.attribute === l.attribute);
      const value = o.attributes[l.attribute];
      const items = Array.isArray(value) ? value : [value];
      const out: any[] = [];
      const text = (t: string) => { if (!t) return; const last = out[out.length - 1]; if (last && last.kind === 'text' && last.marks.length === 0) last.text += t; else out.push({ kind: 'text', text: t, marks: [] }); };
      let next = 0;
      items.forEach((it, n) => {
        if (n > 0) text(', ');
        const s = typeof it === 'string' ? it : it === null || it === undefined ? '' : String(it);
        let last = 0;
        for (const m of s.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) {
          const name = m[1].split(/[|#]/)[0].trim();
          const rec = recs[next];
          if (rec && nfc(rec[0].target) === nfc(name)) { text(s.slice(last, m.index)); out.push(seg(rec[1], [])); next++; last = m.index! + m[0].length; }
        }
        text(s.slice(last));
      });
      const here = out.map((g, k) => (g.kind === 'link' && g.here ? k : -1)).filter((k) => k >= 0);
      const name = def?.attributes?.find((a: any) => nfc(a.key) === nfc(l.attribute))?.name ?? null;
      occurrences.push({ kind: 'attribute', attribute: l.attribute, attributeName: name, at: l.at, excerpt: d.excerptWindow(out, here, MAX, BEFORE) });
    } else if (l.block !== null) {
      if (seenBlock.has(l.block)) return;
      seenBlock.add(l.block);
      const block = o.blocks[l.block];
      const rendered = block.segments.map((g: any) => ('link' in g ? seg(g.link, g.marks) : { kind: 'text', text: g.text, marks: g.marks }));
      const here = rendered.map((g: any, k: number) => (g.kind === 'link' && g.here ? k : -1)).filter((k: number) => k >= 0);
      occurrences.push({ kind: l.embed ? 'embed' : 'body', attribute: null, attributeName: null, at: l.at, excerpt: d.excerptWindow(rendered, here, MAX, BEFORE) });
    }
  });
  if (!occurrences.length) return null;
  const modified = typeof o.attributes.modified === 'string' ? o.attributes.modified : null;
  // D-633 (ms4-links §9.1): the source's chip fields as D-601, the trimmed frontmatter strings or null.
  const chip = (k: string) => (typeof o.attributes[k] === 'string' ? (o.attributes[k] as string).trim() : null);
  return {
    source: o.path, title: o.title, type: o.type, modified, readOnly: o.frontmatterError, occurrences, raw: o.raw,
    review: chip('review'), status: chip('status'), due: chip('due'), completed: chip('completed'),
  };
}

const instant = (v: string | null) => {
  if (!v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? `${v.trim()}T00:00:00Z` : v);
  return Number.isNaN(t) ? null : t;
};
const byInstant = (x: number | null, y: number | null, newest: boolean) =>
  x !== null && y !== null ? (newest ? y - x : x - y) : x !== null ? -1 : y !== null ? 1 : 0;
const mostFrequent = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || byCode(a[0], b[0]))[0]?.[0] ?? null;

function group(ctx: Ctx, entries: any[]) {
  const by = new Map<string, { entries: any[]; raws: Map<string, number> }>();
  for (const e of entries) {
    const g = by.get(e.type) ?? { entries: [] as any[], raws: new Map<string, number>() };
    if (e.raw) g.raws.set(e.raw, (g.raws.get(e.raw) ?? 0) + 1);
    const { raw: _r, ...clean } = e;
    g.entries.push(clean);
    by.set(e.type, g);
  }
  const defined = (k: string) => ctx.types.some((t) => t.key === k && (t.exists || t.system));
  const rank = (k: string): [number, number] => FIRST.includes(k) ? [0, FIRST.indexOf(k)] : LAST.includes(k) ? [2, LAST.indexOf(k)] : defined(k) ? [1, 0] : [3, 0];
  return [...by.entries()]
    .map(([type, g]) => ({
      type, defined: defined(type) || FIRST.includes(type) || LAST.includes(type), raw: mostFrequent(g.raws) ?? type,
      entries: g.entries.sort((a, b) => byInstant(instant(a.modified), instant(b.modified), true) || byCode(a.source, b.source)),
    }))
    .sort((a, b) => rank(a.type)[0] - rank(b.type)[0] || rank(a.type)[1] - rank(b.type)[1] || byCode(a.type, b.type));
}

/** D-348: the panel of a date without a Daily Note. */
async function dateBacklinksPanel(ctx: Ctx, date: string) {
  const entries: any[] = [];
  const key = (l: any) => nfc(String(l.target).split(/[|#]/)[0].trim());
  for (const o of ctx.objs) {
    const e = await entryFor(ctx, o, (l, r) => r.kind === 'date-missing' && key(l) === date);
    if (e) entries.push(e);
  }
  return { objects: entries.length, groups: group(ctx, entries) };
}

const TEMPLATE = '_templates/Daily Note/Daily Note.md';

/** ms4-daily §5 (D-336): the daily stem from vault.yml's `daily-format`, and whether it fell back. */
async function dailyStem(files: Files, date: string): Promise<[string, boolean]> {
  const d = await doc();
  const m = /^daily-format:[ \t]*(.*)$/m.exec(files['.tegg/vault.yml'] ?? '');
  if (!m) return [d.dailyFileStem('YYYY-MM-DD', date), false];
  const raw = m[1].trim().replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
  const s = d.dailyFileStem(raw, date);
  return s === null ? [d.dailyFileStem('YYYY-MM-DD', date), true] : [s, false];
}
function dailyFolder(ctx: Ctx): string {
  const t = ctx.types.find((x) => x.key === 'daily-note');
  return t && !t.invalid ? String(t.folder).replace(/^\/+|\/+$/g, '') : 'Daily';
}

/** D-339: `created`/`modified` in the day window: instants by [start, end), offset-less values by their local date. */
export function inWindow(v: unknown, date: string, start: number, end: number): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/.test(s)) { const t = Date.parse(s); return t >= start && t < end ? t : null; }
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) return s.slice(0, 10) === date ? Date.parse(s.length > 10 ? `${s}Z` : `${s}T00:00:00Z`) : null;
  return null;
}

async function daily(cmd: string, a: any, files: Files, ctx: Ctx): Promise<Answer> {
  const d = await doc();
  const date = String(a.date ?? '');
  const groups = dailyGroups(ctx.objs);
  const of = (x: string) => groups.get(x) ?? [];
  switch (cmd) {
    case 'daily_winners': return { result: Object.fromEntries([...groups].map(([k, g]) => [k, g[0].path])) };
    case 'daily_view': {
      const g = of(date);
      const r = g[0] ? String(g[0].attributes.review ?? '').trim() : '';
      return { result: { date, path: g[0]?.path ?? null, duplicates: g.slice(1).map((o) => o.path), review: r === 'reviewed' || r === 'unreviewed' ? r : null } };
    }
    case 'daily_dates': {
      const pre = `${String(a.year).padStart(4, '0')}-${String(a.month).padStart(2, '0')}-`;
      return { result: [...groups.keys()].filter((k) => k.startsWith(pre)).sort(byCode) };
    }
    case 'daily_draft': {
      const tpl = files[TEMPLATE];
      const x = tpl === undefined ? { keys: [], body: '', invalid: false } : d.expandDailyTemplate(tpl, date);
      const [stem0, formatFallback] = await dailyStem(files, date);
      const folder = dailyFolder(ctx);
      const stem = freeStem(files, ctx, folder, stem0);
      return { result: { text: d.newDailyNote({ date, keys: x.keys, body: x.body, id: '{{id}}', now: '{{now}}' }), body: x.body, templateInvalid: x.invalid ? TEMPLATE : null, path: folder ? `${folder}/${stem}.md` : `${stem}.md`, formatFallback } };
    }
    case 'daily_create': {
      const text = String(a.text ?? '');
      const x = d.extract(text, date);
      const at = (x.attributes ?? {}) as Record<string, any>;
      const ok = String(at.type ?? '').trim().toLowerCase().replace(/\s+/g, '-') === 'daily-note' && String(at.date ?? '').trim().slice(0, 10) === date && nfc(String(at.title ?? '').trim()) === date;
      if (!ok) return { error: err('DailyMismatch', "fake: the bytes aren't this date's Daily Note") };
      const [stem0] = await dailyStem(files, date);
      const folder = dailyFolder(ctx);
      // FR-SYN-06, PR #38 re-review: a file at the planned path with this write's id is this write; replaced, not copied.
      const planned = `${folder ? `${folder}/` : ''}${nfc(stem0)}.md`;
      const id = String(at.id ?? '').trim();
      const mine = id !== '' && files[planned] !== undefined && String((d.extract(files[planned], date).attributes as any)?.id ?? '').trim() === id;
      const path = mine ? planned : `${folder ? `${folder}/` : ''}${freeStem(files, ctx, folder, stem0)}.md`;
      const others = of(date).map((o) => o.path).filter((p) => p !== path);
      return { result: { path, version: null, duplicates: others }, writes: { [path]: text } };
    }
    case 'daily_backlinks': {
      const w = of(date)[0];
      return { result: w ? await backlinksPanel(ctx, w.path) : await dateBacklinksPanel(ctx, date) };
    }
    case 'daily_context': {
      const start = Date.parse(String(a.start)), end = Date.parse(String(a.end)), limit = Number(a.limit ?? 50);
      const own = of(date)[0]?.path ?? null;
      const q: [number, any][] = [], c: [number, any][] = [], m: [number, any][] = [];
      // 5A-1 (D-328, FR-DLY-04 AC-11): what Tasks due lists for the day (due on it, or completed in it) isn't repeated.
      const statusOpts: any[] = (ctx.types as any[]).find((x) => x.key === 'task')?.attributes?.find((a: any) => a.key === 'status')?.options ?? [];
      const stateOf = (v: unknown) => { const o = statusOpts.find((x) => x.label === (typeof v === 'string' ? nfc(v) : null)); return ['open', 'in-progress', 'done', 'cancelled'].includes(o?.state) ? o.state : 'open'; };
      const listed = (o: Obj) => {
        if (o.type !== 'task') return false;
        const st = stateOf(o.attributes.status);
        if ((st === 'open' || st === 'in-progress') && typeof o.attributes.due === 'string' && o.attributes.due.trim() === date) return true;
        return st === 'done' && inWindow(o.attributes.completed, date, start, end) !== null;
      };
      for (const o of ctx.objs) {
        if (o.path === own || listed(o)) continue;
        const row = (v: unknown) => ({ path: o.path, title: o.title, type: o.type, at: String(v) });
        const cr = inWindow(o.attributes.created, date, start, end), mo = inWindow(o.attributes.modified, date, start, end);
        if (o.type === 'quick-note' && cr !== null) q.push([cr, row(o.attributes.created)]);
        else if (cr !== null) c.push([cr, row(o.attributes.created)]);
        else if (mo !== null) m.push([mo, row(o.attributes.modified)]);
      }
      const fin = (v: [number, any][]) => v.sort((x, y) => y[0] - x[0] || byCode(x[1].path, y[1].path)).map((x) => x[1]);
      const [qq, cc, mm] = [fin(q), fin(c), fin(m)];
      return { result: { quickNotes: qq.slice(0, limit), created: cc.slice(0, limit), modified: mm.slice(0, limit), totals: [qq.length, cc.length, mm.length] } };
    }
    default: return { error: err('Io', `fake-daily: unknown ${cmd}`) };
  }
}

async function backlinksPanel(ctx: Ctx, path: string) {
  const target = ctx.byPath.get(nfc(path));
  if (!target) return { objects: 0, groups: [] };
  const entries: any[] = [];
  for (const o of ctx.objs) {
    if (o.path === target.path) continue;
    const e = await entryFor(ctx, o, (_l, r) => r.path === target.path);
    if (e) entries.push(e);
  }
  return { objects: entries.length, groups: group(ctx, entries) };
}

function defaultType(files: Files, ctx: Ctx) {
  const m = /^default-type:\s*["']?(.+?)["']?\s*$/m.exec(files['.tegg/vault.yml'] ?? '');
  const name = m ? m[1] : 'Quick Note';
  return ctx.types.find((t) => t.name === name) ?? ctx.types.find((t) => t.key === 'quick-note');
}

const sanitize = (title: string) => {
  let s = nfc(title).replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').split(' ').filter(Boolean).join(' ').replace(/^[ .]+|[ .]+$/g, '');
  const bytes = new TextEncoder();
  while (bytes.encode(s).length > 200) s = s.slice(0, -1);
  s = s.replace(/^[ .]+|[ .]+$/g, '');
  if (!s) return 'Untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s.split('.')[0]) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s.split('.')[0])) s += '_';
  return s;
};

function freeStem(files: Files, ctx: Ctx, folder: string, stem: string): string {
  const taken = new Set(ctx.objs.map((o) => low(o.stem)));
  const f = nfc(folder).replace(/^\/+|\/+$/g, '');
  for (const p of Object.keys(files)) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (nfc(dir) === f && p.endsWith('.md')) taken.add(low(p.split('/').pop()!.replace(/\.md$/, '')));
  }
  for (let n = 1; ; n++) {
    const c = n === 1 ? nfc(stem) : `${nfc(stem)} (${n})`;
    if (!taken.has(low(c))) return c;
  }
}

function plan(files: Files, ctx: Ctx, from: string, target: string, relationTo: string[] | null): any {
  let t = nfc(target).trim();
  const cut = t.search(/[#|]/);
  if (cut >= 0) t = t.slice(0, cut).trim();
  const r = resolver(ctx.objs)(from, t);
  if ((r.kind === 'note' || r.kind === 'daily') && r.path) return { state: 'exists', path: r.path };
  if (/\.md$/i.test(t)) t = t.slice(0, -3);
  const slash = t.lastIndexOf('/');
  const folderPart = slash >= 0 ? t.slice(0, slash) : null;
  const title = slash >= 0 ? t.slice(slash + 1).trim() : t;
  const def = defaultType(files, ctx);
  let folder: string, key: string;
  if (folderPart !== null) {
    const ok = folderPart.split('/').every((s) => s.trim() && !s.startsWith('.') && !/[\\/:*?"<>|#^[\]\u0000-\u001f]/.test(s)) && folderPart.split('/')[0] !== '_templates';
    if (!ok) return { state: 'forbidden', reason: 'folder' };
    key = ctx.types.find((ty) => low(String(ty.folder).replace(/^\/+|\/+$/g, '')) === low(folderPart))?.key ?? def.key;
    folder = folderPart;
  } else {
    const want = relationTo?.[0] ? nfc(relationTo[0]).toLowerCase().replace(/\s+/g, '-') : null;
    const ty = (want && ctx.types.find((x) => x.key === want)) || def;
    key = ty.key;
    folder = String(ty.folder).replace(/^\/+|\/+$/g, '');
  }
  const stem = freeStem(files, ctx, folder, sanitize(title));
  return { state: 'create', path: folder ? `${folder}/${stem}.md` : `${stem}.md`, title, type: key, rewrite: stem !== nfc(title) ? `${stem}|${title}` : null };
}

function relationAllows(ctx: Ctx, from: string, target: string, type: string): boolean {
  const o = ctx.byPath.get(nfc(from));
  if (!o) return false;
  const def = ctx.types.find((t) => t.key === o.type);
  const want = low(target.split(/[|#]/)[0].trim());
  return o.links.some((l: any) => low(l.target.trim()) === want && l.attribute !== null
    && (def?.attributes?.find((a: any) => nfc(a.key) === nfc(l.attribute))?.to ?? []).some((x: string) => nfc(x).toLowerCase().replace(/\s+/g, '-') === type));
}

async function brokenLinks(files: Files, ctx: Ctx) {
  const groups = new Map<string, { spellings: Map<string, number>; count: number; sources: string[]; to: string[] | null; allRel: boolean }>();
  let occurrences = 0, objects = 0;
  const broken = (l: any, r: Res) => r.kind === 'unresolved' && isNoteTarget(l.target);
  for (const o of [...ctx.objs].sort((a, b) => byCode(a.path, b.path))) {
    const rs = ctx.res.get(o.path)!;
    let any = false;
    o.links.forEach((l: any, i: number) => {
      if (!broken(l, rs[i])) return;
      any = true;
      occurrences++;
      const k = low(l.target.trim());
      const g = groups.get(k) ?? { spellings: new Map<string, number>(), count: 0, sources: [] as string[], to: null as string[] | null, allRel: true };
      const sp = nfc(l.target.trim());
      g.spellings.set(sp, (g.spellings.get(sp) ?? 0) + 1);
      g.count++;
      if (!g.sources.includes(o.path)) g.sources.push(o.path);
      const def = ctx.types.find((t) => t.key === o.type);
      const to = l.attribute !== null ? def?.attributes?.find((a: any) => nfc(a.key) === nfc(l.attribute))?.to ?? null : null;
      if (to && to.length) g.to ??= to; else g.allRel = false;
      groups.set(k, g);
    });
    if (any) objects++;
  }
  const out: any[] = [];
  for (const [key, g] of groups) {
    const label = mostFrequent(g.spellings) ?? key;
    const sources: any[] = [];
    for (const p of g.sources) {
      const e = await entryFor(ctx, ctx.byPath.get(p)!, (l, r) => broken(l, r) && low(l.target.trim()) === key);
      if (e) { const { raw: _r, ...clean } = e; sources.push(clean); }
    }
    out.push({ key, label, count: g.count, create: plan(files, ctx, g.sources[0] ?? '', label, g.allRel ? g.to : null), sources });
  }
  out.sort((a, b) => b.count - a.count || byCode(a.label, b.label));
  return { occurrences, objects, groups: out };
}

function details(ctx: Ctx, o: Obj) {
  const def = ctx.types.find((t) => t.key === o.type);
  const preview = ((def?.preview ?? []) as string[]).map((k) => [k, o.attributes[k]] as [string, unknown])
    .filter(([, v]) => v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()) && !(Array.isArray(v) && !v.length)).slice(0, 2);
  return { created: typeof o.attributes.created === 'string' ? o.attributes.created : null, preview, stem: nfc(o.stem) !== nfc(o.title) ? nfc(o.stem) : null };
}
function titleGroups(ctx: Ctx): Map<string, Obj[]> {
  const byId = new Map<string, Obj[]>();
  for (const o of ctx.objs) if (o.id) byId.set(o.id, [...(byId.get(o.id) ?? []), o]);
  const copies = new Set<string>();
  for (const g of byId.values()) {
    if (g.length < 2) continue;
    const named = g.filter((o) => low(o.stem) === low(o.title));
    const pool = named.length ? named : g;
    const primary = [...pool].sort((a, b) => [...a.path].length - [...b.path].length || byCode(a.path, b.path))[0];
    for (const o of g) if (o !== primary) copies.add(o.path);
  }
  const out = new Map<string, Obj[]>();
  for (const o of ctx.objs) {
    if (copies.has(o.path)) continue;
    const k = low(o.title.trim());
    out.set(k, [...(out.get(k) ?? []), o]);
  }
  return out;
}
function backlinkCount(ctx: Ctx, path: string): number {
  let n = 0;
  for (const o of ctx.objs) if (o.path !== path && (ctx.res.get(o.path) ?? []).some((r) => r.path === path)) n++;
  return n;
}
function duplicates(ctx: Ctx) {
  const out: any[] = [];
  for (const [key, objs] of titleGroups(ctx)) {
    if (objs.length < 2) continue;
    const sorted = [...objs].sort((a, b) => byInstant(instant(a.attributes.created ?? null), instant(b.attributes.created ?? null), false) || byCode(a.path, b.path));
    const sp = new Map<string, number>();
    for (const o of sorted) sp.set(nfc(o.title.trim()), (sp.get(nfc(o.title.trim())) ?? 0) + 1);
    out.push({ key, label: mostFrequent(sp) ?? key, objects: sorted.map((o) => ({ path: o.path, title: o.title, type: o.type, folder: o.folder, details: details(ctx, o), backlinks: backlinkCount(ctx, o.path) })) });
  }
  return out.sort((a, b) => b.objects.length - a.objects.length || byCode(a.label, b.label));
}

const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

/** 4F (ms4-embeds §4, §8): the targets `linkTargets` (read/ReadView.tsx) sends for a note text, in order. */
async function linkTargets(text: string): Promise<string[]> {
  const d = await doc();
  const out: string[] = [];
  const attachment = (x: string) => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(x); return !!m && m[1].toLowerCase() !== 'md' && !/^\d{4}-\d{2}-\d{2}$/.test(x); };
  const add = (x: string) => { if (x !== '' && !attachment(x) && !out.includes(x)) out.push(x); };
  const parsed = d.parse(text);
  for (const l of d.wikilinks(parsed)) add(String(l.target).trim());
  const walk = (n: any) => {
    if (n.type === 'link') {
      const url = String(n.url ?? '');
      if (url && !url.startsWith('#') && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) && !url.startsWith('//')) {
        let path = url.split('#')[0];
        try { path = decodeURIComponent(path); } catch { /* keep */ }
        if (path) add(path);
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(d.markdownTree(text.slice(parsed.bodyStart)));
  return out;
}

export async function handle(cmd: string, a: any, files: Files, vers: Record<string, VersionDto>): Promise<Answer> {
  if (cmd === 'link_targets') return { result: await linkTargets(String(a.text ?? '')) };
  const ctx = await context(files, vers);
  if (cmd.startsWith('daily_')) return daily(cmd, a, files, ctx);
  switch (cmd) {
    case 'index_backlinks': return { result: await backlinksPanel(ctx, String(a.path)) };
    case 'backlinks': {
      const p = await backlinksPanel(ctx, String(a.path));
      return { result: p.groups.flatMap((g: any) => g.entries.map((e: any) => e.source)).sort(byCode) };
    }
    case 'index_broken_links': return { result: await brokenLinks(files, ctx) };
    case 'index_duplicate_titles': return { result: duplicates(ctx) };
    case 'link_create_plan': return { result: plan(files, ctx, String(a.from ?? ''), String(a.target ?? ''), (a.relationTo ?? null) as string[] | null) };
    case 'link_create': {
      const from = String(a.from ?? ''), target = String(a.target ?? ''), expect = a.expect;
      if (expect?.state === 'create' && files[nfc(expect.path)] !== undefined) return { error: err('Exists', 'fake: the file appeared', { path: nfc(expect.path) }) };
      // 5B (FR-VLT-05 AC-3, D-550): a type picked in the offer's `Type` control is planned again with that type, as the
      // core does for any type a capture can make.
      const picked = expect?.state === 'create' && typeof a.asType === 'string' && a.asType === expect.type && !['daily-note', 'tag', 'image', 'pdf'].includes(String(expect.type));
      const typed = expect?.state === 'create' && (relationAllows(ctx, from, target, expect.type) || picked) ? plan(files, ctx, from, target, [expect.type]) : plan(files, ctx, from, target, null);
      const now = same(typed, expect) ? typed : plan(files, ctx, from, target, null);
      if (now.state === 'exists') return { error: err('Exists', 'fake: exists now', { path: now.path }) };
      if (!same(now, expect) || now.state !== 'create') return { error: err('PlanChanged', 'fake: the plan changed', { now }) };
      return { result: { path: now.path, rewrite: now.rewrite }, writes: { [now.path]: String(a.text) } };
    }
    case 'switcher_duplicates': {
      // Adds `duplicate` details to switcher items (D-289).
      const groups = titleGroups(ctx);
      const items = (a.items as any[]).map((it) => {
        if (it.kind !== 'object') return { ...it, duplicate: null };
        const g = groups.get(low(String(it.title).trim()));
        const o = g && g.length > 1 ? g.find((x) => x.path === it.path) : undefined;
        return { ...it, duplicate: o ? details(ctx, o) : null };
      });
      return { result: items };
    }
    case 'free_stem': return { result: freeStem(files, ctx, String(a.folder ?? ''), String(a.stem ?? '')) };
    default: return { error: err('Io', `fake-links: unknown ${cmd}`) };
  }
}
