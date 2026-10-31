// Slice G3 (docs/contracts/v1-graph.md §16.3; R118, R119; AP-928…AP-931): the pure preset model of a graph view. The
// name rules mirror the core's (§16.1, §16.8 4): NFC and trimmed, compared case-insensitively, never by region.
import type { EdgeKindDto, GraphPresetDto, GraphViewStateDto } from './types';

/** §16.1's name errors, for the live messages under the Save field and the rename field (R119). */
export type NameError = { kind: 'NameEmpty' } | { kind: 'NameTaken'; existing: string } | { kind: 'NameTooLong' } | { kind: 'NameControl' };

const DEFAULT = 'Default';
const MAX_NAME = 100;
// Any `Cc` character (U+0000…U+001F, U+007F…U+009F), D-1115.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const nfc = (s: string) => s.normalize('NFC');
/** Unicode White_Space trim, as the core (JS `trim` also strips U+FEFF). */
export const trimWs = (s: string) => s.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
/** The comparison form of a name (D-907): trimmed, NFC, lower case without a locale (FR-FMT-12 AC-7). */
export const nameKey = (s: string) => nfc(trimWs(s)).toLowerCase();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map(nfc)), y = new Set(b.map(nfc));
  return x.size === y.size && [...x].every((k) => y.has(k));
};

/** The view's current preset: its stored `preset` matched by NFC, case-insensitively, against the listed presets;
 *  `null` is Default (also for a name no longer listed, AP-930). */
export function currentPreset(view: GraphViewStateDto, presets: GraphPresetDto[]): GraphPresetDto | null {
  if (typeof view.preset !== 'string') return null;
  const key = nameKey(view.preset);
  if (key === nameKey(DEFAULT)) return null;
  return presets.find((p) => nameKey(p.name) === key) ?? null;
}
/** AP-929: the view's hidden types or kinds, as sets of NFC keys (unknown keys included), differ from the preset's
 *  (Default, `null`: both empty). Depth, size, `Show all` and the view don't count. */
export function isModified(view: GraphViewStateDto, preset: GraphPresetDto | null): boolean {
  return !sameSet(strings(view.hiddenTypes), preset?.hiddenTypes ?? []) || !sameSet(strings(view.hiddenKinds), preset?.hiddenKinds ?? []);
}
/** AP-928 (mirrors the core): a control character in the input; then trimmed and NFC: empty, longer than 100 scalar
 *  values, taken (case-insensitive, against `presets` and `Default`; a case variant of `renaming` itself is allowed).
 *  `null`: valid. */
export function validateName(name: string, presets: GraphPresetDto[], renaming?: string): NameError | null {
  // The core's order (§16.1): control characters in the raw input, then trimmed and NFC: empty, too long, taken.
  if (CONTROL.test(name)) return { kind: 'NameControl' };
  const n = nfc(trimWs(name));
  if (n === '') return { kind: 'NameEmpty' };
  if ([...n].length > MAX_NAME) return { kind: 'NameTooLong' };
  const key = n.toLowerCase();
  if (key === nameKey(DEFAULT)) return { kind: 'NameTaken', existing: DEFAULT };
  const own = renaming === undefined ? null : nameKey(renaming);
  const other = presets.find((p) => nameKey(p.name) === key && nameKey(p.name) !== own);
  if (other) return { kind: 'NameTaken', existing: nfc(other.name) };
  return null;
}
/** The next view state after applying `preset` (`null`: Default): its hidden types and kinds and `preset` = its name
 *  (Default removes `preset`); depth, `sizeByLinks` and `view` are kept. Unknown keys stay in the state (D-907, §16.4). */
export function applyPreset(view: GraphViewStateDto, preset: GraphPresetDto | null): GraphViewStateDto {
  const { preset: _old, ...rest } = view;
  void _old;
  if (!preset) return { ...rest, hiddenTypes: [], hiddenKinds: [] };
  return { ...rest, hiddenTypes: [...preset.hiddenTypes], hiddenKinds: [...preset.hiddenKinds] as EdgeKindDto[], preset: nfc(preset.name) };
}
