// Slice 5A-2 (ms5-tasks §11.4): the conversion's machine-local preferences in UiStateDto.convert (D-128, never in the
// vault): the last type converted into (D-493 preselection) and FR-CNV-08's `Don't ask again` (D-496). The app owns
// the UI state and registers how to read and change it, so one writer keeps the whole state.
import type { ConvertUiDto } from '../ipc/types';

const DEFAULT: ConvertUiDto = { lastType: null, skipRemoveConfirm: false };
let impl: { get: () => ConvertUiDto | undefined; set: (c: ConvertUiDto) => void } | null = null;

export function registerConvertPrefs(i: typeof impl): void {
  impl = i;
}

export function convertPrefs(): ConvertUiDto {
  return { ...DEFAULT, ...(impl?.get() ?? {}) };
}

export function setConvertPrefs(change: Partial<ConvertUiDto>): void {
  impl?.set({ ...convertPrefs(), ...change });
}
