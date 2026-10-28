// Fake core, slice 6A (docs/contracts/ms6-trash-media.md §1.2…§1.4, §9.2): the TS twin of the core's trash rules over
// the fake's in-memory vault paths. Test code, not product code. Pure: it gets every vault path (text and binary
// files), a reader for `.md` texts and the trash times, and returns rows or the renames to apply; the in-page fake
// applies them (fake-core.ts `__teggTrash`). Also used by the L1 test app/test/trash_order.ac.test.ts.

const nfc = (s: string) => s.normalize('NFC');
const low = (s: string) => nfc(s).toLowerCase();
const TRASH = '.trash/';
/** System folders that are never a folder row while their type exists live (§1.2). */
const SYSTEM_FOLDERS = ['Pages', 'Tasks', 'Quick Notes', 'Daily', 'Tags', 'Images', 'PDFs', '_attachments'];
const MEDIA_TYPES = ['image', 'pdf'];

export type TrashKind = 'object' | 'file' | 'folder';
export type TrashRow = {
  path: string; kind: TrashKind; original: string; folder: string; title: string; type: string | null;
  files: string[]; count: number; trashedAt: string;
};
export type Moved = { from: string; to: string };
export type TrashInput = {
  /** Every vault path (NFC), text and binary. */
  paths: string[];
  /** The text of a `.md` path, or undefined. */
  text: (path: string) => string | undefined;
  /** ISO trash time of a trashed path (row path), if the fake knows one. */
  trashedAt: (path: string) => string | undefined;
  /** Folders of the vault's live types (`.tegg/types/*.yml` `folder:`). */
  typeFolders: string[];
};
export type TrashError = { kind: string; message: string };

/** The fallback trash time of the fake (§9.2). */
export const DEFAULT_TRASHED_AT = '2026-10-01T00:00:00+02:00';

function front(text: string): Record<string, string> {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const typeKey = (raw: string | undefined) => {
  if (raw === undefined) return 'page';
  const v = nfc(raw).trim();
  if (v === '' || v.startsWith('[') || /^-?\d+(\.\d+)?$/.test(v)) return 'page';
  return v.toLowerCase().replace(/\s+/g, '-');
};
const stemOf = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const byPath = (a: string, b: string) => {
  const x = low(a), y = low(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
const isMd = (p: string) => /\.md$/i.test(p);

/** The `[[…]]` link target of a `file:` value, without alias and subpath. */
export function fileTarget(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /\[\[([^\]|#]+)/.exec(raw);
  return m ? nfc(m[1].trim()) : null;
}

/** §3.2: a media target (a file name or path) among `candidates` (vault paths), from the folder `fromDir`: exact path
 *  (case-insensitive) first, then that name in `fromDir`, then the shortest path with that name (then path order). */
export function resolveMediaAmong(candidates: string[], target: string, fromDir: string): string | null {
  const t = low(target.trim());
  const exact = candidates.find((p) => low(p) === t);
  if (exact) return exact;
  const name = t.split('/').pop()!;
  const same = candidates.filter((p) => low(p.split('/').pop()!) === name);
  const local = same.find((p) => low(parentOf(p)) === low(fromDir));
  if (local) return local;
  return [...same].sort((a, b) => [...a].length - [...b].length || byPath(a, b))[0] ?? null;
}

const live = (p: string) => !p.startsWith(TRASH) && !p.startsWith('_templates/') && !p.startsWith('.tegg/');

/** §1.3: the vault path of the file an Image/PDF object's `file:` links to (trashed objects: `.trash/` first). */
export function pairOf(input: TrashInput, objectPath: string): string | null {
  const text = input.text(objectPath);
  if (text === undefined) return null;
  const f = front(text);
  if (!MEDIA_TYPES.includes(typeKey(f.type))) return null;
  const target = fileTarget(f.file);
  if (!target) return null;
  const files = input.paths.filter((p) => !isMd(p));
  if (objectPath.startsWith(TRASH)) {
    const inTrash = files.filter((p) => p.startsWith(TRASH)).map((p) => p.slice(TRASH.length));
    const hit = resolveMediaAmong(inTrash, target, parentOf(objectPath.slice(TRASH.length)));
    if (hit) return TRASH + hit;
  }
  return resolveMediaAmong(files.filter(live), target, parentOf(objectPath.startsWith(TRASH) ? objectPath.slice(TRASH.length) : objectPath));
}

/** §1.3: another live object (not in `_templates/` or `.trash/`) uses the same file. */
export function sharedPair(input: TrashInput, objectPath: string, pair: string): boolean {
  return input.paths.some((p) => p !== objectPath && isMd(p) && live(p) && pairOf(input, p) === pair);
}

/** §1.2: the Trash page's rows, newest first (R71), then path (NFC, case-insensitive). */
export function trashRows(input: TrashInput): TrashRow[] {
  // D-851: `.trash/.tegg/` (a deleted type's definition) is never a row.
  const inTrash = input.paths.filter((p) => p.startsWith(TRASH) && !p.startsWith(`${TRASH}.tegg/`)).sort(byPath);
  const keep = new Set([...SYSTEM_FOLDERS, ...input.typeFolders].map(low));
  const folderRows = new Set<string>();
  for (const p of inTrash) {
    const rest = p.slice(TRASH.length);
    if (!rest.includes('/')) continue;
    const top = rest.split('/')[0];
    if (!keep.has(low(top))) folderRows.add(top);
  }
  const inFolder = (p: string) => folderRows.has(p.slice(TRASH.length).split('/')[0]) && p.slice(TRASH.length).includes('/');
  const rows: TrashRow[] = [];
  const paired = new Set<string>();
  const at = (p: string) => input.trashedAt(p) ?? DEFAULT_TRASHED_AT;
  for (const p of inTrash.filter((x) => isMd(x) && !inFolder(x))) {
    const f = front(input.text(p) ?? '');
    const pair = pairOf(input, p);
    const files = [p];
    if (pair && pair.startsWith(TRASH)) { files.push(pair); paired.add(pair); }
    const original = p.slice(TRASH.length);
    rows.push({ path: p, kind: 'object', original, folder: parentOf(original), title: f.title ? nfc(f.title) : stemOf(p), type: typeKey(f.type), files, count: 1, trashedAt: at(p) });
  }
  for (const p of inTrash.filter((x) => !isMd(x) && !inFolder(x) && !paired.has(x))) {
    const original = p.slice(TRASH.length);
    rows.push({ path: p, kind: 'file', original, folder: parentOf(original), title: p.split('/').pop()!, type: null, files: [p], count: 1, trashedAt: at(p) });
  }
  for (const name of folderRows) {
    const path = TRASH + name;
    const files = inTrash.filter((p) => p.startsWith(`${path}/`));
    rows.push({ path, kind: 'folder', original: name, folder: name, title: name, type: null, files, count: files.filter(isMd).length, trashedAt: at(path) });
  }
  const t = (r: TrashRow) => Date.parse(r.trashedAt);
  return rows.sort((a, b) => t(b) - t(a) || byPath(a.path, b.path));
}

/** A free path: `path`, else ` (2)`, ` (3)` before the extension (case-insensitive). */
export function freePath(paths: string[], path: string): string {
  const taken = new Set(paths.map(low));
  if (!taken.has(low(path))) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const [base, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let n = 2; ; n++) if (!taken.has(low(`${base} (${n})${ext}`))) return `${base} (${n})${ext}`;
}
function freeDir(paths: string[], dir: string): string {
  const taken = (d: string) => paths.some((p) => low(p).startsWith(`${low(d)}/`));
  if (!taken(dir)) return dir;
  for (let n = 2; ; n++) if (!taken(`${dir} (${n})`)) return `${dir} (${n})`;
}

/** §1.4 `trash_object`: the renames (object first, then its unshared pair). The version check is the caller's. */
export function planTrashObject(input: TrashInput, path: string): Moved[] | TrashError {
  const p = nfc(path);
  if (p.startsWith(TRASH) || p.startsWith('.tegg/')) return { kind: 'Invalid', message: `fake: ${p} can't be moved to the trash` };
  if (!input.paths.includes(p)) return { kind: 'Gone', message: `fake: ${p} is gone` };
  const moves: Moved[] = [];
  const paths = [...input.paths];
  const to = freePath(paths, TRASH + p);
  moves.push({ from: p, to });
  paths.push(to);
  const pair = pairOf(input, p);
  if (pair && live(pair) && !sharedPair(input, p, pair)) moves.push({ from: pair, to: freePath(paths, TRASH + pair) });
  return moves;
}

/** §1.4 `trash_restore`: the renames of one row (object then its trashed pair; a file; every file of a folder). */
export function planRestore(input: TrashInput, rowPath: string): Moved[] | TrashError {
  const p = nfc(rowPath);
  const row = trashRows(input).find((r) => r.path === p);
  if (!row) return { kind: 'NotFound', message: `fake: ${p} isn't in the trash` };
  const paths = input.paths.filter((x) => !x.startsWith(TRASH));
  if (row.kind === 'folder') {
    const dir = freeDir(paths, row.original);
    return row.files.map((f) => ({ from: f, to: `${dir}/${f.slice(row.path.length + 1)}` }));
  }
  const moves: Moved[] = [];
  for (const f of row.files) {
    const to = freePath(paths, f.slice(TRASH.length));
    moves.push({ from: f, to });
    paths.push(to);
  }
  return moves;
}

/** §1.4 `trash_delete`: the vault paths each row removes, and the system-trash entries (a folder row by its folder). */
export function planDelete(input: TrashInput, rowPaths: string[]): { remove: string[]; entries: string[]; failed: { path: string; reason: string }[] } {
  const rows = trashRows(input);
  const out = { remove: [] as string[], entries: [] as string[], failed: [] as { path: string; reason: string }[] };
  for (const raw of rowPaths) {
    const p = nfc(raw);
    const row = rows.find((r) => r.path === p);
    if (!p.startsWith(TRASH) || !row) { out.failed.push({ path: p, reason: 'NotFound' }); continue; }
    out.remove.push(...row.files);
    if (row.kind === 'folder') out.entries.push(row.path); else out.entries.push(...row.files);
  }
  return out;
}

/** §1.4 `trash_empty`: every file under `.trash/`; the system-trash entries are the top-level entries of `.trash/`. */
export function planEmpty(input: TrashInput): { remove: string[]; entries: string[] } {
  const remove = input.paths.filter((p) => p.startsWith(TRASH));
  const entries = [...new Set(remove.map((p) => TRASH + p.slice(TRASH.length).split('/')[0]))].sort(byPath);
  return { remove, entries };
}

/** Folders of the live types in `.tegg/types/*.yml` (`folder:`), and since 4E-2 of the type definitions in
 *  `.trash/.tegg/types/` (D-851: a deleted type's objects stay one row each). */
export function typeFolders(paths: string[], text: (p: string) => string | undefined): string[] {
  return paths.filter((p) => /^(\.trash\/)?\.tegg\/types\/[^/]+\.yml$/.test(p)).map((p) => {
    const m = /^folder:\s*(.+)$/m.exec(text(p) ?? '');
    return m ? nfc(m[1].trim().replace(/^["']|["']$/g, '')) : '';
  }).filter(Boolean);
}

/** The Node side of the in-page fake (`__teggTrash`): `files` are the text files, `bin` the binary paths. */
export function handle(cmd: string, a: any, files: Record<string, string>, bin: string[], trashedAt: Record<string, string>): { result?: unknown; moves?: Moved[]; remove?: string[]; entries?: string[]; error?: TrashError } {
  const paths = [...new Set([...Object.keys(files), ...bin].map(nfc))];
  const input: TrashInput = { paths, text: (p) => files[p], trashedAt: (p) => trashedAt[p], typeFolders: typeFolders(paths, (p) => files[p]) };
  switch (cmd) {
    case 'trash_list': return { result: trashRows(input) };
    case 'object_trash': {
      const r = planTrashObject(input, String(a.path));
      return Array.isArray(r) ? { result: r, moves: r } : { error: r };
    }
    case 'trash_restore': {
      const r = planRestore(input, String(a.path));
      if (!Array.isArray(r)) return { error: r };
      // ms4-jobs §14.9.5 (D-815): a note whose type has no definition brings its latest trashed type file back.
      const p = nfc(String(a.path));
      const k = isMd(p) ? typeKey(front(files[p] ?? '').type) : null;
      if (k && files[`.tegg/types/${k}.yml`] === undefined) {
        const copies = paths.flatMap((x) => {
          if (x === `${TRASH}.tegg/types/${k}.yml`) return [[1, x] as const];
          const m = new RegExp(`^${TRASH.replace('.', '\\.')}\\.tegg/types/${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\((\\d+)\\)\\.yml$`).exec(x);
          return m ? [[Number(m[1]), x] as const] : [];
        }).sort((x, y) => y[0] - x[0]);
        if (copies.length) r.push({ from: copies[0][1], to: `.tegg/types/${k}.yml` });
      }
      return { result: r, moves: r };
    }
    case 'trash_delete': {
      const r = planDelete(input, (a.paths ?? []) as string[]);
      return { result: { removed: r.remove, failed: r.failed }, remove: r.remove, entries: r.entries };
    }
    case 'trash_empty': {
      const r = planEmpty(input);
      return { result: { removed: r.remove, failed: [] }, remove: r.remove, entries: r.entries };
    }
    case 'pair_of': return { result: pairOf(input, String(a.path)) };
    default: return { error: { kind: 'Io', message: `fake-trash: unknown ${cmd}` } };
  }
}
