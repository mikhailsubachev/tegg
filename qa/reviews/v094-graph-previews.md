# QA review: v0.94 graph and previews (D-1164…D-1198)

Branch `claude/v094-graph-previews` against `origin/main` (merge-base 1e7784b), reviewed at e7223a2 (tree 7fa169308a)
by the `qa-reviewer` agent, 2026-10-31. Verdict at review time: **not ready** (1 blocker, 1 major, 9 minor).

## Findings and outcome

| # | Severity | Where | Finding | Outcome |
| --- | --- | --- | --- | --- |
| 1 | blocker | `.verify/runs/*-push.json` | No `./verify push` pass on the head tree (the last pass in this worktree was another branch's, 6433455) | the push gate runs on the final head before the PR |
| 2 | major | `app/ui/src/preview/editorChips.ts:156-184` | Hover in the editor now previews `#tag` chips and Markdown note links (an existing gap) with no decision and no `bug_` test | owner point AP-1028 |
| 3 | minor | `app/ui/src/preview/linkUi.tsx:73-74` | The `Link` menu opens above its reference when it wouldn't fit below; no decision | owner point AP-1029 |
| 4 | minor | `app/ui/src/App.tsx:1131-1136` | Tasks' `onUi` skips a `ui_state_set` equal to what is stored (an existing machine-local write); no decision, no `bug_` test | owner point AP-1030 |
| 5 | minor | `docs/acceptance/previews.md`, `graph.md`, `README.md` | Part three still "draft"; R129 cites AP-n | fixed: approved status, D-n references |
| 6 | minor | BRD D-942 | No "superseded by D-1165" note | fixed |
| 7 | minor | previews.md AC-test table | The trailer text differs from the one used | fixed: the table quotes 78b3821's trailer; 78b3821 and 0b27a15 carry their trailers; D-1198 needed no test change |
| 8 | minor | `app/e2e/previews_v094.ac.test.ts:200` | `if (fig)` skips the ⌥Space check silently | owner point AP-1031 (AC-test change) |
| 9 | minor | `app/e2e/previews_v094.ac.test.ts:220-275` | FR-SYN-06 AC-42's L6 tour is narrower than the AC text | owner point AP-1032 |
| 10 | minor | `app/webkit/graph.ac.test.ts:33` | A stale comment above the removed `LINE` table | owner point AP-1031 (AC-test change) |
| 11 | minor | `app/ui/src/graph/canvasInput.ts:77-78`; `app/webkit/previews_v094_default.ac.test.ts` | `gesturestart` set state inside a `setView` updater; `void previews; void eventually;` keeps unused imports | `canvasInput.ts` fixed (no state update on `gesturestart`); the test file's imports in AP-1031 |

## Checked and found in order

Every decision D-1164…D-1198 in the code; every modified AC test matches the approved table or D-1192…D-1196; red tests
fed0038 before the build 78b3821; regression tests before their fixes (e47902a → 78b3821, 4398e49 → e7223a2); no new
UI string; both themes; no new user action (the three `Object preview:` commands stay); no vault writes from the new
inputs; no `.only` / `.skip`; synthetic fixtures only. The AC coverage list is in the review agent's report.
