// Fake core, slice 4E-1 (docs/contracts/ms4-jobs.md §14, §11). Test code, not product code. Runs in Node with the
// real `@tegg/doc` and the fake's type files (fake-schema.ts): R101 (`type_move_plan`), the folder preview, and the
// `type-move` / `folder-move` plans in the core's shape (the moved notes with their ops, then the linking notes whose
// text a retarget op really changes). The in-page part of fake-core.ts runs the plan (progress, hold, zip, undo).
import { listTypes, type Files } from './fake-schema';

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).trim().toLowerCase();
let docMod: any = null;
const doc = async () => (docMod ??= await import('@tegg/doc'));

const stemOf = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '');
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const join = (folder: string, stem: string) => (folder ? `${folder}/${stem}.md` : `${stem}.md`);
const excluded = (p: string) => /^(_templates|\.trash)\//i.test(nfc(p));
const notePaths = (files: Files) => Object.keys(files).filter((p) => p.endsWith('.md') && !p.split('/').some((s) => s.startsWith('.')));
/** Board G: their paths mean something; never moved. */
const FIXED = ['daily-note', 'tag', 'image', 'pdf'];
const typeKey = (s: string) => low(s).replace(/\s+/g, '-');
const inside = (p: string, folder: string) => { const f = low(folder.replace(/^\/+|\/+$/g, '')); return !f || low(p).startsWith(`${f}/`); };

/** The written `type` of a note (D-239 key), or null for an untyped file (FR-TYP-10). */
function typeOf(text: string | undefined): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '');
  const m = fm && /^type:[ \t]*(.+?)[ \t]*$/m.exec(fm[1]);
  if (!m) return null;
  const v = m[1].replace(/^["']|["']$/g, '');
  return v.trim() ? typeKey(v) : null;
}
const idOf = (text: string | undefined) => /^id:[ \t]*(\S+)/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '')?.[1] ?? '')?.[1] ?? null;

/** Board E2 (D-808): every value of `a` stays valid as written under `b`. */
function widens(a: any, b: any): boolean {
  if (a.type === b.type) {
    if (a.type !== 'relation') return true;
    if (!b.to) return true;
    if (!a.to) return false;
    return a.to.every((k: string) => b.to.some((x: string) => typeKey(x) === typeKey(k)));
  }
  const toText = ['number', 'checkbox', 'date', 'date-time', 'url', 'email', 'select', 'multi-select', 'relation'];
  if ((b.type === 'text' || b.type === 'long-text') && (toText.includes(a.type) || a.type === 'text' || a.type === 'long-text')) return true;
  return (a.type === 'date' && b.type === 'date-time') || (a.type === 'select' && b.type === 'multi-select');
}

function shown(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) { const xs = v.map(shown).filter((x): x is string => x !== null); return xs.length ? xs.join(', ') : null; }
  const s = String(v);
  return s.trim() ? s : null;
}

export async function handle(cmd: string, a: any, files: Files): Promise<any> {
  const d = await doc();
  const types = listTypes(files, {});
  const typeDef = (k: string) => types.find((t) => t.key === typeKey(k) && !t.invalid) ?? null;
  const notes = notePaths(files);

  /** A moved note's path at the folder's root: its stem, unless a note in that folder has it (then the free stem). */
  const target = (p: string, folder: string, taken: Set<string>) => {
    const stem = stemOf(p);
    const inFolder = (s: string) => notes.some((n) => low(n) !== low(p) && low(folderOf(n)) === low(folder) && low(stemOf(n)) === low(s)) || taken.has(low(join(folder, s)));
    if (!inFolder(stem)) return join(folder, stem);
    const all = new Set(notes.filter((n) => !excluded(n)).map((n) => low(stemOf(n))));
    let s = stem;
    for (let n = 2; all.has(low(s)) || inFolder(s); n++) s = `${stem} (${n})`;
    return join(folder, s);
  };
  /** Linking notes: those whose text a retarget op for one of the moves really changes. */
  const linking = (moves: [string, string][], movedSet: Set<string>) => {
    const out: Record<string, any[]> = {};
    for (const [from, to] of moves) {
      const title = nfc(String(d.extract(files[from], stemOf(from)).title ?? stemOf(from)));
      const op = { op: 'retarget-links', fromPath: from, fromStem: stemOf(from), fromTitle: title, toPath: to, toStem: stemOf(to), toTitle: title, paths: notes };
      const needle = low(stemOf(from));
      for (const p of notes) {
        if (p === from || movedSet.has(p) || p.startsWith('.trash/')) continue;
        const text = low(files[p] ?? '');
        if (!text.includes(needle) && !text.includes(low(encodeURIComponent(stemOf(from))))) continue; // can't link to it
        if (d.transform(p, files[p], [op]).kind === 'bytes') (out[p] ??= []).push(op);
      }
    }
    return Object.entries(out).sort(([x], [y]) => (x < y ? -1 : 1)).map(([path, ops]) => ({ path, ops }));
  };

  if (cmd === 'type_move_plan') {
    const paths = (a.paths as string[]).map(nfc);
    const from = typeOf(files[paths[0]]) ?? 'page';
    const old = typeDef(from)?.attributes ?? [];
    const nu = typeDef(a.toType)?.attributes ?? [];
    const targetNames: Record<string, string> = {};
    let needsDialog = false;
    const rows = old.map((p: any) => {
      const value = paths.map((x) => shown((d.extract(files[x] ?? '', stemOf(x)).attributes ?? {})[p.key])).find((v) => v !== null) ?? null;
      const same = nu.find((n: any) => nfc(n.key) === nfc(p.key));
      const offered = nu.filter((n: any) => widens(p, n));
      for (const n of offered) targetNames[n.key] = n.name;
      let def = 'content', fixed = false;
      if (same && widens(p, same)) { def = same.key; fixed = same.type === p.type; }
      if (value !== null && !fixed) needsDialog = true;
      return { from: p.key, name: p.name, kind: p.type, value, default: def, offered: offered.map((n: any) => n.key).filter((k: string) => !(fixed && k === def)), fixed };
    });
    if (rows.every((r: any) => r.default !== 'content')) needsDialog = false;
    return { rows, needsDialog, targetNames };
  }

  if (cmd === 'folder_preview') {
    const k = typeKey(a.type);
    return { count: notes.filter((p) => !excluded(p) && typeOf(files[p]) === k && !inside(p, a.folder)).length };
  }

  if (cmd === 'plan_type_move') {
    const to = typeKey(a.toType);
    const def = typeDef(to);
    if (FIXED.includes(to)) return { error: { kind: 'NotMovable', message: 'fake: not a target' } };
    if (!def) return { error: { kind: 'UnknownType', message: 'fake: no such type' } };
    const paths = [...new Set((a.paths as string[]).map(nfc))].sort();
    for (const p of paths) {
      const t = typeOf(files[p]);
      if (p.startsWith('.trash/') || (t && FIXED.includes(t))) return { error: { kind: 'NotMovable', message: 'fake: not movable' } };
    }
    if (paths.every((p) => typeOf(files[p]) === to)) return { error: { kind: 'NoChange', message: 'fake: same type' } };
    const folder = nfc(String(def.folder ?? '')).replace(/^\/+|\/+$/g, '');
    const taken = new Set<string>();
    const out: any[] = [];
    const moves: [string, string][] = [];
    for (const p of paths) {
      if (excluded(p)) { out.push({ path: p, to: null, ops: [{ op: 'change-type', type: to, now: null }] }); continue; }
      const schema = typeDef(typeOf(files[p]) ?? 'page')?.attributes ?? [];
      const order = (k: string) => { const i = schema.findIndex((s: any) => nfc(s.key) === nfc(k)); return i < 0 ? 1e9 : i; };
      const map = (a.mapping as { from: string; to: string }[]).filter((m) => !schema.length || order(m.from) < 1e9).sort((x, y) => order(x.from) - order(y.from));
      const ops: any[] = [];
      if (map.length) ops.push({ op: 'map-properties', map, labels: Object.fromEntries(schema.map((s: any) => [s.key, s.name])) });
      const id = /^id:/m.test(/^---\r?\n([\s\S]*?)\r?\n---/.exec(files[p] ?? '')?.[1] ?? '') ? undefined : `01JB4E${Date.now().toString(36).toUpperCase().padStart(10, '0')}${Math.random().toString(36).slice(2, 12).toUpperCase()}`.slice(0, 26);
      ops.push({ op: 'change-type', type: to, now: a.now, ...(id ? { id } : {}) });
      if (a.review) ops.push({ op: 'set-review', value: 'reviewed', now: a.now });
      let dest: string | null = null;
      if (folder && !inside(p, folder)) {
        dest = target(p, folder, taken);
        taken.add(low(dest));
        ops.push({ op: 'keep-targets', fromPath: p, toPath: dest, paths: notes });
        moves.push([p, dest]);
      }
      out.push({ path: p, to: dest, ops });
    }
    return { kind: 'type-move', notes: out, linking: linking(moves, new Set(paths)), label: { key: 'backups.label.typeMove', args: { count: Math.max(1, moves.length), type: def.name } } };
  }

  if (cmd === 'plan_folder_move') {
    const exempt = new Set<string>(a.exempt ?? []);
    const which = a.type ? [typeKey(a.type)] : types.filter((t) => !t.invalid && !FIXED.includes(t.key)).map((t) => t.key);
    const taken = new Set<string>();
    const out: any[] = [];
    const moves: [string, string][] = [];
    for (const k of which) {
      const folder = nfc(String(a.type && a.folder ? a.folder : typeDef(k)?.folder ?? '')).replace(/^\/+|\/+$/g, '');
      if (!folder) continue;
      for (const p of notes.filter((n) => typeOf(files[n]) === k).sort()) {
        if (excluded(p) || inside(p, folder)) continue;
        if (!a.type && exempt.has(idOf(files[p]) ?? '')) continue;
        const dest = target(p, folder, taken);
        taken.add(low(dest));
        out.push({ path: p, to: dest, ops: [{ op: 'keep-targets', fromPath: p, toPath: dest, paths: notes }] });
        moves.push([p, dest]);
      }
    }
    const def = a.type ? typeDef(a.type) : null;
    const label = a.type ? { key: 'backups.label.folderMove', args: { plural: low(def?.plural ?? a.type), folder: a.folder } } : { key: 'backups.label.tidy', args: {} };
    return { kind: 'folder-move', notes: out, linking: linking(moves, new Set(out.map((x) => x.path))), label, ids: Object.fromEntries(out.map((x) => [x.path, idOf(files[x.path])])) };
  }
  return { error: { kind: 'Unknown', message: `fake-moves: unknown ${cmd}` } };
}
