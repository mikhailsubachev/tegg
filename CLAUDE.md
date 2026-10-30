# Tegg

Local-first, object-based note-taking app for macOS (Apple Silicon). Anytype/Capacities-style typed objects and block editor, but every note is a plain Markdown file in a user-chosen vault folder, compatible with Obsidian. Single user ("me first"), possibly public later.

## Documents

- `docs/Business Requirements.md`: the source of truth for scope. Every requirement has an ID (`FR-TSK-04`, `NFR-PERF-03`, `AR-01`, …) and a priority (M/S/C/W). Decisions are in §3 (`D-xx`), open questions in §13.1, release phasing in §11, export findings in §15.
- `docs/initial requirements.md`: the owner's original brief. Historical; do not edit.
- `docs/test-strategy.md`: how testing is automated: test layers, Claude QA roles, local gates, performance reference, milestones (D-59…D-63). Rules have IDs `TS-xx`.
- `docs/acceptance/`: acceptance criteria (`<REQ-ID>/AC-n`). A requirement is done only when its ACs pass as automated tests named after them (e.g. `fr_fmt_11_ac2_…`). Write ACs for a milestone's requirements before implementing it. Gaps found while writing ACs go to the owner as AP-n points, then into the BRD as decisions.
- Reference requirement IDs in commit messages, PR descriptions, issues, test names and code comments where a rule comes from the BRD.
- If an implementation needs a decision the BRD doesn't cover, or contradicts it, stop and ask. Don't silently decide. Propose an update to the BRD (new `D-xx` or `OQ-xx`) instead.

## Status

Pre-code. MS3 plan (slices 3A–3E, preview builds, TBD pages; D-115…D-120): `docs/plans/ms3-implementation-plan.md`. Slice 3A: ACs `docs/acceptance/app-shell.md`, contract `docs/contracts/ms3-shell.md` (D-121…D-138). Slice 3B: ACs `docs/acceptance/read-view.md` (D-140…D-151). Slice 3C: ACs `docs/acceptance/editor.md`, contract `docs/contracts/ms3-shell.md` §13 (D-173…D-216); preview feedback D-217, D-218; design change D-219 (vault switcher in the title bar, recent vaults), D-220 (logo menu at the bottom left). Slice 3D: ACs `docs/acceptance/types.md` (D-221…D-245), contract `docs/contracts/ms3-shell.md` §14; preview feedback D-246…D-252 (`docs/feedback/ms3-3d.md`), follow-up ACs D-253…D-266. MS4 plan (slices 4A–4F; D-267…D-275): `docs/plans/ms4-implementation-plan.md`. Slice 4A: ACs `docs/acceptance/backlinks.md` (D-276…D-295; red-test decisions D-296…D-311), contract `docs/contracts/ms4-links.md`. Slice 4B: ACs `docs/acceptance/daily-notes.md` (D-318…D-338), contract `docs/contracts/ms4-daily.md` (D-339…D-342; red-test decisions D-344…D-363). Slice 4B preview feedback: D-367…D-369 (`docs/feedback/ms4-4b.md`). Slice 4C: ACs `docs/acceptance/rename.md` (D-383…D-399; red-test decisions D-400…D-413, D-414, D-433), contract `docs/contracts/ms4-jobs.md`. Slice 4F: ACs `docs/acceptance/embeds.md` (D-415…D-432; red-test and build decisions D-434…D-459), contract `docs/contracts/ms4-embeds.md`. Slice 5A is split (D-500): 5A-1 tasks, ACs `docs/acceptance/tasks.md` (D-470…D-489; red-test decisions D-501…D-514); 5A-2 conversion, ACs `docs/acceptance/conversion.md` (D-490…D-499; contract §11 and red-test decisions D-524…D-538); contract `docs/contracts/ms5-tasks.md`; 5A-1 preview feedback D-516…D-523 (`docs/feedback/ms5-5a1.md`, contract §12: All tasks view, header, searchable all-of tag filter, icon Type settings, unsaved new objects); 5A-2 contract decisions D-524…D-538. Slice 5B: ACs `docs/acceptance/capture.md` and `docs/acceptance/inbox.md` (D-539…D-566), contract `docs/contracts/ms5-capture.md` (D-567; red-test decisions D-568…D-584); red tests e3353ae, a9c4c31; QA review of PR #50: D-585 (capture draft while typing, FR-CAP-01 AC-15), D-586 (virtualized Inbox cards, FR-INB-01 AC-12). Slice 4D-lite (tags): owner decisions D-690…D-710 (design boards `TagPage`, `TagsAll`; tag colour back in the MVP by D-707, no tag description or Tag attributes, D-691, D-693), ACs `docs/acceptance/tags.md` (AC decisions D-711…D-728, AC-test changes D-729), contract `docs/contracts/ms4-tags.md` (D-730…D-732); red tests a1c094b, 254a58c (red-test decisions D-733…D-740). Slice MM (mindmaps): a list in a `> [!mindmap]` callout drawn by Tegg, no Mermaid, D-679…D-687 (`docs/plans/mm-mindmap-as-list.md`). Preview v0.68 feedback (`docs/feedback/ms6-v068.md`): D-759 sidebar `New object` + `Search` buttons, D-760 ⌘O and the quick switcher dialog removed (the Search page's `Go to` list), D-761 one sidebar `Tags` entry, D-762 no `New with #tag`, D-763 one date picker (ACs `docs/acceptance/date-picker.md`), D-764 wrapping Backlinks chips, D-781 date display stays per the Date & time setting; bug v0.74 (tag page empty on the 20k vault): D-784, All tags' summary is one read (`index_tagged_objects`, `docs/contracts/ms4-tags.md` §1.6); slice MM: ACs `docs/acceptance/mindmap.md` (D-765…D-779; QA review D-780), fixture `tests/fixtures/vaults/mindmap/`. Slice MM2 (keyboard editing on the map, `right` / `spider` layouts stored as callout metadata `> [!mindmap|spider]`): plan `docs/plans/mm2-map-editing-and-layouts.md` (D-785…D-795), ACs `docs/acceptance/mindmap.md` part two (R95…R98), contract `docs/contracts/mm-mindmap.md` §6, board `MindmapLayouts`. MM2 feedback: D-796…D-799 (`docs/feedback/mm2-map-editing.md`: the clicked node's ring, the pending node's place, a click on the empty map area, real-app tests send keys only to Tegg). Slice 4E (MVP, MS7 row; D-803…D-809, board `TypeJobs`): plan `docs/plans/4e-type-moves-and-schema-rewrites.md` (4E-1 moves, 4E-2 deletes), ACs `docs/acceptance/type-moves.md` (approved; AP-765…AP-773 → D-810…D-818), contract `docs/contracts/ms4-jobs.md` §14; 4E-1 red tests 84c529a (red-test decisions D-819…D-833); 4E-1 merged in PR #86 (QA decisions D-837…D-840); 4E-2 contract `docs/contracts/ms4-jobs.md` §14.9 (D-841, D-842). Local graph (v1.0): owner decisions D-900…D-920 (`docs/plans/v1-local-graph-plan.md`; slices P object previews, G1, G2, G3, D-919; NFR-PERF-11, D-912). Slice P (object previews, v1.0, first graph slice): ACs `docs/acceptance/previews.md` (AP-803…AP-826 → D-921…D-944, BRD v1.110; new NFR-PERF-12, D-940; board `ObjectPreview`, D-921), contract `docs/contracts/v1-previews.md`, fixture `tests/fixtures/vaults/previews/`; build decisions D-945…D-949 (BRD v1.113). Slice G1 (graph core and full view, v1.0): ACs `docs/acceptance/graph.md` (R108…R113; AP-827…AP-850 → D-970…D-993, BRD v1.111), contract `docs/contracts/v1-graph.md` (`graph_neighbourhood`, route `graph/<path>`, live updates), ADR 0004 (d3-force + SVG, D-913), fixture `tests/fixtures/vaults/graph/`; red tests 6313cbd (red-test decisions D-994…D-1009, BRD v1.114). **Daily-use plan** (D-370…D-377): `docs/plans/mvp-daily-use-plan.md`: the owner starts daily use from an empty vault; order 4C, 4F, 5A tasks (schedule + kanban, D-378) + conversion, 5B capture/Inbox (Home → v1.0, D-515), 6A trash + images, 4D-lite tags (no colour), MM mindmaps, then MS7 importer and MS8; 4E, Obsidian import, board/calendar and responsive layout are v1.0. Requirements v1.73 are final: no open questions (D-01…D-459, D-470…D-584; D-343 speeds up the push gate; D-382 makes every slice ship its real-app tests; D-364 is the Create offer after edits, PR #36); every requirement is mapped to a phase in `docs/requirements-coverage.md`. Acceptance criteria exist for the critical requirements. Test strategy accepted (`docs/test-strategy.md`); the MVP is built in milestones MS1–MS8 (BRD §11.2). The MVP includes the **Capacities importer** (D-41, BRD §11.1). Architecture: `docs/architecture.md` (accepted; ADR 0003 one text engine, D-82; spike code is ported, never imported, D-83; residual overwrite window accepted, D-84). Technical spikes before product code:

- S1: Markdown dialect spec + round-trip test corpus
- S2: TipTap editor prototype passing S1
- S3: Tauri platform (menu bar, global hotkeys, capture window < 300 ms, signed + notarized DMG)
- S4: Rust index (SQLite FTS5 + file watcher) against NFR-PERF on 5,000 generated notes
- S5: Capacities import dry-run (preview + report only); its parsing and mapping code becomes the basis of the MVP importer

Spike code is throwaway and lives in `spikes/<name>/`. Product code starts after the spikes and the architecture doc. Each spike also has QA exit criteria (`docs/acceptance/qa-infrastructure.md`), and the QA tooling (`./verify`, hooks, agents, AC coverage) is built before product code.

- **S1 done (GO):** source-preserving documents, see `spikes/s1-roundtrip/FINDINGS.md` and `docs/adr/0001-source-preserving-documents.md`. Dialect spec: `docs/markdown-dialect.md`. Round-trip fixtures: `tests/fixtures/format/roundtrip/` (synthetic, byte-exact; don't open and re-save them in an editor).
- **S2 done (GO):** TipTap block editor on source blocks, see `spikes/s2-editor/FINDINGS.md` and `docs/adr/0002-editor-on-source-blocks.md`. The S2 editor imports the S1 core via the `@core` alias (`spikes/s1-roundtrip/src`).
- **S3 GO except the signed DMG:** Tauri 2 menu bar, global hotkeys and pre-warmed capture window (manual: ready in ~40–50 ms), see `spikes/s3-platform/FINDINGS.md`. Appium `mac2` suite: 7/7 pass (capture p95 ~70 ms, 0 sockets). Pending: the signed + notarized DMG (needs a Developer ID). AP-9…AP-14 decided (D-66…D-71).
- **S4 done (GO):** Rust index (SQLite FTS5, in-memory switcher, FSEvents watcher) beats every NFR-PERF target it can measure by ≥ 3.5× (most by 10–1000×), see `spikes/s4-index/FINDINGS.md`. The Rust extractor matches the TS reference (`tests/fixtures/format/extract/expected.json`, plus a nightly differential corpus). The reference vault comes from `tools/gen-vault`. AP-15 and AP-16 decided (D-64, D-65).
- **S5 done (GO):** Capacities dry run (preview + report, no writes) in Rust, see `spikes/s5-capacities-import/FINDINGS.md`. Fixtures C1–C19: `tests/fixtures/import/capacities/`. The owner's real-export run passes (0 unreadable, imported + reported = total in all 3 spaces); it caught a link-scanner gap, so the importer takes links from a real Markdown parser. AP-22…AP-28 decided (D-75…D-81).

## Stack (confirmed, D-19)

- Tauri 2 (Rust core) + React + TypeScript UI
- Editor: TipTap / ProseMirror. **Not BlockNote** (lossy Markdown conversion).
- Markdown ↔ blocks: unified/remark (mdast) with custom plugins (wikilinks, embeds, callouts, block IDs, query blocks)
- Index: SQLite + FTS5 in the Rust core, stored outside the vault
- File watching: Rust `notify` crate
- Target: macOS 14+, arm64, direct-download notarized DMG

## Non-negotiable rules

1. **Files are the source of truth** (AR-01). The index is a disposable cache; deleting and rebuilding it must give the same state. Nothing needed to understand a note lives only in the index (NFR-POR-03).
2. **Round-trip safety** (FR-FMT-07). Opening and saving a file without edits must not change a single byte. Unknown Markdown, HTML and frontmatter keys are preserved. Only re-serialize what the user actually changed.
3. **Atomic writes only** (FR-SYN-02): write a temp file in the same folder, then rename. Never write a vault file in place.
4. **Minimal writes** (FR-SYN-06): don't touch files that didn't change, no timestamp churn. Every write is a sync upload and a possible conflict.
5. **Never silently overwrite external changes** (NFR-REL-02). Detect them, reload or show a merge.
6. **Restore point before every bulk or destructive operation** (FR-HIS-04): schema renames, tag renames, imports, mass type changes.
7. **Obsidian compatibility** (D-05, NFR-POR-01): YAML frontmatter, `[[wikilinks]]`, `![[embeds]]`, mindmaps as `> [!mindmap]` callouts holding a list (D-679), `.trash/`. A Tegg vault must open in Obsidian without data loss.
8. **Dates without time are `YYYY-MM-DD`**, no time or timezone (FR-FMT-11). Date-times are ISO 8601 with offset.
9. **Unicode NFC** for file names and link targets, written and compared (FR-FMT-12). Content is often Czech; test with diacritics.
10. **File names** are sanitized titles, valid on macOS/Windows/iOS/Android, ≤ 200 UTF-8 bytes, forbidden characters replaced by a space (FR-FMT-08, NFR-POR-02, D-51, D-52). Duplicates get ` (2)` suffixes; links resolve by file/`id`, never by title alone (FR-LNK-14).
11. **No network calls**, no telemetry (NFR-SEC-01). The only allowed exception is opt-in update checks. No link-metadata fetching (D-43).
12. **Machine-local data** (index, cache, version history, window state) goes in `~/Library/Application Support/Tegg/`, never in the vault (FR-STO-07). Portable config goes in the vault under `.tegg/`.
13. **Core stays platform-neutral** (AR-03). Vault I/O, parsing, index, queries and sync adapters must not depend on desktop-only APIs; mobile reuses them later.

## Vault layout (FR-STO)

```
<vault>/
  Pages/ Tasks/ Quick Notes/ Daily/ Tags/ Images/ PDFs/ <Type plural>/   one folder per type
  _attachments/          the image and PDF files themselves
  _templates/<Type>/     templates (excluded from search/queries/graph)
  .tegg/vault.yml        vault settings
  .tegg/types/*.yml      type definitions (versioned schema, AR-07)
  .tegg/queries/*.yml    saved queries
  .tegg/graph.yml        graph filter presets (v1.0, D-906)
  .trash/                deleted objects
```

System types (D-22, D-42): Page, Task, Quick Note, Daily Note, Tag, Image, PDF. Every image and PDF is an object: a small `.md` in `Images/` or `PDFs/` with `file: "[[photo.png]]"`, while notes embed the file itself (`![[photo.png]]`) so they still render in Obsidian (FR-ATT-07).

Reserved frontmatter keys (FR-TYP-15): `id, type, title, description, aliases, tags, created, modified, source, review, icon, cover, previous, file, import-id, captured`. `icon`/`cover` are preserved but not used: objects show their type's icon (D-217).

Deliberately **not** supported (don't add them): page hierarchy / `parent` (D-45), a separate scheduled task date (D-46), a Weblink type (D-43), nested tags (D-40), tag collections (D-48).

## Test data and privacy

- `test exports/` holds **real** Capacities and Notion exports with personal and work data. **Never commit it, never copy it into the repo, never quote its content** in code, tests, commits, issues or artifacts.
- Tests use **synthetic fixtures** in `tests/fixtures/`: small hand-written Capacities/Notion exports, each reproducing specific findings from BRD §15 (FR-IMP-23, D-50). No anonymizer.
- The **local-only real-export test** reads `test exports/` only if it exists and is skipped otherwise (CI). It may output counts and IDs only, never titles or content.
- Zips with non-ASCII names: `unzip` fails on them; use `ditto -x -k` on macOS for manual inspection, and a proper UTF-8 zip reader in code (FR-IMP-07).
- Extract exports only into a temporary directory, never inside the repo.

## Testing

- Every Markdown parser/serializer change needs round-trip tests (AR-06).
- Performance-sensitive code is checked against NFR-PERF targets on the 5,000-note generated vault, on the reference machine (owner's M2 Pro, tightened targets, D-59).
- **All testing is local** (D-60): `./verify [commit|push|nightly|milestone|release]` is the only entry point for gates; git hooks and Claude Code hooks run it. Never bypass hooks (`--no-verify` is denied).
- **Test-first, by a separate agent** (D-61): AC tests are written from the ACs and interfaces only, committed red before the implementation. AC test files are `*.ac.test.ts` (TS) and `tests/ac_*.rs` (Rust). Don't modify or delete an existing AC test without an `AC-Test-Change: <reason>; approved-by: owner` commit trailer.
- Every bug fix starts with a failing regression test named `bug_<issue>_<req-id>_…`. Data-loss (T1) bugs stop feature work in the MVP (D-62).
- Claude never reads `test exports/` or the owner's real vault (D-62); exploratory sessions use synthetic or generated vaults only. The owner starts the real-export run.
- S1 spike: `cd spikes/s1-roundtrip && npm test` (all ACs, property test); `npm run test:real` runs the local-only real-export check (counts only; started by the owner, D-62). Vitest 5 hides console output of passing tests; add `--silent=false` to see it.
- QA gates: `./verify install` once per clone (git hooks), then `./verify commit|push|nightly|milestone --milestone MSn|release`; `./verify push --all` ignores the step memo (D-611); `./verify merge` is the pre-merge flow (D-612); `./verify coverage` writes `qa/coverage/ac-matrix.md`; `./verify check-red <commit>`; `./verify review-prep` before running the `qa-reviewer` agent; `./verify clean` drops the gates' Cargo cache (`.verify/cargo-target`, D-343); `./verify help`. Interface: `tools/qa/CONTRACT.md`; config: `qa.config.json` (add a step there for every new package's tests). QA tool tests: `cd tools/qa && npm test`.
- S2 spike: `cd spikes/s2-editor && npm test` (editor ACs, property test); `npm run test:webkit` (all Playwright tests: the WebKit editor flow with a fake core over mocked IPC, and the perf probe on WebKit + Chromium; use `--workers=1` for clean perf numbers); `npm run dev` or the `s2-editor` entry in `.claude/launch.json` for the playground; `npm run test:real` is started by the owner (D-62).
- S3 spike: `cd spikes/s3-platform && npm run app:build` (.app + ad-hoc DMG); `npm run test:rust` (vault write tests); `cd e2e-appium && npm test` (Appium mac2 real-app suite, S3-QA AC-1…AC-4; needs Xcode, Accessibility permission and a built app); `scripts/sign-notarize.sh` (owner's Developer ID).
- S4 spike: `cd spikes/s4-index && cargo test --release` (conformance, property, sync, search); `cargo run --release --bin perf -- --vault <dir> --runs 20` (p95 vs NFR-PERF; `taskpolicy -b` for the slow profile); `cargo bench --bench perf` (criterion trend). Reference vault: `cargo run --release --manifest-path tools/gen-vault/Cargo.toml -- --seed 1 --out <dir>` (3 GB with images; `--small-images` for index-only work). After an intended extraction change: `cd spikes/s1-roundtrip && UPDATE_EXTRACT=1 npx vitest run test/extract.test.ts`.
- S5 spike: `cd spikes/s5-capacities-import && cargo test --release` (fixture reports, accounting rule); `cargo run --release --bin capacities-dryrun -- <zip|folder> [--space NAME] [--json|--counts-only]`; `TEGG_REAL_EXPORTS=1 cargo test --release --test real_export -- --nocapture` is started by the owner (D-62).
- Product commands: _to be added after scaffolding (run `/init` again then)._

## Working conventions

- UI text in English, all strings externalized for localization (NFR-OTH-02).
- Keyboard-first: every new action is reachable from the command palette (FR-UX-03).
- Light and dark themes with equal quality (FR-UX-05).
- Keep changes small and tied to one requirement or milestone; plan first for anything that touches the file format, sync or the index.
