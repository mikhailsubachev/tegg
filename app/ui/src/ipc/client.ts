// The only module that talks to the shell (architecture §10: UI ↔ core through one client).
// Commands: docs/contracts/ms2-shell.md §2, ms3-shell.md §2.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ChangedDto, ConflictDto, ConflictRowDto, LastOpenedDto, LinkTargetDto, NoteDto, ObjectRowDto, ProgressDto, SearchPageDto,
  SearchQueryDto, SwitcherItemDto, TagDto, TypeDefDto, UiStateDto, VaultInfo, VersionDto, WriteResultDto,
} from './types';

export const ipc = {
  vaultCurrent: () => invoke<VaultInfo | null>('vault_current'),
  vaultOpen: (path: string) => invoke<VaultInfo>('vault_open', { path }),
  vaultCreate: (parent: string, name: string, kind: 'empty' | 'starter') => invoke<VaultInfo>('vault_create', { parent, name, kind }),
  vaultPickDir: () => invoke<string | null>('vault_pick_dir'),
  vaultLast: () => invoke<LastOpenedDto | null>('vault_last'),
  vaultTypes: () => invoke<TypeDefDto[]>('vault_types'),
  typeCounts: () => invoke<Record<string, number>>('index_type_counts'),
  list: (type: string) => invoke<ObjectRowDto[]>('index_list', { type }),
  search: (query: SearchQueryDto) => invoke<SearchPageDto>('index_search', { query }),
  switcher: (q: string, limit = 30) => invoke<SwitcherItemDto[]>('index_switcher', { q, limit }),
  noteRead: (path: string) => invoke<NoteDto>('note_read', { path }),
  noteCreate: (dir: string, title: string, text: string) => invoke<string>('note_create', { dir, title, text }),
  navOpened: (path: string) => invoke<void>('nav_opened', { path }),
  uiStateGet: () => invoke<UiStateDto>('ui_state_get'),
  uiStateSet: (state: UiStateDto) => invoke<void>('ui_state_set', { state }),
  perfMark: (name: string) => invoke<void>('perf_mark', { name }),
  /** NFR-PERF-06 AC-3 (D-199): one typing-latency record per keystroke. */
  perfKey: (frame: number, ms: number) => invoke<void>('perf_mark', { name: 'key', mark: 'key', frame, ms }),
  // 3C (ms3-shell §13.2).
  noteWrite: (path: string, text: string, base: VersionDto | null) => invoke<WriteResultDto>('note_write', { path, text, base }),
  noteCreateExact: (path: string, text: string) => invoke<VersionDto>('note_create_exact', { path, text }),
  noteTrash: (path: string, base: VersionDto) => invoke<string>('note_trash', { path, base }),
  tags: () => invoke<TagDto[]>('index_tags'),
  conflicts: () => invoke<ConflictRowDto[]>('index_conflicts'),
  /** The open note is saved, or the user chose to quit anyway (D-196). */
  appQuit: () => invoke<void>('app_quit'),
  linkResolve: (from: string, targets: string[]) => invoke<LinkTargetDto[]>('link_resolve', { from, targets }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
};

export const events = {
  progress: (f: (p: ProgressDto) => void): Promise<UnlistenFn> => listen<ProgressDto>('index:progress', (e) => f(e.payload)),
  changed: (f: (c: ChangedDto) => void): Promise<UnlistenFn> => listen<ChangedDto>('vault:changed', (e) => f(e.payload)),
  conflict: (f: (c: ConflictDto) => void): Promise<UnlistenFn> => listen<ConflictDto>('note:conflict', (e) => f(e.payload)),
  /** ⌘Q, the Quit Apple Event or closing the window: flush first (FR-EDT-08 AC-7). */
  quitRequested: (f: () => void): Promise<UnlistenFn> => listen('app:quit-requested', () => f()),
};

/** A core error's kind, for the catalog message `error.<kind>` (NFR-OTH-02 AC-2); never its message text. */
export function errorKind(e: unknown): string {
  const k = (e as { kind?: unknown } | null)?.kind;
  return typeof k === 'string' ? k : 'Unknown';
}
