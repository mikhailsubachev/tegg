# QA review: qa/verify-speedup
Head: b97ea8f95c1ef62c0aad9da7fec6c46eefad0e7a  Tree: 2fe5948d4303b7976737a1f1cefdee206053dcd2  Verify: pass (2fe5948d4303b7976737a1f1cefdee206053dcd2, matches HEAD, 2026-10-22T12:41:08Z)
Verdict: ready with notes

Reviewed by the qa-reviewer agent (D-61) on 2026-10-22 from `.verify/review/context.md` and the full `.verify/review/diff.patch` (23 files), plus `tools/qa/src/proc.ts`, `tools/qa/src/cli.ts`, `qa.config.json`, `verify`, `.gitignore`, `docs/test-strategy.md` §5–§6, BRD D-343/D-609…D-612, and the Rust AC files under `crates/*/tests/`.

## Checklist summary

1. **Verify result:** the last `./verify push` passed for exactly the head tree (`2fe5948d…`). OK.
2. **Requirements and ACs:** every change cites D-609…D-612, TS-VERIFY AC-5…AC-7 or TS-I AC-4 in code comments, test names, commit subjects, CONTRACT.md and the BRD (v1.71 row + four D rows). The 6-WebKit-worker change cites D-609 and the owner (commit bf9a907, proposal §5.1 "Outcome"). Nothing decides something outside the BRD except the `nice` field (see findings).
3. **Non-negotiable rules:** tooling-only change; no vault I/O, no format, index or sync code touched. Rule 11 (no network calls) concerns the product; `git fetch origin` in `verify merge` is the developer's git operation and is explicitly part of D-612. Rule 12: the memo is in `.verify/` (git-ignored, machine-local). Rule 13 N/A. OK.
4. **Test quality:** no existing `*.ac.test.ts` / `tests/ac_*.rs` modified or deleted (only new AC files; `cargo-junit.test.ts` and `helpers.ts` are not AC files), so no `AC-Test-Change` trailer is needed. No fixture changes. No `.only`/skipped tests, no snapshot-only tests, no broadened tolerances. Red-first order holds: b24978a (red tests) precedes b3f63d4 (implementation), and the passing push gate ran the red-first check on the range. The two bug fixes are discussed in the findings.
5. **Privacy:** only the synthetic Czech pangram and made-up step ids in tests; the proposal doc names test ids and timings only. Nothing from `test exports/`. OK.
6. **Scope:** one milestone of QA tooling (D-609…D-612). `app/playwright.config.ts` (6 workers) and the docs are tied to D-609; nothing unrelated.

Implementation checks that passed: `--threads 2` is safe because `crates/tegg-format/tests/ac_format.rs:182-194` is the only AC file that mutates process state (`TZ`) and it is the `--serial` file; no other AC file uses `set_var`/`set_current_dir`. Memo inputs cover the Cargo path deps found (`tegg-core` dev-dep on `tools/gen-vault`, `app/src-tauri` on `crates`; `tools/core-perf` is not a workspace member). `runLanes` keys results by step id, which `loadConfig` already enforces unique. Each step's stdout block is one `process.stdout.write`, so contiguity holds. `pairBlocks` rejects count mismatches and undeclared test names before attribution. The Claude pre-tool hook (`tools/qa/src/cli.ts:116-131`) already blocks `gh pr merge` on a stale `.verify/last-pass`, as D-612 states.

## Findings
- [minor] tools/qa/src/proc.ts:26-47 The async runner's stdin fix (`stdio: 'ignore'` without input, EPIPE handler) has no regression test; the JUnit reader fix has `tools/qa/test/junit.test.ts` (two tests) but neither is named `bug_<issue>_…` and neither has an issue. Both are tooling bugs found while building the branch (commit 31fbfb6). Recommend an issue number each and renaming the junit tests to the `bug_` convention; the stdin change is structurally covered by every lane test. (TS-D2)
- [minor] tools/qa/test/cargo-junit.test.ts:144-239 The TS-I AC-4 tests (`ts_i_ac4_*`) live in a plain unit-test file, not a `*.ac.test.ts` file, so they are outside AC-test protection and were not subject to the red-first check. Coverage still credits them by name. Consider moving them to `cargo-junit.ac.test.ts`. (TS-I1, TS-I3)
- [minor] tools/qa/src/cargo-junit.ts The per-file fallback path ("could not attribute libtest output … running its files one by one") is only tested at the `pairBlocks` level; no test exercises `main()` taking the fallback branch. TS-I AC-4 names the fallback explicitly. (TS-I AC-4)
- [minor] qa.config.json:19 `qa-tools-test` inputs omit `.gitignore`, which `tools/qa/test/verify.ac.test.ts:228` and `nightly.ac.test.ts:127` read from the real repository root. A `.gitignore` change would not re-run the QA tool tests in push; nightly covers it (CONTRACT §12), but the input is cheap to add. (D-611, CONTRACT §3.2.3)
- [minor] docs/Business Requirements.md:470 D-343 still says WebKit runs "with 8 workers under ./verify"; this branch sets 6 (commit bf9a907, CONTRACT §3.2.2, proposal §5.1 "Outcome"), but the BRD's D-609 row does not record it. Add the 6-worker outcome to D-609 (or a note on D-343). (CLAUDE.md "Documents")
- [minor] tools/qa/src/config.ts:10-14 and CONTRACT.md §2/§3.2.2 The `nice` step field is implemented, documented and unit-tested (`tools/qa/test/nice.test.ts`) but is not in D-609 or any AC, and Tegg's config uses none after the experiment (proposal §5.1). Either record it as part of D-609 or drop it. (CLAUDE.md "If an implementation needs a decision the BRD doesn't cover")
- [minor] tools/qa/test/merge.ac.test.ts AC-7's default base `origin/main` and the fetch-warning path are untested (the temp repos have no remote). A local bare remote in one test would cover both. (TS-VERIFY AC-7)
- [minor] tools/qa/test/lanes.ac.test.ts The wall-time bounds (`< 3500 ms` for two concurrent 2 s steps, `>= 4000 ms` sequential) are load-sensitive; proposal §5.1 records the lane ACs failing under `nice`. The stamp-based overlap/sequence assertions are robust; consider loosening only the `< 3500` upper bound if it flakes in the node lane. Not a TS-I5 violation as written. (TS-I5, test-strategy §8.4)
- [minor] tools/qa/test/step-memo.ac.test.ts AC-6 says milestone and release "always run"; only nightly is tested. The code path is shared (`consult = gate === 'push' && !opts.all`), so this is a coverage note, not a defect. (TS-VERIFY AC-6)
- [minor] app/playwright.config.ts:37 Comment continuation line lost its indentation. Style only.
- [minor] tools/qa/src/config.ts:10-14 Two stacked JSDoc blocks on `Step`; merge them. Style only.

No blockers, no majors.

## AC coverage of touched requirements
- TS-VERIFY AC-5 (lanes, D-609): `ts_verify_ac5_different_lanes_overlap`, `ts_verify_ac5_same_lane_runs_in_config_order`, `ts_verify_ac5_lanes_1_option_runs_every_step_in_config_order`, `ts_verify_ac5_verify_lanes_env_1_runs_every_step_in_config_order`, `ts_verify_ac5_lanes_other_than_1_exit_2`, `ts_verify_ac5_summary_keeps_config_order_and_per_step_durations`, `ts_verify_ac5_output_of_each_step_is_one_contiguous_block`, `ts_verify_ac5_all_lane_steps_run_after_a_failure`, `ts_verify_ac5_commit_gate_ignores_lanes` (`tools/qa/test/lanes.ac.test.ts`)
- TS-VERIFY AC-6 (step memo, D-611): the thirteen `ts_verify_ac6_*` tests in `tools/qa/test/step-memo.ac.test.ts`; milestone/release "always run" not tested directly
- TS-VERIFY AC-7 (`verify merge`, D-612): the five `ts_verify_ac7_*` tests in `tools/qa/test/merge.ac.test.ts`; `origin/main` default and fetch warning not tested
- TS-I AC-4 (batched Rust AC runner, D-610): the eight `ts_i_ac4_*` tests in `tools/qa/test/cargo-junit.test.ts` (a non-AC file); end-to-end fallback-to-one-invocation not tested
- TS-VERIFY AC-1…AC-4, TS-HOOKS, TS-I AC-1…AC-3: not changed by this branch; existing tests untouched
