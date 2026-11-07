// Slice PIN (docs/contracts/v1-pinned.md §2): the pins DTOs, hand-written as graph/types.ts.
import type { VersionDto } from './types';

export type PinStoredDto =
  | { kind: 'object'; id: string | null; path: string | null }
  | { kind: 'tag'; key: string }
  | { kind: 'type'; key: string };
export type PinState = 'ok' | 'pending' | 'trashed' | 'missing' | 'noObjects';
/** One row of the section: a listed pin and what it resolves to (R131, R133). `index` is 0-based among listed pins. */
export type PinRowDto = {
  index: number;
  target: PinStoredDto;
  state: PinState;
  path: string | null; title: string | null; type: string | null; date: string | null;
};
export type PinsDto = {
  version: VersionDto | null;
  state: 'missing' | 'ok' | 'newer' | 'unreadable';
  error: { line: number | null; reason: string } | null;
  patchable: boolean;
  indexReady: boolean;
  rows: PinRowDto[];
};
export type PinRequestDto = { kind: 'object'; path: string } | { kind: 'tag'; key: string } | { kind: 'type'; key: string };
/** `at` / `to` are 0-based final positions among listed pins; `at: null` is the end. */
export type PinOpDto =
  | { op: 'pin'; target: PinRequestDto; at: number | null }
  | { op: 'unpin'; index: number }
  | { op: 'move'; from: number; to: number };
