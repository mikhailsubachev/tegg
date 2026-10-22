# Proposal: faster `./verify push` (G1) without losing coverage

Status: **items 1–3 implemented (D-343, 2026-10-16); items 4–6 are superseded by D-524…D-527 (2026-10-22): concurrent lanes (item 6), a content-addressed step memo with declared inputs instead of range-based skipping (item 4), batched multi-threaded Rust AC runs, and `./verify merge`. Measured before D-524: push 770–870 s, `app-webkit` ~320 s, `core-rust-test` ~270 s, half of the last 60 runs failed.** Item 1 as built moves only the latency-measuring tests, not whole files: per-test timing showed the switcher tests at ~60 s each and the functional ACs in `ac_perf.rs` at 3–8 s, so those stay in push. Measured on 2026-10-16 from `.verify/runs/` and a warm re-run in the main checkout.

## 1. What the measurements say

### The commit gate is not the problem

The last 12 `verify commit` runs took **0–6 s** (`.verify/runs/*-commit.json`). The commit-level steps are typecheck-only and `changedOnly`, so most are skipped. The 20–25 min you feel per commit is the **push gate**, which Claude runs before reporting a task done (test-strategy §8.1, G1 trigger) and which the `pre-push` hook runs again whenever the tree hash changed after that run.

### The push gate: 1,234 s (budget 600 s, TS-G4 says < 10 min)

Last three runs: 1,256 s, 1,183 s, 1,234 s. Breakdown of the last one:

| Step | Wall time | What the time really is |
| --- | ---: | --- |
| `core-rust-test` | 585 s | ~530 s are two perf AC binaries (below); the rest is a **cold** Rust build plus **regenerating the 5,000- and 20,000-note vaults** (cached per `target/`, and the worktree has a new `target/` every run) |
| `app-webkit` | 348 s | Playwright, 542 tests across 34 files, 6 workers. Sum of all tests 1,190 s; one file, `keyboard.ac.test.ts`, takes **288 s alone** (10 tests with 180–300 s timeouts) and is the critical path |
| `app-shell-test` | 91 s | `vite build` is 2 s warm; the rest is a cold `cargo test` of `src-tauri` (Tauri deps) for 2 tests |
| `s4-test` | 55 s | cold `--release` build of a frozen spike |
| `s3-rust-test` | 32 s | cold build, frozen spike |
| `core-rust-check` | 22 s | cold `cargo check`, fully subsumed by `core-rust-test` |
| `s5-test` | 20 s | cold `--release` build, frozen spike |
| `editor-test`, `qa-tools-test`, `s2-test`, `app-ui-test`, `gen-vault-test`, rest | ~70 s | fine |

Warm re-run of the Rust AC binaries in the main checkout (another session's push gate was running at the same time, so absolute numbers are inflated, the ranking is not):

| AC binary | Time | Notes |
| --- | ---: | --- |
| `tegg-core/tests/ac_perf_headroom.rs` | 355 s | NFR-PERF-03 AC-2 on a 20,000-note vault. Its own header says: *"Headroom check, reported, not a release blocker."* It **failed** under CPU contention in my run: a perf assertion in a gate that other work can disturb |
| `tegg-core/tests/ac_perf.rs` | 177 s | 12 NFR-PERF ACs on the 5,000-note vault, in a debug build (×10 targets) |
| everything else (27 binaries, 334 tests) | ~110 s | |

Why the cold builds: `createWorktree` (`tools/qa/src/checks.ts:114`) makes a fresh `mkdtemp` worktree each run and nothing sets `CARGO_TARGET_DIR`, so every Cargo workspace (core, `app/src-tauri`, s3, s4, s5, gen-vault) compiles its dependencies from zero. Warm, the whole core workspace test build is **4 s**. `node_modules` is already shared by symlink; `target/` is not.

Also found: **no nightly job is installed** (`launchctl` has no verify job; last nightly ran 2026-10-10 and took 3 min). Anything moved to nightly below only counts if nightly actually runs.

## 2. Proposed changes, in order of payoff

### Item 1: perf ACs leave the push gate (≈ −8 min)

- `core-rust-test` runs `crates/*/tests/ac_*.rs` **except** `ac_perf*.rs`.
- New step `core-perf-ac` at level `nightly` runs `ac_perf.rs` and `ac_perf_headroom.rs` (and the milestone gate inherits it).
- Push keeps every functional AC; perf is still checked nightly (together with the existing `core-perf` and `s4-perf` trend steps) and at every milestone/release gate (§9).
- This matches the strategy's own text: G2 holds "perf benchmarks (trend only)", G4 the perf release gate, and the metrics table says "if exceeded: split or move to G2". It also removes a load-sensitive assertion from a gate that runs while you edit.
- Needs: a `D-xx` ("NFR-PERF ACs run at G2/G3/G4, not G1") and a line in `docs/test-strategy.md` §8.1 and `docs/acceptance/performance.md`.

### Item 2: persistent build cache for gate worktrees (≈ −3 to −4 min)

- Gate steps get `CARGO_TARGET_DIR=<root>/.verify/cargo/<step dir>` (one per Cargo workspace, git-ignored with the rest of `.verify/`). Cargo fingerprints by content, so a stale artifact can't make a wrong test pass; the "fresh worktree" guarantee is about **source** (no uncommitted files), and that stays intact.
- Use a **stable worktree path** (`.verify/worktree`) instead of `mkdtemp`, so Tegg's own crates are incremental too (Cargo hashes the path into the metadata of path dependencies; a random path rebuilds them every time).
- Side effect: the 5,000- and 20,000-note reference vaults are cached per `target/`, so they stop being regenerated every run.
- Also fixes `app-shell-test` (91 s → ~5 s), the spike steps and `check-red` runs for new Rust AC files.
- Needs: CONTRACT §3.2 gains one sentence ("build caches persist in `.verify/`; sources come from the commit only"). Add `./verify clean` to wipe the cache when in doubt.

### Item 3: Playwright parallelism and the one slow file (≈ −3 min)

- `fullyParallel: true` in `app/playwright.config.ts` so tests inside a file spread over workers (no file uses serial mode today; each test gets its own fake core, so they're independent), and `workers: 8` under `VERIFY_GATE` (12 cores, 16 GB).
- `keyboard.ac.test.ts`: four tests sweep every route × every command × every control. Split the sweeps into one test per route (same assertions, parallelizable), or keep a sample in push and the full matrix nightly. Without this the file alone stays ≥ 288 s and caps the gain.
- `editor_save.ac.test.ts` (221 s) uses real waits around the autosave timer (`sleep(150)`, `saved(…, 3000)`); it already uses `page.clock` in places and could everywhere.
- Expected: `app-webkit` 348 s → ~120 s.
- Follow-up (2026-10-16): with the stable worktree path two gates of one repository often run at once; the gate's Vite port must then be per run (`VERIFY_PORT_BASE`, CONTRACT §3.2.1), not the fixed 5197, or the second gate's `app-webkit` fails at start.

### Item 4: spike tests only when spikes change (≈ −1.5 min after item 2)

- Spikes are done and frozen (S1–S5 GO). Give push-level steps an optional `onlyIfRangeTouches: "spikes/s4-index"`: the step runs in push only if a commit in the range touches that path, and always at nightly. Same for `tools/gen-vault`.
- Needs: CONTRACT §2 field, test-strategy §8.1 note. Regression protection stays: nightly still runs them, and any commit touching a spike runs them in push.

### Item 5: drop redundant work (≈ −0.5 min)

- `core-rust-check` only at `commit` level; in push it duplicates the test build.
- `app-test-typecheck`/`app-typecheck` likewise are rebuilt by `vite build`/vitest; low value, keep if you like the separate signal.

### Item 6: run independent steps in parallel (≈ −1 min on what remains)

- `gates.ts` runs steps strictly in sequence. Node steps (vitest, node --test) and Cargo steps can run as two lanes. Keep Playwright alone in its lane. Only worth doing after items 1–3, when the remaining gate is ~4–5 min; it is also what makes perf numbers noisy, which is another reason item 1 comes first.

### Prerequisite: install the nightly job

`./verify install-nightly` (launchd, under `caffeinate`, D-62). Items 1 and 4 move coverage to nightly; without a running nightly they lower coverage.

## 3. Expected result

| | Today | After 1–3 | After 1–6 |
| --- | ---: | ---: | ---: |
| `verify push` | ~20.5 min | ~4–5 min | ~3 min |
| `verify commit` | 0–6 s | unchanged | unchanged |

Push would be back inside the 600 s budget (TS-G4) with the same functional AC coverage; perf ACs move to nightly and milestone where they run undisturbed.

## 4. Not proposed

- Skipping AC tests by changed path in push. The fresh-worktree, whole-repo G1 is the only clean-machine check the project has (test-strategy §12); keep it whole.
- Release builds of Tegg crates for faster perf tests: would hide debug-assertion failures.
- Hosted CI: D-60 says local only.
