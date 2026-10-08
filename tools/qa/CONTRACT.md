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
| `steps[]` | Commands run by the gates. `id`: unique name. `dir`: working directory relative to the checkout root (default `.`). `run`: shell command, run with `sh -c`. `level`: the lowest gate that runs the step, one of `commit`, `push`, `nightly`, `milestone`, `release`. `changedOnly` (default `false`): in the **commit** gate only, the step runs only if a staged file is under `dir`; otherwise it is reported as `skipped`. |
| `acTestPatterns` | Regular expressions (JavaScript syntax) matched against **repository-relative paths** with `/` separators. A file matching any of them is an **AC test file**. Default when omitted: the two patterns above. |
| `acRunners[]` | How to run AC test files for `check-red` (§5). `dir`: runner working directory, relative to the checkout root. `match`: regex on the repository-relative path selecting files this runner handles. `run`: command template; `{files}` is replaced by the file path(s) relative to `dir`, each single-quoted; `{junit}` by an absolute path where the runner must write a JUnit XML report. |
| `budgets` | Time budget per gate in seconds (§3.4). Defaults: commit 60, push 600, nightly 5400; other gates have no budget. |

Gate order: `commit` < `push` < `nightly` < `milestone` < `release`. A gate runs every step whose `level` is at or below it.

### 2.1 Environment given to steps and runners

| Variable | Value |
| --- | --- |
| `VERIFY_GATE` | Name of the running gate |
| `VERIFY_RESULTS` | Absolute path of a directory where steps may write JUnit XML reports (`*.xml`) |
| `QA_SEED` | A random integer chosen for this run, recorded in the summary |
| `QA_PROPERTY_SCALE` | `1` for commit and push, `100` for nightly, milestone and release |

Git's hook variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`) are removed from the environment of steps and runners.

## 3. Gates

### 3.1 `verify commit` (G0)

Runs in the **working directory as it is**. Order:
1. **Privacy check** on **staged** files (§6).
2. Steps with `level: commit`.

### 3.2 `verify push [--commit <rev>] [--range <base>..<head>]` (G1)

Checks the committed state of `<rev>` (default `HEAD`) in a **fresh git worktree** created for this run (in a temporary directory) and removed afterwards (TS-VERIFY AC-3). Uncommitted and untracked files of the main working directory are not visible to the checks or steps. If the main working directory has uncommitted changes, a warning containing `uncommitted` is printed on stderr.

For each step `dir` that contains a `package-lock.json`, `node_modules` is provided in the worktree: a symlink to the main checkout's `<dir>/node_modules` if the main checkout has one and its `package-lock.json` is byte-identical; otherwise `npm ci` runs in the worktree.

**Range:** the commits checked by the commit-level checks below. `--range A..B` means the commits reachable from B and not from A (as `git rev-list A..B`). Default: `<base>..<rev>` where `<base>` is the merge-base of `<rev>` with the first ref that exists of `@{upstream}`, `origin/main`, `main`; if none exists or the merge-base equals `<rev>`, the range is empty.

Order:
1. **Privacy check** on every file in the tree of `<rev>` (§6).
2. **Fixture trailer check** on every commit in the range (§7).
3. **AC test protection** on every commit in the range (§5.1).
4. **Red-first check** (§5.2): `check-red` for every commit in the range that **adds** an AC test file, unless its message has a trailer line `Red-First-Exempt: <reason>; approved-by: owner`.
5. Steps with level `commit` and `push` (`changedOnly` is ignored).

On success, writes the **tree hash** of `<rev>` (`git rev-parse <rev>^{tree}`), followed by a newline, to `.verify/last-pass`. On failure, `.verify/last-pass` is left unchanged.

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
- Check `id`s: `privacy`, `fixtures`, `ac-test-protection`, `red-first`, `milestone-acs`.
- `seeds`: every integer found in the step's output after `seed` followed by `=`, `:` or spaces (case-insensitive), in order.
- JUnit files written to `VERIFY_RESULTS` by the run are copied to `.verify/last-results/` (replacing its previous content).
- **Budget:** if `durationMs` exceeds the gate's budget, stdout gets a line containing `exceeded` and the budget, followed by the up-to-3 slowest steps, one per line, each containing the step `id` and its duration. The exit code doesn't change.
- All steps run even after one fails; the gate fails if any check or step failed.

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
- if the tree hash of `<local sha>` equals the content of `.verify/last-pass` (trimmed), it is **skipped** and nothing runs;
- otherwise it runs the push gate with `--commit <local sha>` and, if `<remote sha>` isn't all zeros, `--range <remote sha>..<local sha>` (else the default range).

Exit 0 if every line was skipped or passed, else 1.

### 4.3 `verify hook commit-msg <message file>` (TS-I AC-1)

Looks at the **staged** changes (`git diff --cached --name-status -M`). If any **existing** AC test file (§2 `acTestPatterns`) is modified, deleted or renamed, the commit message must contain a line matching `^AC-Test-Change: .+; approved-by: owner$`; otherwise exit 1 with a message naming the file(s). Adding new AC test files needs no trailer. Exit 0 otherwise.

### 4.4 Claude Code hook: `verify hook claude-pre-tool` (TS-HOOKS AC-2)

Configured in `.claude/settings.json` as a `PreToolUse` hook with matcher `Bash` and command `"$CLAUDE_PROJECT_DIR"/verify hook claude-pre-tool`.

Reads the Claude Code hook JSON from stdin (`{"tool_name": "Bash", "tool_input": {"command": "..."}, ...}`). If `tool_name` is `Bash` and the command contains `git push` or `gh pr merge`, and the content of `.verify/last-pass` (trimmed) isn't the tree hash of `HEAD`, it exits **2** with a message on stderr containing `./verify push`. In every other case (other tools, other commands, matching last-pass, unparsable input) it exits 0 and prints nothing.

### 4.5 Claude Code permissions (TS-HOOKS AC-3, TS-P AC-2)

`.claude/settings.json` `permissions.deny` contains at least:
`Read(./test exports/**)`, `Edit(./test exports/**)`, `Bash(git commit --no-verify:*)`, `Bash(git push --no-verify:*)`.

## 5. AC tests

### 5.1 AC test protection (push gate)

For every commit in the range: if it modifies, deletes or renames an existing AC test file, its message must contain the `AC-Test-Change: …; approved-by: owner` line (§4.3). Otherwise the `ac-test-protection` check fails, naming the commit and file.

### 5.2 `verify check-red <commit>` (TS-I AC-2)

1. Lists the AC test files **added** by `<commit>` (status `A` against its first parent). If there are none, exit 1 with a message containing `no AC tests added`.
2. Creates a fresh worktree of `<commit>` (with `node_modules` provided as in §3.2 for each runner `dir`).
3. For **each** added file, picks the first `acRunners` entry whose `match` matches it (no runner → the check fails for that file) and runs it for that file alone, reading the JUnit report at `{junit}`.
4. A file passes if the report has **at least one** `<testcase>` and **every** testcase has a `<failure>` or `<error>` whose `type` attribute, `message` attribute or text contains `AssertionError`. A missing report, zero testcases, a passing testcase or a non-assertion failure (syntax error, missing module, missing fixture) fails the file.
5. Exit 0 if every added file passes, else 1, listing each failing file and why.

The configuration (`acRunners`) is read from the **current** checkout, not from `<commit>`.

## 6. Privacy check (TS-P AC-1)

Applied to staged files (commit gate: added, copied, modified or renamed, using the staged content) or to every file in the tree (push gate). A file fails if:
- its path starts with `test exports/`; or
- its name ends with `.zip` (case-insensitive) and it is not under `tests/fixtures/`; or
- its size is more than **1,048,576 bytes** and it is not under `tests/fixtures/`.

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
- **Criterion:** a line starting with `- **AC-<n>**` under a heading. Its ID is `<first heading ID>/AC-<n>`; the other heading IDs are **aliases** (`FR-SYN-02 / NFR-REL-01` → `FR-SYN-02/AC-3`, alias `NFR-REL-01/AC-3`). It is **manual** if `[manual]` follows the label directly (`- **AC-5** [manual] …`); a mention of `[manual]` elsewhere in the text doesn't count. A line `- **<ID>/AC-<n>** …` (as in `performance.md`) defines an AC with that explicit ID, wherever it appears.

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
2. a table with one row per AC: `| <AC-ID> | <auto|manual> | <test sources, comma-separated, or —> | <status> |`
3. `## Untested ACs` followed by one line `- <AC-ID>` per untested automated AC
4. `## Orphan tests` followed by one line `- <key> in <repository-relative file>` per orphan reference
5. `## Manual ACs` followed by one line `- <AC-ID>: <status>` per manual AC

### 9.4 Milestone AC check (TS-COV AC-3)

- **Milestone requirements** come from `docs/Business Requirements.md`: the table under the heading line starting `### 11.2`, the row whose first cell is `MS<n>`, third cell. That cell is a comma-separated list: `FR-STO-01…09` (range, inclusive, keeping zero padding; `...` works as `…`), `-06` and `-08…11` (shorthand using the previous item's prefix), `AR-01`, `All NFR-PERF` (every requirement whose ID starts with `NFR-PERF-`). Text in parentheses is ignored.
- Uses the results of the current run (`VERIFY_RESULTS`).
- The `milestone-acs` check **fails** if (a) an automated AC whose ID or alias is a milestone requirement doesn't have status `pass`, (b) a manual one has no `pass` record for **this** milestone, or (c) a milestone requirement has no AC at all (write ACs before implementing, CLAUDE.md; requirements matched only by an `All <prefix>` item are exempt from (c)). Each offending AC or requirement ID is listed.

## 10. Agent definitions (TS-I AC-3)

`.claude/agents/ac-author.md`, `test-author.md`, `qa-reviewer.md`, `explorer.md`, each with YAML frontmatter containing `name:` (the file name without `.md`) and `description:`.
- `qa-reviewer.md`: `tools: Read, Grep, Glob` (read-only).
- `test-author.md`: its body forbids reading the implementation of the feature under test.
- `explorer.md`: its body forbids opening `test exports/`.

## 11. Other commands

- `verify review-prep [--base <rev>]`: writes `.verify/review/diff.patch` (diff of `HEAD` against the merge-base with `<rev>`, default `main`) and `.verify/review/context.md` (branch, base, head sha, head tree hash, last push result and whether its tree matches) for the QA reviewer.
- `verify help`: usage. Unknown commands exit 2.
