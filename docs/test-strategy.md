# Test Automation Strategy: Tegg

|                     |                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------- |
| **Document status** | v1.0, accepted 2026-10-08                                                            |
| **Date**            | 2026-10-08                                                                          |
| **Based on**        | BRD v1.9, `docs/acceptance/`, `docs/markdown-dialect.md`, ADR 0001, S1 `FINDINGS.md` |
| **Owner decisions** | Clarification session 2026-10-08 (§2); BRD D-59…D-63, R-11 (§13)                       |

> **How to read this document.** The BRD says *what* must be true; the acceptance criteria (ACs) say *how we know*; this document says *how the checking is automated, who (human or Claude agent) does it, when it runs, and what blocks a merge or a release*. Strategy rules have IDs (`TS-xx`) so tests, PRs and agents can cite them.

---

## 1. Goals

| ID    | Goal                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-G1 | **No data loss, ever** (NFR-REL-01…04, AR-01). The test effort is weighted towards file safety, round-trip and link integrity, not UI polish. |
| TS-G2 | **Every requirement is proven by its ACs** as automated tests named after them; a milestone is done only when all its ACs pass.              |
| TS-G3 | **Claude doesn't grade its own work.** Claude writes most code *and* most tests, so tests are written independently and before the code.   |
| TS-G4 | **Fast feedback on one Mac.** Everything runs locally; the default gate before a push takes < 10 minutes.                                  |
| TS-G5 | **Privacy by construction.** Real exports and personal data never reach the repo, test output, screenshots or an agent's context.           |

---

## 2. Context and constraints (from the owner, 2026-10-08)

| #    | Decision                                                                                                                         | Consequence                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Q-1  | Claude's QA roles: **test-first author, PR reviewer/gatekeeper, exploratory tester, AC & fixture author**                        | Four Claude agent roles (§6)                                                                                                          |
| Q-2  | **Claude Code writes most of the production code**                                                                               | Independence controls are mandatory (§6.3): separate contexts, red tests committed first, protected AC tests, mutation testing        |
| Q-3  | **Pure local execution**: no hosted CI, no self-hosted runner; one development Mac                                               | All gates run via a `verify` script, git hooks and Claude Code hooks (§8). No GitHub status checks; the verify record is local (§8.3) |
| Q-4  | **Performance reference = this Mac: Apple M2 Pro, 16 GB, macOS 26** (replaces M1 8 GB in D-58)                                 | Targets tightened for faster hardware + a "slow profile" run (§9). BRD D-59                                         |
| Q-5  | **UI testing is layered**: Playwright on the React UI, Appium Mac2 for the real app and native parts, Claude computer use on top | Test pyramid §4. Appium feasibility must be proven in spike S3                                                                        |
| Q-6  | **macOS 14 (the minimum, NFR-OTH-01) is not tested for now**; accepted risk until a public release                              | Known gap, BRD R-11                                                                                                       |
| Q-7  | **Second Mac** = sync partner only; **Dropbox** and **Google Drive** available; **iCloud Drive not enabled**                    | Two-Mac sync tests for Dropbox/Drive; iCloud part of FR-SYN-01/AC-3 is a known gap (§12)                                              |
| Q-8  | The strategy **proposes MVP milestones** (§10.2)                                                                                 | Recorded in BRD §11.2 (D-63)                                                                  |

---

## 3. Risk-based priorities

Test depth follows the cost of a bug, not the size of a feature.

| Tier                                           | Areas                                                                                                                                                                                    | Required depth                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **T1: data loss / corruption** | Atomic writes, round-trip/patch model, external-change detection, conflict copies & duplicate ids, link rename across the vault, bulk rewrites (tag/attribute rename, type change), importer write phase, backups, trash | Unit + property + integration on a real filesystem + fault injection + mutation testing (thresholds §11) + exploratory charter |
| **T2: silent wrong data**                     | Dates/timezones, NFC/NFD, file-name sanitizing, link resolution, duplicate titles, tag matching, importer mapping, index ↔ files consistency, query results                              | Unit + property + conformance (TS ↔ Rust) + integration; mutation testing (thresholds §11)                                 |
| **T3: broken workflow**                       | Editor, capture, inbox, tasks, daily notes, navigation, search UI, previews                                                                                                              | Component/flow tests (Playwright) + real-app smoke (Appium) + exploratory                                                    |
| **T4: experience**                            | Themes, layout, empty states, accessibility, polish                                                                                                                                      | Visual snapshots (v1.0), a11y scan, exploratory                                                                              |

---

## 4. Test layers

```
  L8  Owner manual checks             two-Mac sync, release sign-off           per release
  L7  Claude exploratory sessions     computer use on the real app             per milestone
  L6  Real-app E2E (Appium Mac2)      built .app, menu bar, hotkeys, capture   nightly / milestone
  L5  UI flows (Playwright, WebKit)   React UI, mocked core over IPC           every push
  L4  Integration (real filesystem)   core in temp vaults, fault injection     every push (+ long runs nightly)
  L3  Conformance                     shared TS ↔ Rust expectations corpus     every push
  L2  Property / fuzz                 fast-check, proptest                     every push (short), nightly (long)
  L1  Unit                            Vitest, cargo test                       every commit (changed scope)
  L0  Static rules                    types, lint, custom architecture checks  every commit
```

### L0 Static rules (TS-L0)

Plain type checks and linters (`tsc`, ESLint, `cargo clippy -D warnings`, `rustfmt`), plus **custom architecture rules** that turn non-negotiable rules into checks:

| Rule                                                                 | Requirement            | Check                                                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One write function for vault files                                   | FR-SYN-02/AC-1         | Lint rule / grep: no `fs.writeFile*`, `std::fs::write`, `File::create`, `OpenOptions` on vault paths outside the atomic-write module                         |
| No network                                                           | NFR-SEC-01, D-43       | No HTTP/socket crates or packages outside an allow-list; Tauri capabilities without `http`; CSP `connect-src` limited to IPC; checked again at L6 (§5.4) |
| Core is platform-neutral                                             | AR-03                  | Core crate/packages must not depend on Tauri desktop APIs, AppKit or menu bar code (dependency graph check)                                                  |
| UI strings externalized                                              | NFR-OTH-02             | ESLint rule: no string literals in JSX text/attributes outside the message catalog                                                                          |
| Reserved keys in one place                                           | FR-TYP-15              | Single constant shared by TS and Rust (generated); test that both lists are equal                                                                           |
| Machine-local paths only under Application Support                   | FR-STO-07, rule 12     | Lint: no writes to paths derived from the vault for caches, index or history                                                                                |

### L1 Unit (TS-L1)

- **TypeScript:** Vitest (as in S1). **Rust:** `cargo test`.
- Pure logic: sanitizing names, date parsing, NFC, link parsing, mapping tables, query operators, recurrence math.
- Table-driven, with Czech diacritics and emoji in every text-handling table (CLAUDE.md "test with diacritics").

### L2 Property and fuzz (TS-L2)

- **fast-check** (TS) and **proptest** (Rust). S1 already proves the pattern (random edit sequences keep the round-trip).
- Mandatory properties:
  - parse → serialize = identity, for generated documents;
  - an edit changes only its range;
  - rename A→B→A restores the vault byte-for-byte;
  - sanitizing a file name is idempotent, ≤ 200 bytes, valid on all four OSes;
  - NFC(name) resolves the same as NFD(name);
  - date-only values are equal in every time zone;
  - the index rebuilt from the files equals the incrementally updated index.
- **Run lengths:** on push, default runs with a fixed seed plus one random seed; nightly, 100× runs. Every failure logs its seed, and the minimized case becomes a fixture.

### L3 Conformance (TS-L3)

ADR 0001 splits parsing across languages: TypeScript writes, Rust reads for the index. A drift between them is a T2 bug.

- `tests/conformance/`: every fixture has an `expected.json` (title, id, type, attributes, links with ranges, tags, embeds) **generated once from the TS reference, reviewed, then committed**.
- Both the TS suite and the Rust suite assert against the same JSON. A change to either side has to update the JSON in the same commit.

### L4 Integration on a real filesystem (TS-L4)

Core services against **temporary vaults on APFS** (`$TMPDIR`), never mocks of the filesystem for T1 code.

| Area                     | What is exercised                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic writes            | Temp file name/location, `fsync`, rename; **SIGKILL harness**: child process saving in a loop, killed at random points, 1,000 cycles (FR-SYN-02/AC-3); leftover `.tegg-tmp` clean-up |
| Watcher                  | FSEvents via `notify`: external edit/rename/delete, 500-file burst (FR-SYN-03/AC-6), reflection < 2 s                                                                        |
| External-change safety   | Change-on-disk before save (mtime + size + hash, AC-7) → no write, conflict raised                                                                                           |
| Sync simulation          | Scripted "sync client" that writes conflict copies with Dropbox/Drive/iCloud name patterns, duplicate ids, out-of-order arrivals, placeholder/dataless files (FR-VLT-03)      |
| NFC/NFD                  | Creates NFD-named files at runtime (git can't store them, see fixture README)                                                                                                 |
| Index                    | Delete index → rebuild → snapshot equals the incremental snapshot (AR-01/AC-2, NFR-POR-03)                                                                                    |
| Bulk operations          | Rename/tag rename/attribute rename on generated vaults: only affected files written (write counter), backup zip created first, cancel before write leaves vault byte-identical |
| Importer                 | Synthetic Capacities fixtures end-to-end into an empty vault; a **vault snapshot diff** (paths + hashes) is the assertion; report content checked                            |
| Minimal writes           | A **write-counting test double for the one write function** plus mtime/inode snapshots: open/index/search/query → zero writes (FR-SYN-06/AC-1)                                 |

### L5 UI flows: Playwright (TS-L5)

- **Engine: WebKit** (the closest to Tauri's WKWebView). Chromium only for debugging.
- The React app runs in the browser with the Tauri IPC replaced by a **fake core** (`@tauri-apps/api/mocks`) backed by an in-memory vault.
- **Contract tests** keep the fake honest: command names, argument and result types are generated from the Rust command definitions (e.g. `ts-rs`/`specta`), and a shared contract suite runs against both the fake and the real core.
- Covers editor behaviour (slash menu, Markdown shortcuts, `[[` autocomplete, block conversion, undo), keyboard-first navigation (command palette reaches every action: FR-UX-03 / FR-NAV-02, checked by enumerating the action registry), inbox, tasks board, previews, settings.
- Editor round-trip under real ProseMirror transactions: open fixture → perform UI edits → assert the saved bytes differ only in the edited block (FR-FMT-07/AC-3) using the real TS patch module (not mocked).
- From v1.0: **visual snapshots** in light and dark (FR-UX-05) for a fixed set of screens; **axe-core** accessibility scan (FR-UX-08, S).

### L6 Real-app E2E: Appium Mac2 (TS-L6)

- The **built `.app`** (release profile) driven through macOS accessibility (XCUITest) with the Appium `mac2` driver and a WebdriverIO client.
- Scope is deliberately small: smoke journeys and **what only exists natively**:
  - launch, create/open vault, Home renders;
  - **menu bar capture**;
  - **global hotkeys** ⌃⌥Space / ⌃⌥T with the main window closed (FR-CAP-03/05);
  - the capture window saves into the vault;
  - quit flushes pending edits (FR-EDT-08/AC-3);
  - online-only warning;
  - window and tab restore.
- **Every slice adds to the suite (TS-I7, D-382):** an AC with `L6` in its layer marker gets an `app/e2e/` test in the slice's red commit, next to its L4/L5 tests; the push gate's `l6-coverage` check enforces it.
- **Network check (NFR-SEC-01):** during every L6 run, a monitor samples `lsof -i -a -p <app pids>` and fails on any socket other than local IPC.
- **Feasibility is unproven:** driving content inside a WKWebView through accessibility may be limited. **Spike S3 must prove** hotkey, menu bar and capture-window automation, and a basic in-webview interaction, before we rely on L6 (exit criterion in §10.1).

### L7 Claude exploratory sessions (TS-L7)

Run by the **Explorer agent** (§6) using computer use on the real app, **only on synthetic or generated vaults** (TS-P3).

- **Charters per milestone**, e.g. "try to lose data while switching notes quickly during an external edit", "break link integrity through renames, type changes and duplicates", "import the synthetic Capacities fixture with unusual mappings".
- **`[manual]` ACs that Claude can do:** Obsidian compatibility (open the Tegg-written vault in Obsidian, check properties, links, embeds, Mermaid: FR-FMT-01/AC-3, FR-FMT-05/AC-3, NFR-POR-01/AC-1, FR-ATT-07/AC-3).
- **Output:** a session report in `qa/sessions/<date>-<charter>.md` (steps, observations, screenshots of synthetic data only, bugs filed). Every bug found becomes an automated regression test (TS-D2) before it's fixed.

### L8 Owner manual checks (TS-L8)

Only what can't be automated or delegated:

- **Two-Mac sync**: Dropbox and Google Drive (FR-SYN-01/AC-3).
- **Force-quit while typing** (FR-SYN-02/AC-5).
- **No stutter during a full re-index** (NFR-PERF-06/AC-2).
- **Release sign-off.**

A checklist in `qa/manual/`; results recorded in the release record.

---

## 5. Test data

| ID   | Rule                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-D1 | **Fixtures** live in `tests/fixtures/` (synthetic, committed, D-50), one folder per area: `format/roundtrip/` (exists), `vaults/` (data safety, links), `import/capacities/<finding>/`, `conformance/`. Each folder has a README mapping fixtures to BRD findings/ACs. |
| TS-D2 | **Every bug gets a fixture or test first.** The failing test is committed with the fix and named `bug_<issue>_<req-id>_…`.                                                                                                                    |
| TS-D3 | **Generated vaults** via `tools/gen-vault` (seeded, deterministic; spec in `performance.md`), used for performance, bulk operations, exploratory sessions and the property tests' large cases. Sizes: 50 (smoke), 5,000 (reference), 20,000 (headroom). |
| TS-D4 | **Byte-exact fixtures** are never opened and re-saved in an editor. A `verify` check fails if a fixture's hash changes without a `Fixture-Change:` commit trailer.                                                                               |
| TS-D5 | **Time and locale** are injected (clock, time zone, locale) in all tests; date tests run in America/Los_Angeles, Europe/Prague and Asia/Tokyo, including DST transition days.                                                                    |

### 5.1 Privacy guardrails (TS-P)

| ID   | Rule                                                                                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-P1 | **pre-commit hook** rejects any staged path under `test exports/`, any `.zip` outside `tests/fixtures/`, and files larger than 1 MB outside fixtures.                                                                                                    |
| TS-P2 | The **real-export test** prints counts and file indexes only; its own test asserts that its output matches a numbers-only format, so a later change can't start printing titles.                                                                      |
| TS-P3 | **Claude agents never read the real exports or the owner's real vault.** Exploratory sessions use generated/synthetic vaults; the Explorer and Test-author agent definitions say so explicitly, and `test exports/` is denied in Claude Code permissions (`.claude/settings.json`); the owner starts the real-export run (D-62). |
| TS-P4 | Screenshots and session reports may only show synthetic data.                                                                                                                                                                                |

---

## 6. Claude in the QA process

### 6.1 Agent roles

Defined as Claude Code subagents in `.claude/agents/`. Each runs in its **own context**.

| Agent           | Reads                                                                                         | Writes                                                                 | Never                                                     |
| --------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| **AC author**   | BRD, existing ACs, §15 findings, fixtures                                                    | `docs/acceptance/*.md` drafts, fixture drafts, AP-n points for the owner | Decides gaps itself; any decision goes to the owner (CLAUDE.md) |
| **Test author** | Approved ACs, public interfaces (type signatures, command contracts, ADRs), fixtures         | AC tests (`*.ac.test.ts`, `tests/ac_*.rs`), fixtures                   | Reads implementation code of the feature under test        |
| **Implementer** (main session) | Everything                                                                   | Production code, unit tests                                            | Changes existing AC tests without owner approval (TS-I3)  |
| **QA reviewer** | Diff, BRD, ACs, this strategy, non-negotiable rules                                           | Review report (`qa/reviews/<branch>.md`), findings                     | Edits code; it is read-only                               |
| **Explorer**    | Charters, generated vaults                                                                    | Session reports, bug issues                                            | Uses real exports or the owner's vault                    |

### 6.2 Workflow per requirement or feature

```
1. AC author     drafts ACs  ──► owner approves (gaps → AP-n → BRD D-xx)
2. Test author   writes AC tests from ACs + interfaces only
                 commit "test(FR-XXX-nn): acceptance tests (red)"
                 verify confirms they FAIL for the right reason (assertion, not compile/missing fixture)
3. Implementer   makes them pass; adds unit/property tests for internals
4. verify        full push gate (§8) + mutation run on touched T1/T2 modules
5. QA reviewer   checks diff against BRD, ACs, TS rules, non-negotiable rules 1–13
6. Owner         reads review report, merges
```

### 6.3 Independence controls (TS-I)

| ID    | Control                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-I1 | **Red first.** AC tests are committed before the implementation and must fail at that commit. `./verify check-red <commit>` checks it.                                                                         |
| TS-I2 | **Separate context.** The Test author doesn't see the implementation, so tests describe required behaviour, not the code's behaviour.                                                                          |
| TS-I3 | **Protected AC tests.** A commit that *modifies or deletes* an existing AC test file needs a commit trailer `AC-Test-Change: <reason>; approved-by: owner`. A `commit-msg` hook enforces it; the QA reviewer flags it. |
| TS-I4 | **Mutation testing** (Stryker for TS, `cargo-mutants` for Rust) on T1/T2 modules catches tests that pass whatever the code does. Thresholds in §11 (D-61).                                         |
| TS-I5 | **No weak assertions.** The reviewer flags snapshot-only tests for T1 logic, `expect(...).toBeTruthy()` on results, skipped/`only` tests, and broadened tolerances.                                               |
| TS-I6 | **Coverage by AC, not by line.** Line coverage is reported but not a gate; the gate is "every AC of the milestone has a passing test" (§7).                                                                     |
| TS-I7 | **Every slice ships its real-app tests** (D-382). The red AC tests of a slice include an `app/e2e/` (L6) test for every AC whose layer marker names L6; `./verify push` fails `l6-coverage` when such an AC is tested only at lower layers (TS-COV AC-6). |

---

## 7. Traceability and AC coverage

- `./verify coverage` parses `docs/acceptance/*.md` (every `<REQ-ID>/AC-n`) and test names in TS and Rust (`fr_fmt_11_ac2_…`). It writes `qa/coverage/ac-matrix.md`:
  - requirement → AC → test(s) → last result;
  - **untested** ACs;
  - tests pointing at ACs that no longer exist;
  - `[manual]` ACs and their latest session record.
  - L6 ACs that have tests at lower layers but no real-app test (TS-I7).
- `[manual]` ACs count as covered only with a session record (L7) or a manual checklist entry (L8) for the current milestone.
- Commit messages, PR descriptions and issues cite requirement IDs (CLAUDE.md). The reviewer checks that changed code paths have the relevant IDs.

---

## 8. Execution: pure local (Q-3)

### 8.1 Gates

| Gate                        | Trigger                                              | Budget  | Runs                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G0 commit**               | git `pre-commit`                                     | < 60 s  | Format, lint, type check, L0 rules, privacy guardrails (TS-P1), unit tests of changed packages                                                                             |
| **G1 push**                 | git `pre-push`; Claude Code hook before `git push` and before the agent reports a task done | < 10 min | Everything in G0 for the whole repo; L1–L5 (short property runs) except latency-target ACs (D-343); AC-coverage diff; fixture hash check (TS-D4); red-first check for new AC tests (TS-I1)                     |
| **G2 nightly**              | `launchd` job on this Mac at night, under `caffeinate` (D-62) | ≤ 90 min | Long property runs (100×); SIGKILL harness 1,000 cycles; mutation testing on T1/T2 modules changed since last run; L6 Appium suite; perf benchmarks (trend only); latency-target ACs (`nfr_perf_*`, FR-NAV-01 AC-9, FR-SRC-01 AC-11, D-343); 20,000-note headroom |
| **G3 milestone**            | Owner request                                        | —       | G2 in full (all mutation, not just changed); all milestone ACs green; Explorer charters done; `[manual]` ACs recorded; QA reviewer milestone report                           |
| **G4 release**              | Release candidate                                    | —       | G3 + perf release gate on the reference Mac (§9) + signed/notarized DMG install & smoke + owner two-Mac sync checklist + real-export local run (FR-IMP-23) + `git log` privacy scan |

### 8.2 One entry point

- `./verify [commit|push|nightly|milestone|release]` runs the matching gate.
- It writes a machine-readable summary to `.verify/` (git-ignored): results, durations, seeds, the HEAD tree hash.
- Claude and the hooks call the same script; nobody runs tool commands ad hoc for a gate.

### 8.3 Making local gates trustworthy

Without hosted CI nothing independent enforces the gates, so:

- **The `pre-push` hook skips the rerun only when** `.verify/last-pass` matches the exact tree hash being pushed. Otherwise it runs G1.
- **Claude Code hooks** (project `.claude/settings.json`) block `git push`, `gh pr merge` and "task done" until G1 passed for the current tree. `--no-verify` is denied for Claude in permissions (`.claude/settings.json`).
- **The QA reviewer report states** the verify result and tree hash it saw. A PR without one isn't merged.
- **Known weakness:** there's no clean-machine check, so uncommitted files or local state can hide a problem. Mitigation: G1 runs from a fresh `git worktree` of the commit being pushed, not the working directory.
- **Build cache (D-343):** G1 and later gates reuse a Cargo build cache (`.verify/cargo-target`) and a stable worktree path, so dependencies aren't rebuilt each run. Sources still come only from the commit, and Cargo's fingerprints rebuild anything whose source changed. `./verify clean` drops the cache. The milestone and release gates build the app bundle in its own `target/`.
- **Lanes (D-609):** tree gates run their steps in concurrent lanes (`browser`, `cargo`, `node` in `qa.config.json`), each lane in config order; `--lanes 1` runs them one after another. Steps sharing a resource share a lane.
- **Step memo (D-611):** G1 skips a step whose declared `inputs` are unchanged since a recorded pass (content-addressed by git object ids, `tools/qa/CONTRACT.md` §3.2.3) and names the run it reuses; G2 and above always run everything, as does `./verify push --all`. The nightly job must be installed for this to be safe.
- **Pre-merge flow (D-612):** `./verify merge` = fetch, check that HEAD contains `origin/main`, G1 on HEAD, `review-prep`, then the QA reviewer agent; the Claude hook lets `gh pr` merge through only when `.verify/last-pass` matches HEAD's tree.
- **Latency ACs at G2 (D-343):** ACs that assert a latency budget run nightly and at G3/G4, where nothing else competes for the CPU, not in G1, which often runs while other work does. This needs the nightly job installed (`./verify install-nightly`).

### 8.4 Flaky tests

- A test that fails and then passes on rerun is **flaky**, not green. It's quarantined (`@flaky` tag, separate report) within a day and gets an issue. WebKit: the Playwright tag `@flaky` keeps a test out of the gates' `app-webkit` run, and the nightly step `app-webkit-flaky` runs only the quarantined tests (D-688).
- T1 tests may not stay quarantined past the current milestone.
- File-watcher and timing tests use explicit event waits with generous upper bounds, never fixed sleeps.
- **UI tests wait for state, not for time (D-688).** A WebKit or L6 test waits for the state it acts on or reads before acting: a list showing the typed query (`settled`), a value the core sends (`eventually`), an element (`must`), the embeds of a page it went Back to. A fixed `sleep` is only allowed before asserting that *nothing* happened. Under the push gate's lanes a fixed sleep or a single read is a flaky test.

---

## 9. Performance testing (Q-4)

**Reference:** this Mac, an Apple M2 Pro (8 performance + 4 efficiency cores) with 16 GB, running macOS 26, release build. 95th percentile of ≥ 20 runs (unchanged from D-58).

**Targets on the M2 Pro (D-59).** The NFR targets were set for an M1 with 8 GB. A faster machine meeting them would hide slowness on weaker Macs, so:

| Run                   | How                                                                                                       | Target                                                                                                                                 | Gate?                     |
| --------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Reference run**     | Normal scheduling                                                                                         | Latency metrics (PERF-01, 03–08, 10) at **75%** of the NFR value; full index (PERF-02) at **60%**; memory (PERF-09) unchanged < 400 MB | Release gate (G4)         |
| **Slow profile**      | Benchmarks pinned to efficiency cores (`taskpolicy -b`), as a rough stand-in for older/base Macs        | Reported against the **original** NFR values                                                                                           | Reported, not a gate      |
| **Regression trend**  | Every G2 nightly                                                                                          | > 20% worse than the rolling median of the last 5 runs → issue                                                                         | Gate at G4 (D-58 rule)    |

The factors (75% / 60%) are placeholders. **Spike S4 calibrates them** by running the same benchmarks on this Mac with and without the slow profile. The calibrated numbers are then recorded in D-59 and `docs/acceptance/performance.md`.

**How each metric is measured**:
- **Rust core** (index, search, query, rebuild): `criterion` benchmarks against the 5,000-note generated vault.
- **UI metrics** (open note, typing latency, quick switcher, query view): an instrumented release build writes `performance.mark` timings to a local perf log, enabled only by a launch flag that release builds ignore unless a test env var is set. **Typing latency** is approximated as keydown → next animation frame after the DOM update. S2 must confirm this is a valid proxy.
- **Cold start, capture window, memory:** via L6 (Appium) plus `ps`/`footprint` sampling.
- **Results** are appended to `qa/perf/history.jsonl` (committed; numbers only).

---

## 10. Phased plan

### 10.1 Phase 0: remaining spikes (now)

QA deliverables are part of each spike's exit criteria.

| Spike                     | QA exit criteria                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S2 editor (TipTap)**    | S1 corpus passes through **real ProseMirror transactions** (open → edit block N → save → only block N changed); Obsidian inline syntax (`==hl==`, `%%c%%`, `$m$`, `^id`) has explicit edit tests (S1 finding); Playwright **WebKit** harness with fake core runs one editor flow; typing-latency proxy validated |
| **S3 Tauri platform**     | **Appium Mac2 proof**: open the menu bar capture, trigger both global hotkeys with the main window closed, type and save in the capture window, one interaction inside the WKWebView; capture-window open time measured (< 300 ms); `lsof` network monitor works; signed + notarized DMG installs on the second Mac |
| **S4 Rust index**         | `tools/gen-vault` (seeded); `criterion` benchmarks for PERF-02/03/04/07/08; **calibration of §9 factors**; conformance suite (L3) runs the S1 corpus against the Rust extractor; index rebuild = incremental snapshot property                                                                         |
| **S5 Capacities dry-run** | Synthetic fixtures per §15 finding in `tests/fixtures/import/capacities/`; dry-run report asserted; real-export local run with counts-only output test (TS-P2); "imported + reported = total" rule as a reusable assertion                                                                         |
| **Cross-cutting**         | `./verify` skeleton, git hooks, Claude Code hooks, `.claude/agents/` for the four agent roles (the implementer is the main session), `./verify coverage`, privacy hooks. **Built before product code starts.**                                                                                                                                  |

### 10.2 MVP milestones and their gates (BRD §11.2, D-63)

Ordered so that each milestone stands on tested foundations. T1 code comes first, and the importer comes last because it uses almost everything.

| #      | Milestone                         | Requirements (main)                                                                                                                    | Key automated gates                                                                                                                                                          |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MS1** | Vault core & file format          | FR-STO-01…09, FR-FMT-01…12, FR-SYN-02, -06, FR-TYP-10, -15, NFR-REL-01, -03, NFR-POR-01…03, FR-VLT-01, -02                             | All `file-format.md` and storage ACs; SIGKILL harness; minimal-write counter; NFC/NFD on APFS; mutation ≥ 70% on write/patch modules (MS1 threshold, §11)                                        |
| **MS2** | Index, watcher, search, switcher  | AR-01, FR-SYN-03…05, -07, FR-VLT-03, FR-SRC-01…03, FR-NAV-01, NFR-PERF-01…04, -08                                                      | Rebuild = incremental; external-change & conflict ACs via sync simulator; perf benchmarks in place (trend); conformance suite                                               |
| **MS3** | Types, attributes, editor         | FR-TYP-01…09, -11…14, FR-EDT-01…09, -13…15, FR-EDT-08 autosave, NFR-PERF-05, -06                                                       | Editor round-trip through UI edits; autosave ACs; attribute edits change only their lines; Playwright flows; typing latency trend                                            |
| **MS4** | Links, tags, renames, daily notes | FR-LNK-01…04, -07, -14, FR-TAG-01…08, FR-FMT-08 rename, FR-TYP-04, -07, FR-STO-04, FR-DLY-01…06, -08, FR-HIS-04 backup zip (D-57)        | All `links.md` ACs; rename/undo property test; bulk rewrite writes only changed files + backup first; 50-file rename integration                                            |
| **MS5** | Tasks, capture, inbox, home       | FR-TSK-01…06, -08…11, FR-CNV-01…06, -08, FR-CAP-01, -03…05, FR-INB-01…04, FR-HOM-01, -02, FR-NAV-02…05, NFR-PERF-10                     | Block→object conversion undo; L6 hotkeys/menu bar/capture window; capture < 300 ms; board drag changes attribute                                                           |
| **MS6** | Images, PDFs, trash               | FR-ATT-01…03, -07…09, FR-STO-05, -08, FR-HIS-01                                                                                       | Paste image → object + file + embed; trash/restore paths; "moved to trash" placeholder                                                                                     |
| **MS7** | Capacities importer               | FR-IMP-03, -05, -07…11, -14…17, -19…22, -24                                                                                            | All `import-capacities.md` ACs on synthetic fixtures; cancel = vault byte-identical; backup before import; real-export local run: 0 unreadable, imported + reported = total |
| **MS8** | MVP hardening & release           | NFR-PERF (all), NFR-SEC-01, AR-08, FR-SYN-01 two-Mac                                                                                   | G4 release gate: perf on reference Mac; 7-day "daily use" soak with nightly G2; owner two-Mac sync checklist; Explorer data-loss charters across all features              |

### 10.3 Later phases (outline; detailed per phase)

| Phase      | New test concerns                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v1.0**   | Query engine: differential tests of SQL vs a naive in-memory evaluator over generated vaults. Recurrence: property tests across DST and month ends. Mermaid mindmap round-trip. Templates: variable expansion. Version history: retention and restore. Export: golden files for HTML/Markdown bundle, structural checks for PDF/DOCX, whole-vault export lossless re-import (FR-EXP-06). Share extension via L6. Obsidian import in place = zero writes. **Visual snapshots light/dark** and a11y scan start here. |
| **v1.x**   | Notion and Anytype importers: synthetic fixtures per N-findings; re-import (add-new / update) by `import-id`; multiple vaults isolation; split view.                                                                                                                                                                                             |
| **v2**     | Core reuse on the chosen mobile platform (D-100): the same L1–L4 suites on its targets; **sync adapter contract suite** run against a fake provider and the real Dropbox/Drive APIs (only test accounts); conflict rules identical to folder sync. Device testing approach decided then.                                                                                       |
| **v3 AI**  | Evaluation sets on synthetic vaults; no network calls without explicit opt-in (NFR-SEC-01 revisited by then).                                                                                                                                                                                                                                    |
| **Public** | macOS 14 coverage (closes R-11), clean-machine installs, crash reporting policy, onboarding flows.                                                                                                                                                                                                                                              |

---

## 11. Defects and metrics

**Defects**
- Bugs are GitHub issues labelled with a requirement ID and a tier (T1–T4).
- **T1 bugs stop feature work** until fixed and covered by a regression test (D-62, MVP).
- Every fix starts with a failing test (TS-D2).

**Metrics**, reported per milestone in `qa/coverage/`:

| Metric                           | Target (D-61)                         |
| -------------------------------- | ------------------------------------- |
| AC coverage of current milestone | 100% (gate)                           |
| Mutation score T1 / T2 modules   | ≥ 70% / ≥ 60% in MS1–MS3; ≥ 80% / ≥ 70% from MS4 |
| Flaky tests in quarantine        | 0 T1; ≤ 3 overall                     |
| G1 duration                      | < 10 min (if exceeded: split or move to G2) |
| Escaped T1 defects (found after merge) | 0; each one triggers a retro and a new test layer or rule |
| Perf vs targets and trend        | Within §9                             |

---

## 12. Known gaps and accepted risks

| Gap                                                     | Why                                                    | Mitigation                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| No testing on **macOS 14** (minimum supported)          | Owner decision Q-6; only macOS 26 available            | Avoid APIs newer than macOS 14 (lint against SDK availability where possible); close before public release |
| **iCloud Drive** not tested in two-Mac sync             | Not enabled yet (Q-7)                                  | iCloud name patterns and `.icloud` stubs covered by the sync simulator (L4); owner enables iCloud Drive on both Macs before MS8 (D-62), closing the gap |
| No independent **clean-machine** CI                     | Pure local execution (Q-3)                             | G1 runs from a fresh worktree; DMG smoke on the second Mac at release                              |
| Perf on **weaker Macs** not measured                    | Only M2 Pro available (Q-4)                            | Tightened targets + slow profile (§9)                                                              |
| **Appium in WKWebView** unproven                        | Accessibility exposure of web content varies           | S3 proof; fall back to Claude exploratory for anything Appium can't drive                          |
| Gates depend on hooks not being bypassed                | No server-side enforcement                             | Claude permissions deny `--no-verify`; reviewer report includes verify tree hash                   |

---

## 13. Decisions recorded in the BRD (v1.10, accepted 2026-10-08)

| #     | Decision                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-59  | **Performance reference** (amends D-58): Apple M2 Pro 16 GB, macOS 26, release build; tightened targets + slow profile per §9, factors calibrated in S4.                        |
| D-60  | **Test execution is local**: `./verify` gates G0–G4 via git hooks and Claude Code hooks; no hosted CI until a public release or a second contributor.                            |
| D-61  | **Claude QA roles and independence controls** per §6: red-first AC tests, protected AC tests, mutation thresholds 70% / 60% (T1 / T2) in MS1–MS3, 80% / 70% from MS4.          |
| D-62  | **QA operations**: nightly G2 via `launchd` under `caffeinate`; Claude is denied access to `test exports/` and the owner starts the real-export run; T1 bugs stop feature work in the MVP; iCloud Drive enabled on both Macs before MS8. |
| D-63  | **MVP milestones MS1–MS8** with their test gates (§10.2), recorded in BRD §11.2.                                                                                               |
| R-11  | macOS 14 minimum is untested until the public release track.                                                                                                                   |

Also applied: CLAUDE.md testing section; ACs for the QA infrastructure and spike QA exit criteria in `docs/acceptance/qa-infrastructure.md`; Claude Code permissions in `.claude/settings.json` (deny `test exports/`, deny `--no-verify`).

### 13.1 Open points

None. QP-1…QP-5 were accepted as recommended (D-61, D-62).
