# Spike S5 Findings: Capacities Import Dry Run

**Date:** 2026-10-10 · **Branch:** `spike/s5-capacities-dryrun` · **Stack:** Rust (core, AR-03), `zip` 2 (UTF-8 names without the system `unzip`), yaml-rust2, chrono-tz

## Verdict: GO

The dry run reads a Capacities export (zip or folder), lets the user pick one space, and produces the full import preview: types, attribute mapping, date conversions, value merges, planned file names, link outcomes, media, losses. It writes nothing. Every report passes the "imported + reported = total" rule on all 19 synthetic fixtures and on all 3 spaces of the real Capacities export (owner's run, 2026-10-10, counts only). The first real run failed that rule and exposed missed Markdown links (F12), now fixed.

| Check (S5-QA, `docs/acceptance/qa-infrastructure.md`) | Result |
| --- | --- |
| AC-1: one synthetic fixture per finding C1–C19, README mapping finding → fixture | Pass. `tests/fixtures/import/capacities/c01-…/` … `c19-…/`; `s5_qa_ac1_*` checks every finding has a folder and a README row |
| AC-2: dry-run report asserted per fixture | Pass. 45 tests in `tests/fixtures_report.rs`, named after the FR-IMP ACs they cover |
| AC-3: reusable "imported + reported = total" assertion for objects, attachments, links | Pass. `accounting::check` / `assert_accounted` recompute the totals from the raw entries with their own simple rules (space membership by path, file classes by extension, a separate regex link counter), sharing no code with the planner or the link scanner, and check that every reported item is in a report list. Used by the fixture tests, the CLI and the real-export run. Tests break the planner on purpose (lost object, attachment, link, dropped-file row, wrong space) and show the check fails |
| AC-4 [manual]: owner's real-export run, 0 unreadable entries, counts only | **Pass** (owner, 2026-10-10): 0 unreadable entries, 0 non-UTF-8 names, 3 spaces, 0 files outside spaces, 0 accounting errors in every space. 697 objects, 113 attachments, all imported; links per space: 0, ~814 and 153, with 6–11% reported (unresolved, ambiguous, select values, other space) |

## How it works

- **Input** (`source.rs`, FR-IMP-07): zip and folder produce the same entry list (tested: same report). Zip names are read as UTF-8 even without the zip UTF-8 flag, with CP437 only as a fallback (counted); all names are NFC. Unreadable entries are counted, not skipped silently.
- **Spaces** (`plan.rs`, FR-IMP-22): typed notes sit at `<space>/<Type folder>/<note>.md`. The layout is detected from the depth of notes with `type:`: a single-space export without a space folder and a zip with an extra root folder are handled too.
- **Planner** (`plan.rs`): default type mapping (FR-IMP-08 AC-1; Query/Weblink/AIChat → Page), attribute mapping (FR-IMP-15, FR-TYP-15, FR-IMP-24), attribute type inference (date, date-time, date-range, number, checkbox, select, relation, link-select, list, text), case-variant merges, task status → semantic state, comma-list candidates, file names (D-51, D-52, D-68) with ` (2)` suffixes per folder, compared case-insensitively, `import-id`, repeat-import detection (FR-IMP-20).
- **Links** (`scan.rs`): wikilinks, Markdown links and images outside code, in the body and the frontmatter. Every link gets exactly one outcome: resolved, date mention, attachment (imported), or unresolved, other space, ambiguous, case mismatch, select value, missing file, in a skipped note (reported).
- **Report** (`report.rs`): a Markdown draft of the preview/report page (FR-IMP-05, FR-IMP-19) and a counts-only form for the real export (TS-P2; its format is asserted).

## What the spike found

| # | Finding | Consequence |
| --- | --- | --- |
| F1 | **Capacities doesn't encode parentheses in link paths**: `[x](../Meetings/Tom%C3%A1%C5%A1%20%20Eva%20(1).md)`. A simple `\(([^)]*)\)` reading cuts the path at `(1` and the link looks missing | The scanner reads destinations with balanced parentheses (CommonMark). Fixture `c10` and the C5 `image (3).png` embed cover it. The MVP importer's Markdown parser handles this already (mdast), but any regex shortcut won't |
| F2 | **Wikilinks to duplicate titles can't be resolved** (Capacities writes only the title); path links can | Reported as "ambiguous". **AP-23** |
| F3 | **FR-IMP-14 AC-1 and FR-TYP-15 AC-1 disagree** on `source: upload` in Image objects | Renamed to `source-text` in the spike. **AP-22** |
| F4 | **Media files that no note references** have no defined outcome (D-42: every image is an object) | Listed in the report, imported as attachments. **AP-24** |
| F5 | **Technical attributes** (`mimeType`, `fileSize`, `width`, `height`, `colors`, `domain`, `iframeUrl`) have no target | Dropped by default, reported. **AP-25** |
| F6 | Capacities' duplicate file suffix starts at `(1)`, Tegg's at `(2)` (D-53) | No decision needed: links resolve by source path, planned names are allocated fresh |
| F8 | The BRD doesn't say which export files are objects, attachments or neither | Rule in the spike, **AP-26** |
| F9 | Link targets from note text weren't NFC-normalized; an NFD `[[Tomáš]]` looked unresolved (FR-FMT-12). Found in QA review | Targets and titles are NFC before matching; test `fr_fmt_12_nfd_link_targets_resolve` |
| F10 | Windows-reserved names (`CON`, `COM1`…) and titles with no valid characters aren't covered by D-52 | Listed in the report, **AP-27** |
| F11 | Case-insensitive title matches would bind links silently | Reported as "case mismatch", **AP-28** |
| F12 | **The real-export run caught the line scanner missing Markdown links**: in the main space the independent count found 814 links, the scanner 802, one per note in 12 notes. A line regex can't see an image inside a link, link text over several lines, or brackets in link text | Markdown links now come from a CommonMark parser (pulldown-cmark); regression test `bug_s5_real_export_fr_imp_10_*` (fails on the old scanner). The accounting check worked as intended: it turned a silent loss into a failing run. The MVP importer must take links from the real parser (mdast), never from regexes |
| F7 | Null values are frequent (most templates export every attribute) | Omitted (FR-IMP-09 AC-4) and counted per attribute in the preview ("Empty" column) |

### Assumptions checked by the real-export run (all confirmed)

The spike never read the real export (D-62, TS-P3). These assumptions come from BRD §15 and the S1 fixtures, and the counts-only output has a number for each, so a mismatch shows up without printing any content:

| Assumption | Counter that exposes a mismatch |
| --- | --- |
| Space folders at the top level (or under one wrapper folder) | `export.N.spaces` (expected 3), `export.N.files_outside_spaces` (expected 0) |
| Every note has `type:` frontmatter (C2: 696/696) | `space.N.objects.reported` |
| Media are referenced as `./Media/<encoded name>` | `space.N.links.missing_file`, `space.N.orphan_attachments` |
| `coverImage` / `previewImage` values are null or a Markdown link | `space.N.unknown_cover_values` |
| Tag collections are header-only CSVs (C8: 2) | `space.N.tag_collections`, `space.N.other_files.total` |
| ~10% of wikilinks don't resolve (C9: 58 of 557) | `space.N.links.unresolved`, `.select_value`, `.date_mention`, `.other_space` |

## Not covered here (MS7)

The write phase (atomic writes, backup zip, cancel = vault byte-identical), progress and cancel for 100 MB+ zips (FR-IMP-07 AC-3; reading is a single pass, so progress is entries read / total), the mapping UI, body rewriting (links → wikilinks, `Media:` lines → `![[…]]`, invisible characters removed: only counted here), checklist → Task conversion (FR-IMP-18, v1.0), and the assumed-year handling of FR-IMP-09 (no year-less dates appear in Capacities exports, only in Notion).

## Commands

- `cargo test --release` (in `spikes/s5-capacities-import`): fixture tests; `./verify push` step `s5-test`
- `cargo run --release --bin capacities-dryrun -- <export.zip|folder>` lists spaces; add `--space NAME [--tz ZONE] [--vault DIR] [--json | --counts-only]` for the preview
- Real export (owner only, D-62): `TEGG_REAL_EXPORTS=1 cargo test --release --test real_export -- --nocapture`

## Spike code removed (D-1366)

The spike's code was removed from the repository on 2026-11-04; only this report stays. The last commit with the code is `75b3382` (`git show 75b3382:spikes/<name>/…`). The commands above refer to that commit.


The MVP Capacities importer (MS7) is ported from this code at that commit (D-83, D-1366); until then no test runs the fixtures in `tests/fixtures/import/capacities/`.
