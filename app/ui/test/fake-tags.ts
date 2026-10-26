// Fake core, MS4 slice 4D-lite (docs/contracts/ms4-tags.md §8.1): the TS twin of the core's tag rules (§1) and the
// planners of the tag jobs and merge (§4.1) over the fake's in-memory vault. Test code, not product code. Runs in Node
// so every extraction and byte change comes from the real `@tegg/doc` (`parse`, `tags`, `extract`, `tagName`,
// `transform`, D-82); the in-page part of fake-core.ts runs the jobs (progress, confirm, backup, hold, skips, live
// editors, restore). Checked against R80 by app/test/fake_tags.contract.test.ts.
import type { VersionDto } from './fake-core';

type Files = Record<string, string>;
type Vers = Record<string, VersionDto>;

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
/** The eight R14 colour tokens (D-236, D-707). */
export const TOKENS = ['gray', 'blue', 'green', 'orange', 'purple', 'red', 'teal', 'yellow'];
let docMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));

const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
/** Indexed objects: `.md` outside `_templates/` and dot-folders (`.trash/`, `.tegg/`). */
export const indexed = (p: string) => /\.md$/i.test(p) && !p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));
export const isTemplate = (p: string) => /\.md$/i.test(p) && p.startsWith('_templates/');
/** NFC, UTF-8 byte order (D-694 "path order"). */
export const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(nfc(a)), Buffer.from(nfc(b)));
const byCodePoint = (a: string, b: string) => {
  const x = [...a].map((c) => c.codePointAt(0)!), y = [...b].map((c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
/** ns since the epoch of a valid ISO instant (D-60), as a bigint; null otherwise. */
export function instantNs(v: string | null): bigint | null {
  if (!v || !ISO.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : BigInt(ms) * 1_000_000n;
}
/** A frontmatter value as written (trimmed, quotes removed), from the raw frontmatter lines. */
function raw(text: string, key: string): string | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([^:\s][^:]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (kv && nfc(kv[1]) === key) return kv[2] === '' ? null : kv[2].replace(/^"(.*)"$|^'(.*)'$/, '$1$2');
  }
  return null;
}
const str = (v: unknown): string | null => (typeof v === 'string' ? nfc(v).trim() : null);

export type TagObj = {
  path: string; id: string | null; title: string; type: string; stem: string;
  fm: Record<string, unknown> | null; text: string;
  occ: { name: string; key: string }[];
  modified: string | null; modifiedNs: bigint | null; created: bigint | null;
};

export function objectsOf(files: Files, d: any, filter: (p: string) => boolean = indexed): TagObj[] {
  return Object.keys(files).filter(filter).sort(byBytes).map((path) => {
    const text = files[path];
    const stem = nfc(stemOf(path));
    const parsed = d.parse(text);
    const fm = (parsed.frontmatter && !parsed.frontmatter.error ? parsed.frontmatter.data : null) as Record<string, unknown> | null;
    const x = d.extract(text, stem);
    const type = d.typeMatch(fm && 'type' in fm ? fm.type : undefined).key as string;
    const occ = (d.tags(parsed) as { name: string; key: string }[]).map((t) => ({ name: nfc(t.name), key: t.key }));
    const modified = raw(text, 'modified');
    return {
      path: nfc(path), id: x.id ?? null, title: nfc(String(x.title ?? stem)), type, stem, fm, text, occ,
      modified, modifiedNs: instantNs(modified), created: instantNs(raw(text, 'created')),
    };
  });
}

/** The Tag type's folder (`.tegg/types/tag.yml` `folder:`, D-719). */
export function tagFolder(files: Files): string {
  const y = files['.tegg/types/tag.yml'] ?? '';
  const m = /^folder:\s*(.+?)\s*$/m.exec(y);
  return m ? nfc(m[1].replace(/^["']|["']$/g, '')) : 'Tags';
}

export type TagFileInfo = { path: string; key: string; title: string; colorRaw: string | null; created: bigint | null };

/** §1.1: Tag files per key, winner first (oldest valid `created`, then path order). */
export function tagFiles(objs: TagObj[], d: any): Map<string, TagFileInfo[]> {
  const out = new Map<string, TagFileInfo[]>();
  for (const o of objs) {
    if (o.type !== 'tag') continue;
    const t = o.fm && typeof o.fm.title === 'string' && o.fm.title.trim() !== '' ? nfc(o.fm.title.trim()) : null;
    const title = t ?? o.stem;
    const key = d.tagKey(title) as string;
    const c = o.fm ? o.fm.color : undefined;
    const colorRaw = typeof c === 'string' && c.trim() !== '' ? c.trim() : null;
    (out.get(key) ?? out.set(key, []).get(key)!).push({ path: o.path, key, title, colorRaw, created: o.created });
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.created === null ? 1 : 0) - (b.created === null ? 1 : 0)
      || (a.created !== null && b.created !== null && a.created !== b.created ? (a.created < b.created ? -1 : 1) : 0)
      || byBytes(a.path, b.path));
  }
  return out;
}

export type TagRowDto = {
  key: string; name: string; file: { path: string; version: VersionDto } | null; losers: string[];
  color: string | null; colorRaw: string | null; count: number; lastUsed: string | null; lastUsedNs: string | null;
};

export function rowsOf(files: Files, vers: Vers, d: any): TagRowDto[] {
  const objs = objectsOf(files, d);
  const tf = tagFiles(objs, d);
  const keys = new Set<string>([...tf.keys()]);
  const byKey = new Map<string, TagObj[]>();
  const spell = new Map<string, Map<string, number>>();
  for (const o of objs) {
    const seen = new Set<string>();
    for (const t of o.occ) {
      const m = spell.get(t.key) ?? spell.set(t.key, new Map()).get(t.key)!;
      m.set(t.name, (m.get(t.name) ?? 0) + 1);
      if (!seen.has(t.key)) { seen.add(t.key); (byKey.get(t.key) ?? byKey.set(t.key, []).get(t.key)!).push(o); }
      keys.add(t.key);
    }
  }
  return [...keys].sort(byCodePoint).map((key) => {
    const with_ = byKey.get(key) ?? [];
    const files_ = tf.get(key) ?? [];
    const win = files_[0] ?? null;
    const sp = [...(spell.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]));
    let last: TagObj | null = null;
    for (const o of with_) if (o.modifiedNs !== null && (last === null || o.modifiedNs > last.modifiedNs!)) last = o;
    return {
      key,
      name: win ? win.title : (sp[0]?.[0] ?? key),
      file: win ? { path: win.path, version: vers[win.path] ?? { mtimeNs: '0', size: 0, hash: '' } } : null,
      losers: files_.slice(1).map((f) => f.path),
      color: win && win.colorRaw && TOKENS.includes(win.colorRaw) ? win.colorRaw : null,
      colorRaw: win ? win.colorRaw : null,
      count: with_.length,
      lastUsed: last ? last.modified : null,
      lastUsedNs: last ? String(last.modifiedNs) : null,
    };
  });
}

export function objectRows(files: Files, key: string, d: any) {
  const k = d.tagKey(String(key)) as string;
  return objectsOf(files, d).filter((o) => o.occ.some((t) => t.key === k)).map((o) => {
    const others: string[] = [];
    for (const t of o.occ) if (t.key !== k && !others.includes(t.key)) others.push(t.key);
    const f = (n: string) => (o.fm ? str(o.fm[n]) ?? (o.fm[n] != null && typeof o.fm[n] !== 'object' ? String(o.fm[n]) : null) : null);
    return {
      path: o.path, id: o.id, title: o.type === 'daily-note' ? (str(o.fm?.date) ?? o.title).slice(0, 10) : o.title, type: o.type,
      modified: o.modified, modifiedNs: o.modifiedNs === null ? null : String(o.modifiedNs),
      tags: others, review: f('review'), status: f('status'), due: raw(o.text, 'due'), completed: raw(o.text, 'completed'),
    };
  });
}

/** D-51, D-52 (as the fake's `note_create`): forbidden characters as a space, runs of spaces as one. */
export const sanitize = (t: string) => nfc(t).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim();
/** ≤ 200 UTF-8 bytes, cut at a character boundary (NFR-POR-02). */
export function cut200(s: string): string {
  let out = '';
  for (const ch of s) { if (Buffer.byteLength(out + ch) > 200) break; out += ch; }
  return out.trimEnd();
}
/** A free stem vault-wide (D-291, FR-LNK-14 AC-10): no indexed object and no file in `folder` has it (`own` is free). */
export function freeStem(files: Files, folder: string, stem: string, own: string | null = null): string {
  const taken = new Set(Object.keys(files).filter((p) => /\.md$/i.test(p) && (indexed(p) || folderOf(p) === folder) && p !== own).map((p) => low(stemOf(p))));
  for (let n = 1; ; n++) {
    const c = n === 1 ? stem : `${stem} (${n})`;
    if (!taken.has(low(c))) return c;
  }
}

type Err = { kind: string; message: string; [k: string]: unknown };
const e = (kind: string, message: string, more: Record<string, unknown> = {}): Err => ({ kind, message, ...more });

export type PlannedFile = { path: string; ops: any[]; template?: boolean; rename?: { to: string }; text: string };
export type TagPlan = {
  kind: 'tag-rename' | 'tag-delete' | 'merge';
  files: PlannedFile[]; trashes: string[]; renames: { from: string; to: string }[];
  warnings: { kind: 'duplicateTagFile'; path: string }[]; conflicts: { key: string; kept: string; others: string[] }[];
  label: { key: string; args: Record<string, string | number> }; notes: number; templates: number;
  /** merge: the kept and merged files with their planned text (checked before any write, D-727). */
  check?: string[]; tag?: string; to?: string;
};

function retargetOp(files: Files, from: string, toPath: string, fromTitle: string, toTitle: string) {
  const paths = Object.keys(files).filter((p) => /\.md$/i.test(p) && !p.split('/').some((s) => s.startsWith('.')));
  return { op: 'retarget-links', fromPath: from, fromStem: stemOf(from), fromTitle, toPath, toStem: stemOf(toPath), toTitle, paths };
}
function linkingTo(files: Files, d: any, op: any, except: string[]): string[] {
  return Object.keys(files).filter((p) => /\.md$/i.test(p) && !p.startsWith('.') && !except.includes(p) && d.transform(p, files[p], [op]).kind === 'bytes').sort(byBytes);
}

export async function handle(cmd: string, a: any, files: Files, vers: Vers): Promise<{ result?: unknown; error?: Err }> {
  const d = await doc();
  const rows = () => rowsOf(files, vers, d);
  switch (cmd) {
    case 'index_tags': return { result: rows() };
    case 'tag_objects': return { result: objectRows(files, String(a.key ?? ''), d) };
    // §1.6 (D-784): distinct indexed objects with any occurrence (All tags' `<m> tagged objects`, D-721).
    case 'index_tagged_objects': return { result: objectsOf(files, d).filter((o) => o.occ.length > 0).length };
    // Fake-internal (AP-684, D-746): the paths whose tag keys (frontmatter and inline, NFC lower case) include every key.
    case 'search_tag_paths': {
      const keys = ((a.keys ?? []) as unknown[]).map((k) => d.tagKey(String(k)) as string);
      return { result: objectsOf(files, d).filter((o) => keys.every((k) => o.occ.some((t) => t.key === k))).map((o) => o.path) };
    }
    case 'tag_usage': {
      const k = d.tagKey(String(a.key ?? ''));
      const row = rows().find((r) => r.key === k);
      const templates = objectsOf(files, d, isTemplate).filter((o) => o.occ.some((t) => t.key === k)).length;
      return { result: { notes: row?.count ?? 0, templates, file: row?.file?.path ?? null, losers: row?.losers ?? [] } };
    }
    case 'tag_new_path': {
      const folder = tagFolder(files);
      return { result: { path: `${folder}/${freeStem(files, folder, cut200(sanitize(String(a.name ?? ''))))}.md` } };
    }
    case 'capture_tags':
      return { result: rows().filter((r) => r.count >= 1 || r.file).map((r) => ({ name: r.name, color: r.color })) };
    case 'plan_tag_rename': {
      const all = rows();
      const from = all.find((r) => r.key === d.tagKey(String(a.from ?? '')));
      if (!from) return { error: e('NotFound', `fake: no tag ${a.from}`) };
      const tn = d.tagName(String(a.to ?? ''));
      if (!tn.ok) return { error: e('InvalidName', `fake: ${tn.error}`, { error: tn.error, char: tn.char ?? null }) };
      if (tn.name === from.name) return { result: { noop: true } };
      const other = all.find((r) => r.key === tn.key && r.key !== from.key);
      if (other) return { error: e('TagExists', `fake: #${other.name} exists`, { name: other.name }) };
      const plan: TagPlan = {
        kind: 'tag-rename', files: [], trashes: [], renames: [], conflicts: [], notes: from.count, templates: 0,
        warnings: from.losers.map((path) => ({ kind: 'duplicateTagFile' as const, path })),
        label: { key: 'backups.label.tagRename', args: { from: from.name, to: tn.name } }, tag: from.key, to: tn.name,
      };
      const op = { op: 'rename-tag', key: from.key, to: tn.name };
      for (const o of objectsOf(files, d)) if (o.occ.some((t) => t.key === from.key)) plan.files.push({ path: o.path, ops: [op], text: o.text });
      for (const o of objectsOf(files, d, isTemplate)) if (o.occ.some((t) => t.key === from.key)) { plan.files.push({ path: o.path, ops: [op], template: true, text: o.text }); plan.templates++; }
      if (from.file) {
        const p = from.file.path;
        const folder = folderOf(p);
        const toPath = `${folder ? `${folder}/` : ''}${freeStem(files, folder, cut200(sanitize(tn.name)), p)}.md`;
        const now = String(a.now ?? new Date().toISOString());
        const own: any[] = [{ op: 'set-title', title: tn.name, now }];
        const f: PlannedFile = { path: p, ops: own, text: files[p] };
        if (toPath !== p) {
          f.rename = { to: toPath };
          plan.renames.push({ from: p, to: toPath });
          const rt = retargetOp(files, p, toPath, from.name, tn.name);
          for (const l of linkingTo(files, d, rt, [p])) {
            const have = plan.files.find((x) => x.path === l);
            if (have) have.ops.push(rt); else plan.files.push({ path: l, ops: [rt], text: files[l] });
          }
        }
        plan.files.push(f);
      }
      return { result: plan };
    }
    case 'plan_tag_delete': {
      const row = rows().find((r) => r.key === d.tagKey(String(a.key ?? '')));
      if (!row) return { error: e('NotFound', `fake: no tag ${a.key}`) };
      const op = { op: 'remove-tag', key: row.key };
      const plan: TagPlan = {
        kind: 'tag-delete', files: [], trashes: row.file ? [row.file.path] : [], renames: [], conflicts: [], notes: row.count, templates: 0,
        warnings: row.losers.map((path) => ({ kind: 'duplicateTagFile' as const, path })),
        label: { key: 'backups.label.tagDelete', args: { tag: row.name, count: row.count } }, tag: row.key,
      };
      for (const o of objectsOf(files, d)) if (o.occ.some((t) => t.key === row.key)) plan.files.push({ path: o.path, ops: [op], text: o.text });
      for (const o of objectsOf(files, d, isTemplate)) if (o.occ.some((t) => t.key === row.key)) { plan.files.push({ path: o.path, ops: [op], template: true, text: o.text }); plan.templates++; }
      return { result: plan };
    }
    case 'plan_merge': {
      const objs = objectsOf(files, d);
      const keep = objs.find((o) => o.path === nfc(String(a.keep ?? '')));
      const others = ((a.others ?? []) as string[]).map((p) => objs.find((o) => o.path === nfc(String(p))));
      if (!keep || !others.length || others.some((o) => !o || low(o.title) !== low(keep.title))) return { error: e('NotFound', 'fake: not one same-title group (D-290)') };
      const os = (others as TagObj[]).slice().sort((x, y) => (x.created ?? 0n) < (y.created ?? 0n) ? -1 : (x.created ?? 0n) > (y.created ?? 0n) ? 1 : byBytes(x.path, y.path));
      const now = String(a.now ?? new Date().toISOString());
      const plan: TagPlan = {
        kind: 'merge', files: [{ path: keep.path, ops: [{ op: 'merge-into', others: os.map((o) => ({ path: o.path, title: o.title, text: o.text })), now }], text: keep.text }],
        trashes: os.map((o) => o.path), renames: [], warnings: [], conflicts: [], notes: 1 + os.length, templates: 0,
        label: { key: 'backups.label.merge', args: { count: 1 + os.length, title: keep.title } }, check: [keep.path, ...os.map((o) => o.path)],
      };
      const skip = new Set(['id', 'type', 'title', 'created', 'modified', 'tags', 'aliases']);
      for (const o of os) {
        for (const [k, v] of Object.entries(o.fm ?? {})) {
          if (skip.has(k) || !keep.fm || !(k in keep.fm)) continue;
          const kv = JSON.stringify(keep.fm[k]), ov = JSON.stringify(v);
          if (kv === ov) continue;
          const val = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));
          const c = plan.conflicts.find((x) => x.key === k) ?? (plan.conflicts.push({ key: k, kept: val(keep.fm[k]), others: [] }), plan.conflicts[plan.conflicts.length - 1]);
          c.others.push(val(v));
        }
        const rt = retargetOp(files, o.path, keep.path, o.title, keep.title);
        for (const l of linkingTo(files, d, rt, [o.path, keep.path])) {
          const have = plan.files.find((x) => x.path === l);
          if (have) have.ops.push(rt); else plan.files.push({ path: l, ops: [rt], text: files[l] });
        }
      }
      return { result: plan };
    }
    case 'transform': {
      const r = d.transform(String(a.source), String(a.text), a.ops);
      return { result: r.kind === 'bytes' ? r.text : null };
    }
    default: return { error: e('Io', `fake-tags: unknown ${cmd}`) };
  }
}
