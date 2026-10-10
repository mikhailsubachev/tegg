# Spike S2 Findings: TipTap Block Editor on Source-Preserving Documents

**Date:** 2026-10-10 · **Branch:** `spike/s2-editor` · **Decision record:** [ADR 0002](../../docs/adr/0002-editor-on-source-blocks.md) (Proposed) · **Builds on:** S1 / [ADR 0001](../../docs/adr/0001-source-preserving-documents.md)

## Verdict: GO, with two points for the owner (AP-9, AP-10), accepted as D-66 and D-67

A real TipTap 3 editor (ProseMirror) works on top of S1's source-preserving model.
- Each top-level editor block remembers the source block it came from (`srcIndex`).
- Saving (`reconcile`) writes every untouched block byte-for-byte and renders only blocks the user changed.
- Each save is verified by re-reading the result. Untouched blocks must be identical, and **every changed block must read back to the same editor content** the user saw.
- The editor model is never serialized whole.

| Check (S2-QA exit criteria, `docs/acceptance/qa-infrastructure.md`) | Result |
| --- | --- |
| AC-1: every fixture through real ProseMirror transactions. Unedited open → save; then one operation on one block → save. | 43/43 unedited saves byte-identical; nothing is written on open. **731 operations actually ran**: type 125, insert 138, delete 138, split 56, join 7, turn into list/heading/quote 56 each, move 99. Each kept every unchanged block byte-identical. 547 more test cases didn't apply (e.g. split a heading) and are not counted. |
| AC-1: property test, random sequences of editor commands on random fixtures | 10 seeds × 1,000 runs pass, with the read-back check on every save |
| AC-2: Obsidian inline syntax kept when its block is edited. Links, embeds, tags, `==hl==`, `%%c%%`, `$m$`, `^id`, footnote refs, inline HTML, Markdown images. | pass (`s2_qa_ac2_*`, and exact bytes in S1 `s2_qa_ac2_core_inline_*`) |
| AC-3: WebKit, real UI, fake core over mocked Tauri IPC. Open → type → save; exact bytes asserted, incl. BOM, CRLF, raw HTML, `*` marker; no write on open. | pass (`s2_qa_ac3_*`, nightly gate step `s2-webkit`) |
| AC-4: typing-latency proxy cross-checked with the engine's own Event Timing API | Agree on WebKit and Chromium within what Event Timing can show (see Performance). **PERF-06 is not met as written** (WebKit p95 16 ms, max 17 ms); see AP-9 |
| Blocks shown read-only because the editor can't represent them losslessly | 1 of 131 (fixtures: the ragged table, E2) |

Tests: S2 1,350 vitest (`npm test`) + 3 Playwright (`npm run test:webkit`); S1 suite 394, green with the core additions. Real-export tests run only when the owner starts them (`npm run test:real`, D-62).

## What the spike found

Each item below would have silently damaged notes, changed their meaning on reload, or blocked the user. All are fixed.

| # | Problem | Fix | Test |
| --- | --- | --- | --- |
| E1 | `==highlight==`, `%%comment%%` and `$math$` would be escaped or dropped when their block is edited (S1 open item 3) | Syntax extensions in the S1 core (`src/inline.ts`); highlight content is parsed for nested emphasis | `s2_qa_ac2_*` |
| E2 | **Editor plugins change notes on open**: the table plugin adds a cell to a ragged GFM row (a `\|` in a code span counts as a separator) | Generic guard (`attach`): a block the editor changed by itself on load becomes read-only raw | `obsidian/04 Tables.md` via `s2_qa_ac1_unedited_*` |
| E3 | **Deleting or moving a block can merge two lists** (a blank line doesn't separate two `-` lists) | One of the lists gets another marker (`-` → `*`, `1.` → `1)`). Accepted, D-67 | `fr_fmt_07_deleting_the_block_between_two_lists_*` (6 cases in the operation run) |
| E4 | **Indented code moved below a list becomes part of the list** (CommonMark rule) | Last-resort `<!-- -->` separator. Accepted, D-67 | `fr_fmt_07_moving_indented_code_*` |
| E5 | The first losslessness check compared text with the standard rendering (`(1)` → `\(1\)`), which made links to `… (1).md` files read-only | Semantic check: what the editor would write, read back in the note's context, gives the same editor content | load tests; the real-export run showed the effect (190 → 1 read-only blocks, see privacy note) |
| E6 | `[[` autocomplete left a stray `[` (`\[[[Note]]`), found in manual testing | `insertLink` removes both brackets | `bug_s2_e6_link_autocomplete_*` |
| E7 | **Autosave while typing wrote `word&#x20;`** (to-markdown encodes paragraph edge spaces) | Edge spaces of paragraphs, headings and cells are trimmed (Markdown ignores them) | `bug_s2_trailing_space_*` |
| E8 | **Shift+Enter at the end of a block wrote a literal backslash** (`abc\`), shown on reload (QA review) | Edge hard breaks are dropped. Root cause: save didn't check changed blocks, so the **read-back check** was added | `bug_s2_trailing_hard_break_*` |
| E9 | **Currency was parsed as math**: `Paid $5 for [[Lunch]] and $3` hid the link and tags (QA review) | Inline `$math$` follows Obsidian's rules: no space inside the delimiters, no digit after the closing `$`, `\$` never closes | S1 `single-dollar math follows Obsidian rules` |
| E10 | **A literal `==`, `%%` or `$` typed as text came back as a highlight, comment or math** (found by the read-back check) | Written escaped (`\==`, `\%%`, `\$`) | S1 `literal markers …`, property test |
| E11 | **Nested items lost their nesting** when a list that starts indented in the file (` * item`) was edited (found by the read-back check) | Continuation lines get the indent the block actually has in the output | operation run (`capacities/DailyNotes`), property test |
| E12 | **Tags in the editor didn't match the file's meaning**: a typed `#word` (text) is a tag on reload; text typed right after a tag extends it (found by the read-back check) | Tag rules plugin: changed textblocks are re-tokenized with the parser's tag rules (Obsidian behaviour); only the differing part is rebuilt | `tags in the editor follow Obsidian tag rules` |

Expected editor behaviour, not bugs:
- Turning a paragraph next to a list into a list joins them (like Notion).
- Typing right after `*italic*` continues the italic.
- A typed `[[` without picking a suggestion stays literal text (`\[\[`), never a broken link.
- Backspace after a tag removes the whole tag (it's one node).

## Performance (this Mac, Apple Silicon; generated 5,000-word note, `src/ui/largeNote.ts`)

Measured with Playwright typing one key per 40 ms, one browser at a time (`npx playwright test e2e/perf.spec.ts --workers=1`; runs vary by a few ms):

| Metric | WebKit (Tauri's engine) | Chromium | Target (NFR) |
| --- | --- | --- | --- |
| Open: parse → painted (PERF-05) | 114–126 ms | 143–153 ms | < 150 ms; D-59 reference run: < 112 ms |
| Typing, app proxy keydown → next frame, p50 / p95 / max (PERF-06) | 8 / 16 / 16–17 ms | 1.5–2.4 / 15.4–16.6 / 16.4–17.5 ms | < 16 ms; D-59 reference run: < 12 ms |
| Typing, Event Timing API: keydowns reported (≥ 16 ms), and their max | 25–28 of 80, max 16 ms | 14–19 of 80, max 16 ms | |
| Save: reconcile + verify incl. read-back (autosave, debounced) | 27–30 ms | 44–51 ms | (no target) |

**S2-QA AC-4.** The Event Timing API is the engine's own input → next-paint measurement, available on WebKit and Chromium. It only reports events of 16 ms or more, with 8 ms granularity.
- On both engines it shows **no keystroke slower than 16 ms**, and the app's proxy shows the same: max 16–17.5 ms.
- So the proxy is validated at the one-frame level. Event Timing can't confirm the proxy's sub-frame values.
- A manual session in the in-app browser pane was **not** a valid measurement: keys fired in a burst and queued behind each other, and a hidden pane throttles animation frames.

**Results against the targets, plainly:**
- **PERF-06 is not met as written** (< 16 ms). On WebKit, p95 is 16 ms and max is 17 ms. Typing latency ends at the next frame, so at 60 Hz every keystroke is "in the next frame (≤ 16.7 ms)" or "a frame late". **AP-9 (owner):** express PERF-06 as "≥ 95% of keystrokes painted in the next frame, none later than two frames", and don't apply the D-59 factor to it.
- **PERF-05 is met on WebKit for the original target** (< 150 ms) and **not for D-59's reference run** (< 112 ms), at 114–126 ms.
  - Profile: parse 27 ms, block conversion + **losslessness check ~45 ms** (one re-render and re-parse per block, ~0.25 ms each), editor load 2 ms.
  - MVP fix: check a block lazily, the first time a transaction touches it, or cache the result per block in the index.
- **Save cost grows with the note**: verify re-parses the whole file and reads back every changed block. It's debounced but runs on the main thread. MVP fix: verify only the changed region plus one neighbour on each side, or run reconcile in a worker.

## Points for the owner

- **AP-9:** PERF-06 as a frame-based target (above).
- **AP-10: save may change bytes of a block the user didn't edit** (E3, E4). When a delete or move makes two same-marker lists adjacent, one list's markers change. When a list is newly followed by indented code, a `<!-- -->` line is inserted. FR-FMT-07 says only what the user changed is re-serialized, and the BRD doesn't cover this case.
  - Alternatives: always use the `<!-- -->` separator (no marker change), or refuse such a move or delete with a message.
  - The dialect spec marks these rules as proposed.
- **Spike test names in coverage:** S1's tests (merged in #1) use product AC keys (`fr_fmt_07_ac1_…`). `./verify coverage` and the MS1 milestone check would then count throwaway spike tests as product AC evidence, against TS-I6. S2's tests now use their own keys (`s2_qa_ac1…ac4`). Decide whether to rename S1's tests or exclude `spikes/` from coverage (CONTRACT §9.2).

## Privacy note (D-62)

- On 2026-10-08 and 2026-10-10, Claude-started runs of the spike suites read `test exports/`. D-62 was already in force for the 2026-10-10 runs.
  - The S2 real-export test in this branch ran explicitly.
  - Plain `npm test` in both spikes also ran the real-export tests whenever the folder existed, and so did the `s1-test` push step in the main checkout. It is skipped in the gate's fresh worktree.
- Only counts and file indexes were output, and nothing from the exports is in the repository.
- **Fixed in this branch:** real-export tests now run only with `TEGG_REAL_EXPORTS=1`, i.e. `npm run test:real`, started by the owner.
- The real-export numbers from those runs are **provisional**:
  - Capacities: 697/697 unedited saves byte-identical; typing edits confined; 1 of 2,622 blocks read-only after E5.
  - Notion: 226/226; 1 of 890 read-only.
- **The owner should re-run `npm run test:real` in `spikes/s1-roundtrip` and `spikes/s2-editor`** on the final code. E8–E12 came after those runs.

## Implications for the MVP editor

1. Keep the architecture and its parts:
   - `loadDoc`, with the per-block losslessness check
   - `attach`, the normalization guard
   - the tag rules plugin
   - `reconcile`: write raw / render changed / verify incl. read-back / escalate separators

   See ADR 0002.
2. Callouts are blockquotes whose first line is `[!type] Title` as text. The MVP needs a real callout node with a type picker.
3. Checklist items are list items with a `checked` attribute, so mixed lists stay lossless. The MVP needs a clickable checkbox and the convert-to-Task action (FR-TSK-11).
4. Raw blocks are read-only here. The MVP should let you edit them as source in place, re-parsed on blur.
5. Embeds render as chips. Rendering the embedded note's content (FR-EMB) is MVP work.
6. Performance: lazy losslessness check, region-limited verify.
7. The `/`, `[[` and `#` menus and the bubble menu use plain TipTap 3 MIT packages; no paid extensions needed.

## Limits of this spike

- Frontmatter isn't editable in the editor. That's the separate attribute panel; S1's `setAttribute` covers the file side.
- Undo across a save, and merging external changes, aren't covered (S4 watcher, FR-SYN-03).
- `fit()` NFC-normalizes the whole rendered block. FR-FMT-12 requires NFC only for file names and link targets, so this is a choice. It stays inside changed blocks and is noted in the dialect spec.
- Not checked in Obsidian itself: the inline math rules (E9) and whether `== a ==` with inner spaces is a highlight. Both follow the documented Obsidian behaviour as I understand it; verify once in Obsidian (NFR-POR-01 manual AC).
- KaTeX, a dependency of `micromark-extension-math`, has a low-severity advisory. Tegg uses only the parser, not KaTeX rendering.
