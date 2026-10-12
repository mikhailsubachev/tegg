// The only module that talks to the shell (architecture §10: UI ↔ core through one client).
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ChangedDto, ConflictDto, NoteDto, ProgressDto, SearchPageDto, SearchQueryDto, SwitcherItemDto, VaultInfo } from './types';

export const ipc = {
  vaultCurrent: () => invoke<VaultInfo | null>('vault_current'),
  vaultOpen: (path: string) => invoke<VaultInfo>('vault_open', { path }),
  search: (query: SearchQueryDto) => invoke<SearchPageDto>('index_search', { query }),
  switcher: (q: string, limit = 30) => invoke<SwitcherItemDto[]>('index_switcher', { q, limit }),
  noteRead: (path: string) => invoke<NoteDto>('note_read', { path }),
  noteCreate: (dir: string, title: string, text: string) => invoke<string>('note_create', { dir, title, text }),
  perfMark: (name: string) => invoke<void>('perf_mark', { name }),
};

export const events = {
  progress: (f: (p: ProgressDto) => void): Promise<UnlistenFn> => listen<ProgressDto>('index:progress', (e) => f(e.payload)),
  changed: (f: (c: ChangedDto) => void): Promise<UnlistenFn> => listen<ChangedDto>('vault:changed', (e) => f(e.payload)),
  conflict: (f: (c: ConflictDto) => void): Promise<UnlistenFn> => listen<ConflictDto>('note:conflict', (e) => f(e.payload)),
};
