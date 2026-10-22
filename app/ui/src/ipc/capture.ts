// The capture window's only client (docs/contracts/ms5-capture.md §2.2; NFR-SEC-03, D-552, D-553): the commands its
// capability allows and the events it listens to. The main window's `ipc/client.ts` is never imported here.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CaptureContextDto, CaptureDraftDto, CapturedDto, CaptureSuggestDto, DateTimeUiDto, StagedMediaResultDto } from './types';

export type CaptureOpen = { seq: number; trigger: string; kind: 'default' | 'task' };
export type CaptureSaved = { typeName: string; title: string; path: string; heading?: string | null };

export const captureIpc = {
  context: () => invoke<CaptureContextDto>('capture_context'),
  create: (vault: string, type: string, title: string, text: string, media: string[] = []) => invoke<CapturedDto>('capture_create', { vault, type, title, text, media }),
  /** 6A (ms6-trash-media §5, D-620): stages files in the shell (never the vault): pasted bytes, dropped paths, or the picker. */
  mediaBytes: (bytes: Uint8Array, name: string) => invoke<StagedMediaResultDto[]>('capture_media_add', bytes, { headers: { 'x-tegg-name': encodeURIComponent(name) } }),
  mediaPaths: (paths: string[]) => invoke<StagedMediaResultDto[]>('capture_media_add', { paths }),
  mediaPick: () => invoke<StagedMediaResultDto[]>('capture_media_add', { pick: true }),
  ready: (seq: number) => invoke<void>('capture_ready', { seq }),
  hide: () => invoke<void>('capture_hide'),
  resize: (height: number) => invoke<void>('capture_resize', { height }),
  openMain: (path: string | null) => invoke<void>('capture_open_main', { path }),
  draftGet: () => invoke<CaptureDraftDto | null>('capture_draft_get'),
  draftSet: (draft: CaptureDraftDto | null) => invoke<void>('capture_draft_set', { draft }),
  /** D-603: link suggestions for `[[` and `@` (no body, excerpt or path). */
  suggest: (query: string) => invoke<CaptureSuggestDto[]>('capture_suggest', { query }),
  /** `heading`: D-604's `Saved to <plural>` on a type without the review workflow (default `Saved to Inbox`). */
  savedShow: (typeName: string, title: string, path: string, heading?: string) => invoke<void>('capture_saved_show', { typeName, title, path, heading: heading ?? null }),
};

export type CaptureUiState = { theme?: string; dateTime?: DateTimeUiDto | null };

export const captureEvents = {
  open: (f: (o: CaptureOpen) => void): Promise<UnlistenFn> => listen<CaptureOpen>('capture:open', (e) => f(e.payload)),
  contextChanged: (f: () => void): Promise<UnlistenFn> => listen('capture:context-changed', () => f()),
  saved: (f: (s: CaptureSaved) => void): Promise<UnlistenFn> => listen<CaptureSaved>('capture:saved', (e) => f(e.payload)),
  /** §4: the app's theme and Date & time choices changed (emitted by `ui_state_set`). */
  uiState: (f: (s: CaptureUiState) => void): Promise<UnlistenFn> => listen<CaptureUiState>('ui:state', (e) => f(e.payload)),
};
