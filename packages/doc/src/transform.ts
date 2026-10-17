// Slice 4C (docs/contracts/ms4-jobs.md §2.3): the text side of the job engine. Rust plans and writes; every byte change
// comes from here (one text engine, D-82). Link form rules: D-383; frontmatter links: D-388; NFC: FR-FMT-12.
//
// Stub (slice 4C red tests): `transform` and `rewriteLinks` answer `{ kind: 'unchanged' }` until 4C is built, so a
// test fails on its assertion, never on an import error (TS-I1).

export type TextOp =
  | { op: 'retarget-links'; fromPath: string; fromStem: string; fromTitle: string; toPath: string; toStem: string; toTitle: string; paths: string[] }
  | { op: 'set-title'; title: string; now: string }

export type Transformed = { kind: 'bytes'; text: string; edits: { start: number; end: number }[] } | { kind: 'unchanged' }

/** Applies `ops` in order (D-82). Byte offsets in `edits` are UTF-8 offsets into the input. */
export function transform(source: string, text: string, ops: TextOp[]): Transformed {
  void source
  void text
  void ops
  return { kind: 'unchanged' }
}

/** The link rewrite alone (FR-LNK-03 AC-7, AC-9, AC-20). Same edit rules as `transform`. */
export function rewriteLinks(source: string, text: string, op: Extract<TextOp, { op: 'retarget-links' }>): Transformed {
  return transform(source, text, [op])
}
