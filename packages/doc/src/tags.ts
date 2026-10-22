// Slice 4D-lite (docs/contracts/ms4-tags.md §2): tag names and Tag file bytes. Stubs until the slice is built: each
// returns a deliberately wrong result so the AC tests fail on their assertions, never on an import (TS-I1).

export type TagNameResult =
  | { ok: true; name: string; key: string }
  | { ok: false; error: 'empty' | 'space' | 'digits' | 'char'; char?: string }

/** D-642, D-658. Drops one leading `#`; NFC; then dialect §5 tag text. 4D-lite stub. */
export function tagName(input: string): TagNameResult {
  void input
  return { ok: false, error: 'empty' }
}

/** D-641, R86. `now` is ISO 8601 with offset (the UI's clock, ms5-tasks §1). Ends with `---\n`. 4D-lite stub. */
export function tagFile(f: { id: string; title: string; color?: string; now: string }): string {
  void f
  return ''
}

/** D-653: sets or removes `color` and touches `modified` (only those lines change). 4D-lite stub: the input unchanged. */
export function setTagColor(text: string, color: string | null, now: string): string {
  void color
  void now
  return text
}
