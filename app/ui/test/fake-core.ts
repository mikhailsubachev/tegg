// Fake core for the Playwright WebKit tests (L5): docs/contracts/ms3-shell.md §5. Test code, not product code.
// It answers the shell's IPC commands (ms2-shell §2, ms3-shell §2) over an in-memory vault, through
// `@tauri-apps/api/mocks` `mockIPC` with event mocking, injected into the page before the app's scripts run.
// Search and the switcher match titles by folded substring only (their real behaviour is tested at the core, MS2).
import type { Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { STARTER, handle as handleTypes } from './fake-schema';
import { handle as handleLinks } from './fake-links';
import { handle as handleJobs } from './fake-jobs';
import { handle as handleTasks } from './fake-tasks';
import { handle as handleInbox } from './fake-inbox';
import { handle as handleSettings } from './fake-settings';
import { handle as handleTrash } from './fake-trash';
import { handle as handleMedia, sniff } from './fake-media';
import { handle as handleTags } from './fake-tags';

/** `bin` (6A, ms6-trash-media §9.2): binary vault files (images, PDFs), vault path → base64. */
export type FakeVault = { name: string; files: Record<string, string>; bin?: Record<string, string> };
export type UiStateDto = {
  version: 1;
  theme: 'system' | 'light' | 'dark';
  sidebarOpen: boolean;
  rightPanel: { open: boolean; tab: 'backlinks' | 'outline' | 'graph' };
  /** Attribute strip expanded (ms3-shell §11.2, D-147); a missing field reads as `true`. */
  propertiesOpen?: boolean;
  /** ms5-tasks §6.3 (D-481): the Tasks page's remembered state. */
  tasks?: { view: 'schedule' | 'kanban'; groupBy: 'status' | 'tag'; dateFilter: 'all' | 'today' | 'week'; tags: string[]; doneExpanded: boolean };
  /** ms5-tasks §11.4 (D-493, D-496): the last conversion type and "Don't ask again". */
  convert?: { lastType: string | null; skipRemoveConfirm: boolean };
  /** ms5-capture §5.2 (5B, D-566): Date & time display choices. */
  dateTime?: { date: string; time: string; week: string };
  /** ms5-capture §7.4 (5B, D-555): the Inbox's remembered type filter. */
  inbox?: { filter: string };
};
/** ms5-capture §1.6, §5.2 (5B). */
export type HotkeyStateDto = { id: 'quick-capture' | 'new-task'; keys: string; state: 'active' | 'taken' };
export type ShellSettingsDto = { showStatusItem: boolean; openAtLogin: boolean };
export type CaptureDraftDto = { text: string; type: string; tags: string[]; due: string | null; priority: string | null; savedAt: string };
/** 4D-lite (ms4-tags §5.2): `label` and `files` are listed; the fake keeps the manifest and the entries in memory. */
export type BackupDto = { name: string; kind: string; time: string; label?: { key: string; args: Record<string, string | number> }; files?: number };
/** ms4-tags §5.1. */
export type BackupManifest = {
  version: 1; kind: string; label: { key: string; args: Record<string, string | number> }; vault: string; time: string; job: number;
  planned: { renames: [string, string][]; creates: string[]; trashes: string[] };
  done: { renames: [string, string, string][]; creates: [string, string][]; trashes: [string, string][]; written: [string, string][] } | null;
};
/** One zip of the fake (ms4-tags §8.1): listed fields, the manifest (`null` for zips without one) and the entries. */
export type BackupRecord = BackupDto & { manifest: BackupManifest | null; entries: Record<string, string> };
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
  /** Delay or fail every `note_write`; `hold` queues writes until `release()`. 4F (ms4-embeds §8): with `path`, only
   *  writes to that path are affected (task writes and `note_create` too, D-510). */
  writeControl(c: { delayMs?: number; fail?: 'Io' | null; hold?: boolean; path?: string | null }): Promise<void>;
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
  /** ms4-jobs §11 (4C): the reports of every job the fake ran, in start order. */
  jobs(): Promise<JobReportDto[]>;
  /** Pauses the next job before `phase`; the returned function releases it. */
  holdJob(phase: 'planning' | 'writing'): Promise<() => Promise<void>>;
  /** The next job write to `path` is skipped with `reason`. */
  skipOnWrite(path: string, reason: SkipReason): Promise<void>;
  // ---------------------------------------------------------------- 5B (ms5-capture §11.2)
  /** Capture page: emits `capture:open { seq, trigger, kind }` as the shell does on a trigger (§1.3). */
  openCapture(o?: { trigger?: 'status-item' | 'status-menu' | 'hotkey' | 'palette'; kind?: 'default' | 'task' }): Promise<number>;
  /** Capture `#saved` page: fills the confirmation panel as `capture_saved_show` does (event `capture:saved`). */
  showSaved(o: { typeName: string; title: string; path: string }): Promise<void>;
  /** The hotkey states the shell reports; emits `hotkeys:state` (main window). */
  setHotkeys(list: HotkeyStateDto[]): Promise<void>;
  /** `shell_settings_set` calls, in order (machine-local, never the vault). */
  shellCalls(): Promise<ShellSettingsDto[]>;
  /** `vault_reveal` calls (the vault paths the shell was asked to reveal). */
  reveals(): Promise<string[]>;
  /** The capture draft in Application Support (`capture_draft_set`), or null. */
  draft(): Promise<CaptureDraftDto | null>;
  /** Backup zips the fake made (bulk convert, 4D-lite jobs, restores) and the seeded ones, newest last, with their
   *  manifest and entries (ms4-tags §8.1). */
  backups(): Promise<BackupRecord[]>;
  /** 4D-lite (ms4-tags §8.1): the next backup zips fail (`BackupFailed`, as a read-only Application Support). */
  failBackups(on: boolean): Promise<void>;
  /** Switches the open vault as another window would (D-219); `null` closes it. The capture page gets
   *  `capture:context-changed` and a new vault id. */
  setVault(v: FakeVault | null): Promise<void>;
  /** The capture page's records: `capture_ready` seqs, `capture_hide` count, `capture_open_main` paths,
   *  `capture_saved_show` payloads, `capture_open` (main window) kinds. */
  captureLog(): Promise<{ ready: number[]; hides: number; openMain: (string | null)[]; saved: { typeName: string; title: string; path: string }[]; opens: string[] }>;
  // ---------------------------------------------------------------- 6A (ms6-trash-media §9.2)
  /** Binary vault files as they are now (vault path → bytes). */
  binary(): Promise<Record<string, Uint8Array>>;
  /** Sets or removes (`null`) a binary vault file "from another program"; emits `vault:changed` (and `trash:changed`
   *  under `.trash/`) unless `silent`. */
  setBinary(path: string, bytes: Uint8Array | null, opts?: { silent?: boolean }): Promise<void>;
  /** The renames and removals of the trash commands, in order: `trash` (`object_trash`), `restore` (`trash_restore`),
   *  `remove` (`trash_delete`, `trash_empty`). */
  moves(): Promise<{ kind: 'trash' | 'restore' | 'remove'; from: string; to: string | null }[]>;
  /** What `trash_delete` / `trash_empty` moved to the system trash (row entries: files, or a folder row's folder). */
  systemTrash(): Promise<string[]>;
  /** Emits Tauri's drag-drop events (`tauri://drag-enter`, `tauri://drag-over`, `tauri://drag-drop`) with `paths` and
   *  the logical `position`, as a Finder drop on the window. */
  dropFiles(paths: string[], position: { x: number; y: number }): Promise<void>;
  /** Dispatches a synthetic `paste` on the focused element with `clipboardData.files` (and `text/plain` when given). */
  paste(page: Page, o: { files: { name: string; type: string; bytes: Uint8Array }[]; text?: string }): Promise<void>;
  /** Files staged by the capture window (`capture_media_add`), in order. */
  staged(): Promise<{ token: string; name: string }[]>;
};
/** ms4-jobs §4 (4C). */
export type SkipReason = 'changed' | 'missing' | 'placeholder' | 'readOnly' | 'io';
export type JobReportDto = {
  jobId: number; kind: string; phase: 'done' | 'cancelled' | 'failed';
  renamed?: { from: string; to: string };
  written: string[]; unchanged: string[];
  skipped: { path: string; reason: SkipReason }[]; error?: string;
};
/** ms3-shell §12.5 (D-219). */
export type RecentVaultDto = { name: string; path: string; exists: boolean };
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
  /** Folder path of the vault open at launch (D-219: the switcher's colour and the recent list); default `/fake/<name>`. */
  vaultPath?: string;
  /** The machine-local recent-vaults list `vault_recent` starts from (ms3-shell §12.5), most recent first; default: the
   *  open vault only. `vault_open` / `vault_create` record their vault first on success, NFC, no duplicates, at most 9. */
  recent?: RecentVaultDto[];
  /** Code run at the start of `/src/main.tsx`, before the app renders (test catalogs, collation locale). */
  prelude?: string;
  // ---------------------------------------------------------------- 5B (ms5-capture §11.2)
  /** `capture`: the page is the capture window (`capture.html`), answering only §2.2's commands (others reject with
   *  `Forbidden`, as the ACL). Default `main`. */
  window?: 'main' | 'capture';
  /** `hotkeys` answers (default: both active). */
  hotkeys?: HotkeyStateDto[];
  /** `shell_settings` (default `{ showStatusItem: true, openAtLogin: false }`). */
  shellSettings?: ShellSettingsDto;
  /** The stored capture draft (`capture_draft_get`). */
  captureDraft?: CaptureDraftDto | null;
  // ---------------------------------------------------------------- v0.52 feedback (ms3-shell §16.8)
  /** FR-SYN-03 AC-21: every written `note_write` is reported as `vault:changed { paths: [p] }` twice, as the watcher
   *  reports Tegg's own saves: once while the write is pending (before it resolves) and once after it returned. */
  echoWrites?: boolean;
  // ---------------------------------------------------------------- 6A (ms6-trash-media §9.2)
  /** Trash times of trashed entries (row path → ISO with offset), R71. */
  trashedAt?: Record<string, string>;
  /** Files outside the vault that drops and the picker can name (absolute path → bytes). A path that is a prefix
   *  (`<path>/…`) of another key is a folder. */
  files?: Record<string, Uint8Array>;
  /** The paths the picker answers (`media_pick`, `capture_media_add { pick: true }`); default: Cancel (`[]`). */
  pick?: string[];
  /** §2 (D-615, D-628): `link_resolve` and `embed_load` report targets that resolve only in `.trash/` as `trashed`.
   *  On by default; `false` gives the pre-6A behaviour (unresolved, missing). */
  trashedLinks?: boolean;
  // ---------------------------------------------------------------- 4D-lite (ms4-tags §8.1)
  /** Seeded zips `backups_list` lists (with or without a manifest). */
  backups?: BackupRecord[];
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
/** 5B: pages installed with the same vault object (main window and capture window of one test). */
const GROUPS = new WeakMap<FakeVault, Set<Page>>();

export async function installFakeCore(page: Page, vault: FakeVault | null, opts: FakeOptions = {}): Promise<FakeCoreHandle> {
  const mocks = readFileSync(MOCKS, 'utf8').replace(/export\s*\{[^}]*\};?\s*$/, '');
  await page.addInitScript({ content: `(() => {${mocks}\nwindow.__teggMocks = { mockIPC, mockWindows };})();` });
  // 3D (ms3-shell §14.8): type-file commands run in Node (fake-schema.ts) over a snapshot of the in-page files.
  await page.exposeFunction('__teggTypes', (cmd: string, args: unknown, files: Record<string, string>, vers: Record<string, unknown>) =>
    handleTypes(cmd, args, files, vers as any)).catch(() => {});
  // 4A (ms4-links §6): link commands in Node with the real @tegg/doc extraction and excerpt window.
  await page.exposeFunction('__teggLinks', (cmd: string, args: unknown, files: Record<string, string>, vers: Record<string, unknown>) =>
    handleLinks(cmd, args, files, vers as any)).catch(() => {});
  // 4C (ms4-jobs §11): rename plans and text changes in Node with the real @tegg/doc.
  await page.exposeFunction('__teggJobs', (cmd: string, args: unknown, files: Record<string, string>) => handleJobs(cmd, args, files)).catch(() => {});
  // 5A-1 (ms5-tasks §7): the task queries in Node (fake-tasks.ts) with the real @tegg/doc and @tegg/schema.
  await page.exposeFunction('__teggTasks', (cmd: string, args: unknown, files: Record<string, string>, vers: Record<string, unknown>, ro: string[]) =>
    handleTasks(cmd, args, files, vers as any, ro)).catch(() => {});
  // 5B (ms5-capture §11.2): the Inbox query and vault settings in Node; pages sharing one vault object see each other's
  // writes (the capture window's capture appears in the main window, a settings change reaches the capture window).
  await page.exposeFunction('__teggInbox', (cmd: string, args: unknown, files: Record<string, string>, vers: Record<string, unknown>, ro: string[]) =>
    handleInbox(cmd, args, files, vers, ro)).catch(() => {});
  await page.exposeFunction('__teggSettings', (cmd: string, args: unknown, files: Record<string, string>, vers: Record<string, unknown>) =>
    handleSettings(cmd, args, files, vers as any)).catch(() => {});
  // 6A (ms6-trash-media §9.2): the trash rules (fake-trash.ts) and media adds (fake-media.ts) in Node.
  await page.exposeFunction('__teggTrash', (cmd: string, args: unknown, files: Record<string, string>, bin: string[], at: Record<string, string>) =>
    handleTrash(cmd, args, files, bin, at)).catch(() => {});
  await page.exposeFunction('__teggMedia', (cmd: string, args: any, files: Record<string, string>, bin: string[]) =>
    handleMedia(cmd, args, files, bin)).catch(() => {});
  // 4D-lite (ms4-tags §8.1): the tag twin and the tag-job / merge planners in Node (fake-tags.ts).
  await page.exposeFunction('__teggTags', (cmd: string, args: any, files: Record<string, string>, vers: Record<string, unknown>) =>
    handleTags(cmd, args, files, vers as any)).catch(() => {});
  // §3.6: `window.__TEGG_MEDIA_BASE__` points here; the fake serves its in-memory files with the sniffed type, 404 else.
  await page.route(/\/__media\//, async (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname.replace(/^.*?\/__media\//, '')).normalize('NFC');
    const b64 = await page.evaluate((p) => {
      const f = (window as any).__teggFake;
      if (!f) return null;
      if (p.startsWith('stage/')) return f.stagedBytes?.[p.slice('stage/'.length)] ?? null;
      if (p.startsWith('.tegg/')) return null;
      return f.bin?.[p] ?? null;
    }, rel).catch(() => null);
    const bytes = b64 === null ? null : Buffer.from(b64, 'base64');
    const type = bytes ? sniff(bytes) : null;
    if (!bytes || !type) { await route.fulfill({ status: 404, body: '' }); return; }
    await route.fulfill({ status: 200, contentType: type, headers: { 'cache-control': 'no-cache' }, body: bytes });
  }).catch(() => {});
  if (vault) {
    const group = GROUPS.get(vault) ?? new Set<Page>();
    GROUPS.set(vault, group);
    group.add(page);
    page.on('close', () => group.delete(page));
    await page.exposeFunction('__teggSync', async (msg: unknown) => {
      for (const other of group) if (other !== page && !other.isClosed()) await other.evaluate((m) => (window as any).__teggFake?.remote(m), msg).catch(() => {});
    }).catch(() => {});
  }
  const outside = Object.fromEntries(Object.entries(opts.files ?? {}).map(([k, v]) => [k.normalize('NFC'), Buffer.from(v).toString('base64')]));
  await page.addInitScript(fakeMain, { vault, opts: { ...opts, prelude: undefined, files: undefined }, outside, empty: newEmptyVault('').files, starter: STARTER });
  if (opts.prelude) {
    const prelude = opts.prelude;
    await page.route(/\/src\/(capture\/)?main\.tsx(\?.*)?$/, async (route) => {
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
    // 4C (ms4-jobs §11). Stub until 4C is built: no job runs, so the list stays empty.
    jobs: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.jobs)) as JobReportDto[]),
    holdJob: async (phase) => {
      await page.evaluate((ph) => { (window as any).__teggFake.jobHold = ph; }, phase);
      return async () => { await page.evaluate(() => { const f = (window as any).__teggFake; f.jobHold = null; for (const r of f.jobHeld.splice(0)) r(); }); };
    },
    skipOnWrite: (path, reason) => page.evaluate(([p, r]) => { (window as any).__teggFake.jobSkips[p.normalize('NFC')] = r; }, [path, reason] as const),
    openCapture: (o) => page.evaluate((oo) => (window as any).__teggFake.openCapture(oo.trigger ?? 'hotkey', oo.kind ?? 'default'), o ?? {}),
    showSaved: (o) => page.evaluate((oo) => (window as any).__teggFake.emit('capture:saved', oo), o),
    setHotkeys: (list) => page.evaluate((l) => { const f = (window as any).__teggFake; f.hotkeys = l; return f.emit('hotkeys:state', l); }, list),
    shellCalls: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.shellCalls)) as ShellSettingsDto[]),
    reveals: () => ev(() => [...(window as any).__teggFake.reveals] as string[]),
    draft: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.draft ?? null)) as CaptureDraftDto | null),
    backups: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.backups)) as BackupRecord[]),
    failBackups: (on) => page.evaluate((o) => { (window as any).__teggFake.backupFail = o; }, on),
    setVault: (v) => page.evaluate((vv) => (window as any).__teggFake.switchVault(vv), v ? JSON.parse(JSON.stringify(v)) : null),
    captureLog: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.captureLog))),
    // 6A (ms6-trash-media §9.2).
    binary: async () => {
      const b = await ev(() => ({ ...((window as any).__teggFake.bin ?? {}) }) as Record<string, string>);
      return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Uint8Array.from(Buffer.from(v, 'base64'))]));
    },
    setBinary: (path, bytes, o) => page.evaluate(([p, b, oo]) => (window as any).__teggFake.setBinary(p, b, oo),
      [path, bytes === null ? null : Buffer.from(bytes).toString('base64'), o ?? {}] as const),
    moves: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.moves))),
    systemTrash: () => ev(() => [...(window as any).__teggFake.sysTrash] as string[]),
    dropFiles: (paths, position) => page.evaluate(async ([ps, pos]) => {
      const f = (window as any).__teggFake;
      await f.emit('tauri://drag-enter', { paths: ps, position: pos });
      await f.emit('tauri://drag-over', { position: pos });
      await f.emit('tauri://drag-drop', { paths: ps, position: pos });
    }, [paths.map((p) => p.normalize('NFC')), position] as const),
    paste: (target, o) => target.evaluate(([files, text]) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
      if (text !== null) dt.setData('text/plain', text);
      const target = (document.activeElement ?? document.body) as HTMLElement;
      const e = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: dt });
      target.dispatchEvent(e);
    }, [o.files.map((f) => ({ name: f.name, type: f.type, b64: Buffer.from(f.bytes).toString('base64') })), o.text ?? null] as const),
    staged: () => ev(() => JSON.parse(JSON.stringify((window as any).__teggFake.staged ?? []))),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// In-page part. Serialized by Playwright: it must be self-contained (no imports, no outer variables).
function fakeMain(init: { vault: FakeVault | null; opts: FakeOptions; outside: Record<string, string>; empty: Record<string, string>; starter: Record<string, string> }) {
  const w = window as any;
  const READS = new Set([
    'vault_current', 'vault_last', 'vault_types', 'vault_pick_dir', 'index_type_counts', 'index_list', 'index_search',
    'index_switcher', 'note_read', 'ui_state_get', 'ui_state_set', 'nav_opened', 'perf_mark', 'vault_open',
    'link_resolve', 'open_external', // 3B: read-only / opens a URL outside the vault (ms3-shell §11.1)
    'index_tags', 'index_conflicts', // 3C: read-only (ms3-shell §13.2)
    'vault_recent', 'app_about', // D-219, D-220 (ms3-shell §12.5): read-only / shows the About panel
    'type_get', 'type_template', 'type_usage', 'type_misfits', 'index_type_rows', 'starter_plan', // 3D (ms3-shell §14.3): read-only
    'index_backlinks', 'index_broken_links', 'index_duplicate_titles', 'link_create_plan', 'backlinks', // 4A (ms4-links §4): read-only
    'daily_view', 'daily_dates', 'daily_draft', 'daily_context', 'daily_backlinks', // 4B (ms4-daily §4): read-only
    'job_report', 'job_interrupted', 'backups_list', 'editor_open', 'editor_close', // 4C (ms4-jobs §4): read-only / editor registration
    'task_list', 'daily_tasks', // 5A-1 (ms5-tasks §3): read-only
    // 5B (ms5-capture §2.2, §5, §7.1): read-only, or machine-local only (never a vault write).
    'vault_settings', 'vault_reveal', 'shell_settings', 'shell_settings_set', 'hotkeys', 'hotkeys_retry', 'inbox_list', 'inbox_count', 'index_versions',
    'capture_open', 'capture_context', 'capture_ready', 'capture_hide', 'capture_resize', 'capture_open_main', 'capture_draft_get',
    'capture_draft_set', 'capture_saved_show', 'capture_suggest', // v0.52 (ms5-capture §16.1, D-603): read-only suggestions
    'trash_list', 'media_pick', 'media_open', 'media_reveal', // 6A (ms6-trash-media §4): read-only / a dialog / the shell opens a file
    'tag_objects', 'tag_usage', 'tag_new_path', 'job_plan', 'backup_reveal', // 4D-lite (ms4-tags §3, §4.4, §5.2): read-only
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
    path: (init.vault ? (opts.vaultPath ?? `/fake/${init.vault.name}`) : null) as string | null,
    recent: [] as { name: string; path: string; exists: boolean }[],
    emit: (event: string, payload: unknown) => w.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload }),
    // 3C (ms3-shell §13.7): versions, invalid UTF-8 files, write control, conflicts.
    mtimes: {} as Record<string, number>,
    clock: 1,
    invalid: {} as Record<string, number[]>,
    control: { delayMs: 0, fail: null, hold: false } as { delayMs?: number; fail?: 'Io' | null; hold?: boolean; path?: string | null },
    held: [] as (() => void)[],
    writtenPaths: [] as string[],
    conflicts: null as ConflictRowDto[] | null,
    // 4C (ms4-jobs §11): job reports, hold and skip control.
    jobs: [] as unknown[],
    jobHold: null as 'planning' | 'writing' | null,
    jobHeld: [] as (() => void)[],
    jobSkips: {} as Record<string, string>,
    jobSeq: 0,
    editors: new Set<string>(),
    reports: {} as Record<number, any>,
    plans: {} as Record<number, { op: any; files: Record<string, any[]> }>,
    undo: {} as Record<number, { op: any; files: { before: string; after: string; pre: string; post: string }[] }>,
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
      else if (typeof text === 'string') { if (o.silent && !state.stale.has(p) && state.vault.files[p] !== undefined) state.indexVer[p] = state.ver(p)!; state.vault.files[p] = text; delete state.invalid[p]; state.touch(p); }
      else {
        const bytes = Uint8Array.from(text.bytes);
        let ok = true;
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { ok = false; }
        state.vault.files[p] = new TextDecoder('utf-8').decode(bytes);
        if (ok) delete state.invalid[p]; else state.invalid[p] = [...bytes];
        state.touch(p);
      }
      // 5B (§7.3): a silent change makes the index version stale; an `inbox` job skips the file as `changed`.
      if (o.silent) state.stale.add(p); else { state.stale.delete(p); delete state.indexVer[p]; }
      if (!o.silent && p.startsWith('.trash/')) void state.emit('trash:changed', null); // 6A (ms6-trash-media §4)
      return o.silent ? undefined : state.emit('vault:changed', { paths: [p] });
    },
    // ---------------------------------------------------------------- 5B (ms5-capture §11.2)
    hotkeys: (opts.hotkeys ?? [{ id: 'quick-capture', keys: '⌃⌥Space', state: 'active' }, { id: 'new-task', keys: '⌃⌥T', state: 'active' }]) as HotkeyStateDto[],
    shell: (opts.shellSettings ?? { showStatusItem: true, openAtLogin: false }) as ShellSettingsDto,
    shellCalls: [] as ShellSettingsDto[],
    reveals: [] as string[],
    draft: (opts.captureDraft ?? null) as CaptureDraftDto | null,
    backups: (opts.backups ?? []).map((b) => JSON.parse(JSON.stringify(b))) as BackupRecord[],
    backupFail: false,
    stale: new Set<string>(),
    /** 5B (§7.3): the version the index last read of a silently changed file (`index_versions`). */
    indexVer: {} as Record<string, VersionDto>,
    vaultId: 1,
    captureSeq: 0,
    captureLog: { ready: [] as number[], hides: 0, openMain: [] as (string | null)[], saved: [] as unknown[], opens: [] as string[] },
    lastCount: null as number | null,
    countTimer: 0 as unknown as ReturnType<typeof setTimeout> | 0,
    remoteApplying: false,
    inboxJobs: {} as Record<number, { phase: string; cancelled: boolean }>,
    openCapture: (trigger: string, kind: string) => {
      const seq = ++state.captureSeq;
      void state.emit('capture:open', { seq, trigger, kind });
      return seq;
    },
    /** Changes from another page of the same test (the other window of the app). */
    remote: (m: any) => {
      if (m.kind === 'file' && state.vault) {
        const p = String(m.path).normalize('NFC');
        state.remoteApplying = true;
        try {
          if (m.text === null) { delete state.vault.files[p]; delete state.mtimes[p]; } else { state.vault.files[p] = m.text; state.touch(p); }
        } finally { state.remoteApplying = false; }
        state.stale.delete(p);
        if (opts.window === 'capture') void state.emit('capture:context-changed', {});
        else void state.emit('vault:changed', { paths: [p] });
        state.refreshCount();
      } else if (m.kind === 'bin') {
        const p = String(m.path).normalize('NFC');
        if (m.b64 === null) delete (state as any).bin[p]; else (state as any).bin[p] = m.b64;
        if (opts.window !== 'capture') void state.emit('vault:changed', { paths: [p] });
      } else if (m.kind === 'capture-open' && opts.window === 'capture') state.openCapture(m.trigger, m.captureKind);
      else if (m.kind === 'saved' && opts.window === 'capture') void state.emit('capture:saved', m.payload);
      else if (m.kind === 'ui-state' && opts.window === 'capture') void state.emit('ui:state', m.payload);
      else if (m.kind === 'route' && opts.window !== 'capture') void state.emit('shell:route', { route: m.route });
      return null;
    },
    sync: (m: unknown) => { if (typeof w.__teggSync === 'function') void w.__teggSync(m); },
    /** `inbox:count` when the member count changed (FR-NAV-04 AC-2). */
    refreshCount: () => {
      if (opts.window === 'capture' || !state.vault) return;
      if (state.countTimer) clearTimeout(state.countTimer as ReturnType<typeof setTimeout>);
      state.countTimer = setTimeout(async () => {
        state.countTimer = 0;
        if (!state.vault) return;
        const r = await w.__teggInbox('inbox_count', {}, state.vault.files, {}, Object.keys(state.invalid));
        const n = Number(r?.result ?? 0);
        if (state.lastCount !== null && n !== state.lastCount) void state.emit('inbox:count', { count: n });
        state.lastCount = n;
      }, 30);
    },
    watch: () => {
      if (!state.vault) return;
      const raw = state.vault.files;
      state.vault.files = new Proxy(raw, {
        set(t, k, v) {
          (t as any)[k] = v;
          if (typeof k === 'string') {
            if (!state.remoteApplying) { state.stale.delete(k.normalize('NFC')); state.sync({ kind: 'file', path: k, text: v }); }
            state.refreshCount();
          }
          return true;
        },
        deleteProperty(t, k) {
          delete (t as any)[k];
          if (typeof k === 'string') {
            if (!state.remoteApplying) state.sync({ kind: 'file', path: k, text: null });
            state.refreshCount();
          }
          return true;
        },
      });
    },
    switchVault: (v: FakeVault | null) => {
      state.vault = v ? JSON.parse(JSON.stringify(v)) : null;
      state.path = v ? `/fake/${v.name}` : null;
      state.vaultId++;
      state.watch();
      if (opts.window === 'capture') void state.emit('capture:context-changed', {});
      else void state.emit('vault:changed', { paths: [] });
      return null;
    },
    renameFile: (from: string, to: string, o: { silent?: boolean } = {}) => {
      const f = from.normalize('NFC'), t = to.normalize('NFC');
      if (!state.vault || state.vault.files[f] === undefined) return;
      state.vault.files[t] = state.vault.files[f];
      delete state.vault.files[f];
      state.mtimes[t] = state.mtimes[f] ?? 0;
      delete state.mtimes[f];
      if (o.silent) return undefined;
      // 6A (ms6-trash-media §4): the shell also emits `trash:changed` for a change under `.trash/`.
      if (f.startsWith('.trash/') || t.startsWith('.trash/')) void state.emit('trash:changed', null);
      return state.emit('vault:changed', { paths: [f, t] });
    },
  };
  w.__teggFake = state;
  state.watch();
  state.refreshCount();
  // The theme the Rust side injects before the first paint (contract §3.5); its name is not in the contract yet.
  w.__TEGG_UI_STATE__ = state.uiState;

  const fold = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  const err = (kind: string, message: string) => ({ kind, message });
  const excluded = (p: string) => !p.endsWith('.md') || p.split('/').some((seg, i, a) => i < a.length - 1 && (seg.startsWith('.') || seg === '_templates'));
  const front = (text: string): Record<string, string> => {
    const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text); // a BOM before the frontmatter is allowed (dialect §2)
    const out: Record<string, string> = {};
    if (!m) return out;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    return out;
  };
  // 3D (D-239, FR-TYP-13): the matched type key; a value that isn't one non-empty string is Page.
  const match = (raw: string | undefined) => {
    if (raw === undefined) return 'page';
    const v = raw.normalize('NFC').trim();
    if (v === '' || v.startsWith('[') || /^-?\d+(\.\d+)?$/.test(v) || v === 'null' || v === '~') return 'page';
    return v.toLowerCase().replace(/\s+/g, '-');
  };
  // D-332: a valid YYYY-MM-DD calendar date.
  const isDate = (t: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  };
  const objects = () => {
    if (!state.vault) return [];
    return Object.entries(state.vault.files)
      .filter(([p]) => !excluded(p))
      .map(([path, text]) => {
        const f = front(text);
        const stem = path.split('/').pop()!.replace(/\.md$/, '');
        const type = match(f.type);
        const day = type === 'daily-note' && f.date && isDate(f.date.trim().slice(0, 10)) ? f.date.trim().slice(0, 10) : null;
        return { path, id: f.id ?? null, title: day ?? f.title ?? stem, stored: day ? (f.title ?? null) : null, type, daily: day, created: f.created ?? null, modified: f.modified ?? null, folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' };
      });
  };
  // D-319, D-335: the Daily Note a date opens, from the one copy of the rule in Node (fake-links.ts, PR #38 review).
  const dailyWinners = async (): Promise<Record<string, string>> => (await w.__teggLinks('daily_winners', {}, state.vault!.files, {})).result ?? {};
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
  const info = () => (state.vault ? { name: state.vault.name, path: state.path ?? `/fake/${state.vault.name}`, placeholders: opts.placeholders ?? 0 } : null);
  state.recent = opts.recent ? opts.recent.map((r) => ({ ...r })) : (state.vault && state.path ? [{ name: state.vault.name, path: state.path, exists: true }] : []);
  const record = (name: string, path: string) => {
    const p = path.normalize('NFC');
    state.recent = [{ name: name.normalize('NFC'), path: p, exists: true }, ...state.recent.filter((r) => r.path.normalize('NFC') !== p)].slice(0, 9);
  };
  // D-239, D-541 (5B): `default-type` is matched as a key (NFC, lower case, spaces as `-`); a value that names no type
  // gives Quick Note, as the core does.
  const defaultType = () => {
    const v = yaml(state.vault?.files['.tegg/vault.yml'] ?? '');
    const raw = typeof v['default-type'] === 'string' ? String(v['default-type']) : '';
    const key = raw.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-');
    const all = types();
    return all.find((t) => t.key.normalize('NFC') === key) ?? all.find((t) => t.key === 'quick-note') ?? { key: 'page', folder: 'Pages' };
  };

  // 3D (ms3-shell §14.8): forwards a command to the Node side with the current files and type-file versions, applies
  // its writes like the other write commands (version, writtenPaths, `vault:changed`) and fills TypeDto versions.
  const typePathOf = (key: string) => `.tegg/types/${key.normalize('NFC')}.yml`;
  const withVersions = (v: any): any => {
    if (Array.isArray(v)) return v.map(withVersions);
    if (v && typeof v === 'object' && typeof v.key === 'string' && Array.isArray(v.attributes) && 'exists' in v) {
      const exists = state.vault?.files[typePathOf(v.key)] !== undefined;
      return { ...v, exists: v.exists && exists, version: exists ? state.ver(typePathOf(v.key)) : null };
    }
    return v;
  };
  // 4F (ms4-embeds §8): `writeControl({ path })` limits delay, failure and hold to writes to that path.
  const ctlOn = (a: any) => !state.control.path || String(a?.path ?? '').normalize('NFC') === String(state.control.path).normalize('NFC');
  const viaNode = (cmd: string, fn = '__teggTypes') => async (a: any) => {
    if (!state.vault) throw err('NoVault', 'fake: no vault');
    if (fn === '__teggLinks' && cmd === 'link_create' && ctlOn(a) && state.control.fail === 'Io') throw err('Io', 'fake: write failed (Io)'); // D-309
    const files = state.vault.files;
    const vers: Record<string, VersionDto> = {};
    for (const p of Object.keys(files)) if (p.startsWith('.tegg/types/') || p === '.tegg/vault.yml' || fn === '__teggTasks' || fn === '__teggInbox') vers[p] = (fn === '__teggInbox' ? state.indexVer[p] : undefined) ?? state.ver(p)!;
    // 5A-1 (ms5-tasks §7): task rows carry each file's version and whether the editor would open it read-only.
    const r = await w[fn](cmd, a ?? {}, files, vers, Object.keys(state.invalid));
    if (r.writes) {
      const paths: string[] = [];
      for (const [p, t] of Object.entries(r.writes as Record<string, string | null>)) {
        if (t === null) { delete files[p]; delete state.mtimes[p]; } else { files[p] = t; state.touch(p); state.writtenPaths.push(p); }
        paths.push(p);
      }
      void state.emit('vault:changed', { paths });
    }
    if (r.error) throw r.error.disk ? { ...r.error, disk: withVersions(r.error.disk) } : r.error;
    return withVersions(r.result);
  };


  // ---------------------------------------------------------------- 6A (ms6-trash-media §9.2): trash and media
  const x = state as any;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  /** The page clock as ISO 8601 with the local offset (the fake's "now"). */
  const isoLocal = (ms: number) => {
    const d = new Date(ms);
    const off = -d.getTimezoneOffset();
    const a = Math.abs(off);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
  };
  const toB64 = (v: any): string => {
    const u8 = v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : Array.isArray(v) ? Uint8Array.from(v) : v && typeof v === 'object' ? Uint8Array.from(Object.values(v) as number[]) : new Uint8Array();
    let out = '';
    for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(out);
  };
  x.bin = Object.fromEntries(Object.entries(init.vault?.bin ?? {}).map(([k, v]) => [k.normalize('NFC'), v])) as Record<string, string>;
  x.trashedAt = { ...(opts.trashedAt ?? {}) } as Record<string, string>;
  x.moves = [] as { kind: string; from: string; to: string | null }[];
  x.sysTrash = [] as string[];
  x.staged = [] as { token: string; name: string }[];
  x.stagedBytes = {} as Record<string, string>;
  x.idSeq = 0;
  x.lastOptions = null as any;
  const changed6a = (paths: string[]) => {
    void state.emit('vault:changed', { paths });
    if (paths.some((q) => q.startsWith('.trash/'))) void state.emit('trash:changed', null);
    state.refreshCount();
  };
  const setBin = (p: string, b64: string | null, sync = true) => {
    if (b64 === null) delete x.bin[p]; else x.bin[p] = b64;
    if (sync) state.sync({ kind: 'bin', path: p, b64 });
  };
  x.setBinary = (path: string, b64: string | null, o: { silent?: boolean } = {}) => {
    const p = path.normalize('NFC');
    setBin(p, b64);
    if (!o.silent) changed6a([p]);
  };
  const viaTrash = async (cmd: string, a: any) => {
    if (!state.vault) throw err('NoVault', 'fake: no vault');
    const r = await w.__teggTrash(cmd, a ?? {}, state.vault.files, Object.keys(x.bin), x.trashedAt);
    if (r.error) throw r.error;
    return r;
  };
  const applyMoves = (moves: { from: string; to: string }[], kind: 'trash' | 'restore') => {
    const files = state.vault!.files;
    const paths: string[] = [];
    const now = isoLocal(Date.now());
    for (const m of moves) {
      if (files[m.from] !== undefined) {
        files[m.to] = files[m.from];
        delete files[m.from];
        state.mtimes[m.to] = state.mtimes[m.from] ?? 0;
        delete state.mtimes[m.from];
      } else if (x.bin[m.from] !== undefined) {
        setBin(m.to, x.bin[m.from]);
        setBin(m.from, null);
      }
      if (kind === 'trash') x.trashedAt[m.to] = now;
      else delete x.trashedAt[m.from];
      x.moves.push({ kind, from: m.from, to: m.to });
      paths.push(m.from, m.to);
    }
    changed6a(paths);
  };
  /** `writeControl({ fail: 'Io', path })`: that path (or the entries under it) can't be moved to the system trash. */
  const removable = (r: { remove: string[]; entries: string[]; result: any }) => {
    const bad = state.control.fail === 'Io' && state.control.path ? String(state.control.path).normalize('NFC') : null;
    if (!bad) return r;
    const hit = (q: string) => q === bad || q.startsWith(`${bad}/`);
    const failed = [...new Set(r.entries.filter(hit))];
    return {
      remove: r.remove.filter((q) => !hit(q)), entries: r.entries.filter((q) => !hit(q)),
      result: { removed: r.result.removed.filter((q: string) => !hit(q)), failed: [...r.result.failed, ...failed.map((q) => ({ path: q, reason: 'fake: Io' }))] },
    };
  };
  const removeAll = (remove: string[], entries: string[]) => {
    const files = state.vault!.files;
    for (const p of remove) {
      if (files[p] !== undefined) { delete files[p]; delete state.mtimes[p]; }
      if (x.bin[p] !== undefined) setBin(p, null);
      delete x.trashedAt[p];
      x.moves.push({ kind: 'remove', from: p, to: null });
    }
    x.sysTrash.push(...entries);
    changed6a(remove);
  };
  /** §3.4: one file and its object, file first; `writeControl({ fail: 'Io', path })` fails the write of that path once
   *  (the object: the file just written is removed again, FR-ATT-01 AC-7). */
  const addMedia = async (q: { b64: string; name: string; owner: string | null; ownerTitle: string | null; date: string; size?: number }) => {
    if (!state.vault) throw err('NoVault', 'fake: no vault');
    const id = `01JB6AFAKE${String(++x.idSeq).padStart(16, '0')}`;
    const r = await w.__teggMedia('add', { ...q, now: isoLocal(Date.now()), id }, state.vault.files, Object.keys(x.bin));
    if (r.error) throw r.error;
    const [file] = Object.keys(r.writes.bin);
    const [obj] = Object.keys(r.writes.text);
    const failing = (p: string) => state.control.fail === 'Io' && !!state.control.path && String(state.control.path).normalize('NFC') === p;
    if (failing(file)) { state.control.fail = null; throw { ...err('Io', `fake: ${file} couldn't be written`), name: q.name }; }
    setBin(file, r.writes.bin[file]);
    state.writtenPaths.push(file);
    if (failing(obj)) {
      state.control.fail = null;
      setBin(file, null);
      throw { ...err('Io', `fake: ${obj} couldn't be written`), name: q.name };
    }
    state.vault.files[obj] = r.writes.text[obj];
    state.touch(obj);
    state.writtenPaths.push(obj);
    changed6a([file, obj]);
    return r.result;
  };
  const dirOutside = (p: string) => Object.keys(init.outside).some((k) => k.startsWith(`${p.replace(/\/+$/, '')}/`));
  const addPaths = async (paths: string[], owner: string | null, ownerTitle: string | null, date: string) => {
    const out: any[] = [];
    for (const raw of paths) {
      const p = String(raw).normalize('NFC');
      const name = p.split('/').filter(Boolean).pop() ?? p;
      const b64 = init.outside[p];
      if (b64 === undefined) { out.push({ error: dirOutside(p) ? 'Refused' : 'Io', name }); continue; }
      try { out.push({ ok: await addMedia({ b64, name, owner, ownerTitle, date }) }); } catch (e: any) { out.push({ error: e?.kind ?? 'Io', name }); }
    }
    return out;
  };
  const headers = () => {
    const h = new Headers((x.lastOptions?.headers ?? {}) as HeadersInit);
    const dec = (v: string | null) => { if (v === null) return null; try { return decodeURIComponent(v); } catch { return v; } };
    return { name: dec(h.get('x-tegg-name')) ?? '', owner: dec(h.get('x-tegg-owner')), ownerTitle: dec(h.get('x-tegg-owner-title')), date: dec(h.get('x-tegg-date')) ?? isoLocal(Date.now()).slice(0, 10) };
  };
  const isRaw = (a: any) => a instanceof Uint8Array || a instanceof ArrayBuffer || Array.isArray(a);
  /** §5: stages one file in the page's memory (never the vault). */
  const stage = async (b64: string, name: string) => {
    const r = await w.__teggMedia('info', { b64, name }, {}, []);
    if (r.error) return { error: r.error.kind, name };
    const token = `stage-${++x.idSeq}`;
    x.stagedBytes[token] = b64;
    x.staged.push({ token, name });
    return { ok: { token, name, ...r.result } };
  };
  /** §3.2: a link target naming a media file (an extension other than `.md`). */
  const mediaTarget = (t: string) => {
    const name = t.split('/').pop() ?? '';
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return false;
    const ext = name.slice(dot + 1);
    return ext.toLowerCase() !== 'md' && !ext.includes(' ') && ext.length <= 5;
  };
  const parentDir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  /** §3.2: Obsidian's rule over `candidates`: exact path, then the name in `fromDir`, then the shortest path. */
  const pickMedia = (candidates: string[], target: string, fromDir: string): string | null => {
    const lo = (v: string) => v.normalize('NFC').toLowerCase();
    const t = lo(target.trim());
    const exact = candidates.find((c) => lo(c) === t);
    if (exact) return exact;
    const nm = t.split('/').pop()!;
    const same = candidates.filter((c) => lo(c.split('/').pop()!) === nm);
    return same.find((c) => lo(parentDir(c)) === lo(fromDir)) ?? [...same].sort((a1, b1) => [...a1].length - [...b1].length || (a1 < b1 ? -1 : 1))[0] ?? null;
  };
  const fileOf = (text: string | undefined) => { const m = /\[\[([^\]|#]+)/.exec(front(text ?? '').file ?? ''); return m ? m[1].trim().normalize('NFC') : null; };
  const extType = (p: string) => (/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(p) ? 'image' : /\.pdf$/i.test(p) ? 'pdf' : null);

  // 4C (ms4-jobs §11): the in-page job runner.
  const jobs = {
    progress: (jobId: number, phase: string, done: number, total: number, counts?: unknown) =>
      state.emit('job:progress', { jobId, kind: 'note-rename', phase, done, total, ...(counts ? { counts } : {}) }),
    hold: async (phase: 'planning' | 'writing') => {
      if (state.jobHold === phase) await new Promise<void>((r) => state.jobHeld.push(r));
    },
    write: (p: string, text: string) => {
      state.vault!.files[p] = text;
      state.touch(p);
      state.writtenPaths.push(p);
      void state.emit('vault:changed', { paths: [p] });
    },
    move: (from: string, to: string, text: string) => {
      const files = state.vault!.files;
      delete files[from];
      delete state.mtimes[from];
      files[to] = text;
      state.touch(to);
      state.writtenPaths.push(to);
      void state.emit('vault:changed', { paths: [from, to] });
    },
    /** D-386: an open note is changed by its editor; counted written when its save lands. */
    live: async (p: string, ops: unknown[]): Promise<'written' | 'changed'> => {
      const before = state.ver(p);
      void state.emit('job:transform', { requestId: ++state.jobSeq, source: p, text: state.vault!.files[p], ops, live: true });
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => setTimeout(r, 25));
        const now = state.ver(p);
        if (now && before && (now.size !== before.size || now.hash !== before.hash)) return 'written';
        if (!state.editors.has(p)) return 'changed';
      }
      return 'changed';
    },
    finish: (jobId: number, report: any, total: number) => {
      state.reports[jobId] = report;
      state.jobs.push(report);
      const counts = { written: report.written.length, unchanged: report.unchanged.length, skipped: report.skipped.length };
      return jobs.progress(jobId, report.phase, total, total, counts);
    },
    rename: async (jobId: number, path: string, plan: any) => {
      const report: any = { jobId, kind: 'note-rename', phase: 'done', written: [], unchanged: [], skipped: [] };
      if (plan.noop) { await jobs.finish(jobId, report, 0); return; }
      const total = 1 + plan.linking.length;
      await jobs.progress(jobId, 'planning', 0, total);
      await jobs.hold('planning');
      await jobs.progress(jobId, 'writing', 0, total);
      await jobs.hold('writing');
      const files = state.vault!.files;
      const undo: { before: string; after: string; pre: string; post: string }[] = [];
      const noteOps = [{ op: 'set-title', title: plan.title, now: new Date().toISOString().replace(/\.\d+Z$/, '+00:00') }, plan.op];
      const pre = files[path];
      const post = await w.__teggJobs('transform', { source: path, text: pre, ops: noteOps }, files) ?? pre;
      if (plan.toPath !== path) { jobs.move(path, plan.toPath, post); report.renamed = { from: path, to: plan.toPath }; } else jobs.write(path, post);
      report.written.push(plan.toPath);
      undo.push({ before: path, after: plan.toPath, pre, post });
      state.plans[jobId] = { op: plan.op, files: { [plan.toPath]: noteOps } };
      let done = 1;
      for (const p of plan.linking as string[]) {
        state.plans[jobId].files[p] = [plan.op];
        const skip = state.jobSkips[p];
        if (skip) { delete state.jobSkips[p]; report.skipped.push({ path: p, reason: skip }); }
        else if (state.editors.has(p)) {
          const r = await jobs.live(p, [plan.op]);
          if (r === 'written') report.written.push(p); else report.skipped.push({ path: p, reason: 'changed' });
        } else {
          const cur = files[p];
          const out = cur === undefined ? null : await w.__teggJobs('transform', { source: p, text: cur, ops: [plan.op] }, files);
          if (cur === undefined) report.skipped.push({ path: p, reason: 'missing' });
          else if (out === null || out === cur) report.unchanged.push(p);
          else { jobs.write(p, out); report.written.push(p); undo.push({ before: p, after: p, pre: cur, post: out }); }
        }
        await jobs.progress(jobId, 'writing', ++done, total);
      }
      state.undo[jobId] = { op: plan.op, files: undo };
      await jobs.finish(jobId, report, total);
    },
    undo: (of: number, back: boolean) => {
      const rec = state.undo[of];
      if (!rec) throw err('NotFound', 'fake: nothing to undo');
      const jobId = ++state.jobSeq;
      const rev = (o: any) => ({ ...o, fromPath: o.toPath, fromStem: o.toStem, fromTitle: o.toTitle, toPath: o.fromPath, toStem: o.fromStem, toTitle: o.fromTitle, paths: o.paths.map((x: string) => (x === o.fromPath ? o.toPath : x)) });
      void (async () => {
        const report: any = { jobId, kind: 'note-rename', phase: 'done', written: [], unchanged: [], skipped: [] };
        const total = rec.files.length;
        await jobs.progress(jobId, 'planning', 0, total);
        await jobs.progress(jobId, 'writing', 0, total);
        const files = state.vault!.files;
        let done = 0;
        for (const f of rec.files) {
          const [at, to, want, put] = back ? [f.after, f.before, f.post, f.pre] : [f.before, f.after, f.pre, f.post];
          if (at === to && state.editors.has(at)) {
            const r = await jobs.live(at, [back ? rev(rec.op) : rec.op]);
            if (r === 'written') report.written.push(at); else report.skipped.push({ path: at, reason: 'changed' });
          } else if (files[at] !== want) report.skipped.push({ path: at, reason: files[at] === undefined ? 'missing' : 'changed' });
          else if (at !== to) { jobs.move(at, to, put); report.renamed = { from: at, to }; report.written.push(to); }
          else { jobs.write(at, put); report.written.push(at); }
          await jobs.progress(jobId, 'writing', ++done, total);
        }
        await jobs.finish(jobId, report, total);
      })();
      return { jobId };
    },
  };


  // ---------------------------------------------------------------- 4D-lite (ms4-tags §4, §5, §8.1): tag jobs, merge, restore
  const versAll = () => { const v: Record<string, VersionDto> = {}; for (const p of Object.keys(state.vault?.files ?? {})) v[p] = state.ver(p)!; return v; };
  const viaTags = async (cmd: string, a: any) => {
    if (!state.vault) throw err('NoVault', 'fake: no vault');
    const r = await w.__teggTags(cmd, a ?? {}, state.vault.files, versAll());
    if (r.error) throw r.error;
    return r.result;
  };
  const tagJobs: Record<number, { kind: string; phase: string; cancelled: boolean; go?: () => void; plan: any }> = {};
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const sha = async (t: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  const utcName = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  /** §5.1 (ms4-jobs §6): every `.md` and `.tegg/` file, before the first vault write; 10 kept (`exempt` too, D-671). */
  const makeZip = (kind: string, jobId: number, label: any, planned: any, exempt: string | null = null): BackupRecord | null => {
    if (state.backupFail) return null;
    const files = state.vault!.files;
    const entries: Record<string, string> = {};
    for (const p of Object.keys(files)) if (p.endsWith('.md') || p.startsWith('.tegg/')) entries[p.normalize('NFC')] = files[p];
    // AP-619 (D-690): a zip made in a second that already has one takes the next free second (as the core's `backup`),
    // so name order stays newest first under the fixed clock.
    let at = Date.now();
    while (state.backups.some((b) => b.name.startsWith(`${utcName(at)}-`))) at += 1000;
    const name = `${utcName(at)}-${kind}.zip`;
    const manifest: BackupManifest = { version: 1, kind, label, vault: state.vault!.name, time: new Date(Date.now()).toISOString().replace(/\.\d+Z$/, 'Z'), job: jobId, planned, done: null };
    const rec: BackupRecord = { name, kind, time: isoLocal(at), label, files: Object.keys(entries).length, manifest, entries };
    state.backups.push(rec);
    const others = state.backups.filter((b) => b.name !== exempt).sort((p, q) => (p.name < q.name ? -1 : 1));
    while (others.length > 10) { const old = others.shift()!; state.backups = state.backups.filter((b) => b !== old); }
    return rec;
  };
  const freeTrash = (p: string) => {
    let t = `.trash/${p}`;
    for (let n = 2; state.vault!.files[t] !== undefined; n++) t = `.trash/${p.replace(/\.md$/, '')} (${n}).md`;
    return t;
  };
  const moveRaw = (from: string, to: string, text: string, kind: 'trash' | 'restore' | null) => {
    const files = state.vault!.files;
    files[to] = text;
    delete files[from];
    state.mtimes[to] = kind ? (state.mtimes[from] ?? 0) : ++state.clock;
    delete state.mtimes[from];
    if (kind) { x.moves.push({ kind, from, to }); if (kind === 'trash') x.trashedAt[to] = isoLocal(Date.now()); }
    state.writtenPaths.push(to);
    changed6a([from, to]);
  };
  const jobRun = (jobId: number, kind: string, plan: any) => {
    const j: { kind: string; phase: string; cancelled: boolean; go?: () => void; plan: any } = (tagJobs[jobId] = { kind, phase: 'queued', cancelled: false, plan });
    const report: any = { jobId, kind, phase: 'done', written: [], unchanged: [], skipped: [] };
    const progress = (phase: string, done: number, total: number, counts?: unknown) => {
      j.phase = phase;
      return state.emit('job:progress', { jobId, kind, phase, done, total, ...(counts ? { counts } : {}) });
    };
    const finish = async (phase: string, total: number, zip: BackupRecord | null, error?: string, done?: any) => {
      report.phase = phase;
      if (error) report.error = error;
      if (zip && done) zip.manifest!.done = done;
      state.reports[jobId] = report;
      state.jobs.push(report);
      await progress(phase, phase === 'done' ? total : 0, total, { written: report.written.length, unchanged: report.unchanged.length, skipped: report.skipped.length });
    };
    return { j, report, progress, finish };
  };
  /** `tag-rename`, `tag-delete`, `merge` (§4.1): plan in Node, confirm, zip, then write file by file. */
  const startTagJob = async (planCmd: string, a: any) => {
    if (!state.vault) throw err('NoVault', 'fake: no vault');
    const r = await w.__teggTags(planCmd, a, state.vault.files, versAll());
    if (r.error) throw r.error;
    if (r.result?.noop) return { jobId: null };
    const plan = r.result;
    const jobId = ++state.jobSeq;
    const { j, report, progress, finish } = jobRun(jobId, plan.kind, plan);
    state.plans[jobId] = { op: null, files: {} };
    void (async () => {
      const total = plan.files.length + plan.trashes.length;
      await progress('planning', 0, 0);
      await jobs.hold('planning');
      if (j.cancelled) return finish('cancelled', total, null);
      await progress('confirm', 0, total);
      await new Promise<void>((res) => { j.go = res; });
      if (j.cancelled) return finish('cancelled', total, null);
      await progress('backup', 0, total);
      const zip = makeZip(plan.kind, jobId, plan.label, { renames: plan.renames.map((x: any) => [x.from, x.to]), creates: [], trashes: plan.trashes });
      if (!zip) return finish('failed', total, null, 'BackupFailed: fake: Application Support is read-only');
      if (j.cancelled) return finish('cancelled', total, zip);
      await progress('writing', 0, total);
      await jobs.hold('writing');
      const files = state.vault!.files;
      const done: any = { renames: [], creates: [], trashes: [], written: [] };
      if (plan.check) for (const p of plan.check as string[]) {
        const f = plan.files.find((q: any) => q.path === p);
        const want = f ? f.text : undefined;
        if (want !== undefined && files[p] !== want) return finish('failed', total, zip, `changed:${p}`, done);
        if (want === undefined && files[p] === undefined) return finish('failed', total, zip, `changed:${p}`, done);
      }
      let n = 0;
      for (const f of plan.files) {
        const p = f.path;
        state.plans[jobId].files[p] = f.ops;
        const skip = state.jobSkips[p];
        const cur = files[p];
        if (skip) { delete state.jobSkips[p]; report.skipped.push({ path: p, reason: skip }); }
        else if (cur === undefined) report.skipped.push({ path: p, reason: 'missing' });
        else if (p in state.invalid) report.skipped.push({ path: p, reason: 'readOnly' });
        else if (state.editors.has(p) && !f.rename) {
          // ms4-jobs §9 (D-386): an open note is changed by its editor, whatever it holds now.
          const rr = await jobs.live(p, f.ops);
          if (rr === 'written') { report.written.push(p); done.written.push([p, await sha(files[p])]); } else report.skipped.push({ path: p, reason: 'changed' });
        } else if (cur !== f.text || state.stale.has(p)) report.skipped.push({ path: p, reason: 'changed' });
        else {
          const out = await w.__teggJobs('transform', { source: p, text: cur, ops: f.ops }, files);
          if (f.rename) {
            const to = f.rename.to;
            jobs.move(p, to, out ?? cur);
            report.renamed = { from: p, to };
            report.written.push(to);
            done.renames.push([p, to, await sha(out ?? cur)]);
          } else if (out === null || out === cur) report.unchanged.push(p);
          else { jobs.write(p, out); report.written.push(p); done.written.push([p, await sha(out)]); }
        }
        await progress('writing', ++n, total);
      }
      for (const p of plan.trashes as string[]) {
        if (files[p] === undefined) report.skipped.push({ path: p, reason: 'missing' });
        else { const t = freeTrash(p); moveRaw(p, t, files[p], 'trash'); done.trashes.push([p, t]); }
        await progress('writing', ++n, total);
      }
      await finish('done', total, zip, undefined, done);
    })();
    return { jobId };
  };
  /** `restore` (§5.3): the pre-restore zip, then the manifest's reversal, then every other differing entry. */
  const startRestore = (name: string) => {
    if (!state.vault) throw err('NoVault', 'fake: no vault');
    const src = state.backups.find((b) => b.name === name);
    if (!src) throw err('NotFound', `fake: no backup ${name}`);
    const jobId = ++state.jobSeq;
    const { j, report, progress, finish } = jobRun(jobId, 'restore', { kind: 'restore', files: [], trashes: [], renames: [] });
    void (async () => {
      const files = state.vault!.files;
      await progress('planning', 0, 0);
      await jobs.hold('planning');
      if (j.cancelled) return finish('cancelled', 0, null);
      await progress('backup', 0, 0);
      const pre = makeZip('restore', jobId, { key: 'backups.label.restore', args: { time: src.time } }, { renames: [], creates: [], trashes: [] }, src.name);
      if (!pre) return finish('failed', 0, null, 'BackupFailed: fake: Application Support is read-only');
      if (j.cancelled) return finish('cancelled', 0, pre);
      const m = src.manifest;
      const rev = m ? (m.done ?? { renames: m.planned.renames.map(([f, t]) => [f, t, '']), creates: m.planned.creates.map((c) => [c, '']), trashes: m.planned.trashes.map((t) => [t, `.trash/${t}`]), written: [] }) : null;
      const entries = Object.entries(src.entries ?? {});
      const total = entries.length + (rev ? rev.renames.length + rev.creates.length + rev.trashes.length : 0);
      await progress('writing', 0, total);
      await jobs.hold('writing');
      const handled = new Set<string>();
      let n = 0;
      if (rev) {
        for (const [from, to, h] of rev.renames as [string, string, string][]) {
          handled.add(from);
          const cur = files[to];
          if (cur !== undefined && (h === '' || (await sha(cur)) === h) && files[from] === undefined && src.entries[from] !== undefined) {
            moveRaw(to, from, src.entries[from], null); report.written.push(from);
          } else report.skipped.push({ path: to, reason: 'changed' });
          await progress('writing', ++n, total);
        }
        for (const [p, h] of rev.creates as [string, string][]) {
          const cur = files[p];
          if (cur !== undefined && (h === '' || (await sha(cur)) === h)) { moveRaw(p, freeTrash(p), cur, 'trash'); report.written.push(p); }
          else report.skipped.push({ path: p, reason: 'changed' });
          await progress('writing', ++n, total);
        }
        for (const [from, to] of rev.trashes as [string, string][]) {
          handled.add(from);
          if (files[to] !== undefined && files[from] === undefined) { moveRaw(to, from, files[to], 'restore'); report.written.push(from); }
          else report.skipped.push({ path: from, reason: 'changed' });
          await progress('writing', ++n, total);
        }
      }
      for (const [p, text] of entries) {
        if (handled.has(p)) continue;
        const skip = state.jobSkips[p];
        if (skip) { delete state.jobSkips[p]; report.skipped.push({ path: p, reason: skip }); }
        else if (files[p] === text) { /* equal: untouched (FR-SYN-06) */ }
        else if (state.editors.has(p)) {
          const rr = await jobs.live(p, [{ op: 'replace', text }]);
          if (rr === 'written') report.written.push(p); else report.skipped.push({ path: p, reason: 'changed' });
        } else { jobs.write(p, text); report.written.push(p); }
        await progress('writing', ++n, total);
      }
      await finish('done', total, null);
    })();
    return { jobId };
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
      state.path = path;
      state.last = null;
      state.vaultId++;
      state.watch();
      record(state.vault!.name, path);
      return info();
    },
    vault_create: (a) => {
      state.writes++;
      if (opts.createError) throw err(opts.createError.kind, opts.createError.message);

      const name = String(a.name).normalize('NFC');
      const target = `${String(a.parent).replace(/\/+$/, '')}/${name}`;
      if ((opts.nonEmpty ?? []).includes(target)) throw err('NotEmpty', `fake: ${target} is not empty`);
      state.vault = { name, files: a.kind === 'starter' ? { ...init.empty, ...init.starter } : { ...init.empty } }; // FR-VLT-02 AC-6/AC-7
      state.vaultId++;
      state.watch();
      state.path = target;
      state.last = null;
      record(name, target);
      return info();
    },
    vault_recent: () => state.recent.map((r) => ({ ...r })),
    app_about: () => null,
    vault_pick_dir: () => (opts.pickDir === undefined ? null : opts.pickDir),
    vault_last: () => {
      if (!state.vault || !state.last) return null;
      if (/^daily\/\d{4}-\d{2}-\d{2}$/.test(state.last.path)) return { ...state.last };
      const objs = objects();
      if (state.vault.files[state.last.path] !== undefined && !excluded(state.last.path)) return { ...state.last };
      const byId = state.last.id ? objs.find((o) => o.id === state.last!.id) : undefined;
      return byId ? { path: byId.path, id: byId.id } : null;
    },
    vault_types: viaNode('vault_types'),
    type_get: viaNode('type_get'),
    type_create: viaNode('type_create'),
    type_patch: viaNode('type_patch'),
    type_delete: viaNode('type_delete'),
    type_template: viaNode('type_template'),
    type_usage: viaNode('type_usage'),
    type_misfits: viaNode('type_misfits'),
    index_type_rows: viaNode('index_type_rows'),
    starter_plan: viaNode('starter_plan'),
    starter_add: viaNode('starter_add'),
    // 4A (ms4-links §4, §6).
    index_backlinks: viaNode('index_backlinks', '__teggLinks'),
    backlinks: viaNode('backlinks', '__teggLinks'),
    index_broken_links: viaNode('index_broken_links', '__teggLinks'),
    index_duplicate_titles: viaNode('index_duplicate_titles', '__teggLinks'),
    link_create_plan: viaNode('link_create_plan', '__teggLinks'),
    link_create: viaNode('link_create', '__teggLinks'),
    // 4B (ms4-daily §4, §8): in Node (fake-links.ts) with the §2 winner rule and the real @tegg/doc twins.
    daily_view: viaNode('daily_view', '__teggLinks'),
    daily_dates: viaNode('daily_dates', '__teggLinks'),
    daily_draft: viaNode('daily_draft', '__teggLinks'),
    daily_create: async (a) => {
      // D-363: writeControl applies as to note_write.
      if (ctlOn(a) && state.control.hold) await new Promise<void>((r) => state.held.push(r));
      if (ctlOn(a) && state.control.delayMs) await new Promise((r) => setTimeout(r, state.control.delayMs));
      if (ctlOn(a) && state.control.fail === 'Io') throw err('Io', 'fake: write failed (Io)');
      const r: any = await viaNode('daily_create', '__teggLinks')(a);
      return { ...r, version: state.ver(r.path) };
    },
    daily_backlinks: viaNode('daily_backlinks', '__teggLinks'),
    daily_context: viaNode('daily_context', '__teggLinks'),
    // 5A-1 (ms5-tasks §7): read-only task queries in Node (fake-tasks.ts).
    task_list: viaNode('task_list', '__teggTasks'),
    daily_tasks: viaNode('daily_tasks', '__teggTasks'),
    index_type_counts: () => {
      const out: Record<string, number> = {};
      for (const o of objects()) out[o.type] = (out[o.type] ?? 0) + 1;
      return out;
    },
    index_list: (a) => objects().filter((o) => o.type === String(a.type).normalize('NFC')).map((o) => ({ path: o.path, id: o.id, title: o.title, type: o.type, modified: o.modified })),
    index_search: async (a) => {
      // §15.8: words in tiers (D-253), quoted phrases strict, `-word` excluded, file stems searched (D-254). No typos.
      // AP-621 (D-692): `query.tags` requires every key (all of); tags without text list every matching object.
      const tagKeys = ((a.query?.tags ?? []) as unknown[]).map(String);
      const tagged = tagKeys.length && state.vault
        ? new Set(((await w.__teggTags('search_tag_paths', { keys: tagKeys }, state.vault.files, {})).result ?? []) as string[])
        : null;
      const inTags = (p: string) => !tagged || tagged.has(p.normalize('NFC'));
      const words = (t: string) => [...t.normalize('NFC').matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, w: fold(m[0]) }));
      const toks = (t: string) => words(t).map((x) => x.w);
      const items: { toks: string[]; neg: boolean; quoted: boolean }[] = [];
      for (const m of String(a.query?.text ?? '').matchAll(/(-?)(?:["„“]([^"“”]*)["“”]?|(\S+))/g)) {
        const tk = toks(m[2] ?? m[3] ?? '');
        if (tk.length) items.push({ toks: tk, neg: m[1] === '-' && (m[2] !== undefined || (m[3] ?? '').length > 0), quoted: m[2] !== undefined });
      }
      const pos = items.filter((i) => !i.neg);
      const seqIn = (hay: string[], need: string[]) => hay.some((_, k) => need.every((x, j) => hay[k + j] === x));
      if (!pos.length && tagged) {
        const only = objects().filter((o) => inTags(o.path) && !items.some((i) => i.neg && [o.title, o.path.split('/').pop()!.replace(/\.md$/, ''), state.vault!.files[o.path]].some((t) => seqIn(toks(t), i.toks))))
          .sort((x, y) => x.title.localeCompare(y.title) || x.path.localeCompare(y.path))
          .map((o) => ({ path: o.path, type: o.type, title: o.title, matched_in: 'title', tier: 'phrase', typo: false, snippet: null, file_name: null }));
        return { results: only, total: only.length };
      }
      if (!pos.length) return { results: [], total: 0 };
      const seq = (hay: string[], its: { toks: string[] }[]) => {
        const need = its.flatMap((i) => i.toks);
        return hay.some((_, k) => need.every((w, j) => hay[k + j] === w));
      };
      const unq = pos.filter((i) => !i.quoted);
      const rows = objects().filter((o) => inTags(o.path)).flatMap((o) => {
        const text = state.vault!.files[o.path];
        const fm = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
        const body = fm ? text.slice(fm[0].length) : text;
        const f = front(text);
        const stem = o.path.split('/').pop()!.replace(/\.md$/, '');
        const attrs = Object.entries(f).filter(([k]) => !['id', 'type', 'title', 'aliases', 'tags', 'created', 'modified'].includes(k)).map(([, v]) => v).join(' \n ');
        const fields = { title: toks(o.title), fileName: toks(stem), attribute: toks(attrs), body: toks(body) };
        const all = Object.values(fields);
        const has = (i: { toks: string[] }) => all.some((h) => seq(h, [i]));
        if (items.some((i) => i.neg && has(i)) || pos.some((i) => i.quoted && !has(i))) return [];
        const matched = pos.filter(has);
        if (unq.length && !unq.some(has)) return [];
        const tier = unq.length <= 1 ? 'phrase' : !unq.every(has) ? 'anyWord' : all.some((h) => seq(h, unq)) ? 'phrase' : 'allWords';
        const field = (Object.keys(fields) as (keyof typeof fields)[]).find((k) => matched.some((i) => seq(fields[k], [i])))!;
        const mark = (t: string): [number, number][] => {
          const ws = words(t);
          return ws.flatMap((w, k) => matched.filter((i) => i.toks.every((x, j) => ws[k + j]?.w === x)).map((i) => [w.at, ws[k + i.toks.length - 1].end] as [number, number]));
        };
        const lines = body.split(/\r?\n/);
        const hit = lines.findIndex((l) => mark(l).length);
        const lead = lines.findIndex((l) => l.trim());
        const snippet = hit >= 0 ? { text: lines[hit], highlights: mark(lines[hit]), line: hit + 1 } : field === 'fileName' && lead >= 0 ? { text: lines[lead], highlights: [], line: lead + 1 } : null;
        return [{ rank: [['phrase', 'allWords', 'anyWord'].indexOf(tier), field === 'fileName' ? 0 : ['title', 'alias', 'attribute', 'body'].indexOf(field)], r: {
          path: o.path, type: o.type, title: o.title, matched_in: field, tier, typo: false, snippet,
          file_name: field === 'fileName' ? { text: stem.normalize('NFC'), highlights: mark(stem.normalize('NFC')), line: 0 } : null,
        } }];
      });
      rows.sort((x, y) => x.rank[0] - y.rank[0] || x.rank[1] - y.rank[1] || x.r.path.localeCompare(y.r.path));
      const results = rows.map((x) => x.r);
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
        if (!q || fold(o.title).includes(q) || fold(stem).includes(q) || (o.stored !== null && fold(o.stored).includes(q))) return [{ kind: 'object', path: o.path, title: o.title, type: o.type, folder: o.folder, matched_alias: null, created }];
        const al = aliasesOf(o.path).find((x) => fold(x).includes(q));
        return al ? [{ kind: 'object', path: o.path, title: o.title, type: o.type, folder: o.folder, matched_alias: al, created }] : [];
      })
        // As the real switcher (FR-NAV-01): an exact title match first, then prefix matches, then the rest (stable).
        .map((x, i) => ({ x, i, r: !q ? 2 : fold(x.title) === q ? 0 : fold(x.title).startsWith(q) ? 1 : 2 }))
        .sort((a1, b1) => a1.r - b1.r || a1.i - b1.i)
        .map((y) => y.x)
        .slice(0, a.limit ?? 30);
      if (raw) { const dt = defaultType() as any; items.push({ kind: 'create', path: null, title: raw, type: dt.key, folder: dt.folder, matched_alias: null }); }
      return viaNode('switcher_duplicates', '__teggLinks')({ items }); // 4A: `duplicate` details (D-289)
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
      if (ctlOn(a) && state.control.hold) await new Promise<void>((r) => state.held.push(r));
      if (ctlOn(a) && state.control.delayMs) await new Promise((r) => setTimeout(r, state.control.delayMs));
      if (ctlOn(a) && state.control.fail === 'Io') throw err('Io', 'fake: write failed (Io)');
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      if (p.startsWith('.trash/')) throw err('Invalid', `fake: ${p} is in the trash (ms6-trash-media §1.5)`);
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
      state.stale.delete(p);
      delete state.indexVer[p];
      state.writtenPaths.push(p);
      if (opts.echoWrites) {
        // ms3-shell §16.8: the watcher's report of this write, while it is pending and again after it returned.
        await state.emit('vault:changed', { paths: [p] });
        await new Promise((r) => setTimeout(r, 30));
        setTimeout(() => { void state.emit('vault:changed', { paths: [p] }); }, 0);
      }
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
    // ms5-tasks §11.6, §11.7 (D-492): a conversion's undo deletes the new file only while it is still `base`; counted
    // as a write of that path; `writeControl({ fail })` applies (D-510).
    note_discard: (a) => {
      const p = String(a.path).normalize('NFC');
      const top = p.split('/')[0];
      if (['.tegg', '_templates', '.trash'].includes(top) || !/\.md$/i.test(p)) throw err('Protected', `fake: ${p} can't be discarded`);
      if (!state.vault || state.vault.files[p] === undefined) throw err('NotFound', `fake: ${p} is gone`);
      if (ctlOn(a) && state.control.fail === 'Io') throw err('Io', 'fake: write failed (Io)');
      const now = state.ver(p)!;
      const base = a.base as VersionDto;
      if (!base || base.size !== now.size || base.hash !== now.hash) throw { ...err('Conflict', `fake: ${p} changed`), path: p, mine: '', theirs: state.vault.files[p], theirsVersion: now };
      delete state.vault.files[p];
      delete state.mtimes[p];
      state.writtenPaths.push(p);
      void state.emit('vault:changed', { paths: [p] });
      return null;
    },
    // 4D-lite (ms4-tags §3, §8.1): the tag twin in Node (fake-tags.ts); `TagRowDto[]` (was `TagDto[]`).
    index_tags: () => viaTags('index_tags', {}),
    tag_objects: (a) => viaTags('tag_objects', { key: a.key }),
    tag_usage: (a) => viaTags('tag_usage', { key: a.key }),
    tag_new_path: (a) => viaTags('tag_new_path', { name: a.name }),
    tag_rename: (a) => startTagJob('plan_tag_rename', { from: a.from, to: a.to, now: isoLocal(Date.now()) }),
    tag_delete: (a) => startTagJob('plan_tag_delete', { key: a.key }),
    merge_start: (a) => startTagJob('plan_merge', { keep: a.keep, others: a.others, now: isoLocal(Date.now()) }),
    job_plan: (a) => {
      const j = tagJobs[a.jobId];
      if (!j || j.phase === 'planning' || j.phase === 'queued') return null;
      const pl = j.plan;
      return pl ? {
        jobId: a.jobId, kind: pl.kind, files: pl.files.filter((f: any) => !f.template).length, templates: pl.templates ?? 0,
        renames: pl.renames ?? [], trashes: pl.trashes ?? [], warnings: pl.warnings ?? [], conflicts: pl.conflicts ?? [],
      } : null;
    },
    backup_reveal: (a) => {
      const b = state.backups.find((z) => z.name === String(a.name));
      if (!b) throw err('NotFound', `fake: no backup ${a.name}`);
      state.reveals.push(`backups/${b.name}`);
      return null;
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
      if (a.type !== undefined && String(a.type).normalize('NFC') === 'daily-note') throw err('UseDailyNote', 'fake: a Daily Note is created by typing in it'); // D-318
      // 5A-1 (D-510): `writeControl({ fail })` applies to the typed create too.
      // With `path`, the typed create the core would name that path fails (its stem is the sanitized title).
      const planned = (title: string) => String(title).normalize('NFC').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/ {2,}/g, ' ').trim();
      const ctlCreate = !state.control.path || String(state.control.path).normalize('NFC').replace(/\.md$/i, '').split('/').pop()!.replace(/ \(\d+\)$/, '') === planned(a.title);
      if (a.type !== undefined && ctlCreate && state.control.fail === 'Io') throw err('Io', 'fake: create failed (Io)');
      if (a.type !== undefined) return viaNode('note_create')(a); // 3D: note_create(type, title, text) (ms3-shell §14.3)
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
    ui_state_set: (a) => {
      state.uiState = a.state;
      // ms5-capture §4 (as the shell): the capture windows get the theme and the Date & time choice as `ui:state`.
      state.sync({ kind: 'ui-state', payload: { theme: a.state?.theme, dateTime: a.state?.dateTime ?? null } });
      return null;
    },
    nav_opened: (a) => {
      // D-349: a daily route is recorded as the route, so the landing can reopen it.
      if (typeof a.route === 'string' && a.route.startsWith('daily/')) { state.last = { path: a.route, id: null }; return null; }
      if (a.path == null) return null;
      const p = String(a.path).normalize('NFC'); const o = objects().find((x) => x.path === p); state.last = { path: p, id: o?.id ?? null }; return null;
    },
    perf_mark: () => null,
    // 4F (ms4-embeds §8): one call per nesting level, no recency.
    embed_load: async (a) => {
      const out: any[] = [];
      const seen = new Set<string>();
      for (const p0 of (a.paths ?? []) as string[]) {
        const p = String(p0).normalize('NFC');
        if (seen.has(p)) continue;
        seen.add(p);
        const key = state.vault ? Object.keys(state.vault.files).find((k) => k.normalize('NFC') === p) : undefined;
        const text = key === undefined ? undefined : state.vault!.files[key];
        if (opts.trashedLinks !== false && p.startsWith('.trash/') && (text !== undefined || x.bin[p] !== undefined)) {
          // 6A (ms6-trash-media §2): a trashed object shows the D-27 placeholder.
          out.push({ path: p, state: 'trashed', title: text !== undefined ? (front(text).title ?? p.split('/').pop()!.replace(/\.md$/, '')) : p.split('/').pop()!, text: null, version: null, utf8: true, links: [] });
          continue;
        }
        if (text === undefined || /^(_templates|\.trash)\//.test(p)) {
          out.push({ path: p, state: 'missing', text: null, version: null, utf8: true, links: [] });
          continue;
        }
        const targets = ((await w.__teggLinks('link_targets', { text }, {}, {})).result ?? []) as string[];
        const links = targets.length ? await (handlers.link_resolve as any)({ from: p, targets }) : [];
        out.push({ path: p, state: 'ok', text, version: state.ver(p), utf8: !(p in state.invalid), links });
      }
      return out;
    },
    // 3B (ms3-shell §11.1): the resolution rules of `Core::resolve_links` over the in-memory files.
    link_resolve: async (a) => {
      const from0 = String(a.from ?? '').normalize('NFC');
      const from = from0.startsWith('.trash/') ? from0.slice('.trash/'.length) : from0; // §1.5: as from its original path
      const fromDir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      const objs = objects();
      const low = (x: string) => x.normalize('NFC').toLowerCase();
      const byCode = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
      const winners = (a.targets as string[]).some((x) => /\d{4}-\d{2}-\d{2}/.test(String(x))) ? await dailyWinners() : {};
      const dailyWinner = (date: string) => objects().find((o) => o.path === winners[date]);
      // D-601 (ms3-shell §11.1, §16): the resolved object's `review`, `status`, `due`, `completed` (trimmed strings, or null).
      const fields = (path: string | null) => {
        const f = path && state.vault?.files[path] !== undefined ? front(state.vault.files[path]) : {};
        const v = (k: string) => (typeof f[k] === 'string' ? f[k].trim() : null);
        return { review: v('review'), status: v('status'), due: v('due'), completed: v('completed') };
      };
      return (a.targets as string[]).map((given) => { const r = resolveOne(given); return { object: null, ...r, ...fields(r.kind === 'media' ? null : r.path) }; });
      function resolveOne(given: string): { target: string; kind: string; path: string | null; title: string | null; type: string | null; object?: string | null } {
        let t = String(given).normalize('NFC').trim();
        const cut = t.search(/[#|]/);
        if (cut >= 0) t = t.slice(0, cut).trim();
        // D-162: a date is a Daily Note link first.
        if (isDate(t)) {
          const daily = dailyWinner(t);
          if (daily) return { target: given, kind: 'daily', path: daily.path, title: daily.title, type: daily.type };
          return { target: given, kind: 'date-missing', path: null, title: null, type: null };
        }
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
        // 6A (ms6-trash-media §3.2): a media file, resolved over the vault's files (not only objects).
        const all = [...Object.keys(state.vault?.files ?? {}), ...Object.keys(x.bin)].map((q) => q.normalize('NFC'));
        const usable = (q: string) => !/^(_templates|\.trash|\.tegg)\//.test(q) && !/\.md$/i.test(q);
        if (mediaTarget(t)) {
          const file = pickMedia(all.filter(usable), t, fromDir);
          if (file) {
            const owners = objs.filter((o) => (o.type === 'image' || o.type === 'pdf') && (() => { const ft = fileOf(state.vault!.files[o.path]); return !!ft && pickMedia(all.filter(usable), ft, o.folder) === file; })())
              .sort((o1, o2) => (o1.path < o2.path ? -1 : 1));
            const own = owners[0];
            return { target: given, kind: 'media', path: file, title: own ? own.title : file.split('/').pop()!, type: own ? own.type : extType(file), object: own ? own.path : null };
          }
        }
        // 6A (ms6-trash-media §2, D-628): the same rules over `.trash/` with its prefix removed.
        const trashed = opts.trashedLinks !== false ? all.filter((q) => q.startsWith('.trash/')) : [];
        if (mediaTarget(t)) {
          const inTrash = trashed.filter((q) => !/\.md$/i.test(q)).map((q) => q.slice('.trash/'.length));
          const file = pickMedia(inTrash, t, fromDir);
          if (file) {
            const pairObj = trashed.filter((q) => /\.md$/i.test(q)).sort().find((q) => { const ft = fileOf(state.vault!.files[q]); return !!ft && pickMedia(inTrash, ft, parentDir(q.slice('.trash/'.length))) === file; });
            if (pairObj) { const f = front(state.vault!.files[pairObj]); return { target: given, kind: 'trashed', path: pairObj, title: f.title ?? pairObj.split('/').pop()!.replace(/\.md$/, ''), type: match(f.type) }; }
            return { target: given, kind: 'trashed', path: `.trash/${file}`, title: file.split('/').pop()!, type: extType(file) };
          }
        } else {
          const tobjs = trashed.filter((q) => /\.md$/i.test(q) && state.vault!.files[q] !== undefined).map((q) => {
            const rest = q.slice('.trash/'.length);
            const f = front(state.vault!.files[q]);
            return { path: q, rest, id: f.id ?? null, title: f.title ?? rest.split('/').pop()!.replace(/\.md$/, ''), type: match(f.type), folder: parentDir(rest) };
          });
          const th = tobjs.find((o) => low(o.rest) === kmd) ?? tobjs.find((o) => o.id !== null && low(o.id) === k)
            ?? (() => { const same = tobjs.filter((o) => low(o.rest.split('/').pop()!.replace(/\.md$/, '')) === k); return same.find((o) => o.folder === fromDir) ?? [...same].sort((o1, o2) => o1.rest.length - o2.rest.length || byCode(o1.rest, o2.rest))[0]; })();
          if (th) return { target: given, kind: 'trashed', path: th.path, title: th.title, type: th.type };
        }

        return { target: given, kind: 'unresolved', path: null, title: null, type: null };
      }
    },
    // 4C (ms4-jobs §4, §11): the job engine over the in-memory files; plans and bytes from Node (fake-jobs.ts).
    note_rename: async (a) => {
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      const plan = await w.__teggJobs('plan_rename', { path: a.path, title: a.title, fromTitle: a.fromTitle }, state.vault.files);
      if (plan.error) throw err(plan.error, `fake: ${plan.error}`);
      const jobId = ++state.jobSeq;
      void jobs.rename(jobId, String(a.path).normalize('NFC'), plan);
      return { jobId, toPath: plan.toPath ?? String(a.path).normalize('NFC') };
    },
    // 5B: an `inbox` job is cancellable in planning and backup (ms5-capture §7.3).
    job_cancel: (a) => {
      const t = tagJobs[a.jobId];
      if (t) {
        const allowed = t.plan?.kind === 'restore' || t.kind === 'restore' ? ['queued', 'planning', 'backup'] : ['queued', 'planning', 'confirm', 'backup'];
        if (!allowed.includes(t.phase)) throw err('NotCancellable', 'fake: the job is writing');
        t.cancelled = true;
        t.go?.();
        return null;
      }
      const j = state.inboxJobs[a.jobId];
      if (j && (j.phase === 'planning' || j.phase === 'backup' || j.phase === 'queued')) { j.cancelled = true; return null; }
      throw err('NotCancellable', 'fake: nothing to cancel');
    },
    job_confirm: (a) => {
      const t = tagJobs[a.jobId];
      if (!t || t.phase !== 'confirm') throw err('NotFound', 'fake: no job waits for confirmation');
      t.go?.();
      return null;
    },
    job_report: (a) => state.reports[a.jobId] ?? null,
    job_retry: async (a) => {
      const p = String(a.path).normalize('NFC');
      const ops = state.plans[a.jobId]?.files[p];
      if (!ops || !state.vault) throw err('NotFound', 'fake: no such planned file');
      const cur = state.vault.files[p];
      if (cur === undefined) return { outcome: 'skipped', reason: 'missing' };
      const out = await w.__teggJobs('transform', { source: p, text: cur, ops }, state.vault.files);
      if (out === null || out === cur) return { outcome: 'unchanged' };
      jobs.write(p, out);
      const r = state.reports[a.jobId];
      if (r) { r.skipped = r.skipped.filter((x: any) => x.path !== p); r.written.push(p); }
      return { outcome: 'written' };
    },
    job_undo: (a) => jobs.undo(a.jobId, true),
    job_redo: (a) => jobs.undo(a.jobId, false),
    job_transform_result: () => null,
    job_interrupted: () => [],
    job_resolve_interrupted: () => { throw err('NotFound', 'fake: no interrupted job'); },
    // ms4-tags §5.2: newest first; the label and file count of each zip (zips without a manifest: `backups.label.unknown`).
    backups_list: () => [...state.backups].sort((p, q) => (p.name < q.name ? 1 : p.name > q.name ? -1 : 0)).map((b) => ({
      name: b.name, kind: b.kind, time: b.time, label: b.label ?? b.manifest?.label ?? { key: 'backups.label.unknown', args: { kind: b.kind } },
      files: b.files ?? Object.keys(b.entries ?? {}).length,
    })),
    backup_restore: (a) => startRestore(String(a.name)),
    editor_open: (a) => { state.editors.add(String(a.path).normalize('NFC')); return null; },
    editor_close: (a) => { state.editors.delete(String(a.path).normalize('NFC')); return null; },
    // ---------------------------------------------------------------- 5B (ms5-capture §5, §7, §11.2)
    vault_settings: viaNode('vault_settings', '__teggSettings'),
    vault_settings_patch: async (a) => {
      const r: any = await viaNode('vault_settings_patch', '__teggSettings')(a);
      return r ? { ...r, version: state.ver('.tegg/vault.yml') } : null;
    },
    vault_reveal: () => { if (!state.vault) throw err('NoVault', 'fake: no vault'); state.reveals.push(String(state.path)); return null; },
    shell_settings: () => ({ ...state.shell }),
    shell_settings_set: (a) => { state.shell = { ...a.settings }; state.shellCalls.push({ ...a.settings }); return null; },
    hotkeys: () => state.hotkeys.map((h) => ({ ...h })),
    hotkeys_retry: () => state.hotkeys.map((h) => ({ ...h })),
    inbox_list: viaNode('inbox_list', '__teggInbox'),
    index_versions: (a) => ((a.paths ?? []) as string[]).map((p) => { const k = String(p).normalize('NFC'); return state.indexVer[k] ?? state.ver(k); }),
    inbox_count: viaNode('inbox_count', '__teggInbox'),
    /** The palette's `Quick Capture` / `Capture a task` and Inbox zero's `Quick Capture` (§1.3, trigger `palette`; the
     *  command name is red-test point AP-506): the capture window gets `capture:open`. */
    capture_open: (a) => {
      const kind = a?.kind === 'task' ? 'task' : 'default';
      state.captureLog.opens.push(kind);
      state.sync({ kind: 'capture-open', trigger: 'palette', captureKind: kind });
      return null;
    },
    inbox_bulk: (a) => {
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      const jobId = ++state.jobSeq;
      const paths = ((a.paths ?? []) as string[]).map((p) => String(p).normalize('NFC'));
      const change = a.change;
      const job = (state.inboxJobs[jobId] = { phase: 'queued', cancelled: false });
      const progress = (phase: string, done: number, counts?: unknown) => {
        job.phase = phase;
        return state.emit('job:progress', { jobId, kind: 'inbox', phase, done, total: paths.length, ...(counts ? { counts } : {}) });
      };
      void (async () => {
        const report: any = { jobId, kind: 'inbox', phase: 'done', written: [], unchanged: [], skipped: [] };
        const finish = async (phase: string) => {
          report.phase = phase;
          state.reports[jobId] = report;
          state.jobs.push(report);
          job.phase = phase;
          await progress(phase, phase === 'done' ? paths.length : 0, { written: report.written.length, unchanged: report.unchanged.length, skipped: report.skipped.length });
        };
        await progress('planning', 0);
        await jobs.hold('planning');
        if (job.cancelled) return finish('cancelled');
        if (change?.op === 'set-type') {
          await progress('backup', 0);
          if (job.cancelled) return finish('cancelled');
          const t = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
          state.backups.push({ name: `${t}-inbox.zip`, kind: 'inbox', time: new Date().toISOString(), manifest: null, entries: {} });
        }
        await progress('writing', 0);
        await jobs.hold('writing');
        let done = 0;
        for (const p of paths) {
          const files = state.vault!.files;
          const skip = state.jobSkips[p];
          if (skip) { delete state.jobSkips[p]; report.skipped.push({ path: p, reason: skip }); }
          else if (files[p] === undefined) report.skipped.push({ path: p, reason: 'missing' });
          else if (p in state.invalid) report.skipped.push({ path: p, reason: 'readOnly' });
          else if (state.stale.has(p)) report.skipped.push({ path: p, reason: 'changed' });
          else if (ctlOn({ path: p }) && state.control.fail === 'Io') report.skipped.push({ path: p, reason: 'io' });
          else {
            const r = await w.__teggInbox('apply', { path: p, text: files[p], change }, files, {}, []);
            const out = r?.result ?? null;
            if (out === null || out === files[p]) report.unchanged.push(p);
            else { jobs.write(p, out); report.written.push(p); }
          }
          await progress('writing', ++done);
        }
        await finish('done');
      })();
      return { jobId };
    },
    // ---------------------------------------------------------------- 6A (ms6-trash-media §4, §9.2)
    trash_list: async () => (await viaTrash('trash_list', {})).result,
    object_trash: async (a) => {
      const p = String(a.path).normalize('NFC');
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      if (!p.startsWith('.trash/') && !p.startsWith('.tegg/')) {
        const now = state.ver(p);
        if (!now && x.bin[p] === undefined) throw err('Gone', `fake: ${p} is gone`);
        const base = a.base as VersionDto | null;
        if (now && (!base || base.size !== now.size || base.hash !== now.hash)) throw { ...err('Conflict', `fake: ${p} changed`), disk: now, path: p };
      }
      const r = await viaTrash('object_trash', { path: p });
      applyMoves(r.moves, 'trash');
      return r.result;
    },
    trash_restore: async (a) => {
      const r = await viaTrash('trash_restore', { path: String(a.path).normalize('NFC') });
      applyMoves(r.moves, 'restore');
      return r.result;
    },
    trash_delete: async (a) => {
      const r = removable(await viaTrash('trash_delete', { paths: ((a.paths ?? []) as string[]).map((q) => String(q).normalize('NFC')) }));
      removeAll(r.remove, r.entries);
      return r.result;
    },
    trash_empty: async () => {
      const r = removable(await viaTrash('trash_empty', {}));
      removeAll(r.remove, r.entries);
      return r.result;
    },
    media_add: async (a) => {
      const h = headers();
      return addMedia({ b64: toB64(a), name: h.name, owner: h.owner, ownerTitle: h.ownerTitle, date: h.date });
    },
    media_add_paths: (a) => addPaths((a.paths ?? []) as string[], a.owner ?? null, a.ownerTitle ?? null, String(a.date ?? isoLocal(Date.now()).slice(0, 10))),
    media_pick: () => [...(opts.pick ?? [])],
    media_open: () => null,
    media_reveal: () => null,
    open_external: (a) => {
      const url = String(a.url);
      if (!/^(https?:|mailto:)/i.test(url)) throw err('Unsupported', `fake: scheme not allowed: ${url}`);
      state.external.push(url);
      return null;
    },
  };

  // 5B (ms5-capture §2.2): the capture window's commands; every other command is refused as the ACL does (§2.1).
  const capture: Record<string, (a: any) => unknown> = {
    capture_context: async () => {
      if (!state.vault) return { vault: null, types: [], defaultType: 'quick-note', tags: [] };
      const r = await w.__teggSettings('capture_context', {}, state.vault.files, {});
      const tags = (await w.__teggTags('capture_tags', {}, state.vault.files, {})).result; // 4D-lite: CaptureTagDto[] (D-655)
      return { vault: { id: `vault-${state.vaultId}`, name: state.vault.name, color: null }, types: r.result.types, defaultType: r.result.defaultType, tags };
    },
    capture_create: async (a) => {
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      if (String(a.vault) !== `vault-${state.vaultId}`) throw err('VaultChanged', 'fake: another vault is open');
      if (state.control.hold) await new Promise<void>((r) => state.held.push(r));
      if (state.control.delayMs) await new Promise((r) => setTimeout(r, state.control.delayMs));
      if (state.control.fail === 'Io') throw err('Io', 'fake: write failed (Io)');
      const r = await w.__teggSettings('capture_plan', { type: a.type, title: a.title, text: a.text }, state.vault.files, {});
      const plan = r.result;
      if (plan.error) throw plan.error;
      // 6A (ms6-trash-media §5, D-624): the staged files first (pairs), then the note with one embed paragraph each.
      let text = String(a.text);
      const tokens = ((a.media ?? []) as string[]).map(String);
      if (tokens.length) {
        const embeds: string[] = [];
        const title = String(a.title ?? '').trim();
        for (const tk of tokens) {
          const b64 = x.stagedBytes[tk];
          const name = x.staged.find((s0: any) => s0.token === tk)?.name ?? tk;
          if (b64 === undefined) throw err('Io', `fake: no staged file ${tk}`);
          const added: any = await addMedia({ b64, name, owner: plan.path, ownerTitle: title || null, date: isoLocal(Date.now()).slice(0, 10) });
          embeds.push(`![[${added.embed}]]`);
        }
        text = [text.replace(/\n+$/, ''), ...embeds].filter((part) => part !== '').join('\n\n') + '\n';
        x.staged = [];
        x.stagedBytes = {};
      }
      state.vault.files[plan.path] = text;
      state.touch(plan.path);
      state.writtenPaths.push(plan.path);
      return { path: plan.path, title: String(a.title).normalize('NFC'), typeName: plan.typeName };
    },
    // v0.52 (ms5-capture §16.1, D-603): the switcher's matching as `{ link, title, type, alias }`, at most 8, no create
    // rows; `link` is the D-184 link text (the file stem, or the vault path without `.md` when the stem isn't unique).
    capture_suggest: async (a) => {
      if (!state.vault) throw err('NoVault', 'fake: no vault');
      const items = (await handlers.index_switcher({ q: String(a?.query ?? ''), limit: 30 })) as any[];
      const stemOf = (p: string) => p.split('/').pop()!.replace(/\.md$/, '').normalize('NFC').toLowerCase();
      const stems: Record<string, number> = {};
      for (const o of objects()) stems[stemOf(o.path)] = (stems[stemOf(o.path)] ?? 0) + 1;
      return items.filter((x) => x.kind === 'object').slice(0, 8).map((x) => ({
        link: (stems[stemOf(x.path)] ?? 0) > 1 ? String(x.path).replace(/\.md$/, '') : String(x.path).split('/').pop()!.replace(/\.md$/, ''),
        title: x.title, type: x.type, alias: x.matched_alias ?? null,
      }));
    },
    // 6A (ms6-trash-media §5): stages files in the page's memory, never the vault; reads no vault file.
    capture_media_add: async (a) => {
      if (isRaw(a)) return [await stage(toB64(a), headers().name)];
      const paths = a?.pick ? [...(opts.pick ?? [])] : ((a?.paths ?? []) as string[]);
      const out: any[] = [];
      for (const raw of paths) {
        const p = String(raw).normalize('NFC');
        const name = p.split('/').filter(Boolean).pop() ?? p;
        const b64 = init.outside[p];
        out.push(b64 === undefined ? { error: dirOutside(p) ? 'Refused' : 'Io', name } : await stage(b64, name));
      }
      return out;
    },
    capture_ready: (a) => { state.captureLog.ready.push(Number(a.seq)); return null; },
    capture_hide: () => { state.captureLog.hides++; return null; },
    capture_resize: () => null,
    capture_open_main: (a) => {
      const p = a.path === null || a.path === undefined ? null : String(a.path).normalize('NFC');
      state.captureLog.openMain.push(p);
      if (p) state.sync({ kind: 'route', route: `note/${p}` });
      return null;
    },
    capture_draft_get: () => (state.draft ? { ...state.draft } : null),
    capture_draft_set: (a) => { state.draft = a.draft ? { ...a.draft } : null; return null; },
    capture_saved_show: (a) => {
      const payload = { typeName: String(a.typeName), title: String(a.title), path: String(a.path) };
      state.captureLog.saved.push(payload);
      state.sync({ kind: 'saved', payload });
      return null;
    },
  };

  w.__teggMocks.mockWindows(opts.window === 'capture' ? 'capture' : 'main');
  // 6A (ms6-trash-media §3.6): media URLs go to the fake's `/__media/` route (WebKit can't route custom schemes).
  w.__TEGG_MEDIA_BASE__ = `${location.origin}/__media/`;
  w.__teggMocks.mockIPC((cmd: string, args: any) => {
    const rec: { cmd: string; args: unknown; at?: number; seq?: number; endSeq?: number; ok?: boolean; endAt?: number; result?: unknown } =
      { cmd, args: args === undefined ? undefined : JSON.parse(JSON.stringify(args ?? null)), at: Date.now(), seq: ++state.seq };
    state.calls.push(rec);
    if (opts.window === 'capture' && !cmd.startsWith('plugin:event|')) {
      const c = capture[cmd];
      if (!c) { rec.ok = false; return Promise.reject(err('Forbidden', `fake ACL: ${cmd} is not allowed from the capture window`)); }
      let out: Promise<unknown>;
      try { out = Promise.resolve(c(args ?? {})); } catch (e) { out = Promise.reject(e); }
      return out.then((v) => { rec.ok = true; rec.result = v === undefined ? undefined : JSON.parse(JSON.stringify(v)); return v; }, (e) => { rec.ok = false; rec.result = JSON.parse(JSON.stringify(e ?? null)); throw e; });
    }
    if (opts.window !== 'capture' && cmd in capture && cmd !== 'capture_open') { rec.ok = false; return Promise.reject(err('Forbidden', `fake ACL: ${cmd} is a capture-window command`)); }
    const h = handlers[cmd];
    if (!READS.has(cmd) && cmd !== 'vault_create' && cmd !== 'note_create') state.writes++; // those two count themselves
    if (!h) throw err('Io', `fake core: unknown command ${cmd}`);
    const settle = (ok: boolean) => { rec.endSeq = ++state.seq; rec.ok = ok; rec.endAt = Date.now(); };
    let out: Promise<unknown>;
    try { out = Promise.resolve(h(args ?? {})); } catch (e) { out = Promise.reject(e); }
    return out.then((v) => { settle(true); rec.result = v === undefined ? undefined : JSON.parse(JSON.stringify(v)); return v; }, (e) => { settle(false); rec.result = JSON.parse(JSON.stringify(e ?? null)); throw e; });
  }, { shouldMockEvents: true });
  // 6A (ms6-trash-media §4): the mock drops invoke options; raw-body commands read their headers from here.
  const invokeMocked = w.__TAURI_INTERNALS__.invoke;
  w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown, options: unknown) => {
    x.lastOptions = options ?? null;
    return invokeMocked(cmd, args, options);
  };
}
