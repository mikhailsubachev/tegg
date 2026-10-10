# Acceptance Criteria

Testable acceptance criteria (AC) for the requirements in `docs/Business Requirements.md` (BRD).

## Scope of this first set

The **critical requirements**: those where a bug means data loss, corrupted files, broken links or an architecture rewrite. They are written before any code, so the spikes (S1–S5) and the MVP can be checked against them.

| File | Area | Requirements |
| --- | --- | --- |
| [file-format.md](file-format.md) | Markdown file format and round-trip | FR-FMT-01…12, FR-STO-02, FR-TYP-10, FR-TYP-15, NFR-POR-01…03, AR-06 |
| [data-safety.md](data-safety.md) | Vault storage, writes, sync, external changes | FR-STO-01, -03…09, FR-SYN-01…07, FR-EDT-08, FR-VLT-03, NFR-REL-01…04, AR-01 |
| [links.md](links.md) | Link integrity, renames, duplicates, date mentions, media objects | FR-FMT-08, FR-LNK-03, -04, -14, FR-STO-04, FR-TYP-04, -07, FR-TAG-04, FR-DLY-08, FR-ATT-07 |
| [import-capacities.md](import-capacities.md) | Capacities importer (MVP, D-41) | FR-IMP-05, -07, -09…17, -19…24, FR-HIS-04 (MVP backup) |
| [performance.md](performance.md) | Performance targets | NFR-PERF-01…10 |
| [qa-infrastructure.md](qa-infrastructure.md) | Test tooling and spike QA exit criteria (D-60, D-61) | `docs/test-strategy.md` TS-xx rules |

ACs for the remaining MVP requirements are written **per milestone**, just before that milestone is built.

## Conventions

- Each requirement has a heading with its ID and short name, then numbered criteria `AC-1`, `AC-2`, ….
- A criterion is written as **Given / When / Then** (or a plain measurable statement) and must be checkable by an automated test unless marked **[manual]**.
- A criterion's full ID is `<REQ-ID>/AC-n`, e.g. `FR-FMT-11/AC-2`.
- Test names contain the ID in lower snake case, e.g. `fr_fmt_11_ac2_timezone_does_not_shift_date`, so a script can report coverage per requirement.
- **Fixtures** are named in `tests/fixtures/` (synthetic, committed, D-50). `[real-export]` marks criteria that are also checked by the local-only run against `test exports/` (counts and IDs only).
- Times in examples use the Europe/Prague time zone unless stated otherwise.
- Gaps found while writing the criteria were decided as AP-1…AP-8 below and recorded in the BRD as D-51…D-58.

## Decided points (accepted 2026-10-08, BRD D-51…D-58)

Writing the criteria uncovered gaps and conflicts in the BRD. All proposals below were accepted by the owner.

| # | Issue | Decision | Affects |
| --- | --- | --- | --- |
| AP-1 | **File-name length.** NFR-POR-02 says ≤ 200 *characters*, but macOS/APFS limits names to 255 **UTF-8 bytes**. A 200-character Czech or emoji title can exceed that (likely why `unzip` failed on the Notion export). | Limit the file name (without `.md`) to **200 UTF-8 bytes**, cut at a character boundary; the full title stays in `title:`. | FR-FMT-08, NFR-POR-02 |
| AP-2 | **Forbidden characters in titles** (`/ : \ * ? " < > \|`): removed or replaced? | Replace each with a space, collapse repeated spaces, trim leading/trailing spaces and dots. | FR-FMT-08 |
| AP-3 | **Duplicate-title suffix vs. conflict copies.** Tegg names duplicates `Title (2).md`, but Google Drive names conflict copies `Title (1).md`. A file-name pattern can't tell them apart. | A file is a **conflict copy** only if it has the **same `id`** as another file. The name pattern is only a hint. Tegg's duplicate suffixes start at `(2)`. | FR-LNK-14, FR-SYN-04, FR-SYN-05 |
| AP-4 | **When does a file get its `id`?** FR-FMT-02 says every object has one, but FR-TYP-10 says untyped files (e.g. from Obsidian) aren't rewritten until edited. | `id` (and `type: page`) are written on the **first edit in Tegg**; until then the index identifies the file by path. | FR-FMT-02, FR-TYP-10 |
| AP-5 | **When is `modified` updated?** Updating it on every save causes timestamp churn (FR-SYN-06). | Only when the content or an attribute actually changed; never on open, never on a save with no change. | FR-FMT-02, FR-SYN-06 |
| AP-6 | **Offset for imported date-times.** Capacities stores UTC (`…Z`); FR-FMT-11 requires ISO 8601 with offset. | Convert to the **local time zone at import time** with its offset (e.g. `2026-04-07T21:46:20+02:00`). | FR-FMT-11, FR-IMP-09 |
| AP-7 | **Restore point in the MVP.** FR-IMP-05 / FR-HIS-04 need restore points, but version history ships in v1.0. §11.1 says a backup zip stands in for imports. Schema and tag renames are in the MVP too. | Use the same **vault backup zip** before every bulk operation in the MVP (import, attribute rename, tag rename, bulk type change), stored in Application Support, newest 10 kept. | FR-HIS-04, NFR-REL-04 |
| AP-8 | **"Typical" note size and test machine** for NFR-PERF aren't fully defined. | Reference vault and machine as defined in [performance.md](performance.md). | NFR-PERF-* |

## Open points (from spike S2, pending the owner)

| # | Issue | Proposal | Affects |
| --- | --- | --- | --- |
| AP-9 | **Typing latency is frame-quantized.** Keydown → next paint ends at the next frame, so at 60 Hz a keystroke is "in the next frame (≤ 16.7 ms)" or "a frame late". A ms target below one frame (D-59's 75% → 12 ms) measures the display, not the app. WebKit measured p95 16 ms, max 17 ms on a 5,000-word note. | PERF-06: "≥ 95% of keystrokes painted in the next frame, none later than two frames"; the D-59 factor is not applied to it. | NFR-PERF-06, D-59, `performance.md` |
| AP-10 | **Save may change a block the user didn't edit.** When a delete or move makes two same-marker lists adjacent, one list's markers change (`-` → `*`), because a blank line doesn't separate them in Markdown; when a list is newly followed by indented code, a `<!-- -->` line is inserted. FR-FMT-07 says only what the user changed is re-serialized. | Accept both as the minimal change that keeps the note's structure (alternatives: always `<!-- -->`; or refuse the move/delete with a message). | FR-FMT-07, ADR 0002, dialect §1.5 |

## Open points (from spike S3, pending the owner)

| # | Issue | Proposal | Affects |
| --- | --- | --- | --- |
| AP-11 | **File names that break Obsidian links.** D-52 replaces `/ : \ * ? " < > \|`, but Obsidian also rejects `#`, `^`, `[`, `]` and `\|` in names it links to (`[[C# notes]]` points to heading "notes" in "C"). A title like `C# tips` makes a file that `[[wikilinks]]` can't reach in Obsidian (D-05). | Also replace `# ^ [ ]` with a space in file names; the full title stays in `title:`. | D-52, FR-FMT-08, NFR-POR-01 |
| AP-12 | **"Enter saves" vs. multi-line Markdown capture.** FR-CAP-01 says "Enter/⌘↩ saves and closes", but the field accepts Markdown, which needs Enter for new lines and lists. | ⌘↩ saves, Enter is a new line (what the S3 spike does). | FR-CAP-01 |
| AP-13 | **Frontmatter keys for captured tasks.** FR-CAP-04 names a `captured` timestamp and FR-TSK-10 a due date and priority, but `captured`, `due`, `priority` and `status` aren't in the reserved keys (FR-TYP-15) or the dialect spec. The spike writes `captured:` and `due:` provisionally. | Add `captured` to the reserved keys; define the Task type's attribute keys (`status`, `priority`, `due`, `completed`, `recurrence`) in the dialect spec before MS5. | FR-TYP-15, FR-CAP-04, FR-TSK-01, dialect spec |
| AP-14 | **Second app instance and hotkey conflicts.** Launching the app twice runs two copies, and only one gets the global hotkeys; another app can also own ⌃⌥Space. Neither case is covered. | Single instance (a second launch focuses the first); a hotkey that can't be registered is shown in Settings with a prompt to choose another (FR-SET-04). | FR-CAP-05, FR-SET-04 |

## Open points (from spike S4, pending the owner)

| # | Issue | Proposal | Affects |
| --- | --- | --- | --- |
| AP-15 | **Tags inside math.** The dialect already says links inside math aren't links (§5), and the S1 reference ignored that: fixed in S4 (bug, regression tests added). For tags it says only "not in code or links". Obsidian doesn't read `#x` inside `$…$` or `$$…$$` as a tag. | Math is excluded for tags too (implemented in both extractors as a proposal, pending your decision); add it to dialect §5 when approved. | Dialect §5, FR-FMT-10, FR-TAG |
| AP-16 | **The slow profile doesn't stand in for an M1.** `taskpolicy -b` makes everything about 3.5–6.5× slower (E-cores at low clock), while an M1 is about 1.2–1.4× slower than the M2 Pro. On it, search p95 is 221 ms against the original 200 ms target. | Keep the 75% / 60% factors (D-59). Keep the slow profile as a reported **worst case** with no target, or drop it. If an M1 is available, measure once with `perf` to confirm the factors. | D-59, performance.md, test-strategy §9 |

