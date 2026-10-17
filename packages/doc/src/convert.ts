// Slice 5A-2 (ms5-tasks §11.1; D-490, D-491, D-495): the conversion text helpers — the unit a selection converts, the
// new object's title, tags and body, and the host text with the unit replaced by an embed.
// STUB (TS-I1): every function exists and compiles but returns a deliberately wrong result until 5A-2 is built.

/** The unit a selection converts (R51, D-490, D-493). Offsets are UTF-16 indexes into the whole file text. */
export type ConvertUnit = {
  kind: 'blocks' | 'items' | 'nested-item'
  /** Start of the unit's first line. */
  from: number
  /** End of its last line, without the line break. */
  to: number
  /** R50 summary: top-level blocks, or items of the run (nested children not counted). */
  count: number
  first: 'paragraph' | 'heading' | 'item' | 'quote' | 'callout' | 'other'
  /** The first item's `[x]` / `[ ]`; null when it isn't a checklist item. */
  checked: boolean | null
}

/** STUB: no unit. */
export function conversionUnit(_text: string, _selFrom: number, _selTo: number): ConvertUnit | null {
  return null
}

/** STUB: an empty object. */
export function objectFromUnit(
  _text: string,
  unit: ConvertUnit,
  _linkTitle: (target: string) => string | null,
): { title: string; tags: string[]; body: string; checked: boolean | null } {
  return { title: '', tags: [], body: '', checked: unit.checked }
}

/** STUB: the host text unchanged. */
export function replaceUnitWithEmbed(text: string, _unit: ConvertUnit, _target: string): { text: string; embedFrom: number; embedTo: number } {
  return { text, embedFrom: 0, embedTo: 0 }
}
