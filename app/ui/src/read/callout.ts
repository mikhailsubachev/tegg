// Callout types (FR-EDT-02 AC-3; ms3-shell §11.3).
// STUB (TS-I1): compiles and returns a deliberately wrong result until slice 3B is built.
export const CALLOUT_TYPES: readonly string[] = [];

export function calloutType(_raw: string): { type: string; label: string; fold: '+' | '-' | null; title: string | null } {
  return { type: '', label: '', fold: null, title: null };
}
