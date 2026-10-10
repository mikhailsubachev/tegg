# ADR 0003: One text engine; Rust orchestrates

- **Status:** Accepted (owner, 2026-10-10; AP-29 → D-82)
- **Requirements:** FR-FMT-07, FR-SYN-02, FR-SYN-06, FR-LNK-03, FR-TAG-04, FR-TYP-04, FR-IMP-*, AR-03
- **Builds on:** ADR 0001, ADR 0002 · **Details:** `docs/architecture.md` §3.2, §5.6, §5.7

## Context

ADR 0001 gives Markdown body edits to TypeScript but left bulk rewrites (link, tag and attribute renames across the vault, type changes, import body conversion) open between TypeScript and Rust. Two engines that patch Markdown would drift: S4 found the Rust and TS parsers disagreeing in edge cases (P1, P3, P9), and S5 found a regex shortcut silently losing links (F12).

## Decision

1. Every new version of a note's bytes is produced by the TypeScript document engine `@tegg/doc` (ADR 0001 patches with re-parse verification). That covers typing, attribute edits, bulk renames and import body conversion.
2. Rust never edits Markdown text. It reads (index, queries), selects files, takes restore points, checks versions and writes whole files atomically through the one write function.
3. Bulk operations are Rust jobs (`tegg-jobs`) that send each file's bytes to the engine running in a Web Worker in the main webview and write the result with the version it read.
4. The Capacities import planner (spaces, mapping, accounting rule; S5) stays in Rust; body rewriting goes through the engine, with links taken from the mdast parse.

## Consequences

- **Good:** one implementation of the patch model and its verification; the Rust/TS difference is limited to *reading*, which the conformance and differential corpora already control.
- **Cost:** jobs need a live webview (the main window hides instead of closing, so it stays alive on desktop); every job file makes an IPC round trip.
- **Enforced** by an L0 check: no Markdown rendering in the Rust crates' dependencies.

## Alternatives considered

- **Port the patch model to Rust** and keep both engines equal with the conformance corpus: two engines to maintain, and pulldown-cmark lacks the micromark extensions (wikilinks, tags, highlights, math) the editor relies on.
- **Embed a JS engine in Rust** (QuickJS) to run `@tegg/doc` headless: possible later if jobs must run without a webview (e.g. mobile background work); not needed for the desktop MVP.
