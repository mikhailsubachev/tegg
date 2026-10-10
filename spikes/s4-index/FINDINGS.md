# Spike S4 Findings: Rust Index (SQLite FTS5 + File Watcher)

**Date:** 2026-10-10 · **Branch:** `spike/s4-index` · **Machine:** reference M2 Pro, 16 GB, macOS 26 (D-59), release build · **Stack:** rusqlite 0.40 (bundled SQLite, FTS5), pulldown-cmark 0.13, yaml-rust2 0.13 (events), notify 8 (FSEvents), rayon

## Verdict: GO

SQLite FTS5 in the Rust core meets every NFR-PERF target it can measure, with a lot of headroom, also at 4× the reference vault. Incremental updates, both direct and through the file watcher, give exactly the index a rebuild gives. The Rust extractor matches the TypeScript reference on every round-trip fixture. The differential corpus showed that **two Markdown parsers drift** in edge cases, so the conformance checks run every night.

| Check (S4-QA, `docs/acceptance/qa-infrastructure.md`) | Result |
| --- | --- |
| AC-1: `tools/gen-vault --seed <n>` generates the reference vault; same seed → byte-identical | Pass. Two full runs (9,201 files, 3.0 GB) had the same tree digest before the image PRNG was split off (Markdown no longer depends on `--small-images`); `s4_qa_ac1_*` tests |
| AC-2: `criterion` benchmarks for PERF-02, -03, -04, -07, -08 | `benches/perf.rs` (trend); `src/bin/perf` gives p95 against targets, nightly step `s4-perf` |
| AC-3: normal and slow profile; ratio used to confirm the factors | Measured: the slow profile is **about 3.5–6.5× slower**, not the ~1.3× the factors assume. It doesn't stand in for an M1. **AP-16** |
| AC-4: Rust extractor = TypeScript reference (`expected.json`) for every round-trip fixture | **43/43**. Plus a differential corpus of ~1,850 random tricky documents per seed: all equal except one known class (P3, about 2% of documents, ≤ 4% allowed) |
| AC-5: property test, rebuild = incremental after random creates, edits, renames, deletes | Pass: 64 direct cases, 12 watcher-driven cases, plus offline catch-up. Found and fixed one bug (P4) |

## Performance (p95 of 20 runs, release, warm file cache)

Reference vault, seed 1: 5,000 notes + 2,000 Image objects + 200 Tag objects = **7,200 indexed objects**.

| Metric | Target (×D-59 factor) | Reference run | Slow profile (`taskpolicy -b`) | 20,000-note vault |
| --- | ---: | ---: | ---: | ---: |
| NFR-PERF-02 full index | 18,000 ms (30 s × 60%) | **925 ms** | 5,547 ms | 4,157 ms |
| NFR-PERF-02/AC-2 reopen, 100 files changed offline | 2,250 ms | **146 ms** | 826 ms | 317 ms |
| NFR-PERF-03 quick switcher, per keystroke | 75 ms | **0.5 ms** | 2.4 ms | 1.6 ms |
| NFR-PERF-04 full-text search, 50 hits + snippets | 150 ms | **39 ms** | **221 ms (misses 200)** | 73 ms |
| NFR-PERF-07 query view, 1,000 rows (core only) | 225 ms | **2.3 ms** | 15 ms | 6.8 ms |
| NFR-PERF-08 external change → index updated | 1,500 ms | **70 ms** | 248 ms | 67 ms |
| Index size on disk | – | 62 MB | – | 229 MB |
| Process RSS after a full build | (PERF-09: 400 MB for all processes) | 74 MB | – | 208 MB |

- **Search:** the slowest queries are one-letter prefixes (`a` → `"a"*` matches almost every note, 39 ms; 243 ms in the slow profile). The UI should not prefix-expand one-character words, or should wait for a second character.
- **Memory:** 74 MB for the index process plus about 210 MB for the WebViews (S3) is about 285 MB, under the 400 MB PERF-09 budget. At 20,000 notes it's tighter (about 420 MB), which is the headroom case, not a target.
- **Watcher:** FSEvents delivers changes in about 50–70 ms. A 30 ms settle window batches sync-client bursts.
- **Not measured here:** cold-cache full index (`purge` needs root; [manual] at MS2), typing latency while indexing (UI, MS2/MS3), cold start (PERF-01), rendering of results (PERF-04/-07 here are core-only).

## How it works

- **Extractor** (`src/extract.rs`): a rule-for-rule port of the S1 reference (`spikes/s1-roundtrip/src/extract.ts`). Frontmatter uses the same delimiters. YAML is built from parser events with the YAML 1.2 core schema, as `yaml` v2 resolves it; duplicate keys → invalid. Wikilinks and tags are scanned on the raw text, outside code, HTML, `%%comments%%` and math; Markdown links are also skipped for tags.
- **Index** (`src/index.rs`): `notes`, `attrs`, `links`, `tags` tables plus an FTS5 table (`unicode61 remove_diacritics 2`, prefix indexes 2 and 3), so `zlutoucky` finds `žluťoučký`. Rebuild parses in parallel and writes in one transaction. Updates work per path: the file system is the truth (exists → re-index, gone → delete), and event kinds are never trusted. The index lives outside the vault; deleting it and rebuilding gives the same state (AR-01).
- **Quick switcher** (`src/switcher.rs`): titles, aliases and file names, folded (NFD, marks dropped, lower case) in memory. Ranking: exact, prefix, word prefix, substring, then in-order letters. A linear scan is 0.5 ms at 7,200 objects and 1.6 ms at 22,200, so no extra index is needed.
- **Offline catch-up** (`Index::sync`): compares `(mtime, size)` with the files and re-indexes only what differs (PERF-02/AC-2).

## What the spike found

| # | Finding | Consequence |
| --- | --- | --- |
| P1 | **The S1 reference parser crashes on `$$` followed by a line break inside a paragraph** (`a $$\nb`): a development assertion in micromark-extension-math. Found by the differential corpus; about 6% of random documents (120 of 2,000) | S1 core bug, tracked as a follow-up task. These documents are **left out of the corpus** (the test prints the count), so top-level paragraph-interrupting `$$` has no differential coverage until it's fixed |
| P2 | **The YAML loaders disagree**: `yaml-rust2`'s loader keeps `Null`/`TRUE` as strings and silently keeps the last of duplicate keys; the reference (`yaml` v2, core schema, `uniqueKeys`) reads null/true and rejects duplicates | The Rust side builds values from parser events (it knows the quoting style). The core-schema rules are pinned by the differential corpus |
| P3 | **`$$` math blocks inside lists, quotes and HTML blocks** end differently in micromark (container rules) and in the Rust pre-pass, which models only top-level `$$` blocks. About 40 of 1,880 documents (2%), all with `$$` in a container | Known difference, narrowed to the `links` and `tags` keys and to documents with `$$` on a container line: counted, capped at 4%, anything else fails (`s4_qa_ac4_differential_corpus`). Fixing it means a second CommonMark container parser; better options are below |
| P4 | **Watcher bug found by the property test**: a folder renamed away and recreated with the same name within one event batch kept the old folder's notes in the index | A changed folder is reconciled both ways (drop what's gone, index what's there). FSEvents "must rescan" events trigger a full `sync()` |
| P5 | FSEvents reports `/private/var/…` for a vault under `/var/…` | Event paths are mapped back through the canonical vault path |
| P6 | Links inside math counted in the reference, against the dialect (§5: "not links: … math"); tags inside math are unspecified | Fixed in S1 for links (tests `fr_fmt_03_*`), tags excluded (`fr_fmt_10_*_ap15`), decided in D-64 |
| P9 | **Prices read as math differ between parsers**: pulldown-cmark's math takes `$5 [[Cost]] $6`; Obsidian (and S1) don't, because a digit follows the closing `$`. Found because the reviewer asked for currency cases; the Rust index would have shown links the editor doesn't | The Rust extractor scans math itself with S1's Obsidian rules. Currency cases are in the corpus |
| P10 | **The generator's note sizes missed the spec**: only 53% of notes were short (spec: 60%) because paragraphs overshot the word target | Fixed; `performance_md_distribution_on_5000_notes` checks 12 types, the 60/35/5 length mix and 200 tags |
| P7 | The slow profile is about 3.5–6.5× slower, a worst case, not an M1 | Decided in D-65: reported only, factors stay |
| P8 | Rebuild uses every core (rayon) | In the app, cap the indexing pool (e.g. cores − 2) so the UI stays responsive while indexing (PERF-02 note) |

### Two parsers: what the drift means for the architecture

The editor (TypeScript, S1/S2) and the index (Rust) parse the same Markdown. A file can be read differently by the two, for example a link the editor shows that the index doesn't know. S4 controls this with the fixture contract (`expected.json`, every push) and the differential corpus (nightly, two-sided, randomized). Remaining options for MS2, none needed for the MVP:

1. Keep both parsers. Grow the differential corpus with every new construct, and decide each known difference explicitly (today only P3).
2. Make Rust the single extractor and compile it to WASM for the editor. The editor still needs mdast for blocks, so this removes only the link/tag drift.

Recommendation: option 1, with P3 recorded as a dialect note ("links inside `$$` blocks in lists are undefined").

## Commands

- `cargo test --release` (in `spikes/s4-index`): conformance, property tests, sync, search
- Differential check: `cd spikes/s1-roundtrip && EXTRACT_DIFF_OUT=/tmp/d npx vitest run test/extract-diff.test.ts && S4_EXTRACT_DIFF=/tmp/d/corpus.json cargo test --release --manifest-path ../s4-index/Cargo.toml --test conformance -- --nocapture` (nightly step `s4-differential`)
- `cargo run --release --manifest-path tools/gen-vault/Cargo.toml -- --seed 1 --out <dir> [--small-images] [--notes 20000] [--digest]`
- `cargo run --release --bin perf -- --vault <dir> --runs 20 [--label slow] [--out r.json]`; slow profile: prefix with `taskpolicy -b` (nightly step `s4-perf`, normal profile)
- `cargo bench --bench perf`: criterion trend (generates `target/bench-vault` once)
- Regenerate the reference contract after an intended extraction change: `cd spikes/s1-roundtrip && UPDATE_EXTRACT=1 npx vitest run test/extract.test.ts`
