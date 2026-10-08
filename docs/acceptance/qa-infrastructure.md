# Acceptance Criteria: QA Infrastructure & Spike QA Exit Criteria

See [README](README.md) for conventions. The rules referenced here (`TS-xx`) are defined in [`docs/test-strategy.md`](../test-strategy.md); decisions D-59…D-63 are in the BRD. Test names use the rule ID, e.g. `ts_i_ac1_modifying_ac_test_needs_trailer`. The exact interface (commands, config, file formats) is `tools/qa/CONTRACT.md`.

---

## Tooling (built before product code)

### TS-VERIFY `./verify` entry point (D-60)

- **AC-1** `./verify commit|push|nightly|milestone|release` runs the gate defined in test-strategy §8.1 and exits non-zero if any step fails.
- **AC-2** Each run writes a summary to `.verify/` (git-ignored): steps, results, durations, property-test seeds and the tree hash of the checked commit.
- **AC-3** `./verify push` runs in a fresh `git worktree` of the commit being pushed, so uncommitted files can't make it pass.
- **AC-4** `./verify push` completes in < 10 minutes on the reference machine for the current repo; if it doesn't, the slowest steps are listed.

### TS-HOOKS Git and Claude Code hooks (D-60)

- **AC-1** `pre-commit` runs `./verify commit`; `pre-push` runs `./verify push` unless `.verify/last-pass` matches the exact tree hash being pushed.
- **AC-2** Project Claude Code settings block `git push` and `gh pr merge` until `./verify push` passed for the current tree.
- **AC-3** Claude Code permissions deny `git commit --no-verify` and `git push --no-verify`.
- **AC-4** A one-time `./verify install` sets up the git hooks; `./verify` warns if they are missing.

### TS-P Privacy guardrails (D-50, D-62)

- **AC-1** `pre-commit` rejects a staged path under `test exports/`, a `.zip` outside `tests/fixtures/`, and a file > 1 MB outside `tests/fixtures/`.
- **AC-2** Claude Code permissions deny reading and editing `test exports/`.
- **AC-3** The real-export test's own test asserts that its output contains only counts, file indexes and IDs (numbers-only format), never titles or content.

### TS-I Independence controls (D-61)

- **AC-1** A `commit-msg` hook rejects a commit that modifies or deletes an existing AC test file (`*.ac.test.ts`, `tests/ac_*.rs`) unless the message has an `AC-Test-Change: <reason>; approved-by: owner` trailer. Adding new AC test files needs no trailer.
- **AC-2** `./verify check-red <commit>` checks out the given commit, runs the AC tests added in it and passes only if they fail with assertion failures (not compile errors or missing fixtures).
- **AC-3** `.claude/agents/` defines the roles AC author, Test author, QA reviewer and Explorer (test-strategy §6.1); the Test author's and Explorer's instructions forbid reading the implementation under test and the real exports respectively; the QA reviewer has read-only tools.

### TS-COV AC coverage report (test-strategy §7)

- **AC-1** `./verify coverage` lists every `<REQ-ID>/AC-n` in `docs/acceptance/*.md` and every test named after one (TS and Rust), and writes `qa/coverage/ac-matrix.md`.
- **AC-2** The report lists ACs without a test, tests pointing at ACs that don't exist, and `[manual]` ACs with their latest session or checklist record.
- **AC-3** `./verify milestone` fails if any AC of the milestone's requirements (BRD §11.2) has no passing test or, for `[manual]` ACs, no record for the current milestone.

### TS-D4 Fixture integrity

- **AC-1** `./verify push` fails if a file under `tests/fixtures/` changed its hash without a `Fixture-Change:` trailer in the commit that changed it.

### TS-G2 Nightly gate (D-62)

- **AC-1** A `launchd` agent runs `./verify nightly` once a night under `caffeinate`; a run skipped because the Mac was off runs at the next wake.
- **AC-2** Failures of the nightly run are written to `qa/nightly/<date>.md` and shown by `./verify` the next time it runs.

---

## Spike QA exit criteria (test-strategy §10.1)

### S2-QA Editor spike

- **AC-1** Every fixture in `tests/fixtures/format/roundtrip/` opened in the TipTap prototype, with one block edited through real ProseMirror transactions and saved, differs from the original only in that block's byte range (FR-FMT-07/AC-3).
- **AC-2** Editing a block containing `==highlight==`, `%%comment%%`, `$math$` or a block ID `^id` preserves those constructs byte-for-byte (S1 finding, implication 3).
- **AC-3** A Playwright test on **WebKit** with a fake core over mocked Tauri IPC runs one editor flow (open, type, save) and asserts the saved bytes.
- **AC-4** The typing-latency proxy (keydown → next animation frame after the DOM update) is compared with a high-speed screen recording or equivalent on a 5,000-word note, and the result is recorded in the spike findings.

### S3-QA Platform spike

- **AC-1** An Appium `mac2` test, with the main window closed, opens the capture window through each global hotkey (⌃⌥Space, ⌃⌥T) and through the menu bar icon, types text and saves; the file appears in the vault.
- **AC-2** The same suite performs at least one interaction inside the WKWebView (click a control, type text) and reads the result back; if this isn't possible, the limitation is recorded and test-strategy L6 is updated.
- **AC-3** The capture-window open time (hotkey → window visible with cursor in the text field) is measured over ≥ 20 runs and reported as p95.
- **AC-4** The `lsof` network monitor attached to the app's processes reports zero non-IPC sockets during the suite (NFR-SEC-01).
- **AC-5** [manual] The signed and notarized DMG installs and launches on the second Mac without Gatekeeper warnings.

### S4-QA Index spike

- **AC-1** `tools/gen-vault --seed <n>` generates the reference vault from `performance.md`; two runs with the same seed are byte-identical.
- **AC-2** `criterion` benchmarks exist for NFR-PERF-02, -03, -04, -07 and -08 against the reference vault.
- **AC-3** The benchmarks run on the reference machine both normally and with the slow profile; the measured ratio is used to confirm or change the 75% / 60% factors in D-59 and `performance.md`.
- **AC-4** The Rust extractor passes the conformance suite: for every round-trip fixture, its title, id, type, attributes, links and tags equal the committed `expected.json` generated from the TypeScript reference.
- **AC-5** A property test shows that the index rebuilt from scratch equals the incrementally updated index after random sequences of file creates, edits, renames and deletes.

### S5-QA Capacities dry-run spike

- **AC-1** `tests/fixtures/import/capacities/` has at least one synthetic fixture per BRD §15.1 finding C1–C19, with a README mapping finding → fixture.
- **AC-2** The dry-run report for each fixture is asserted (counts per type, unresolved links, dropped files, renamed attributes, losses).
- **AC-3** A reusable assertion checks "imported + reported = total" for objects, attachments and links (BRD §11.1) and is used by both the fixture tests and the real-export run.
- **AC-4** [manual] The owner runs the real-export dry-run; it reports 0 unreadable zip entries and imported + reported = total, with counts-only output (TS-P AC-3).
