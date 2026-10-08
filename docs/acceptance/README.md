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
