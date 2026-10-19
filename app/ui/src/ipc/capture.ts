// The capture window's only client (docs/contracts/ms5-capture.md §2.2; NFR-SEC-03, D-552, D-553): the commands its
// capability allows and the events it listens to. The main window's `ipc/client.ts` is never imported here.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CaptureContextDto, CaptureDraftDto, CapturedDto, DateTimeUiDto } from './types';

export type CaptureOpen = { seq: number; trigger: string; kind: 'default' | 'task' };
export type CaptureSaved = { typeName: string; title: string; path: string };

export const captureIpc = {
  context: () => invoke<CaptureContextDto>('capture_context'),
  create: (vault: string, type: string, title: string, text: string) => invoke<CapturedDto>('capture_create', { vault, type, title, text }),
  ready: (seq: number) => invoke<void>('capture_ready', { seq }),
  hide: () => invoke<void>('capture_hide'),
  resize: (height: number) => invoke<void>('capture_resize', { height }),
  openMain: (path: string | null) => invoke<void>('capture_open_main', { path }),
  draftGet: () => invoke<CaptureDraftDto | null>('capture_draft_get'),
  draftSet: (draft: CaptureDraftDto | null) => invoke<void>('capture_draft_set', { draft }),
  savedShow: (typeName: string, title: string, path: string) => invoke<void>('capture_saved_show', { typeName, title, path }),
};

export type CaptureUiState = { theme?: string; dateTime?: DateTimeUiDto | null };

export const captureEvents = {
  open: (f: (o: CaptureOpen) => void): Promise<UnlistenFn> => listen<CaptureOpen>('capture:open', (e) => f(e.payload)),
  contextChanged: (f: () => void): Promise<UnlistenFn> => listen('capture:context-changed', () => f()),
  saved: (f: (s: CaptureSaved) => void): Promise<UnlistenFn> => listen<CaptureSaved>('capture:saved', (e) => f(e.payload)),
  /** §4: the app's theme and Date & time choices changed (emitted by `ui_state_set`). */
  uiState: (f: (s: CaptureUiState) => void): Promise<UnlistenFn> => listen<CaptureUiState>('ui:state', (e) => f(e.payload)),
};
