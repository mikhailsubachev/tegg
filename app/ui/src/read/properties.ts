// Attribute strip rows (FR-TYP-08 display, D-147; ms3-shell §11.3).
// STUB (TS-I1): compiles and returns a deliberately wrong result until slice 3B is built.
import type { Doc } from '@tegg/doc';

export type AttrRow = {
  key: string;
  label: string;
  value:
    | { kind: 'text' | 'number'; text: string }
    | { kind: 'checkbox'; checked: boolean }
    | { kind: 'date'; date: string }
    | { kind: 'datetime'; datetime: string }
    | { kind: 'range'; start: string; end: string }
    | { kind: 'tags'; tags: string[] }
    | { kind: 'links'; targets: string[] }
    | { kind: 'list'; items: string[] }
    | { kind: 'review'; value: string }
    | { kind: 'yaml'; source: string };
};

export function attributeRows(_doc: Doc): { subtitle: string | null; rows: AttrRow[] } {
  return { subtitle: null, rows: [] };
}
