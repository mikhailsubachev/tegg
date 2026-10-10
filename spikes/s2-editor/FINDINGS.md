# Spike S2 Findings: TipTap Block Editor on Source-Preserving Documents

**Date:** 2026-10-10 · **Branch:** `spike/s2-editor` · **Decision record:** [ADR 0002](../../docs/adr/0002-editor-on-source-blocks.md) · **Builds on:** S1 / [ADR 0001](../../docs/adr/0001-source-preserving-documents.md)

## Verdict: GO

A real TipTap 3 editor (ProseMirror) works on top of S1's source-preserving model. Each top-level editor block remembers the source block it came from (`srcIndex`). Saving (`reconcile`) emits every untouched block byte-for-byte, renders only blocks the user changed, and verifies the result by re-parsing. The editor model is never serialized whole.

| Check | Result |
| --- | --- |
| Unedited open → save through the editor, all 43 fixtures (FR-FMT-07 AC-1/AC-2) | 43 / 43 byte-identical, and nothing is written on open |
| Editing operations on every block of every fixture: type, insert, delete, split (Enter), join (Backspace), turn into list / heading / quote, move (S2-QA AC-1) | 1,278 / 1,278: every unchanged block byte-identical |
| Obsidian inline syntax kept when its block is edited: links, embeds, tags, `==hl==`, `%%c%%`, `$m$`, `^id`, footnote refs, inline HTML, Markdown images (S2-QA AC-2) | all pass |
| Property test: random sequences of editor commands on random fixtures | 9 seeds × 500–1,000 runs, pass |
| WebKit, real UI, fake core over mocked Tauri IPC: open → type → save, exact bytes asserted, incl. BOM, CRLF, raw HTML, `*` marker (S2-QA AC-3) | pass |
| Typing-latency proxy cross-checked with the browser's Event Timing API (S2-QA AC-4) | agree (see Performance) |
| Blocks that had to be shown read-only because the editor can't represent them losslessly | 1 of 131 (fixtures) |
| Real exports, run before D-62 (counts only): unedited saves byte-identical; typing edits confined | Capacities 697/697, 2,548/2,548, read-only 1 of 2,622 blocks; Notion 226/226, 757/757, read-only 1 of 890. **The owner should re-run `npm run test:real` on the final code** (the trailing-space fix came after). |

Tests: 1,345 vitest (`npm test`) + 2 Playwright (`npm run test:webkit`, `npx playwright test e2e/perf.spec.ts`). S1 suite: 387, still green with the core additions.

## What the spike found

Every item below would have silently damaged notes or blocked the user. All are fixed and regression-tested.

| # | Problem | Fix |
| --- | --- | --- |
| E1 | `==highlight==`, `%%comment%%` and `$math$` would be escaped or dropped when their block is edited (S1 open item 3) | Syntax extensions in the S1 core (`src/inline.ts`, `micromark-extension-math`); highlight content is parsed for nested emphasis |
| E2 | **Editor plugins change notes on open**: the table plugin adds a cell to a ragged GFM row (a `\|` in a code span counts as a separator), so opening would rewrite the table | Generic guard (`attach`): any block the editor changed by itself on load becomes read-only raw |
| E3 | **Deleting or moving a block can merge two lists**: in Markdown a blank line doesn't separate two `-` lists | Save gives one of the lists another marker (`-` → `*`, `1.` → `1)`); only marker bytes of that list change (6 cases across all fixture operations) |
| E4 | **An indented code block moved below a list becomes part of the list**, whatever the blank lines (CommonMark rule) | Last-resort `<!-- -->` separator between them (standard CommonMark idiom, invisible in Obsidian reading view). Rare: Obsidian users write fenced code |
| E5 | The first losslessness check compared text with the standard rendering, which escapes `(1)` → `\(1\)`; this made 190 real Capacities blocks read-only (links to `… (1).md` files) | Semantic check: what the editor would write, read back (with the note's footnote/link definitions as context), must give exactly the same editor content. 190 → 1 |
| E6 | `[[` autocomplete left a stray `[` (`\[[[Note]]`): the suggestion range of a two-character trigger starts at the second bracket | `insertLink` removes both brackets (found in manual testing) |
| E7 | **Autosave while typing wrote `word&#x20;`**: to-markdown encodes trailing spaces of a paragraph | Leading/trailing spaces of paragraphs, headings and cells are trimmed before rendering (Markdown ignores them anyway); regression test `bug_s2_trailing_space_…` |

Expected editor behaviour, not bugs: turning a paragraph next to a list into a list joins them (like Notion); typing right after `*italic*` continues the italic; a typed `[[` without picking a suggestion stays literal text (`\[\[`), never a broken link.

## Performance (this Mac, Apple Silicon; generated 5,000-word note, `src/ui/largeNote.ts`)

Measured with Playwright typing at a realistic pace (one key per 40 ms):

| Metric | WebKit | Chromium | Target (NFR) |
| --- | --- | --- | --- |
| Open: parse → painted (PERF-05) | 128 ms | 134 ms | < 150 ms (D-59 reference: < 112 ms) |
| Typing, app proxy keydown → next frame, p50 / p95 / max (PERF-06) | 8 / 16 / 17 ms | 1.5 / 16.1 / 16.6 ms | < 16 ms (D-59 reference: < 12 ms) |
| Typing, Event Timing API: keydowns ≥ 16 ms input → paint | max 16 ms | max 16 ms | |
| Save: reconcile + verify (autosave, debounced) | 29 ms | 29 ms | (no target) |

- **S2-QA AC-4, the proxy is validated:** the browser's own Event Timing measurement (input → next paint) and the app's proxy agree on both engines: no keystroke above ~16 ms. A manual session in the in-app browser pane was **not** valid (keys fired in a burst queue behind each other; a hidden pane throttles animation frames); use Playwright at a realistic pace.
- **Typing latency is frame-quantized.** Both measurements end at the next frame, so at 60 Hz every value is "within one frame (16.7 ms)" or "a frame late". A ms target below one frame (D-59's 75% → 12 ms) can't be met by any editor and measures the display, not the app. **Proposal for the owner (AP-9):** express PERF-06 as "≥ 95% of keystrokes painted in the next frame, none later than two frames", with the D-59 factor not applied to it.
- **Open time is near the limit.** 128–134 ms meets 150 ms but not D-59's 112 ms. Profile: parse 27 ms, block conversion + **losslessness check ~45 ms** (one re-render + re-parse per block, ~0.25 ms each), editor load 2 ms. **MVP fix:** check a block lazily, the first time a transaction touches it (~0.25 ms), instead of all blocks on open; expected open ≈ parse + convert. Also cacheable per block in the index.
- **Save cost grows with the note** (verify re-parses the whole file: ~29 ms headless, ~54 ms in a visible tab for 5,000 words). It runs debounced, but on the main thread. **MVP fix:** verify only the changed region plus one neighbour on each side, or run reconcile in a worker.

## Implications for the MVP editor

1. Keep the architecture: `loadDoc` (with per-block losslessness check), `attach` (normalization guard), `reconcile` (emit raw / render changed / verify / escalate separators). See ADR 0002.
2. Callouts are blockquotes whose first line is `[!type] Title` as text. MVP: a real callout node with a type picker (the marker must stay unescaped; S1 F3 handles that).
3. Checklist items are list items with a `checked` attribute (mixed lists stay lossless); MVP needs a clickable checkbox node view and the convert-to-Task action (FR-TSK-11).
4. Raw blocks are read-only in the spike. MVP: edit them as source in place (a code-like view), and re-parse on blur.
5. Embeds render as chips. Rendering the embedded note's content (FR-EMB) is MVP work.
6. Lazy losslessness check and region-limited verify (Performance above).
7. The suggestion menus (`/`, `[[`, `#`) and the bubble menu work with plain TipTap 3 MIT packages; no paid extensions needed.

## Limits of this spike

- Real-export tests (S1 and S2) run only with `TEGG_REAL_EXPORTS=1`, i.e. via `npm run test:real` started by the owner (D-62). Before this change, a plain `npm test` read `test exports/` when the folder existed (counts only); fixed in this branch.
- Frontmatter isn't editable in the editor (attribute panel is separate MVP work; `setAttribute` from S1 covers the file side).
- Undo across a save and multi-user/external-change merging aren't covered (S4 watcher, FR-SYN-03).
- The KaTeX dependency of `micromark-extension-math` has a low-severity advisory; Tegg doesn't use KaTeX rendering (only the parser), so it's not reachable. Re-check when choosing a math renderer.
