// Slice G3 (docs/contracts/v1-graph.md §16.3; R118, R119; AP-928…AP-931): the pure preset model of a graph view.
// Red-test stub (TS-I1): the contract's signatures, not implemented yet.
import type { GraphPresetDto, GraphViewStateDto } from './types';

/** §16.1's name errors, for the live messages under the Save field and the rename field (R119). */
export type NameError = { kind: 'NameEmpty' } | { kind: 'NameTaken'; existing: string } | { kind: 'NameTooLong' } | { kind: 'NameControl' };

/** The view's current preset: its stored `preset` matched by NFC, case-insensitively, against the listed presets;
 *  `null` is Default (also for a name no longer listed, AP-930). */
export function currentPreset(view: GraphViewStateDto, presets: GraphPresetDto[]): GraphPresetDto | null {
  void view; void presets;
  throw new Error('presets.currentPreset: not implemented (G3)');
}
/** AP-929: the view's hidden types or kinds, as sets of NFC keys (unknown keys included), differ from the preset's
 *  (Default, `null`: both empty). Depth, size, `Show all` and the view don't count. */
export function isModified(view: GraphViewStateDto, preset: GraphPresetDto | null): boolean {
  void view; void preset;
  throw new Error('presets.isModified: not implemented (G3)');
}
/** AP-928 (mirrors the core): trimmed and NFC; empty, taken (case-insensitive, against `presets` and `Default`; a case
 *  variant of `renaming` itself is allowed), longer than 100 scalar values, or a control character. `null`: valid. */
export function validateName(name: string, presets: GraphPresetDto[], renaming?: string): NameError | null {
  void name; void presets; void renaming;
  throw new Error('presets.validateName: not implemented (G3)');
}
/** The next view state after applying `preset` (`null`: Default): its hidden types and kinds and `preset` = its name
 *  (Default removes `preset`); depth, `sizeByLinks` and `view` are kept. */
export function applyPreset(view: GraphViewStateDto, preset: GraphPresetDto | null): GraphViewStateDto {
  void view; void preset;
  throw new Error('presets.applyPreset: not implemented (G3)');
}
