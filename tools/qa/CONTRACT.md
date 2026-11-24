# QA tooling contract

The public interface of the QA tooling: the `./verify` command, its configuration, the files it reads and writes, and the hooks. Acceptance criteria: [`docs/acceptance/qa-infrastructure.md`](../../docs/acceptance/qa-infrastructure.md) (TS-VERIFY, TS-HOOKS, TS-P, TS-I, TS-COV, TS-D4, TS-G2). Strategy: [`docs/test-strategy.md`](../../docs/test-strategy.md) §6–§8.

Tests are written against this contract only (black box), never against the implementation.

## 1. General

- **Entry point:** `verify`, an executable shell script at the repository root. It requires Node.js ≥ 22.18 (runs TypeScript directly) and git.
- **Which repository:** `verify` operates on the git repository that contains the **current working directory** (`git rev-parse --show-toplevel`), not on the repository where the `verify` script itself lives. So the tool can be tested by running the real `verify` script with a temporary git repository as the working directory.
- **Configuration:** `qa.config.json` at the repository root (§2). If it is missing or not valid JSON, every command except `install`, `install-nightly`, `counts-only`, `help` and `hook claude-pre-tool` exits with code **2** and an error message on stderr (`hook claude-pre-tool` then exits 0 silently, so it never blocks Claude in a repository without the tooling).
- **Exit codes:** `0` = passed; `1` = a gate or check failed; `2` = usage or configuration error (unknown command, missing argument, invalid config).
- **Output:** human-readable progress on stdout; errors and warnings on stderr. Exact wording isn't part of the contract except where quoted below. Check failures (offending paths, commits as abbreviated or full SHAs, AC and requirement IDs) appear in the output and in the summary's `checks[].messages`.
- **Machine-local output** goes to `.verify/` at the repository root (git-ignored).

### 1.1 Warnings printed by every command

Every command except `hook claude-pre-tool` and `install-nightly --dry-run` prints these warnings to **stderr** when they apply (they never change the exit code):

- If `git config core.hooksPath` is not `.githooks`: a line containing `hooks not installed` and `./verify install` (TS-HOOKS AC-4).
- If the last nightly run failed (§8): a line containing `nightly` and the path of the nightly report, e.g. `Last nightly run (2026-10-08) failed: qa/nightly/2026-10-08.md` (TS-G2 AC-2). The warning stops once a later nightly run passes.

### 1.2 Shared state (D-1831, TS-VERIFY AC-9)

The folder `<git common dir>/tegg-verify/` (`git rev-parse --git-common-dir`; for a normal clone `<main checkout>/.git/tegg-verify/`) is shared by the main checkout and every worktree of the repository. It is never part of a commit. It holds:

| File | Content |
| --- | --- |
| `step-memo.json` | the step memo (§3.2.3) |
| `passed-trees` | the tree hashes that passed the push gate (§3.2), one per line, newest last, at most 200 lines |
| `step-runs.json` | the last recorded run of every step with `testFiles` (§3.2.5) |
| `flaky.json` | the flaky list (§3.6) |

Only gates that hold the gate lock (§3.5) and `verify flaky --clear` write these files. A missing, unreadable or malformed file is treated as empty and rewritten; it never fails a gate. If the folder can't be created, the gate prints a warning on stderr containing `shared state` and works with the checkout's `.verify/` files only.

## 2. `qa.config.json`

```json
{
  "steps": [
    { "id": "qa-tools-typecheck", "dir": "tools/qa", "run": "npm run --silent typecheck", "level": "commit", "changedOnly": true },
    { "id": "qa-tools-test", "dir": "tools/qa", "run": "node --test 'test/*.test.ts'", "level": "push" }
  ],
  "acTestPatterns": ["\\.ac\\.test\\.tsx?$", "(^|/)tests/ac_[^/]+\\.rs$"],
  "acRunners": [
    { "dir": "tools/qa", "match": "^tools/qa/test/.*\\.ac\\.test\\.ts$",
      "run": "node --test --test-reporter=junit --test-reporter-destination={junit} {files}" }
  ],
  "budgets": { "commit": 60, "push": 600, "nightly": 5400 }
}
```

| Field | Meaning |
| --- | --- |
| `steps[]` | Commands run by the gates. `id`: unique name. `dir`: working directory relative to the checkout root (default `.`). `run`: shell command, run with `sh -c`. `level`: the lowest gate that runs the step, one of `commit`, `push`, `nightly`, `milestone`, `release`. `changedOnly` (default `false`): in the **commit** gate only, the step runs only if a staged file is under `dir`; otherwise it is reported as `skipped`. `cargoCache` (default `true`): in tree gates (push and above), the step gets the shared Cargo build cache (§3.2.1); `false` for steps that expect artifacts under their own `target/` (e.g. a built `.app` at a fixed path). `lane` (default `default`): in tree gates, steps of the same lane run one after another in config order and different lanes run concurrently (§3.2.2); the commit gate ignores it. `inputs` (optional): repository-relative paths (files or directories, `/` separators, no leading `/` and no `..`) the step depends on, for the step memo (§3.2.3); a step without `inputs` always runs. `timeout` (optional): seconds after which a tree gate stops the step (§3.2.4); it must be a positive number, otherwise exit 2. `testFiles` (optional): a regular expression (JavaScript syntax) on repository-relative paths that selects the step's **independent test files**, for partial runs (§3.2.5); it must be a valid regex, otherwise exit 2. A step with `testFiles` may contain `{files}` in its `run`; `{files}` in the `run` of a step without `testFiles` exits 2. |
| `acTestPatterns` | Regular expressions (JavaScript syntax) matched against **repository-relative paths** with `/` separators. A file matching any of them is an **AC test file**. Default when omitted: the two patterns above. |
| `acRunners[]` | How to run AC test files for `check-red` (§5). `dir`: runner working directory, relative to the checkout root. `match`: regex on the repository-relative path selecting files this runner handles. `run`: command template; `{files}` is replaced by the file path(s) relative to `dir`, each single-quoted; `{junit}` by an absolute path where the runner must write a JUnit XML report. |
| `realAppTests` | Repository-relative directory prefixes (ending in `/`) whose test sources are **real-app tests** for the `l6-coverage` check (§9.5), e.g. `["app/e2e/"]`. When omitted or empty, the check isn't run. |
| `budgets` | Time budget per gate in seconds (§3.4). Defaults: commit 60, push 600, nightly 5400; other gates have no budget. |

Gate order: `commit` < `push` < `nightly` < `milestone` < `release`. A gate runs every step whose `level` is at or below it.

### 2.1 Environment given to steps and runners

| Variable | Value |
| --- | --- |
| `VERIFY_GATE` | Name of the running gate |
| `VERIFY_RESULTS` | Absolute path of a directory where steps may write JUnit XML reports (`*.xml`) |
| `QA_SEED` | A random integer chosen for this run, recorded in the summary |
| `VERIFY_MILESTONE` | Only in `verify milestone --milestone MS<n>`: the milestone being gated, e.g. `MS3`, so registry tests can fail on placeholders due at or before it (D-124) |
| `QA_PROPERTY_SCALE` | `1` for commit and push, `100` for nightly, milestone and release |
| `CARGO_TARGET_DIR` | Tree gates only, for steps whose `cargoCache` isn't `false`: `<repository root>/.verify/cargo-target` (§3.2.1). Not set by the commit gate |
| `VERIFY_PORT_BASE` | Tree gates only: a TCP port in 20000–29999 that was free when the run started, for the servers the steps start for their tests (§3.2.1). Not set by the commit gate |

Git's hook variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`) are removed from the environment of steps and runners.

## 3. Gates

### 3.1 `verify commit` (G0)

Runs in the **working directory as it is**. Order:
1. **Privacy check** on **staged** files (§6).
2. Steps with `level: commit`.

### 3.2 `verify push [--commit <rev>] [--range <base>..<head>] [--lanes 1] [--all]` (G1)

Checks the committed state of `<rev>` (default `HEAD`) in a **fresh git worktree** created for this run (in a temporary directory) and removed afterwards (TS-VERIFY AC-3). Uncommitted and untracked files of the main working directory are not visible to the checks or steps. If the main working directory has uncommitted changes, a warning containing `uncommitted` is printed on stderr.

For each step `dir` that contains a `package-lock.json`, `node_modules` is provided in the worktree: a symlink to the main checkout's `<dir>/node_modules` if the main checkout has one and its `package-lock.json` is byte-identical; otherwise `npm ci` runs in the worktree.

**Range:** the commits checked by the commit-level checks below. `--range A..B` means the commits reachable from B and not from A (as `git rev-list A..B`). Default: `<base>..<rev>` where `<base>` is the merge-base of `<rev>` with the first ref that exists of `@{upstream}`, `origin/main`, `main`; if none exists or the merge-base equals `<rev>`, the range is empty.

Order:
1. **Privacy check** on every file in the tree of `<rev>` (§6).
2. **Fixture trailer check** on every commit in the range (§7).
3. **AC test protection** on every commit in the range (§5.1).
4. **Red-first check** (§5.2): `check-red` for every commit in the range that **adds** an AC test file, unless its message has a trailer line `Red-First-Exempt: <reason>; approved-by: owner`.
5. **L6 coverage check** on the tree of `<rev>` (§9.5).
6. Steps with level `commit` and `push` (`changedOnly` is ignored), scheduled by lane (§3.2.2) and subject to the step memo (§3.2.3).

On success, writes the **tree hash** of `<rev>` (`git rev-parse <rev>^{tree}`), followed by a newline, to `.verify/last-pass` and appends it to the shared `passed-trees` (§1.2; a hash already there moves to the end), but **only if the range was the default range or was set by the pre-push hook** (§4.2). With an explicit `--range`, a passing run is recorded in the summary but `.verify/last-pass` is left unchanged, so a narrowed range can't unlock `git push` (owner decision 2026-10-08); `passed-trees` is left unchanged too. On failure, both are left unchanged.

A tree **has passed** if it equals the content of `.verify/last-pass` (trimmed) or is a line of the shared `passed-trees`.

### 3.2.1 Build cache and worktree path (D-343)

- **Cargo cache.** Steps of tree gates (push, nightly, milestone, release) run with `CARGO_TARGET_DIR=<repository root>/.verify/cargo-target` unless their `cargoCache` is `false`. All Cargo workspaces share it. Cargo keys artifacts by package, path, profile and source fingerprints, so a cached artifact never stands in for changed source. Test helpers that cache generated data per `target/` (the reference vaults) cache it there too.
- **Stable worktree path.** The fresh worktree of §3.2 is created at the same path every run: `<os temp dir>/tegg-verify-<first 12 hex digits of the SHA-256 of the repository root's real path>/wt`, outside the repository. Any leftover directory there is removed before `git worktree add`, and the worktree is removed after the run as before, so steps see only the commit's files. The stable path lets Cargo reuse the artifacts of the checkout's own crates (their metadata hash includes the path).
- **Exclusive use.** A pid file `lock` next to `wt` guards the path. If a live process holds it (another gate of the same repository is running), the gate uses a fresh temporary directory instead, as before D-343. A lock whose process is gone is taken over.
- **Per-run port.** Steps that start a server for their tests (the Playwright steps) bind it to `VERIFY_PORT_BASE`, never to a fixed port; the server fails to start when the port is taken (Vite's `--strictPort` for a dev server) and a running server is never reused, so a gate never tests a stray server's code. The runner derives the candidate from the worktree path (so the stable path and a fall-back path start from different ports), skips ports that are already in use, and so two gates of the same repository can run at the same time. The developer ports (`app` 5177, `spikes/s2-editor` 5174) are outside the range and unchanged; the app's Playwright config doesn't use 5177 even outside a gate (§3.5).
- **Built bundle for the WebKit tests (D-1880).** The app's Playwright config doesn't start the Vite dev server: `app/webkit/serve-built.ts <port>` builds the UI once with the app's own Vite config, keeps the output in memory (nothing is written, so two runs never share a folder) and serves it on the run's port. A page load then makes 5 requests, not about 356. The page entries and the app modules the tests import in the page are built as entry chunks served at their source paths (`/src/main.tsx`, `/src/theme/tokens.ts`, …; the lists are `EXPOSED` and, for modules outside the UI folder that tests import by their `/@fs<repository root>/…` URL, `EXPOSED_FS` in that file), so a test reaches the app's own module instances as it did on the dev server. Outside a gate `TEGG_WEBKIT_DEV=1` serves the dev server instead, for debugging a test; under a gate the variable is ignored. The bundle is a production build, as the shipped app is: React's StrictMode double runs of effects, which only a development build has, are not exercised by it (D-1880). So the nightly step `app-webkit-dev` runs the whole suite once more on the dev server (it sets `VERIFY_WEBKIT_DEV=1`; 4 workers; its reports are `app-webkit-dev.xml` and `app-webkit-dev.flaky.json`), and a guard that only the double run needs is missed for a day at most (D-1882). The server ends itself when the process that started it is gone.
- `check-red` (§5.2) keeps using a fresh temporary worktree and no shared cache.
- **`verify clean`** deletes `.verify/cargo-target` (exit 0), for when the cache is suspected or too large.

### 3.2.2 Lanes (D-609)

Tree gates (push, nightly, milestone, release) run the steps of each lane one after another in config order, and the lanes concurrently. A step's lane is its `lane` field (§2), default `default`; lanes start in the order of their first step in the config. Every step still gets its own environment (§2.1) and `cargoCache` setting, and all steps run even after one fails (a failure ends neither its lane nor the gate).

- **Output:** when a step starts, one line `▶ <id> [<lane>] (<dir>): started` is printed (without the command, so a start line never carries text that belongs to another step's output). When it finishes, its stdout and the result line `✓ <id> (N s): <run>` / `✗ <id> (N s): <run>` are printed to stdout as **one contiguous block** (no line of another step appears between the first and the last line of that block), and its stderr goes to stderr at the same moment.
- **Summary (§3.4):** `steps[]` stays in config order regardless of lanes; each entry has its own `durationMs` and, in tree gates, its `lane`.
- **Sequential run:** `--lanes 1` (push, nightly, milestone, release, merge) or the environment variable `VERIFY_LANES=1` runs every step in config order, as if all were in one lane; the option wins over the variable. Any other value of either exits 2 with a usage error.
- Steps that share a resource (the Cargo cache of §3.2.1, `VERIFY_PORT_BASE`, a built app under a fixed path) must be in the same lane; the configuration, not the tool, guarantees this.
- **Balance:** lanes are balanced by worker counts in the configuration (2 Rust test threads, 2 vitest workers, 6 WebKit workers on 12 cores; D-1347 had lowered WebKit to 4 while the tests loaded the dev server, D-1881 set 6 again with the built bundle). Lowering a lane's scheduling priority instead was tried and rejected: a niced lane fails its own timing-bound tests (FR-UX-07 AC-1's 500 ms progress gap, the lane ACs of this section).
- The commit gate ignores lanes and runs its steps in config order.

### 3.2.3 Step memo (push only, D-611)

For a step with `inputs` (§2), the push gate computes a **memo key**: a hash of the step's `id`, `dir`, `run`, `cargoCache`, a tooling version constant, and the git object id of every input path in the checked commit's tree (`git rev-parse <sha>:<path>`, one call per path, never one `ls-tree` for all paths, which descends into a directory when a deeper path is also given; a path missing from the tree counts as empty). `<dir>/package-lock.json` is always part of the inputs (it decides `node_modules`, §3.2). The gate (and so `QA_PROPERTY_SCALE`) is not part of the key: a pass recorded by nightly, milestone or release counts for push.

- **Where (D-1831):** the memo is the shared `step-memo.json` (§1.2) together with the checkout's `.verify/step-memo.json`: a gate reads both (a record in either counts; the shared one wins for the same key) and writes the result to both. So a pass recorded in one worktree is reused in every other. Each record also holds `results`, the absolute path of the results folder of its run.
- If the memo records a pass for the key, the step does not run: the gate prints `- <id>: skipped (inputs unchanged; reuses <gate> run <startedAt> at <short sha>)`, the summary entry has `result: "skipped"` and `reuses: "<startedAt of the reused run>"`, and the JUnit reports that run wrote for the step (the `$VERIFY_RESULTS/<name>.xml` files named in its `run`) are copied from that run's results folder (the record's `results`; for a record without it, `.verify/results/<that run>/` of this checkout) into this run's `VERIFY_RESULTS` when they still exist, so `.verify/last-results/` and `verify coverage` stay complete.
- Otherwise the step runs. After the gate, every step with a key that **passed** is recorded under its key (step id, gate, commit, `startedAt`, run id, report names); a step that **failed** has any record for its key removed.
- `nightly`, `milestone` and `release` never skip a step but record passes the same way. `verify push --all` never skips but records. `verify check-red` never reads or writes the memo.
- A step without `inputs` always runs and is never recorded.
- A missing, unreadable or malformed memo file is treated as empty and rewritten; it never fails the gate.
- **A failure ends the reuse everywhere (D-1831):** a failed step's record isn't just removed: its key gets a record marked `failed`, which is no pass. Through the shared memo it overrides the copy of an earlier pass that another checkout still holds in its own file, until the step passes again under that key. The file is machine-local (git-ignored with the rest of `.verify/`).
- Memo skips are only as good as the declared inputs: a dependency not listed can leave a stale pass in place until a nightly or `--all` run (§12).

### 3.2.4 Step timeout (D-1832, TS-VERIFY AC-10)

A step with `timeout` (§2) that is still running `timeout` seconds after it started in a tree gate is stopped: its process group gets SIGTERM and, if it isn't empty 10 s later, SIGKILL. The step's result is `fail`, its summary entry has `timedOut: true`, and its output block ends, after the result line, with a line containing `timed out`, the step's id and the limit in seconds. The lane goes on with its next step. A step without `timeout` has no limit. The commit gate ignores `timeout`.

### 3.2.5 Partial runs (push only, D-1834, TS-VERIFY AC-12)

For a step with both `testFiles` and `inputs`. Its **test files** at a commit are the files of the commit's tree whose repository-relative path matches `testFiles`. They must be independent: no test file may depend on another test file, and a change to one must not change the result of another. The configuration, not the tool, guarantees this.

- **`{files}`:** in a full run `{files}` in `run` is replaced by the empty string. In a partial run it is replaced by the chosen test files, as paths relative to the step's `dir`, each single-quoted, separated by spaces.
- **The record:** after every run of the step in a tree gate, the shared `step-runs.json` (§1.2) records, under a fingerprint of the step (`id`, `dir`, `run`, `cargoCache`, `testFiles`, `inputs`, a tooling version), the checked commit, the gate, `startedAt` and `pending`: the test files not known to pass at that commit.
  - A passing run: `pending` is empty. A step skipped by the step memo is recorded the same way.
  - A failing run with a readable JUnit report among the step's reports (the `$VERIFY_RESULTS/<name>.xml` files named in its `run`): `pending` is every test file the run should have run (all test files in a full run, the chosen ones in a partial run) except those with at least one `<testcase>` in the reports and none of them with a `<failure>`, `<error>` or `<skipped>`. A `<testcase>` belongs to the test file whose path equals its `classname` or ends with `/` + its `classname`. Test files a partial run didn't run keep passing and aren't pending.
  - A failing run without a readable report, a timed-out one, and one whose report names no pending test file (the failure can't be tied to a file: a crash outside a test, a failing teardown): in a full run `pending` is unknown (`null`); in a partial run it is every chosen test file.
- **Choosing (push without `--all`, when the step memo doesn't skip the step):** the run is partial if a record exists for the step's fingerprint, its `pending` is known, its commit exists in the repository, and every path that differs between that commit and the checked commit under the step's inputs (`git diff --name-status --no-renames <recorded> <checked> -- <inputs and <dir>/package-lock.json>`) matches `testFiles`. The chosen test files are the record's `pending` plus the added and modified ones, without those missing from the checked commit's tree.
  - Otherwise the run is full.
  - If no test file is chosen, the step doesn't run and its result is `pass`.
- **Output and summary:** a partial run prints `- <id>: partial run of <n> test file(s) (other inputs unchanged since <gate> run <startedAt> at <short sha>)` before the step starts; the summary entry has `partial: { "files": [<repository-relative paths>], "since": "<recorded commit>" }`.
- A passing partial run is a pass of the step: it is recorded in the step memo (§3.2.3) like any pass.
- `nightly`, `milestone`, `release` and `push --all` always run the step in full and record the run.

### 3.3 `verify nightly`, `verify milestone --milestone <MSn>`, `verify release`

- All three run like `push` (fresh worktree of `HEAD`, same checks, default range) plus the steps up to their level.
- `nightly` additionally maintains the nightly status (§8).
- `milestone` additionally runs the **milestone AC check** for `<MSn>` (§9.4); `--milestone` is required (exit 2 without it).
- `release` runs the milestone AC check for **all** milestones listed in the BRD §11.2 table together.

### 3.4 Summary and budget (TS-VERIFY AC-2, AC-4)

Every gate run writes a JSON summary to `.verify/runs/<timestamp>-<gate>.json` and the same content to `.verify/last-<gate>.json`:

```json
{
  "gate": "push",
  "commit": "<full sha>",
  "tree": "<tree hash>",
  "startedAt": "<ISO 8601>",
  "durationMs": 1234,
  "result": "pass",
  "seed": 123456,
  "checks": [ { "id": "privacy", "result": "pass", "messages": [] } ],
  "steps":  [ { "id": "qa-tools-test", "result": "pass", "durationMs": 900, "seeds": [20261008] } ]
}
```

- `result` is `pass` or `fail`; step `result` is `pass`, `fail` or `skipped`. For the commit gate, `commit` is the `HEAD` sha and `tree` is the tree of the staged index (`git write-tree`).
- `steps[]` is in config order regardless of lanes (§3.2.2). In tree gates each entry also has `lane`; a step skipped by the step memo (§3.2.3) has `result: "skipped"`, `durationMs: 0` and `reuses` (the `startedAt` of the run whose pass it reuses).
- Check `id`s: `privacy`, `fixtures`, `ac-test-protection`, `red-first`, `flaky`, `l6-coverage`, `milestone-acs`, `milestone-deferred`.
- Tree gates: a step stopped by its timeout has `timedOut: true` (§3.2.4); a partial run has `partial` (§3.2.5); the summary has `flaky`, the flaky tests of this run (§3.6), an empty array when there are none.
- `seeds`: every integer found in the step's output after `seed` followed by `=`, `:` or spaces (case-insensitive), in order.
- JUnit files written to `VERIFY_RESULTS` by the run are copied to `.verify/last-results/` (replacing its previous content).
- **Budget:** if `durationMs` exceeds the gate's budget, stdout gets a line containing `exceeded` and the budget, followed by the up-to-3 slowest steps, one per line, each containing the step `id` and its duration. The exit code doesn't change.
- All steps run even after one fails; the gate fails if any check or step failed.

### 3.5 One gate at a time (D-1330, TS-VERIFY AC-8)

Parallel gates load the machine so much that timing-sensitive WebKit tests fail falsely, so only one heavy command runs on the machine at a time.

- **Which commands:** `push`, `nightly`, `milestone`, `release`, `merge`, `check-red`, and `hook pre-push` when it runs the push gate. `commit` and the other tools don't take the lock.
- **Usage errors first:** a command checks its arguments before it takes the lock, so a usage error (`milestone` without `--milestone`, `check-red` without a commit or with an unknown one, a bad `--lanes` or `VERIFY_LANES`, also for `hook pre-push`) exits 2 at once, also while another gate holds the lock. `merge` also fetches and checks its base (§11) before it waits, so a missing `merge <rev> first` exits 1 at once.
- **The lock:** a folder `gate.lock` in `$VERIFY_GATE_LOCK_DIR`, by default `~/Library/Caches/tegg-verify/` on macOS (`~/.cache/tegg-verify/` elsewhere). It's shared by every checkout and worktree of the user. It holds `owner.json` with the owner's `pid`, `command`, `checkout` (the repository root the command was started in), `started` (ISO 8601), a random `id`, and, when the system reports them, `procStart` (the owner process's start time as `ps -o lstart= -p <pid>` prints it with `LC_ALL=C` and `TZ=UTC0`, trimmed, so every shell and launchd print the same string) and `boot` (the system boot time in seconds since the epoch: `kern.boottime` on macOS, `btime` in `/proc/stat` on Linux).
- **Taking it:** the command makes a private folder next to `gate.lock` (a name starting with `gate.lock.`), writes `owner.json` into it, and renames that folder to `gate.lock`. The rename fails while a lock exists, so the lock and its owner record appear in one atomic step; a `gate.lock` without `owner.json` is never a lock in the making.
- **Waiting:** a command that finds the lock taken waits for it, without a time limit. Right away and then every minute it prints a line on stdout containing `waiting for`, the owner's command and checkout. It starts once the lock is free.
- **Stale locks:** a lock is stale if its `owner.json` is missing or unreadable, if the owner `pid` no longer exists, or if that `pid` now belongs to another process (it was reused after a crash or restart): `procStart` is recorded and differs from the start time of the process that now has that `pid`; or, only when `procStart` isn't recorded or can't be read now, `boot` is recorded and differs from the current boot time (the system moves the boot time when the clock is set, so it is only the fallback). A missing value, or one the system can't report now, doesn't make a lock stale. The next command moves a stale lock aside under a unique name, checks that what it moved is the lock it judged stale (same `id`; otherwise it moves it back), removes it and takes the lock. Before it waits, a command also removes the folders stale owners left next to the lock (names starting with `gate.lock.`: drafts of killed waiters, locks moved aside); one without `owner.json` only once it is more than a minute old.
- **Release:** the owner removes the lock when it exits, and only a lock whose `id` is its own; it renames the lock aside first, so `gate.lock` never exists without `owner.json`. On SIGINT, SIGTERM or SIGHUP it first passes the signal on to its running steps (each step of a tree gate, also with `--lanes 1`, runs in its own process group, and the signal goes to the whole group), starts no further step, waits until every step's process group is empty (after 10 s it kills them with SIGKILL), then removes the lock and exits by the same signal. A second signal kills the steps at once. The `check-red` runners and its `npm ci` run synchronously in the gate's own process group: a signal reaches them from a terminal, and the gate handles it once the running `check-red` has ended, so the lock stays until then. A command interrupted while it waits removes its private folder.
- **Nested runs:** while it holds the lock, a command sets `VERIFY_GATE_LOCK_HELD` in its environment, so a `verify` started by its steps doesn't wait for its own parent.
- **WebKit runs outside a gate:** the app's Playwright config takes the same lock in its `globalSetup` (command `app webkit`), so a targeted `npx playwright test` waits for a running gate and a gate waits for it. Inside a gate (`VERIFY_GATE_LOCK_HELD` set) it returns at once (nested run). Playwright starts the dev server before `globalSetup`, so outside a gate the config picks its own free port for every run too (from the §3.2.1 range, by checkout path and process id, passed to its workers in `TEGG_WEBKIT_PORT`) and never reuses a running server: a waiting run can't lose another run's server when that run ends. It leaves signals to Playwright, which stops its workers first; the lock is released when the Playwright process exits. Playwright's UI and watch modes hold the lock for as long as they stay open.
- **No lock:** if the lock folder can't be created, the command prints a warning on stderr containing `without the one-gate-at-a-time lock` and runs without the lock.
- The QA tool tests give each test process its own `VERIFY_GATE_LOCK_DIR`, so they never wait for a real gate, and remove it when the test process exits.

### 3.6 Flaky tests (D-1833, TS-VERIFY AC-11)

A test that fails and then passes on a retry inside one step is **flaky**. The step's own exit code decides whether it passed; the gate counts the flaky tests.

- **Report:** a step may write files `$VERIFY_RESULTS/<name>.flaky.json`: a JSON array of `{ "file": "<repository-relative path of the test file>", "test": "<test name>" }`. A file that isn't such an array is ignored with a warning on stderr containing `flaky`.
- **After the steps**, a tree gate reads every such file this run wrote, prints one line per entry containing `flaky`, the file and the test, and puts the entries in the summary's `flaky` (`[{ "file", "test" }]`).
- **The flaky list:** `flaky.json` (§1.2) is a JSON array; each entry is appended to it as a record `{ file, test, blob, commit, gate, startedAt }`, where `blob` is the git object id of `file` in the checked commit's tree (empty if it isn't there). Records older than 90 days are dropped on every write.
- **The `flaky` check** (every tree gate, after `red-first`, before the steps, so it judges earlier runs only): for every `file` + `test` of the list, it counts the records whose `blob` equals the object id of `file` in the checked commit's tree. Two or more fail the check with one message `<file> :: <test>: flaky <n> times (<dates>); fix or quarantine it`, sorted. A changed test file (a fix, or a quarantine tag such as `@flaky`) has another object id, so its earlier records no longer count for that commit.
- **`verify flaky`** prints the list, one line per record (`<date> <file> :: <test> (<gate> at <short sha>)`), exit 0. **`verify flaky --clear <file>`** removes every record of that file (for a flaky test fixed outside its test file) and prints how many it removed, exit 0; without a file it exits 2. Neither takes the gate lock.
- **Configuration:** the app's Playwright config retries a failed test once under a gate (`VERIFY_GATE` set) and writes `app-webkit.flaky.json` (`app-webkit-dev.flaky.json` in the nightly dev-server run) through `app/webkit/flaky-reporter.ts`; outside a gate it doesn't retry.

## 4. Hooks

### 4.1 Git hooks (TS-HOOKS AC-1, AC-4)

Committed in `.githooks/`, executable, POSIX `sh`. Each finds the repository root with `git rev-parse --show-toplevel` and runs that root's `verify`:

| Hook | Runs |
| --- | --- |
| `pre-commit` | `verify commit` |
| `commit-msg` | `verify hook commit-msg "$1"` |
| `pre-push` | `verify hook pre-push "$@"`, passing stdin through |

`verify install` sets `git config core.hooksPath .githooks` (idempotent, exit 0).

### 4.2 `verify hook pre-push <remote> <url>`

Reads git's pre-push lines from stdin: `<local ref> <local sha> <remote ref> <remote sha>`. For each line whose local sha isn't all zeros (a delete):
- if the tree of `<local sha>` has passed (§3.2: `.verify/last-pass` or the shared `passed-trees`), it is **skipped** and nothing runs;
- otherwise it runs the push gate with `--commit <local sha>` and, if `<remote sha>` isn't all zeros, `--range <remote sha>..<local sha>` (else the default range).

Exit 0 if every line was skipped or passed, else 1; a bad `VERIFY_LANES` exits 2 before anything runs (§3.5).

### 4.3 `verify hook commit-msg <message file>` (TS-I AC-1)

Looks at the **staged** changes (`git diff --cached --name-status -M`); during a merge (`MERGE_HEAD` exists) only the files whose staged result also differs from `MERGE_HEAD` count, i.e. the merge's own changes (§5.0). If any **existing** AC test file (§2 `acTestPatterns`) is modified, deleted or renamed, the commit message must contain a line matching `^AC-Test-Change: .+; approved-by: owner$`; otherwise exit 1 with a message naming the file(s). Adding new AC test files needs no trailer. Exit 0 otherwise.

### 4.4 Claude Code hook: `verify hook claude-pre-tool` (TS-HOOKS AC-2)

Configured in `.claude/settings.json` as a `PreToolUse` hook with matcher `Bash` and command `"$CLAUDE_PROJECT_DIR"/verify hook claude-pre-tool`.

Reads the Claude Code hook JSON from stdin (`{"tool_name": "Bash", "tool_input": {"command": "..."}, ...}`). If `tool_name` is `Bash` and the command contains `git push` or `gh pr merge`, and the tree of `HEAD` hasn't passed (§3.2: `.verify/last-pass` or the shared `passed-trees`), it exits **2** with a message on stderr containing `./verify push`. In every other case (other tools, other commands, matching last-pass, unparsable input) it exits 0 and prints nothing.

### 4.5 Claude Code permissions (TS-HOOKS AC-3, TS-P AC-2)

`.claude/settings.json` `permissions.deny` contains at least:
`Read(./test exports/**)`, `Edit(./test exports/**)`, `Bash(git commit --no-verify:*)`, `Bash(git push --no-verify:*)`.

## 5. AC tests

### 5.0 Merge commits in the range

For a commit with more than one parent, the per-commit checks (§5.1, §5.2, §7) look only at the changes the **merge itself** introduces: the files whose merge result differs from **every** parent (git's combined diff, `git diff-tree -r -c`). Changes that came in from one side of the merge are not attributed to the merge commit. A file in the combined diff counts as deleted if it is deleted against any parent, added if it is new against every parent, and modified otherwise. The red-first check (§5.2) skips merge commits (owner decision 2026-10-08).

### 5.1 AC test protection (push gate)

For every commit in the range: if it modifies, deletes or renames an existing AC test file, its message must contain the `AC-Test-Change: …; approved-by: owner` line (§4.3). Otherwise the `ac-test-protection` check fails, naming the commit and file.

### 5.2 `verify check-red <commit>` (TS-I AC-2)

1. Lists the AC test files **added** by `<commit>` (status `A` against its first parent). If there are none, exit 1 with a message containing `no AC tests added`.
2. Creates a fresh worktree of `<commit>` (with `node_modules` provided as in §3.2 for each runner `dir`).
3. For **each** added file, picks the first `acRunners` entry whose `match` matches it (no runner → the check fails for that file) and runs it for that file alone, reading the JUnit report at `{junit}`. Runners get `VERIFY_GATE=check-red` and their own free dev-server port in `VERIFY_PORT_BASE` (§3.2.1), as gate steps do.
4. A file passes if the report has **at least one** `<testcase>` and **every** testcase has a `<failure>` or `<error>` whose `type` attribute, `message` attribute or text contains `AssertionError`. A missing report, zero testcases, a passing testcase or a non-assertion failure (syntax error, missing module, missing fixture) fails the file. A `<skipped>` testcase fails the file too, unless the same test (equal `name` and `classname`) has a `<failure>` or `<error>` with `AssertionError` elsewhere in the report: a test a contract runs on one browser project only is red there (D-2243).
5. Exit 0 if every added file passes, else 1, listing each failing file and why.

**Rust AC tests** run through `tools/qa/src/cargo-junit.ts` (no extra tools): `node tools/qa/src/cargo-junit.ts --junit <report.xml> [--threads N] [--serial <file>]… <tests/ac_*.rs>… [-- <libtest args>]`, run from the Cargo workspace root. It groups the files by package and runs all files of a package in **one** invocation, `cargo test -p <package> --test <stem> --test <stem>… --no-fail-fast -- --test-threads=N <libtest args>`, splits libtest's output per test binary (cargo runs the binaries one after another; the *i*-th `running <n> tests` block on stdout belongs to the *i*-th `Running tests/<stem>.rs` line on stderr, and every test name in the block must be declared in that file, otherwise the package falls back to one invocation per file with a warning on stderr) and converts each binary's output to one JUnit suite `<package>::<stem>` (D-610). `--threads N` sets libtest's `--test-threads` (default 1); each `--serial <file>` runs that file in its own invocation with one thread (for tests that change process-wide state, e.g. `TZ`). Arguments after `--` go to every binary. A failure gets `type="AssertionError"` only if the panic happened **in the AC test file itself** and isn't an unwrap/expect of an error or a `todo!()`/`unimplemented!()` message; a panic in library code, a setup unwrap or a compile error (no testcases) is not red. Product stubs therefore return wrong values or `Err(NotImplemented)` rather than panicking (`docs/contracts/ms1-core.md`).

The configuration (`acRunners`) is read from the **current** checkout, not from `<commit>`.

### 5.2.1 Red-first cache (push gate only)

A commit's content never changes, so the push gate's `red-first` check (§4 step 4) remembers commits it found red:
- After `check-red` passes for a commit inside the gate, the gate records the commit's full SHA together with a fingerprint of the **current** `acRunners` configuration in `.verify/red-first-cache.json` (machine-local, git-ignored like the rest of `.verify/`).
- The gate skips `check-red` for a commit whose SHA is recorded with the **same** fingerprint; the commit counts as red. The fingerprint is a hash of the JSON of `acRunners` (order and every field of every entry), so any change to a runner's `dir`, `match` or `run` makes every recorded commit run again.
- A commit whose `check-red` fails is never recorded and runs again on the next gate.
- `verify check-red <commit>` (§5.2) never reads or writes the cache.
- A missing, unreadable or malformed cache file is treated as empty and rewritten; it never fails the gate.

## 6. Privacy check (TS-P AC-1)

Applied to staged files (commit gate: added, copied, modified or renamed, using the staged content) or to every file in the tree (push gate). A file fails if:
- its path starts with `test exports/`; or
- its name ends with `.zip` (case-insensitive) and it is not under `tests/fixtures/`; or
- its size is more than **2,097,152 bytes** (2 MiB, D-2075) and it is not under `tests/fixtures/`.

Each failure is reported with the path and which rule it broke; the `privacy` check fails.

### 6.1 `verify counts-only [file]` (TS-P AC-3 helper)

Checks that output of a real-export run contains only counts. Reads the file, or stdin when no file is given. Every non-empty line must be **counts-only**: after removing (1) JSON object keys of the form `"<letters, digits, _ or ->"` followed by optional spaces and `:`, and (2) labels of the form `<letter>(<letters, digits, spaces, _ or ->)*:`, only digits, whitespace and the characters `{ } [ ] , . : % / -` may remain. Exit 0 if all lines are counts-only. Otherwise exit 1 and print the **line numbers** of offending lines, never their content.

Examples: `capacities: {"files":697,"ok":697}` and `failing file indexes: 3,17` are counts-only; `title: Výlet do Lisabonu` is not.

## 7. Fixture trailer check (TS-D4 AC-1)

For every commit in the range: if it **modifies, deletes or renames** a file under `tests/fixtures/` (adding new files is fine), its message must contain a line matching `^Fixture-Change: .+$`. Otherwise the `fixtures` check fails, naming the commit and file.

## 8. Nightly (TS-G2)

### 8.1 Status and report

- When `verify nightly` fails, it writes `qa/nightly/<YYYY-MM-DD>.md` (local date) containing one line `- <id>: fail` per failed check or step, and records the failure in `.verify/nightly-status.json` (`{"date": "YYYY-MM-DD", "result": "fail", "report": "qa/nightly/YYYY-MM-DD.md"}`).
- When it passes, it records `{"date": ..., "result": "pass"}` and writes no report.
- The warning in §1.1 is shown while the latest recorded result is `fail`.
- `qa/nightly/` is git-ignored (machine-local).

### 8.2 `verify install-nightly [--dry-run]`

Installs a `launchd` user agent with label `com.tegg.verify-nightly` at `~/Library/LaunchAgents/com.tegg.verify-nightly.plist` and loads it. With `--dry-run`, prints the plist XML to stdout and changes nothing.

The plist has:
- `ProgramArguments`: `/usr/bin/caffeinate`, `-i`, `<repository root>/verify`, `nightly`;
- `WorkingDirectory`: the repository root;
- `StartCalendarInterval` with `Hour` 2 and `Minute` 30. With a calendar interval, launchd runs a job missed while the Mac was asleep at the next wake (TS-G2 AC-1);
- `EnvironmentVariables` → `PATH` that includes the directory of the Node.js binary running `verify`;
- `StandardOutPath` and `StandardErrorPath` under `<repository root>/.verify/`.

## 9. AC coverage (TS-COV)

### 9.1 Acceptance criteria sources

All `docs/acceptance/*.md` files except `README.md`.
- **Requirement heading:** a line starting with `### ` followed by one or more IDs separated by ` / `, then a space and free text. An ID is uppercase letters, digits and hyphens, starting with a letter and containing a hyphen or ending in a digit (`FR-FMT-07`, `NFR-REL-01`, `AR-06`, `TS-VERIFY`, `TS-P`, `TS-G2`, `S2-QA`). A shorthand `-NN` after ` / ` means the previous ID's prefix with a new last part: `### FR-STO-01 / -03 / -05 Vault layout` → `FR-STO-01`, `FR-STO-03`, `FR-STO-05`.
- **Table criterion:** a Markdown table row whose first cell is exactly a requirement ID (e.g. `| NFR-PERF-01 | Cold start to usable UI | < 2 s | … |` in `performance.md`) defines the automated AC `<ID>/AC-1` (owner decision 2026-10-08).
- **Criterion:** a line starting with `- **AC-<n>**` under a heading. Its ID is `<first heading ID>/AC-<n>`; the other heading IDs are **aliases** (`FR-SYN-02 / NFR-REL-01` → `FR-SYN-02/AC-3`, alias `NFR-REL-01/AC-3`). It is **manual** if `[manual]` follows the label directly (`- **AC-5** [manual] …`); a mention of `[manual]` elsewhere in the text doesn't count. It is **deferred** to a milestone if `[MS<n>]` follows the label directly, alone or next to `[manual]` in either order (`- **AC-2** [MS2] …`, `- **AC-5** [manual] [MS3] …`); the same "directly after the label" rule applies (D-94). A line `- **<ID>/AC-<n>** …` (as in `performance.md`) defines an AC with that explicit ID, wherever it appears.

### 9.2 Test keys

- An AC's **key** is its ID lower-cased, `-` replaced by `_`, `/AC-<n>` replaced by `_ac<n>`: `FR-FMT-11/AC-2` → `fr_fmt_11_ac2`, `TS-VERIFY/AC-1` → `ts_verify_ac1`, `S2-QA/AC-4` → `s2_qa_ac4`. Aliases give additional keys.
- **Test sources:** files with extension `.ts`, `.tsx`, `.js`, `.mjs` whose name contains `.test.` or `.spec.`, and `.rs` files with a `#[test]` attribute (a line that starts, after indentation, with `#[test]`; a mention in a comment doesn't count); anywhere in the repository except `node_modules/`, `.git/`, `.verify/`, `target/`, `dist/`, `tests/fixtures/` and `.claude/worktrees/` (other checkouts of the same repository).
- A **test reference** is any match of `\b((?:fr|nfr|ar|ts|s\d+)(?:_[a-z0-9]+)*?_ac\d+)(?![0-9])` in a test source, i.e. the shortest prefix ending in `_ac<n>`: `fr_fmt_11_ac2_timezone_does_not_shift_date` → `fr_fmt_11_ac2`.
- A reference whose key belongs to no AC is an **orphan**.

### 9.3 `verify coverage [--results <dir>]` → `qa/coverage/ac-matrix.md`

Results come from JUnit XML files in `<dir>` (default `.verify/last-results/`). A `<testcase>` belongs to an AC if its `name` or `classname` contains a reference to one of the AC's keys. It **passed** if it has no `<failure>`, `<error>` or `<skipped>`. A testcase that is only `<skipped>` counts as not run.

AC status:
- automated: `pass` (at least one testcase passed and none failed), `fail` (any failed), `not run` (referenced in a test source but no testcase in the results), `untested` (no reference in any test source);
- manual: `manual: pass (<MSn>, <file>)` or `manual: fail (<MSn>, <file>)` from the latest record, `<file>` being the repository-relative path, else `manual: no record`.

**Manual records:** files `qa/sessions/*.md` and `qa/manual/*.md`, read in file-name order (later files win). A record file has a line `milestone: MS<n>` and lines `- <AC-ID>: pass` or `- <AC-ID>: fail`.

The report (exit 0 always) contains, in this order:
1. `# AC coverage`
2. a table with one row per AC: `| <AC-ID> | <auto|manual>[ (MS<n>)] | <test sources, comma-separated, or —> | <status> |` (the milestone in parentheses for a deferred AC)
3. `## Untested ACs` followed by one line `- <AC-ID>` per untested automated AC
4. `## Orphan tests` followed by one line `- <key> in <repository-relative file>` per orphan reference
5. `## Real-app ACs without an L6 test` (§9.5)
6. `## Manual ACs` followed by one line `- <AC-ID>: <status>` per manual AC

### 9.4 Milestone AC check (TS-COV AC-3)

- **Milestone requirements** come from `docs/Business Requirements.md`: the table under the heading line starting `### 11.2`, the row whose first cell is `MS<n>`, third cell. That cell is a comma-separated list: `FR-STO-01…09` (range, inclusive, keeping zero padding; `...` works as `…`), `-06` and `-08…11` (shorthand using the previous item's prefix), `AR-01`, `All NFR-PERF` (every requirement whose ID starts with `NFR-PERF-`). Text in parentheses is ignored.
- Uses the results of the current run (`VERIFY_RESULTS`).
- The `milestone-acs` check **fails** if (a) an automated AC whose ID or alias is a milestone requirement doesn't have status `pass`, (b) a manual one has no `pass` record for **this** milestone, or (c) a milestone requirement has no AC at all (write ACs before implementing, CLAUDE.md; requirements matched only by an `All <prefix>` item are exempt from (c)). Each offending AC or requirement ID is listed.
- **Deferred ACs (D-94):** an AC deferred to `MS<k>` is in scope of `verify milestone --milestone MS<k>` (whatever its requirement's milestone) and is **not** checked by its requirement's milestone; there it still counts for (c). A deferred AC skipped this way is listed in a separate check `milestone-deferred`, which always passes, one message `<AC-ID>: verified at MS<k>` each. A marker naming a milestone missing from the §11.2 table fails `milestone-acs` of the requirement's milestone with `<AC-ID>: unknown milestone MS<k>`. `verify release` ignores the markers and checks every AC; a deferred manual AC there needs any `pass` record (as every manual AC at release), and an unknown-milestone marker fails it too. A marker naming the requirement's own milestone is checked normally and not listed. The `milestone-deferred` check is always present after `milestone-acs`, with its messages sorted (none when nothing is deferred).

### 9.5 L6 coverage check (TS-COV AC-6, D-382)

- An AC is a **real-app AC** if its criterion line contains a layer marker `*(` … `)*` whose text contains the token `L6` (matched by `\bL6\b`): `*(L6)*`, `*(L5; L6 once)*`, `*(L6 benchmark)*`. Table criteria (§9.1) are never real-app ACs.
- A **real-app reference** is a test reference (§9.2) in a test source whose repository-relative path starts with one of the `realAppTests` prefixes (§2).
- The `l6-coverage` check runs on the files of the checked tree. It **fails** for every real-app AC that has a test reference (by its key or an alias key) in some test source but no real-app reference; each such AC is one message `<AC-ID>: no real-app test in <prefixes joined by ", ">`, sorted by AC ID. A real-app AC with no test reference at all passes (its slice isn't tested yet; it shows as untested in the report). Deferred and manual markers don't change this.
- When `realAppTests` is omitted or empty, the check is not run and not listed.
- `verify coverage` adds, after `## Orphan tests`, a section `## Real-app ACs without an L6 test` with one line `- <AC-ID>` per AC the check would fail (none when `realAppTests` is empty).

## 10. Agent definitions (TS-I AC-3)

`.claude/agents/ac-author.md`, `test-author.md`, `qa-reviewer.md`, `explorer.md`, each with YAML frontmatter containing `name:` (the file name without `.md`) and `description:`.
- `qa-reviewer.md`: `tools: Read, Grep, Glob` (read-only).
- `test-author.md`: its body forbids reading the implementation of the feature under test.
- `explorer.md`: its body forbids opening `test exports/`.

## 11. Other commands

- `verify review-prep [--base <rev>]`: writes `.verify/review/diff.patch` (diff of `HEAD` against the merge-base with `<rev>`, default `main`) and `.verify/review/context.md` (branch, base, head sha, head tree hash, last push result and whether its tree matches) for the QA reviewer.
- `verify merge [--base <rev>] [--lanes 1] [--all]` (D-612): the pre-merge flow. `<rev>` defaults to `origin/main` if that ref exists, else `main`. If a remote `origin` exists, `git fetch origin` runs first (a failed fetch is a warning on stderr, not an error). If `<rev>` is not an ancestor of `HEAD`, it exits **1** without running a gate, with a message on stderr containing `merge <rev> first`. Otherwise it runs the push gate on `HEAD` exactly as `verify push` does (default range, lanes, memo, `.verify/last-pass` recorded on success), then `review-prep --base <rev>`, and prints a last line `verify merge: READY (tree <tree hash>)` when the gate passed or `verify merge: NOT READY` when it failed. Exit code: the gate's (0 or 1).
- `verify help`: usage. Unknown commands exit 2.

## 12. Known limitations (owner decision 2026-10-08)

Found by the QA review of the first version and deliberately not addressed now. Revisit when they start to matter:

- **Claude hook matching:** `git -C <dir> push`, `git -c … push` and other global options aren't detected; `--no-verify` or a `core.hooksPath` override placed after other arguments isn't caught by the deny rules; `git push` inside quoted text (a commit message, a `grep`) is blocked when last-pass is stale.
- **Faked pre-push input:** running `./verify hook pre-push` by hand with a made-up stdin line (`<ref> <head> <ref> <head~1>`) checks a narrowed range and still records last-pass, a smaller version of the `--range` route closed in §3.2.
- **Test helpers aren't protected:** shared helpers such as `tools/qa/test/helpers.ts` can be changed without an `AC-Test-Change:` trailer. The QA reviewer checks such changes (TS-I3).
- **Step timeouts are opt-in (§3.2.4):** a hanging step without `timeout` hangs its gate, including the nightly run.
- **Partial runs (§3.2.5):** nothing checks that a step's test files are independent; a helper or fixture that matches `testFiles` by mistake would be treated as a test file. After a partial run the step's JUnit report holds only the files that ran, so `verify coverage` shows the other ACs of that step as not run until the next full run (nightly or `push --all`).
- **Partial runs and unattributed failures (§3.2.5):** if a failed run names a failing file and also has a failure its report ties to no test file, only the named file is pending; the other failure is seen again at the next full run.
- **Partial run of quarantined tests only (§3.2.5, §3.6):** when the only change is a quarantine tag on every test of a file, the partial run finds no test to run and fails; run `verify push --all` once.
- **Step timeout and processes outside the group (§3.2.4):** a process that left the step's process group (a detached test server) survives the timeout and may keep `VERIFY_PORT_BASE`; the next gate then fails to start its server until that process is stopped.
- **Passed trees and the range checks (§3.2):** a tree that passed lets any commit with that tree through the hooks, in every worktree, without the commit-level checks (`ac-test-protection`, `red-first`, `fixtures`) running for a rewritten history of the same tree.
- **`verify flaky --clear` and a running gate (§3.6):** it doesn't take the gate lock; cleared at the moment a gate records its flaky tests, one of the two writes can be lost.
- **Flaky list (§3.6):** `verify flaky --clear` isn't protected; the QA reviewer checks that a cleared test was fixed. A flaky test in a step that writes no `.flaky.json` (vitest, cargo) isn't counted.
- **Duplicate AC IDs** (e.g. `FR-TYP-15/AC-1` in two files) and alias collisions are merged silently in the coverage report.
- **counts-only** accepts ASCII-only labels and JSON keys, so an ASCII title used as a label passes.
- **Merge side effects (§5.0):** a merge that itself adds a new AC test (new against every parent) skips red-first; a clean merge where both sides changed the same AC test or fixture (each with its own trailer) differs from every parent, so the merge commit needs the trailer too.
- **Coverage after a commit:** every gate run replaces `.verify/last-results/`, so `./verify coverage` right after a commit gate shows automated ACs as "not run"; run it after `push` or `nightly`.
- **Interrupted runs:** Ctrl-C during a gate can leave its temporary worktree registered until the next run's `git worktree prune`.
- **Strategy items not in this contract:** the Claude hook blocking "task done" until G1 passed, and an "AC-coverage diff" in G1 (test-strategy §8.1, §8.3).
- **Root commits and first pushes:** a root commit is compared with the empty tree (§5.2, §7). A range can only include a root commit through an unrelated history (`--range main..<orphan head>`), and with no upstream, `origin/main` or `main` the default range is empty, so the first push of a brand-new repository checks no commits.
- **One AC per test name:** under the shortest-prefix rule (§9.2) a name like `ts_d4_ac1_ts_i_ac1_…` credits only the first AC.
- **Step memo inputs (§3.2.3, owner decision 2026-10-22):** a dependency missing from a step's `inputs` can leave a stale pass in place; the nightly gate and `verify push --all` run everything regardless. A skipped step whose reused reports are gone from `.verify/results/` shows its ACs as not run in `verify coverage` until the next full run.
- **Gate lock across versions (§3.5):** a checkout still on the first lock version (mkdir, then `owner.json`) can, in the moment between the two, have its new lock taken over by a newer checkout, which treats a lock without `owner.json` as stale. It stops mattering once every worktree has the current `verify`.
- **Stale-lock break race (§3.5):** if a waiter moves aside a fresh lock by mistake (it judged the previous one stale just before another waiter replaced it) and a third command takes the lock in the moment before it can move it back, two gates run at once and the mistaken lock is left as a `gate.lock.stale-*` folder until it turns stale. It needs three commands and a stale lock within microseconds.
- **Steps without a terminal (§3.5):** each tree-gate step runs in its own session (`setsid`), so a step that opens `/dev/tty` fails; steps read `/dev/null` and write to pipes anyway. The gate handles SIGHUP itself, so `nohup ./verify …` doesn't protect it from a closing terminal.
- **AC-8 tests outside the protected pattern:** the TS-VERIFY AC-8 tests of behaviour that existed before AC-8 are in `tools/qa/test/gate-lock.test.ts`, which doesn't match `acTestPatterns`, so they can change without an `AC-Test-Change:` trailer. The QA reviewer checks such changes (TS-I3).
- **Lane resources (§3.2.2):** nothing checks that steps sharing a port, cache or build output are in one lane; a wrong lane assignment shows up as flaky steps.
