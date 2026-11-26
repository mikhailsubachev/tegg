// Slice AND-3 (docs/contracts/android-edit.md §2.2; FR-EDT-08 AC-17, CP-4): the recovery copy's DTO. Hand-written until
// the ts-rs binding (`RecoveryDto` in app/src-tauri/src/dto.rs) lands in `types.ts`; the shapes are the same.
import type { VersionDto } from './types';

export type RecoveryDto = { vault: string; path: string; id: string | null; title: string; text: string; base: VersionDto | null; savedAt: string };
