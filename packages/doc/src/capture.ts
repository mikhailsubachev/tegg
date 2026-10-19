// Slice 5B (docs/contracts/ms5-capture.md §3.1; D-539): the title, body and trailing tags of a capture's text (R57).
// STUB (TS-I1): exists and compiles, returns a deliberately wrong result until 5B is built.

export type CaptureParts = {
  /** '' when no line has non-space characters (the UI saves `Untitled`, D-523). */
  title: string
  /** '' or ending with exactly one '\n'. */
  body: string
  /** Trailing `#tag` tokens of the title line, in order, as written (without '#'). */
  tags: string[]
  /** The title line is kept as the body's first paragraph (it held a link, D-491). */
  keptTitleLine: boolean
}

/** R57 (D-539): NFC, CRLF → LF. `linkTitle` gives a link's target title when it has no alias. STUB: nothing. */
export function captureParts(_text: string, _linkTitle: (target: string) => string | null): CaptureParts {
  return { title: '', body: '', tags: [], keptTitleLine: false }
}
