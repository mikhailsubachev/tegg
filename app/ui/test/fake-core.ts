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
};
export type FakeCoreHandle = {
  calls(): Promise<{ cmd: string; args: unknown }[]>;
  writes(): Promise<number>;
  emit(event: 'index:progress' | 'vault:changed' | 'note:conflict', payload: unknown): Promise<void>;
  setFile(path: string, text: string | null): Promise<void>;
  /** The in-memory vault files as they are now (vault-relative NFC path → text). */
  files(): Promise<Record<string, string>>;
  /** The UI state the app stored through `ui_state_set` (machine-local, never in the vault). */
  uiState(): Promise<UiStateDto | null>;
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
    calls: () => ev(() => (window as any).__teggFake.calls.map((c: any) => ({ cmd: c.cmd, args: c.args }))),
    writes: () => ev(() => (window as any).__teggFake.writes as number),
    emit: (event, payload) => page.evaluate(([e, p]) => (window as any).__teggFake.emit(e, p), [event, payload] as const),
    setFile: (path, text) => page.evaluate(([p, t]) => (window as any).__teggFake.setFile(p, t), [path, text] as const),
    files: () => ev(() => ({ ...(window as any).__teggFake.vault?.files }) as Record<string, string>),
    uiState: () => ev(() => (window as any).__teggFake.uiState as UiStateDto | null),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// In-page part. Serialized by Playwright: it must be self-contained (no imports, no outer variables).
function fakeMain(init: { vault: FakeVault | null; opts: FakeOptions; empty: Record<string, string> }) {
  const w = window as any;
  const READS = new Set([
    'vault_current', 'vault_last', 'vault_types', 'vault_pick_dir', 'index_type_counts', 'index_list', 'index_search',
    'index_switcher', 'note_read', 'ui_state_get', 'ui_state_set', 'nav_opened', 'perf_mark', 'vault_open',
  ]);
  const opts = init.opts;
  const state = {
    vault: init.vault as FakeVault | null,
    calls: [] as { cmd: string; args: unknown }[],
    writes: 0,
    uiState: (opts.uiState ?? null) as UiStateDto | null,
    last: (opts.last ?? null) as { path: string; id: string | null } | null,
    emit: (event: string, payload: unknown) => w.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload }),
    setFile: (path: string, text: string | null) => {
      const p = path.normalize('NFC');
      if (!state.vault) return;
      if (text === null) delete state.vault.files[p];
      else state.vault.files[p] = text;
      return state.emit('vault:changed', { paths: [p] });
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
      const items: any[] = objects().filter((o) => !q || fold(o.title).includes(q)).slice(0, a.limit ?? 30)
        .map((o) => ({ kind: 'object', path: o.path, title: o.title, type: o.type, folder: o.folder, matched_alias: null }));
      if (raw) { const dt = defaultType() as any; items.push({ kind: 'create', path: null, title: raw, type: dt.key, folder: dt.folder, matched_alias: null }); }
      return items;
    },
    note_read: (a) => {
      const p = String(a.path).normalize('NFC');
      const text = state.vault?.files[p];
      if (text === undefined) throw err('NotFound', `fake: no note ${p}`);
      return { path: p, text, version: { mtime: 0, size: text.length } };
    },
    note_create: (a) => {
      state.writes++;
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      const dir = String(a.dir).normalize('NFC');
      const stem = String(a.title).normalize('NFC').replace(/[\\/:*?"<>|]/g, ' ').trim();
      let path = `${dir}/${stem}.md`;
      for (let n = 2; state.vault.files[path] !== undefined; n++) path = `${dir}/${stem} (${n}).md`;
      state.vault.files[path] = String(a.text);
      void state.emit('vault:changed', { paths: [path] });
      return path;
    },
    ui_state_get: () => state.uiState ?? { version: 1, theme: 'system', sidebarOpen: true, rightPanel: { open: false, tab: 'backlinks' } },
    ui_state_set: (a) => { state.uiState = a.state; return null; },
    nav_opened: (a) => { const p = String(a.path).normalize('NFC'); const o = objects().find((x) => x.path === p); state.last = { path: p, id: o?.id ?? null }; return null; },
    perf_mark: () => null,
  };

  w.__teggMocks.mockWindows('main');
  w.__teggMocks.mockIPC((cmd: string, args: any) => {
    state.calls.push({ cmd, args: args === undefined ? undefined : JSON.parse(JSON.stringify(args ?? null)) });
    const h = handlers[cmd];
    if (!READS.has(cmd) && cmd !== 'vault_create' && cmd !== 'note_create') state.writes++; // those two count themselves
    if (!h) throw err('Io', `fake core: unknown command ${cmd}`);
    try { return Promise.resolve(h(args ?? {})); } catch (e) { return Promise.reject(e); }
  }, { shouldMockEvents: true });
}
