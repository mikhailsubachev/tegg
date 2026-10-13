// Fake core for the Playwright WebKit tests (L5): docs/contracts/ms3-shell.md §5. Test code, not product code.
// It answers the shell's IPC commands (ms2-shell §2, ms3-shell §2) over an in-memory vault, through
// `@tauri-apps/api/mocks` `mockIPC` with event mocking, injected into the page before the app's scripts run.
// Search and the switcher match titles by folded substring only (their real behaviour is tested at the core, MS2).
import type { Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

export type FakeVault = { name: string; files: Record<string, string> };
export type UiStateDto = {
  version: 1;
  theme: 'system' | 'light' | 'dark';
  sidebarOpen: boolean;
  rightPanel: { open: boolean; tab: 'backlinks' | 'outline' | 'graph' };
  /** Attribute strip expanded (ms3-shell §11.2, D-147); a missing field reads as `true`. */
  propertiesOpen?: boolean;
};
/** ms3-shell §13.2 (3C). */
export type VersionDto = { mtimeNs: string; size: number; hash: string };
export type ConflictRowDto = {
  kind: 'duplicateId' | 'possibleCopy' | 'nameNormalization';
  primary: string;
  others: string[];
  versions: Record<string, VersionDto>;
};
/** One IPC call. `at`: the page's `Date.now()` at the call (Playwright `clock` aware); `seq`/`endSeq`: positions on one
 *  counter at the start and when the answer settled (3C ordering checks, e.g. "the write resolved before the next read");
 *  `ok`: false when the command failed. */
export type CallRecord = { cmd: string; args: unknown; at?: number; seq?: number; endSeq?: number; ok?: boolean; endAt?: number; result?: unknown };
export type FakeCoreHandle = {
  calls(): Promise<CallRecord[]>;
  writes(): Promise<number>;
  emit(event: 'index:progress' | 'vault:changed' | 'note:conflict', payload: unknown): Promise<void>;
  /** Changes a file "from another program" (3C, ms3-shell §13.7). `silent`: no `vault:changed` (FR-SYN-03 AC-14);
   *  `sameBytesTouch`: new mtime, same bytes (AC-16). A `Uint8Array` may hold invalid UTF-8 (NFR-REL-03 AC-7). */
  setFile(path: string, text: string | Uint8Array | null, opts?: { silent?: boolean; sameBytesTouch?: boolean }): Promise<void>;
  renameFile(from: string, to: string, opts?: { silent?: boolean }): Promise<void>;
  /** Delay or fail every `note_write`; `hold` queues writes until `release()`. */
  writeControl(c: { delayMs?: number; fail?: 'Io' | null; hold?: boolean }): Promise<void>;
  release(): Promise<void>;
  /** Paths of successful writes (`note_write` written, `note_create`, `note_create_exact`), in order. */
  writesTo(): Promise<string[]>;
  setConflicts(rows: ConflictRowDto[]): Promise<void>;
  /** The current version of a file as the fake computes it (size + hash of the bytes, mtime a counter). */
  version(path: string): Promise<VersionDto | null>;
  /** The in-memory vault files as they are now (vault-relative NFC path → text). */
  files(): Promise<Record<string, string>>;
  /** The UI state the app stored through `ui_state_set` (machine-local, never in the vault). */
  uiState(): Promise<UiStateDto | null>;
  /** URLs passed to `open_external` that the fake accepted (http, https, mailto; ms3-shell §11.1). */
  externalOpened(): Promise<string[]>;
};
export type FakeOptions = {
  uiState?: UiStateDto;
  /** Answer of `vault_pick_dir`; `null` = the user cancelled. */
  pickDir?: string | null;
  /** Folders `vault_open` can open: path → vault, or `null` for a folder without `.tegg/` (NotATeggVault). */
  dirs?: Record<string, FakeVault | null>;
  /** Folders that exist and aren't empty, for `vault_create` (NotEmpty). */
  nonEmpty?: string[];
  /** Forces `vault_create` to fail with this error. */
  createError?: { kind: string; message: string };
  /** Placeholder count reported by the open vault (FR-VLT-03). */
  placeholders?: number;
  /** The last opened note `{ path, id }` (`vault_last` answers from it, AP-76). */
  last?: { path: string; id: string | null } | null;
  /** Code run at the start of `/src/main.tsx`, before the app renders (test catalogs, collation locale). */
  prelude?: string;
};

const REPO = resolve(import.meta.dirname, '../../..');

/** Loads fixture folders (repo-relative or absolute) into one in-memory vault. A folder whose name starts with a
 *  dot (e.g. `tests/fixtures/vaults/new-empty/.tegg`) is placed under that name in the vault. */
export function loadFixtureVault(...dirs: string[]): FakeVault {
  const files: Record<string, string> = {};
  for (const dir of dirs) {
    const abs = resolve(REPO, dir);
    const prefix = basename(abs).startsWith('.') ? `${basename(abs)}/` : '';
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else files[(prefix + relative(abs, p)).normalize('NFC')] = readFileSync(p, 'utf8');
      }
    };
    walk(abs);
  }
  return { name: basename(resolve(REPO, dirs[0])), files };
}

/** The shell fixture of docs/acceptance/app-shell.md: `vaults/shell` plus `new-empty/.tegg`. */
export function shellVault(): FakeVault {
  return { ...loadFixtureVault('tests/fixtures/vaults/shell', 'tests/fixtures/vaults/new-empty/.tegg'), name: 'Trezor' };
}

export function newEmptyVault(name: string): FakeVault {
  return { ...loadFixtureVault('tests/fixtures/vaults/new-empty/.tegg'), name };
}

const MOCKS = resolve(import.meta.dirname, '../../node_modules/@tauri-apps/api/mocks.js');

export async function installFakeCore(page: Page, vault: FakeVault | null, opts: FakeOptions = {}): Promise<FakeCoreHandle> {
  const mocks = readFileSync(MOCKS, 'utf8').replace(/export\s*\{[^}]*\};?\s*$/, '');
  await page.addInitScript({ content: `(() => {${mocks}\nwindow.__teggMocks = { mockIPC, mockWindows };})();` });
  await page.addInitScript(fakeMain, { vault, opts: { ...opts, prelude: undefined }, empty: newEmptyVault('').files });
  if (opts.prelude) {
    const prelude = opts.prelude;
    await page.route(/\/src\/main\.tsx(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: `${prelude}\n${await res.text()}` });
    });
  }
  const ev = <T>(fn: () => T) => page.evaluate(fn);
  return {
    calls: () => ev(() => (window as any).__teggFake.calls.map((c: any) => ({ cmd: c.cmd, args: c.args, at: c.at, seq: c.seq, endSeq: c.endSeq, ok: c.ok, endAt: c.endAt, result: c.result }))),
    writes: () => ev(() => (window as any).__teggFake.writes as number),
    emit: (event, payload) => page.evaluate(([e, p]) => (window as any).__teggFake.emit(e, p), [event, payload] as const),
    setFile: (path, text, o) => page.evaluate(([p, t, oo]) => (window as any).__teggFake.setFile(p, t, oo),
      [path, text instanceof Uint8Array ? { bytes: [...text] } : text, o ?? {}] as const),
    renameFile: (from, to, o) => page.evaluate(([f, t, oo]) => (window as any).__teggFake.renameFile(f, t, oo), [from, to, o ?? {}] as const),
    writeControl: (c) => page.evaluate((cc) => { Object.assign((window as any).__teggFake.control, cc); }, c),
    release: () => ev(() => (window as any).__teggFake.release()),
    writesTo: () => ev(() => [...(window as any).__teggFake.writtenPaths] as string[]),
    setConflicts: (rows) => page.evaluate((r) => { (window as any).__teggFake.conflicts = r; }, rows),
    version: (path) => page.evaluate((p) => (window as any).__teggFake.ver(p), path),
    files: () => ev(() => ({ ...(window as any).__teggFake.vault?.files }) as Record<string, string>),
    uiState: () => ev(() => (window as any).__teggFake.uiState as UiStateDto | null),
    externalOpened: () => ev(() => [...(window as any).__teggFake.external] as string[]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// In-page part. Serialized by Playwright: it must be self-contained (no imports, no outer variables).
function fakeMain(init: { vault: FakeVault | null; opts: FakeOptions; empty: Record<string, string> }) {
  const w = window as any;
  const READS = new Set([
    'vault_current', 'vault_last', 'vault_types', 'vault_pick_dir', 'index_type_counts', 'index_list', 'index_search',
    'index_switcher', 'note_read', 'ui_state_get', 'ui_state_set', 'nav_opened', 'perf_mark', 'vault_open',
    'link_resolve', 'open_external', // 3B: read-only / opens a URL outside the vault (ms3-shell §11.1)
    'index_tags', 'index_conflicts', // 3C: read-only (ms3-shell §13.2)
  ]);
  const opts = init.opts;
  const state = {
    vault: init.vault as FakeVault | null,
    calls: [] as { cmd: string; args: unknown; at?: number; seq?: number; endSeq?: number; ok?: boolean; endAt?: number; result?: unknown }[],
    seq: 0,
    writes: 0,
    external: [] as string[],
    uiState: (opts.uiState ?? null) as UiStateDto | null,
    last: (opts.last ?? null) as { path: string; id: string | null } | null,
    emit: (event: string, payload: unknown) => w.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload }),
    // 3C (ms3-shell §13.7): versions, invalid UTF-8 files, write control, conflicts.
    mtimes: {} as Record<string, number>,
    clock: 1,
    invalid: {} as Record<string, number[]>,
    control: { delayMs: 0, fail: null, hold: false } as { delayMs?: number; fail?: 'Io' | null; hold?: boolean },
    held: [] as (() => void)[],
    writtenPaths: [] as string[],
    conflicts: null as ConflictRowDto[] | null,
    release: () => { const h = state.held.splice(0); for (const f of h) f(); state.control.hold = false; },
    ver: (path: string): VersionDto | null => {
      const p = path.normalize('NFC');
      const text = state.vault?.files[p];
      if (text === undefined) return null;
      const bytes = state.invalid[p] ?? [...new TextEncoder().encode(text)];
      let h = 0x811c9dc5;
      for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
      return { mtimeNs: String(state.mtimes[p] ?? 0), size: bytes.length, hash: h.toString(16).padStart(8, '0') };
    },
    touch: (p: string) => { state.mtimes[p] = ++state.clock; },
    setFile: (path: string, text: string | { bytes: number[] } | null, o: { silent?: boolean; sameBytesTouch?: boolean } = {}) => {
      const p = path.normalize('NFC');
      if (!state.vault) return;
      if (o.sameBytesTouch) state.touch(p);
      else if (text === null) { delete state.vault.files[p]; delete state.invalid[p]; delete state.mtimes[p]; }
      else if (typeof text === 'string') { state.vault.files[p] = text; delete state.invalid[p]; state.touch(p); }
      else {
        const bytes = Uint8Array.from(text.bytes);
        let ok = true;
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { ok = false; }
        state.vault.files[p] = new TextDecoder('utf-8').decode(bytes);
        if (ok) delete state.invalid[p]; else state.invalid[p] = [...bytes];
        state.touch(p);
      }
      return o.silent ? undefined : state.emit('vault:changed', { paths: [p] });
    },
    renameFile: (from: string, to: string, o: { silent?: boolean } = {}) => {
      const f = from.normalize('NFC'), t = to.normalize('NFC');
      if (!state.vault || state.vault.files[f] === undefined) return;
      state.vault.files[t] = state.vault.files[f];
      delete state.vault.files[f];
      state.mtimes[t] = state.mtimes[f] ?? 0;
      delete state.mtimes[f];
      return o.silent ? undefined : state.emit('vault:changed', { paths: [f, t] });
    },
  };
  w.__teggFake = state;
  // The theme the Rust side injects before the first paint (contract §3.5); its name is not in the contract yet.
  w.__TEGG_UI_STATE__ = state.uiState;

  const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  const err = (kind: string, message: string) => ({ kind, message });
  const excluded = (p: string) => !p.endsWith('.md') || p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));
  const front = (text: string): Record<string, string> => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const out: Record<string, string> = {};
    if (!m) return out;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    return out;
  };
  const objects = () => {
    if (!state.vault) return [];
    return Object.entries(state.vault.files)
      .filter(([p]) => !excluded(p))
      .map(([path, text]) => {
        const f = front(text);
        const stem = path.split('/').pop()!.replace(/\.md$/, '');
        return { path, id: f.id ?? null, title: f.title ?? stem, type: f.type ?? 'page', modified: f.modified ?? null, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' };
      });
  };
  const yaml = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    return out;
  };
  const types = () => {
    if (!state.vault) return [];
    return Object.entries(state.vault.files)
      .filter(([p]) => /^\.tegg\/types\/[^/]+\.yml$/.test(p))
      .map(([p, text]) => {
        const key = p.slice('.tegg/types/'.length, -'.yml'.length).normalize('NFC');
        const y = yaml(text);
        const ok = !!y.name && !!y.plural;
        return { key, name: y.name ?? key, plural: y.plural ?? key, folder: y.folder ?? key, icon: y.icon ?? '', color: y.color ?? '', system: y.system === 'true', invalid: !ok };
      });
  };
  const info = () => (state.vault ? { name: state.vault.name, path: `/fake/${state.vault.name}`, placeholders: opts.placeholders ?? 0 } : null);
  const defaultType = () => {
    const v = yaml(state.vault?.files['.tegg/vault.yml'] ?? '');
    const name = v['default-type'] ?? 'Page';
    return types().find((t) => t.name === name) ?? { key: 'page', folder: 'Pages' };
  };

  const handlers: Record<string, (a: any) => unknown> = {
    vault_current: () => info(),
    vault_open: (a) => {
      const path = String(a.path);
      const dirs = opts.dirs ?? {};
      if (!(path in dirs)) throw err('NotFound', `fake: no folder ${path}`);
      const v = dirs[path];
      if (v === null) throw err('NotATeggVault', `fake: ${path} has no .tegg/`);
      state.vault = JSON.parse(JSON.stringify(v));
      state.last = null;
      return info();
    },
    vault_create: (a) => {
      state.writes++;
      if (opts.createError) throw err(opts.createError.kind, opts.createError.message);
      if (a.kind === 'starter') throw err('Unsupported', 'fake: starter vaults arrive in 3D');
      const name = String(a.name).normalize('NFC');
      const target = `${String(a.parent).replace(/\/+$/, '')}/${name}`;
      if ((opts.nonEmpty ?? []).includes(target)) throw err('NotEmpty', `fake: ${target} is not empty`);
      state.vault = { name, files: { ...init.empty } };
      state.last = null;
      return info();
    },
    vault_pick_dir: () => (opts.pickDir === undefined ? null : opts.pickDir),
    vault_last: () => {
      if (!state.vault || !state.last) return null;
      const objs = objects();
      if (state.vault.files[state.last.path] !== undefined && !excluded(state.last.path)) return { ...state.last };
      const byId = state.last.id ? objs.find((o) => o.id === state.last!.id) : undefined;
      return byId ? { path: byId.path, id: byId.id } : null;
    },
    vault_types: () => types(),
    index_type_counts: () => {
      const out: Record<string, number> = {};
      for (const o of objects()) out[o.type] = (out[o.type] ?? 0) + 1;
      return out;
    },
    index_list: (a) => objects().filter((o) => o.type === String(a.type).normalize('NFC')).map(({ folder: _f, ...o }) => o),
    index_search: (a) => {
      const q = fold(String(a.query?.text ?? '').trim());
      const results = q ? objects().filter((o) => fold(o.title).includes(q)).map((o) => ({ path: o.path, type: o.type, title: o.title, matched_in: 'title', typo: false, snippet: null })) : [];
      return { results, total: results.length };
    },
    index_switcher: (a) => {
      const raw = String(a.q ?? '').trim().normalize('NFC');
      const q = fold(raw);
      // 3C (FR-EDT-06 AC-1, AC-2): also aliases (`matched_alias`) and file stems; `created` for duplicate titles.
      const aliasesOf = (path: string): string[] => {
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(state.vault!.files[path]);
        if (!m) return [];
        const lines = m[1].split(/\r?\n/);
        const i = lines.findIndex((l) => /^aliases:/.test(l));
        if (i < 0) return [];
        const flow = /^aliases:\s*\[(.*)\]\s*$/.exec(lines[i]);
        if (flow) return flow[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
        const out: string[] = [];
        for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) out.push(lines[j].replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
        return out;
      };
      const items: any[] = objects().flatMap((o): any[] => {
        const stem = o.path.split('/').pop()!.replace(/\.md$/, '');
        const created = front(state.vault!.files[o.path]).created ?? null;
        if (!q || fold(o.title).includes(q) || fold(stem).includes(q)) return [{ kind: 'object', path: o.path, title: o.title, type: o.type, folder: o.folder, matched_alias: null, created }];
        const al = aliasesOf(o.path).find((x) => fold(x).includes(q));
        return al ? [{ kind: 'object', path: o.path, title: o.title, type: o.type, folder: o.folder, matched_alias: al, created }] : [];
      }).slice(0, a.limit ?? 30);
      if (raw) { const dt = defaultType() as any; items.push({ kind: 'create', path: null, title: raw, type: dt.key, folder: dt.folder, matched_alias: null }); }
      return items;
    },
    note_read: (a) => {
      const p = String(a.path).normalize('NFC');
      const text = state.vault?.files[p];
      if (text === undefined) throw err('NotFound', `fake: no note ${p}`);
      return { path: p, text, version: state.ver(p), utf8: !(p in state.invalid) };
    },
    // 3C (ms3-shell §13.2): the D-175 write rule over the in-memory files.
    note_write: async (a) => {
      const p = String(a.path).normalize('NFC');
      const text = String(a.text);
      const base = (a.base ?? null) as VersionDto | null;
      if (state.control.hold) await new Promise<void>((r) => state.held.push(r));
      if (state.control.delayMs) await new Promise((r) => setTimeout(r, state.control.delayMs));
      if (state.control.fail === 'Io') throw err('Io', 'fake: write failed (Io)');
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      if (p in state.invalid) throw err('NotUtf8', `fake: ${p} isn't valid UTF-8`);
      const disk = state.vault.files[p];
      if (disk === undefined) {
        if (base) throw err('Gone', `fake: ${p} is gone`);
      } else {
        if (disk === text) return { outcome: 'unchanged', version: state.ver(p) };
        const now = state.ver(p)!;
        if (!base || base.size !== now.size || base.hash !== now.hash) {
          const c = { path: p, mine: text, theirs: disk, theirsVersion: now };
          void state.emit('note:conflict', c);
          throw { ...err('Conflict', `fake: ${p} changed on disk`), ...c };
        }
      }
      state.vault.files[p] = text;
      state.touch(p);
      state.writtenPaths.push(p);
      return { outcome: 'written', version: state.ver(p) };
    },
    note_create_exact: (a) => {
      const p = String(a.path).normalize('NFC');
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      if (state.vault.files[p] !== undefined) throw err('NameTaken', `fake: ${p} exists`);
      state.vault.files[p] = String(a.text);
      state.touch(p);
      state.writtenPaths.push(p);
      void state.emit('vault:changed', { paths: [p] });
      return state.ver(p);
    },
    note_trash: (a) => {
      const p = String(a.path).normalize('NFC');
      if (!state.vault || state.vault.files[p] === undefined) throw err('Gone', `fake: ${p} is gone`);
      const now = state.ver(p)!;
      const base = a.base as VersionDto;
      if (!base || base.size !== now.size || base.hash !== now.hash) throw { ...err('Conflict', `fake: ${p} changed`), path: p, mine: '', theirs: state.vault.files[p], theirsVersion: now };
      let t = `.trash/${p}`;
      for (let n = 2; state.vault.files[t] !== undefined; n++) t = `.trash/${p.replace(/\.md$/, '')} (${n}).md`;
      state.vault.files[t] = state.vault.files[p];
      delete state.vault.files[p];
      state.mtimes[t] = state.mtimes[p] ?? 0;
      delete state.mtimes[p];
      state.writtenPaths.push(t);
      void state.emit('vault:changed', { paths: [p, t] });
      return t;
    },
    index_tags: () => {
      const forms: Record<string, Record<string, number>> = {};
      const add = (name: string) => {
        const n = name.normalize('NFC');
        const k = n.toLowerCase();
        (forms[k] ??= {})[n] = (forms[k][n] ?? 0) + 1;
      };
      for (const o of objects()) {
        const text = state.vault!.files[o.path];
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
        let bodyText = text;
        if (fm) {
          bodyText = text.slice(fm[0].length);
          const lines = fm[1].split(/\r?\n/);
          const i = lines.findIndex((l) => /^tags:/.test(l));
          if (i >= 0) {
            const flow = /^tags:\s*\[(.*)\]\s*$/.exec(lines[i]);
            if (flow) flow[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean).forEach(add);
            else for (let j = i + 1; j < lines.length && /^\s+-\s+/.test(lines[j]); j++) add(lines[j].replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, ''));
          }
        }
        bodyText = bodyText.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
        for (const m of bodyText.matchAll(/(^|[\s(])#([\p{L}\p{N}_\/-]*\p{L}[\p{L}\p{N}_\/-]*)/gmu)) add(m[2]);
      }
      return Object.entries(forms).map(([key, f]) => {
        const best = Object.entries(f).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))[0][0];
        return { key, spelling: best, count: Object.values(f).reduce((x, y) => x + y, 0) };
      }).sort((x, y) => (x.key < y.key ? -1 : 1));
    },
    index_conflicts: () => {
      if (state.conflicts) return state.conflicts;
      const rows: ConflictRowDto[] = [];
      const objs = objects();
      const copyName = (p: string) => /( \(\d+\)| \(conflicted copy[^)]*\)| \(conflict [^)]*\))\.md$/.test(p);
      const versions = (ps: string[]) => Object.fromEntries(ps.map((x) => [x, state.ver(x)!]));
      const byId: Record<string, string[]> = {};
      for (const o of objs) if (o.id) (byId[o.id] ??= []).push(o.path);
      for (const ps of Object.values(byId)) {
        if (ps.length < 2) continue;
        const sorted = [...ps].sort((x, y) => Number(copyName(x)) - Number(copyName(y)) || x.length - y.length || (x < y ? -1 : 1));
        rows.push({ kind: 'duplicateId', primary: sorted[0], others: sorted.slice(1), versions: versions(sorted) });
      }
      for (const o of objs) {
        const m = /^(.*) \((\d+)\)\.md$/.exec(o.path);
        if (!m) continue;
        const orig = objs.find((x) => x.path === `${m[1]}.md`);
        if (!orig || (orig.id && orig.id === o.id)) continue;
        const a = state.vault!.files[orig.path].split('\n'), b = state.vault!.files[o.path].split('\n');
        const same = a.filter((l, i) => b[i] === l).length;
        if (same / Math.max(a.length, b.length) >= 0.9) rows.push({ kind: 'possibleCopy', primary: orig.path, others: [o.path], versions: versions([orig.path, o.path]) });
      }
      return rows;
    },
    note_create: (a) => {
      state.writes++;
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      const dir = String(a.dir).normalize('NFC');
      const stem = String(a.title).normalize('NFC').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim(); // 3C: `#^[]` too (D-68 `C# tips` → `C tips`)
      let path = `${dir}/${stem}.md`;
      for (let n = 2; state.vault.files[path] !== undefined; n++) path = `${dir}/${stem} (${n}).md`;
      state.vault.files[path] = String(a.text);
      state.touch(path);
      state.writtenPaths.push(path);
      void state.emit('vault:changed', { paths: [path] });
      return path;
    },
    ui_state_get: () => state.uiState ?? { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' }, propertiesOpen: true },
    ui_state_set: (a) => { state.uiState = a.state; return null; },
    nav_opened: (a) => { const p = String(a.path).normalize('NFC'); const o = objects().find((x) => x.path === p); state.last = { path: p, id: o?.id ?? null }; return null; },
    perf_mark: () => null,
    // 3B (ms3-shell §11.1): the resolution rules of `Core::resolve_links` over the in-memory files.
    link_resolve: (a) => {
      const from = String(a.from ?? '').normalize('NFC');
      const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      const objs = objects();
      const low = (x: string) => x.normalize('NFC').toLowerCase();
      const byCode = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
      return (a.targets as string[]).map((given) => {
        let t = String(given).normalize('NFC').trim();
        const cut = t.search(/[#|]/);
        if (cut >= 0) t = t.slice(0, cut).trim();
        const k = low(t);
        const kmd = k.endsWith('.md') ? k : `${k}.md`;
        let hit = objs.find((o) => low(o.path) === kmd)
          ?? objs.find((o) => o.id !== null && low(o.id) === k);
        if (!hit) {
          const same = objs.filter((o) => low(o.path.split('/').pop()!.replace(/\.md$/, '')) === k);
          hit = same.find((o) => o.folder === fromDir)
            ?? [...same].sort((x, y) => x.path.length - y.path.length || byCode(x.path, y.path))[0];
        }
        if (hit) return { target: given, kind: 'note', path: hit.path, title: hit.title, type: hit.type };
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
          const daily = objs.find((o) => o.type === 'daily-note' && (front(state.vault!.files[o.path]).date === t || o.path.split('/').pop() === `${t}.md`));
          if (daily) return { target: given, kind: 'daily', path: daily.path, title: daily.title, type: daily.type };
          return { target: given, kind: 'date-missing', path: null, title: null, type: null };
        }
        return { target: given, kind: 'unresolved', path: null, title: null, type: null };
      });
    },
    open_external: (a) => {
      const url = String(a.url);
      if (!/^(https?:|mailto:)/i.test(url)) throw err('Unsupported', `fake: scheme not allowed: ${url}`);
      state.external.push(url);
      return null;
    },
  };

  w.__teggMocks.mockWindows('main');
  w.__teggMocks.mockIPC((cmd: string, args: any) => {
    const rec: { cmd: string; args: unknown; at?: number; seq?: number; endSeq?: number; ok?: boolean; endAt?: number; result?: unknown } =
      { cmd, args: args === undefined ? undefined : JSON.parse(JSON.stringify(args ?? null)), at: Date.now(), seq: ++state.seq };
    state.calls.push(rec);
    const h = handlers[cmd];
    if (!READS.has(cmd) && cmd !== 'vault_create' && cmd !== 'note_create') state.writes++; // those two count themselves
    if (!h) throw err('Io', `fake core: unknown command ${cmd}`);
    const settle = (ok: boolean) => { rec.endSeq = ++state.seq; rec.ok = ok; rec.endAt = Date.now(); };
    let out: Promise<unknown>;
    try { out = Promise.resolve(h(args ?? {})); } catch (e) { out = Promise.reject(e); }
    return out.then((v) => { settle(true); rec.result = v === undefined ? undefined : JSON.parse(JSON.stringify(v)); return v; }, (e) => { settle(false); rec.result = JSON.parse(JSON.stringify(e ?? null)); throw e; });
  }, { shouldMockEvents: true });
}
