# MS5 Tasks Interface Contract (slice 5A-1; 5A-2 conversion and the Task card in §11)

- **Status:** accepted, 2026-10-17 (red-test clarifications AP-430…AP-443 → D-501…D-514, §10). Written before the 5A-1 red tests (D-487, as D-295 and D-430). Follows D-470…D-500 (BRD v1.66).
- **ACs:** [docs/acceptance/tasks.md](../acceptance/tasks.md) (FR-TSK-01 AC-1…AC-7, FR-TSK-02 AC-1…AC-13, FR-TSK-03 AC-1…AC-3, FR-TSK-04 AC-1…AC-14, FR-TSK-05 AC-1…AC-13, FR-TSK-08 AC-1…AC-3, FR-TSK-09 AC-1…AC-3, FR-TSK-10 AC-1…AC-8, FR-TSK-11 AC-1…AC-4, FR-DLY-04 AC-8…AC-14, FR-SYN-06 AC-20…AC-22) and its tables R40…R46. Where this contract and the ACs disagree, the ACs win, and this contract is corrected before the red tests.
- **Builds on** [ms4-daily.md](ms4-daily.md) (§1 dates and the day window, §7 daily UI), [ms4-links.md](ms4-links.md) (§1 resolution, §3.1 free stem, §6 fake core), [ms3-shell.md](ms3-shell.md) (§5 fake core, §13.2 `note_read` / `note_write`, §14 types: `tegg-schema`, `type_patch`, the creation path §14.2.3) and [ms4-jobs.md](ms4-jobs.md). Everything in those contracts stays valid unless this one changes it.
- **No job.** Every 5A-1 write is a single-file save with a base version: a task file through `note_write`, a type file through `type_patch`, a new task through `note_create`. 5A-1 adds no `tegg-jobs` planner and no restore point (tasks.md intro).

Until a part is implemented, it exists as a stub that compiles and returns a deliberately wrong result (an empty list, `None`, the input unchanged, or an `Io` error). A test then fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Dates, the clock and "today"

- ms4-daily §1 holds unchanged: the UI owns the clock and the zone (`Date.now()`, `Intl`), `@tegg/doc` `localDate(nowMs, timeZone?)` gives today, `addDays(date, n)` is calendar arithmetic, and `parseDate(s)` (Rust `tegg_format::date::parse_date`) is the only test for a valid `due` (R44, D-484: quoted or not, nothing else).
- **The core never decides "today", "overdue" or a section.** The task query (§2) returns raw and parsed values; bucketing (§4) is one TypeScript function given today and the first weekday. The Daily `Tasks due` query (§2.3) receives a `DayWindow` and `today` from its caller.
- **First weekday** comes from a new `@tegg/doc` `firstWeekday(region: string): 1…7` (1 = Monday) in `daily.ts`; the 4B calendar's private `weekStart` (D-329) moves there and the calendar calls it. The tests' regions are `cs` (Monday) and `en-US` (Sunday).
- **Midnight and zone changes** (FR-TSK-04 AC-8): the Tasks page and the daily section re-derive today every 30 s from `Date.now()` and the current `Intl` zone (the D-327 timer of the sidebar), and recompute when it changed.
- **Completed instant** (R44): a new `@tegg/doc` `parseInstant(s, timeZone?): number | null` (in `daily.ts`) reads a date-time with offset; a value without offset is read in the given zone (D-365); a date alone is local midnight. `completed` is written with the existing `localIso(nowMs, timeZone?)`, the date-time with the zone's offset that `created` and `modified` use.

## 2. Core API (`tegg-core`, new module `tasks5a.rs`)

### 2.1 The task row

```rust
pub enum TaskState { Open, InProgress, Done, Cancelled }

pub struct TaskRow {
    pub path: String,                      // NFC vault path
    pub id: Option<String>,
    pub title: String,                     // falls back to the file stem (ObjectInfo rule)
    pub status: Option<String>,            // as written (NFC), None when the key is missing or not one string
    pub state: TaskState,                  // R44 / D-471: option state; missing, unknown value, no or unknown `state` → Open
    pub status_known: bool,                // false when `status` is set but isn't an option (card: `Not a status`)
    pub priority: Option<String>,          // as written (NFC)
    pub priority_rank: usize,              // position in the Task type's `priority` options; missing / unknown = options.len()
    pub due_raw: Option<String>,           // as written, when set
    pub due: Option<NaiveDate>,            // Some only for a valid YYYY-MM-DD (D-484)
    pub completed: Option<String>,         // as written
    pub tags: Vec<String>,                 // keys (NFC, case-folded) of frontmatter and inline tags, sorted, unique
    pub fm_tags: Vec<String>,              // `tags:` entries as written, in file order (the drag edits these, D-478)
    pub source: Option<LinkTarget>,        // `source` resolved by ms4-links §1 from `path`
    pub excerpt: String,                   // body start as plain text (D-482): no headings, links as text, no embeds; ≤ 300 chars
    pub created: Option<String>,
    pub modified: Option<String>,
    pub version: FileVersion,              // the version the index read; the base of every write (§5)
    pub read_only: bool,                   // the editor would open it read-only (not UTF-8, NFR-REL-03)
}

pub struct TaskDefs {
    /// The Task type's options in file order, with their state (built-in when `task.yml` is missing, D-90).
    pub statuses: Vec<StatusOption>,
    pub priorities: Vec<tegg_schema::OptionDef>,
    /// `tasks.yml` warnings: options whose `state` is absent or unknown (FR-TSK-02 AC-9 message).
    pub unknown_states: Vec<(String /* label */, Option<String> /* raw state */)>,
}
pub struct StatusOption { pub label: String, pub color: Option<String>, pub state: TaskState, pub state_raw: Option<String> }

impl Core {
    /// R44: every indexed object whose matched type is `task` (FR-TYP-13), not in `_templates/` or `.trash/`
    /// (never indexed anyway, D-102). Unsorted. One index read, no file read.
    pub fn tasks(&self) -> Vec<TaskRow>;
    pub fn task_defs(&self) -> TaskDefs;
}
```

- **State mapping** reads the option's `state` from `OptionDef.extra` (`open`, `in-progress`, `done`, `cancelled`; anything else, or absent, is Open with a warning). The match of `status` to an option is exact after NFC (types.md R10 `select`).
- **Inline tags** are the index's existing D-185 tags of the body; `tags` merges them with `fm_tags` by key. The tag columns and the tag filter use `TagInfo.spelling` for the label (§4).
- **Excerpt** comes from the index's existing body text (FTS source); no new file read.
- **Nothing only in the index (FR-TSK-01 AC-7):** every field is derived from the file at index time; a rebuilt index gives the same rows.
- **Live updates:** `tasks()` is re-queried by the UI on `vault:changed` (NFR-PERF-08); no task-specific event.

### 2.2 Status `state` in `tegg-schema` (D-473)

- `OptionDef` keeps `state` in `extra` as today. New helpers: `tegg_schema::option_state(&OptionDef) -> Option<&str>` and `TaskState::parse(&str) -> Option<TaskState>`.
- **New `TypeOp` variants**, line edits by the §14.1.4 rules (only the option's line changes, flow-map style kept):
  - `SetOptionState { attr: String, label: String, state: String }`;
  - `AddOption { attr: String, option: OptionDef }` appends after the last option (FR-TSK-02 AC-3);
  - `SetOptionColor { attr, label, color }`, `MoveOption { attr, label, to: usize }`, `RemoveOption { attr, label }`, `RenameOption { attr, from, to }`.
  - `UpdateAttribute { change.options }` keeps working; the new ops exist so each type-settings action writes exactly one line (AR-07 AC-5).
- **Refusals** (`SchemaError::Rule`), checked on the Task type's `status` only: `needOpen` / `needDone` when the patch removes the last option with state Open / Done (D-473: "must remain" applies to a status the file has; a hand-written `task.yml` without a Done-state status still accepts other changes, and an option without a known state counts as Open, D-471); `optionUsed` for `RenameOption` of a label `type_usage` counts as used (the UI passes the count in `PatchContext.used: &[(&str, usize)]`, new field, default empty). `BuiltInChanged` stays for removing `status` / `priority` or changing their key or type.
- **TypeScript twin** in `@tegg/schema`: `OptionDto` gains `state: string | null`; `taskState(option): 'open' | 'in-progress' | 'done' | 'cancelled'`; `checkStatusOptions(options): RuleError | null` (the same `needOpen` / `needDone`). `fake-schema.ts` applies the new ops with the same line edits (checked against the shared corpus `tests/fixtures/types/ops-5a.json`, which the Rust tests read too).

### 2.3 Daily `Tasks due` (D-485)

```rust
pub struct DailyTaskRows { pub overdue: Vec<TaskRow>, pub due: Vec<TaskRow>, pub completed: Vec<TaskRow>, pub total: usize }
impl Core {
    /// `today`: the caller's local date. `overdue` only when w.date == today. Sorted by FR-DLY-04 AC-9.
    /// Cancelled and invalid `due` never listed. `limit` caps the three lists together, in order.
    pub fn daily_tasks(&self, w: &DayWindow, today: NaiveDate, limit: usize) -> DailyTaskRows;
}
```

- `completed` rows are those whose completed instant falls in `[w.start, w.end)` (ms4-daily §1).
- **D-328 first match:** `daily_context` excludes from `created` and `modified` every object `daily_tasks` lists for the same window (FR-DLY-04 AC-11). Both calls stay separate IPC commands; the core computes the exclusion itself.

## 3. IPC added or changed in 5A-1

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `task_list` | — | `TaskListDto` | Read-only: `{ tasks: TaskRowDto[], defs: TaskDefsDto }` in one call. |
| `daily_tasks` | `date`, `start`, `end`, `today`, `limit` | `DailyTasksDto` | Read-only. |
| `type_patch` | unchanged | | Accepts the §2.2 ops (`{ op: 'setOptionState' \| 'addOption' \| 'setOptionColor' \| 'moveOption' \| 'removeOption' \| 'renameOption', … }`) and returns the new rule errors. |
| `note_write`, `note_read`, `note_create` | unchanged | | §5 composes the task writes from them. |
| `ui_state_get` / `ui_state_set` | unchanged | | `UiStateDto.tasks` added (§6.3). |

```ts
type TaskState = 'open' | 'in-progress' | 'done' | 'cancelled';
type TaskRowDto = { path: string; id: string | null; title: string; status: string | null; state: TaskState; statusKnown: boolean;
  priority: string | null; priorityRank: number; dueRaw: string | null; due: string | null; completed: string | null;
  tags: string[]; fmTags: string[]; source: LinkTargetDto | null; excerpt: string; created: string | null; modified: string | null;
  version: VersionDto; readOnly: boolean };
type StatusOptionDto = { label: string; color: string | null; state: TaskState; stateRaw: string | null };
type TaskDefsDto = { statuses: StatusOptionDto[]; priorities: OptionDto[]; unknownStates: { label: string; state: string | null }[] };
type DailyTasksDto = { overdue: TaskRowDto[]; due: TaskRowDto[]; completed: TaskRowDto[]; total: number };
```

DTOs are generated by `ts-rs` (ms2-shell §2); `app/ui/src/ipc/types.ts` is regenerated in the commit that adds them.

## 4. Bucketing (`app/ui/src/tasks/views.ts`, pure TypeScript)

```ts
type ViewInput = { tasks: TaskRowDto[]; defs: TaskDefsDto; today: string; firstWeekday: number; collator: Intl.Collator;
  dateFilter: 'all' | 'today' | 'week'; tagFilter: string[] /* tag keys */; timeZone?: string };

function schedule(i: ViewInput): {
  today: { overdue: TaskRowDto[]; today: TaskRowDto[] };
  week: { date: string; tasks: TaskRowDto[] }[];          // only days with tasks; [] when today is the week's last day
  weekRange: { from: string; to: string } | null;
  later: TaskRowDto[]; none: TaskRowDto[]; done: TaskRowDto[];
};
function kanban(i: ViewInput, groupBy: 'status' | 'tag', tagSpelling: Map<string, string>): {
  columns: { id: string /* label, '#<tag>', 'no-tag', 'no-status' */; label: string; color: string | null; state: TaskState | null;
    dropTarget: boolean; tasks: TaskRowDto[] }[];
};
function counts(i: ViewInput): { open: number; overdue: number; dueToday: number; all: number; today: number; week: number;
  tags: { key: string; label: string; count: number }[] };
function isOverdue(t: TaskRowDto, today: string): boolean;
function dueLabel(t: TaskRowDto, today: string, region: string): { text: string; tone: 'overdue' | 'today' | 'plain' | 'invalid' | 'done' };
```

- One implementation of R41, R42, R44 and D-474…D-477; the L1 table tests, the L2 property (FR-SYN-06 AC-22), the page and the daily section all use it. The sort orders are R41's and R42's, with `collator` = `Intl.Collator(region)` (D-122) and the path byte order last.
- `tagFilter` keeps a task only when it has **every** key in it (D-518; was any of them, D-476).
- `counts.tags` lists the tags of open tasks within the date filter (D-476), each selected key too (count 0 when no task has it); a tag's `count` is the number of open tasks within the date filter that have it and every selected key, i.e. the tasks the views would show with it added (D-518). Order: `count` descending, then `collator` on the label, then key byte order. `kanban` by tag has one column per selected key when `tagFilter` is set, else one per listed tag plus `no-tag`.
- The Kanban Done column holds Done-state tasks whose completed instant (else `modified`) is in `[today − 6, today]` (D-475).

## 5. Task writes (`@tegg/doc` `packages/doc/src/task.ts`, D-82)

```ts
type TaskChange =
  | { kind: 'status'; to: string; toState: TaskState; fromState: TaskState; firstOpen: string; now: string }
  | { kind: 'priority'; to: string | null }
  | { kind: 'due'; to: string | null }
  | { kind: 'moveTag'; from: string | null /* tag key; null = add only */; to: string };
function applyTaskChange(text: string, change: TaskChange): { text: string; inlineKept: boolean } | null;  // null: nothing to write
function completeTask(text: string, defs: TaskDefsDto, done: boolean, now: string): string | null;     // the checkbox (D-472)
```

- **Status (D-472):** sets `status`; into a Done state from a non-Done state appends `completed: <now>` after the last entry (D-230); out of a Done state removes the `completed` line; Done → Done and anything → Cancelled keep it; `modified` updated by `touchModified`. A status equal to the current one returns `null`.
- **Checkbox:** check = the first Done-state option; uncheck = `firstOpen`, the first Open-state option (not the previous status).
- **Tags (D-478):** `moveTag` removes the `fm_tags` entries whose key equals `from` (NFC, case-folded) and appends `to` unless an entry with that key exists; the flow or block style of `tags:` is kept; a missing `tags` key is appended after the last entry; the body is never touched. `inlineKept` is true when `from` also occurs as an inline tag (the D-478 note).
- **The write path, one per surface** (`app/ui/src/tasks/write.ts`): `note_read(path)`; if the returned version differs from `row.version`, it is a conflict (no write, reload, the FR-TSK-02 AC-11 alert); else the change above, then `note_write(path, text, row.version)`. `Conflict` → the same; `Io` → revert and the `Try again` alert, which re-reads and retries with the current base; `readOnly` rows are never written. At most one write per task in flight; a second action on the same task waits for the first to settle.
- **Quick-add create (D-470, FR-TSK-10):** `newObject` gains `values?: [string, Value][]`. Values win over template and default for schema attributes; a value whose key isn't a schema attribute (`tags`, `source`) is written after the schema attributes and template keys, `tags` before `source`, before `review` / `created` / `modified`. A new Task with no `status` value and no template value gets the first Open-state option. `createObject(type, title, values?)` passes them through to the one creation path (`note_create`, D-245).

## 6. UI

### 6.1 Routes, commands, registry

- **Routes:** `tasks` (Schedule) and `tasks/kanban`, both built (R45). The sidebar `Tasks` entry opens the last view (D-481) and shows `counts.overdue + counts.dueToday` when > 0.
- **Commands** (R45 R4), all `needsVault: true`: `tasks.go`, `tasks.schedule`, `tasks.kanban`, `tasks.groupStatus`, `tasks.groupTag`, `tasks.filterAll`, `tasks.filterToday`, `tasks.filterWeek`, `tasks.add`, and the card-scoped `task.complete`, `task.setStatus`, `task.moveNext`, `task.movePrevious`. Card-scoped commands without a focused card, and Kanban commands on `tasks`, are not run and show nothing. No new shortcut.
- **Registry:** `tasks` becomes `built`; the `daily-tasks` row leaves `IN_NOTE_PLACEHOLDERS`; new disabled controls `tasks.sort` (v1.0) and `task.trash` (MS6); `recurrence` moves to v1.0 (D-381).
- **i18n:** the R46 keys, exact English texts as the ACs'. Dates in labels come from `Intl.DateTimeFormat(region, …)`, never from the catalog.
- **Marks:** `route-ready:tasks` and `route-ready:tasks/kanban` once per open, after the visible cards painted (FR-TSK-04 AC-14, report-only, D-488).

### 6.2 Modules (`app/ui/src/tasks/`)

- `TasksPage.tsx` (both routes: header, view switch, quick-add, toolbar, live region), `Schedule.tsx`, `Kanban.tsx` (pointer drag with `Alt` = add only, keyboard ⌥←/⌥→, D-479), `TaskCard.tsx` (R43, the universal card), `CardMenu.tsx`, `QuickAdd.tsx`, `views.ts` (§4), `quickAdd.ts` (§6.4), `write.ts` (§5), `useTasks.ts` (`task_list` + re-query on `vault:changed` and the 30 s day check).
- `daily/ContextSections.tsx` replaces the placeholder with `DailyTasks.tsx` (D-485 rows: checkbox, icon and title, due chip, source chip).
- **Source chip** (`SourceChip.tsx`, D-486): click, double-click and ⏎ navigate to `note/<source path>` with the route option `selectEmbedOf: <task path>`; `NotePage` selects the first block embed resolving to that path and scrolls it to the top, else opens at the top. A date source goes to `daily/<date>`, an unresolved one to the Create offer (ms4-links).
- **Type settings:** the `status` options gain the `State` select, the `Used by <n>` count and the read-only label for used options (D-473); `priority` options as today plus rename of unused labels.

### 6.3 Remembered state (D-481)

`UiStateDto.tasks = { view: 'schedule' | 'kanban' | 'all' /* D-516 */; groupBy: 'status' | 'tag'; dateFilter: 'all' | 'today' | 'week'; tags: string[]; doneExpanded: boolean }`, written with `ui_state_set` on change (machine-local, never in the vault).

### 6.4 Quick-add parsing (`app/ui/src/tasks/quickAdd.ts`, D-483)

```ts
function parseQuickAdd(text: string, ctx: { today: string; priorities: string[]; dateWords?: Record<string, string> /* UI language */ }):
  { title: string; due: string | null; priority: string | null; tags: string[]; tokens: { kind: 'due' | 'priority' | 'tag'; word: string }[] };
```

Pure; scans back from the end while the last word is a token (FR-TSK-10 AC-2 table); NFC on input. `Clear due date` / `Clear priority` re-insert the token's `word` at its place in the shown title.

## 7. Fake core additions (ms3-shell §5, ms4-links §6, ms4-daily §8)

- `installFakeCore` implements `task_list` and `daily_tasks` over its in-memory files with a TypeScript twin of §2 (`app/ui/test/fake-tasks.ts`, using `@tegg/doc` and `@tegg/schema`), and the §2.2 ops in `fake-schema.ts`.
- Versions: each in-memory file has a version that changes on every write and on `setFile`; `setFile(path, text, { silent: true })` (existing) changes the disk without `vault:changed`, so `note_read` returns a version different from the row's (FR-TSK-02 AC-11, FR-TSK-05 AC-10).
- `writeControl` (existing: `delayMs`, `fail: 'Io'`, `hold`) gains an optional `path` so a failure hits one file only, and applies to task writes and `note_create`; `writes()` counts them per path (FR-SYN-06 AC-21).

## 8. Test layout

- **L4** `crates/tegg-core/tests/ac_tasks.rs`: FR-TSK-01 AC-1, AC-4 (bytes through the core), AC-7; FR-TSK-02 AC-1…AC-9, AC-11 (base check), AC-13; FR-TSK-03 AC-2; FR-TSK-04 AC-7 (events); FR-TSK-10 AC-1 (write), AC-5, AC-7; FR-TSK-11 AC-1; FR-DLY-04 AC-9, AC-11. `crates/tegg-schema/tests/ac_task_options.rs`: the §2.2 ops and refusals with the shared corpus.
- **L2** `app/test/tasks_property.ac.test.ts` (fast-check): FR-SYN-06 AC-22.
- **L1** (new files, TS-I3): `packages/doc/test/task_edit.ac.test.ts` (§5 bytes: FR-TSK-01 AC-2…AC-5, FR-TSK-02 AC-10, FR-TSK-03 AC-3, FR-TSK-05 AC-2, AC-4…AC-6, FR-TSK-10 AC-1 `newObject`); `app/test/tasks_views.ac.test.ts` (§4: R41, R42, FR-TSK-03 AC-1, FR-TSK-04 AC-2, AC-4, AC-5, FR-TSK-05 AC-1, AC-3, AC-9, FR-TSK-09 AC-1, FR-DLY-04 AC-9 order); `app/test/quick_add.ac.test.ts` (FR-TSK-10 AC-2, AC-5 names); `app/test/tasks_registry.ac.test.ts` (R45, FR-DLY-04 AC-8, strings FR-TSK-04 AC-11, tokens FR-TSK-04 AC-12, FR-TSK-09 AC-3).
- **L5:** `app/webkit/tasks_schedule.ac.test.ts`, `tasks_kanban.ac.test.ts`, `tasks_card.ac.test.ts` (R43, FR-TSK-02 AC-10…AC-12, FR-TSK-03 AC-3, FR-TSK-08, FR-TSK-09 AC-2), `tasks_quick_add.ac.test.ts`, `tasks_type_settings.ac.test.ts`, `daily_tasks.ac.test.ts`, `tasks_no_writes.ac.test.ts` (FR-TSK-04 AC-13, FR-SYN-06 AC-20/21 write counts). (TZ) and (W) run as `describe` blocks with `test.use({ timezoneId, locale })`.
- **L6** `app/e2e/ms5_tasks.ac.test.ts`: FR-TSK-02 AC-11 (real external writer), FR-TSK-04 AC-1, FR-TSK-05 AC-13, FR-TSK-10 AC-8, FR-DLY-04 AC-12, FR-SYN-06 AC-20, AC-21. Benchmark `app/e2e/perf_tasks.ts` (FR-TSK-04 AC-14, report-only).
- **Fixture:** `tests/fixtures/vaults/tasks/` with its README, written byte-exact from tasks.md's tables in its own commit before the tests.
- **AC-Test-Change** (D-489) goes in the 5A-1 build commit, not the red-test commit.

## 9. Contract choices (no owner decision needed)

1. The core returns raw and parsed values; all date-relative logic (sections, overdue, labels) is one TypeScript module given today, so both zones and both regions are tested at L1 and the core stays zone-free (AR-03).
2. Task writes are composed in the UI from `note_read` + `@tegg/doc` + `note_write` with the row's version as base: one text engine (D-82), and a stale view is a conflict, never an overwrite (NFR-REL-02).
3. Status options keep `state` in `OptionDef.extra`, so type files Tegg wrote earlier read unchanged; one op per type-settings action keeps type-file writes to one line.
4. `daily_tasks` is a separate command, and the D-328 exclusion is done in the core, so the two daily calls can't disagree.

## 10. Clarifications from the red tests (accepted 2026-10-17: AP-430…AP-443 → D-501…D-514)

These override the sections above where they differ.

1. **D-501, D-502:** `PatchContext` is unchanged. `tegg_schema::patch_with_usage(key, text, ops, ctx, used: &[(&str, usize)])` does the `optionUsed` check; `Core::type_patch` computes `used` from `type_usage` and calls it. The `type_patch` IPC is unchanged.
2. **D-503:** `newObject`'s `type.attributes[]` gain `options?: { label: string; color: string | null; state: string | null }[]`; a new Task without a `status` value or template entry gets the first option whose state is Open.
3. **D-504:** with `TEGG_TEST=1`, `TEGG_NOW=<ISO 8601 with offset>` fixes the clock: the Rust side reads it for `now`, and the UI gets `window.__TEGG_NOW__` (the `__TEGG_TZ__` mechanism) and offsets `Date.now()` from it. L6 tests set it to the ACs' test clock.
4. **D-505:** `tasks.summary` is `{open} · {overdue} · {today}`, built from the plural messages `tasks.summary.open` (`{count} open`), `tasks.summary.overdue` (`{count} overdue`), `tasks.summary.today` (`{count} due today`).
5. **D-506:** `TaskChange` stays without `now` for priority, due and tags; `write.ts` applies `touchModified(before, after, now)` after every change, the status change included.
6. **D-507:** the FR-DLY-04 AC-9 order is the core's; no TypeScript daily order function.
7. **D-508:** Kanban tag columns: `id = '#' + key`, `label = '#' + spelling`.
8. **D-509 DOM hooks (§6.2):** card `data-status` (raw value), `data-priority` (raw value); due chip `data-due` (the raw value) and `data-tone` (`overdue` | `today` | `plain` | `invalid` | `done`); column dot `data-color`; the attribute panel's Due row `data-overdue`; an overdue chip's accessible name ends with `, overdue`; the 30 s day check re-reads `__TEGG_TZ__` (the test hook for a zone change).
9. **D-510:** fake core `writeControl({ delayMs?, fail?, hold?, path? })` applies to `note_write`, `note_create` (both paths) and `type_patch`; with `path`, only writes to that path are affected.
10. **D-511 (T2):** `app/src-tauri` maps `OptionDto.state` to `OptionDef.extra` `state` and back, so `updateAttribute { options }` keeps every option's `state`. Regression test `bug_5a_fr_tsk_02_option_state_kept` in the build.
11. **D-512:** `app/test/fake_schema_ops.contract.test.ts` (run by vitest, not an AC test) checks `fake-schema.ts` against `ops-5a.json`.
12. **D-513:** mark `task-moved` (`perf_mark`, once per Kanban move after the card shows in its target column); `perf_tasks.ts` reports it. 60 fps scrolling is a manual check in MS8.
13. **D-514:** FR-TSK-11 AC-4's test is in the 5A-2 red commit.

## 10a. Interface details settled while building 5A-1 (no owner decision needed)

1. **D-328 exclusion** (§2.3): `daily_context` leaves out of Created and Modified the tasks `daily_tasks` lists as due on the date or completed in the window; overdue rows depend on today, which `daily_context` doesn't receive, and stay in Created/Modified.
2. **Index** (§2.1): `tegg-index` stores the content hash and a UTF-8 flag per note (index schema 5, a rebuild) and answers `note_state(path)` with the version, the flag and the plain-text excerpt, so `tasks()` reads no file.
3. **Opening a source at the embed** (D-486): the route option `selectEmbedOf: <task path>` on `note/<path>`; `NotePage` resolves the top-level block embeds of the note and selects the first one resolving to that path (`EditorPaneApi.embedBlocks`, `selectBlockAtTop`), else places the caret at the top. The Tasks page, the Daily Note rows (`tasks/sourceNav.ts`) and the properties panel's Source chip use it.
4. **Schedule stays put**: a task completed or changed from the Schedule keeps its place (with its new values) until the page is left, so the focus and a second click stay on it (FR-TSK-02 AC-10, FR-TSK-04 AC-10). The Kanban and the Daily Note move cards at once.
5. **Palette vs sidebar** (D-481): `Go to Tasks` opens `tasks`; the sidebar entry opens the last view.
6a. **Panel Status on a Task** (D-472): picking a status in the properties panel goes through `applyTaskChange` (sets or removes `completed`); the Status list of a Task has no `Clear` (a missing status counts as Open, D-471, and would keep `completed`).
6b. **Queued writes** (§5): `write.ts` keeps, per file, the chain of versions this window's own writes went through; a queued action whose row is any version of the chain, while the file is at its end, is based on them. An outside write breaks the chain, so it is still a conflict (NFR-REL-02).
6c. **Tag moves** (D-478): the `tags:` entry is edited in place (untouched items keep their bytes) only when the result reads back as the intended tags; otherwise the entry is re-rendered.
6. **Module name**: the quick-add component is `tasks/QuickAddRow.tsx` (`quickAdd.ts` is the parser; the two can't differ only in case on macOS).

## 11. Slice 5A-2: conversion and the Task card (D-490…D-499)

- **Status:** accepted, 2026-10-18. Written for the 5A-2 red tests; 4F is on `main` (PR #46) and `ms4-embeds.md` is final. The points of §11.10 are decided as D-524…D-538 (BRD v1.71) and override the text above them where they differ. §12 (5A-1 preview feedback, D-516…D-523) applies to 5A-2 too.
- **ACs:** [docs/acceptance/conversion.md](../acceptance/conversion.md) (FR-CNV-01 AC-1…AC-8, FR-CNV-02 AC-1…AC-7, FR-CNV-03 AC-1…AC-11, FR-CNV-04 AC-1…AC-3, FR-CNV-05 AC-1…AC-10, FR-CNV-06 AC-1…AC-5, FR-CNV-08 AC-1…AC-6, FR-FMT-07 AC-20, FR-SYN-06 AC-23) with tables R50…R54, and tasks.md FR-TSK-11 AC-4 (D-514). Where this section and the ACs disagree, the ACs win.
- **Builds on** §1…§10 above, [ms4-embeds.md](ms4-embeds.md) (§2 helpers, §5 tree, §6 rendering, §7 editor, §8 fake core), [ms4-links.md](ms4-links.md) (§1 resolution, D-184 link text) and ms3-shell §13 (editor, autosave, conflicts) and §14.7.1 (the one creation path).
- **No job, no restore point** (conversion.md intro): a conversion is `note_create` for the new object, then the source note's ordinary save. Undo adds at most one delete or trash of that new file (D-492).
- Stubs as in the intro (TS-I1): every new function exists, compiles and returns a wrong result until built.

### 11.1 Text helpers (`@tegg/doc`, new `packages/doc/src/convert.ts`, exported from the index; D-490, D-491, D-495)

All offsets are UTF-16 indexes into the whole file text (frontmatter included), as `embedSection`.

```ts
/** The unit a selection converts (R51, D-490, D-493). `selFrom`/`selTo` are offsets into `text` (a caret: equal).
 *  Extends to whole blocks; inside a quote or callout to the whole quote or callout; inside a top-level list to the
 *  whole top-level items it touches (with their nested items); a selection inside one nested item only → that item
 *  (with its own children). Null: in the frontmatter, or no block (blank lines only). */
export type ConvertUnit = {
  kind: 'blocks' | 'items' | 'nested-item'
  from: number                // start of the unit's first line
  to: number                  // end of its last line, without the line break
  count: number               // R50 summary: top-level blocks, or items of the run (nested children not counted)
  first: 'paragraph' | 'heading' | 'item' | 'quote' | 'callout' | 'other'
  checked: boolean | null     // the first item's `[x]` / `[ ]`; null when it isn't a checklist item
}
export function conversionUnit(text: string, selFrom: number, selTo: number): ConvertUnit | null

/** R51 and D-491: the new object's title, tags and body from the unit. `linkTitle(target)` gives the title of a
 *  wikilink target as resolved from the host (null: unresolved, then the target as written is used). */
export function objectFromUnit(text: string, unit: ConvertUnit, linkTitle: (target: string) => string | null): {
  title: string               // plain text of the first line, NFC, trimmed; '' when the first block has no text
  tags: string[]              // trailing `#tag` tokens of the first line, without `#`, NFC, in order, unique by tagKey
  body: string                // canonical: `\n` line ends, NFC, ends with one `\n` or is ''
  checked: boolean | null     // = unit.checked
}

/** R51 "Embed in the source" (D-490): the host text with the unit replaced by the embed paragraph `![[target]]`
 *  (or `<indent>- ![[target]]` for a nested item), blank-line separated, lists split around it (numbers kept). The
 *  host's line ending (CRLF when the file uses CRLF), BOM and final-newline state are kept; other bytes unchanged.
 *  `embedFrom` / `embedTo`: the offsets of the inserted embed line in the result. */
export function replaceUnitWithEmbed(text: string, unit: ConvertUnit, target: string): { text: string; embedFrom: number; embedTo: number }
```

- `objectFromUnit` doesn't know the title the user typed in R50: the app passes R50's title to `newObject`; the body is the same either way (FR-CNV-02 AC-6).
- These three functions are the only place that decides R51; the editor (§11.3), the L1 tests and the L2 property use them.

### 11.2 New object bytes (D-232, D-495)

- `newObject` gains `body?: string`: when given, it is the body after the frontmatter and the template's body is **not** used (the template's frontmatter entries still apply; D-524).
- The app builds the conversion's values (`newObject` `values`, §5): `tags` (when `objectFromUnit` gave any) and `source: { link: <source link text> }`; for a Task from a checked item, `status` = the first Done-state option and `completed` = `localIso(now)` (D-495); for an unchecked item or no item, the D-503 default. Other types never get a check state.
- **Source link text** (FR-CNV-04 AC-1, D-527: with `|title` when the title differs from the written target, e.g. `"[[Quick Notes/Dvojník|Dvojník]]"`): `linkText({ path: source, title: sourceTitle, fromPath: <type folder>/<planned stem>.md, stemResolves })`, `stemResolves` from `link_resolve(<that from path>, [sourceStem])` returning the source. A Daily Note source is `[[YYYY-MM-DD]]` (D-162). The from path is a planned path (the type's folder from `type_get` and the sanitized title); `link_resolve` doesn't need it to exist.
- **Embed target** (FR-CNV-03 AC-5, AC-11): after `note_create` returns the path actually written, `embedTarget({ path, title, fromPath: source, stemResolves })` with `stemResolves` from `link_resolve(source, [newStem])` returning that path. The planned stem is never used for the embed.

### 11.3 `@tegg/editor` additions

```ts
export interface TeggEditor {
  // …existing
  /** §11.1 `conversionUnit` for the current caret, text selection or block selection, or null. Null as well inside
   *  an embed's own content, in the title field, and when the editor is read-only or `options.convertible` is false. */
  conversionUnit(): ConvertUnit | null
  commands: {
    // …existing
    /** D-490, D-492: replaces `unit` (as computed on the current text) by `replaceUnitWithEmbed(text, unit, target)`
     *  as ONE undo step tagged with `record`, selects the new embed as a block (FR-CNV-01 AC-7), and returns its pos.
     *  Afterwards `text()` equals the helper's result byte for byte. False (nothing changed) if the text moved on. */
    convertUnit(unit: ConvertUnit, target: string, record: ConversionRecord): number | false
  }
}
export type ConversionRecord = { path: string; created: string /* the bytes note_create wrote */; type: string; title: string }

export interface EditorOptions {
  // …existing
  /** D-494: false in `_templates/` notes and nested embed editors; `conversionUnit()` is then null. Default true. */
  convertible?: boolean
  /** D-492: undo / redo of a conversion step. `afterUndo` runs after the undo applied (the app flushes the save,
   *  then deletes or trashes the file). `beforeRedo` runs before the redo applies: the app recreates the file and
   *  returns the embed target to write (it may differ, FR-CNV-06 AC-2), or false to cancel the redo (nothing changes).
   *  Only the step `convertUnit` made is a conversion step; the rewrite of the target joins the redo step. */
  conversion?: { afterUndo(r: ConversionRecord): void; beforeRedo(r: ConversionRecord): Promise<string | false> }
  /** D-496: called before a user action removes block embeds (⌫, Delete, block menu Delete, ⌘X, typing or pasting over
   *  a selection). Never for moves, undo, redo or `convertUnit`. Return null to remove at once; a promise defers the
   *  removal, which then happens (as one undo step, the typed or pasted text included) only if it resolves true. */
  guardEmbedRemoval?(embeds: { pos: number; source: string }[]): Promise<boolean> | null
}
```

- Undo scope stays D-178: the history belongs to the editor instance; leaving the note or an external reload drops it, so no conversion record survives (FR-CNV-06 AC-4).
- `slash.ts`: `task` and `turnIntoObject` built (no `due`), matched like the other items (`/turn`, `/task`).

### 11.4 The flow (`app/ui/src/convert/`)

| Module | What it is |
| --- | --- |
| `ConvertPopover.tsx` | R50: `dialog` `Turn into object`, Title textbox (selected), `Type` radiogroup (Page, Task, Quick Note, user types in D-122 order; ↑/↓ and first letter), summary (plural messages), `Convert` / `Cancel`. Esc and Cancel return focus to where it was; a typed `/turn` or `/task` is removed on close either way. |
| `convert.ts` | `convertSelection(editor, page, opts: { preselect: 'task' \| 'last' })`: unit → `link_resolve` for link titles → popover → `prepareObject(type).create(title, values)` with `body` (§11.2; one creation path, D-245) → on success `link_resolve` for the embed target → `editor.commands.convertUnit` → `page.flushSave()` at once (not the 1 s autosave, AC-6). On a failed create: the `convert.failed` alert, nothing else. A source save failure or `Conflict` follows editor.md's rules; the new file stays. A virtual Daily Note's flush is its first write (`daily_create`). Writes `UiStateDto.convert.lastType`. |
| `undo.ts` | `afterUndo`: flush the source save, then `note_read(path)`: missing → nothing (AC-5); text equal to `created` → `note_discard(path, version)`; else (or `Conflict` from discard) → `note_trash(path, version)` and the `convert.trashedOnUndo` alert. `beforeRedo`: `note_create_exact(path, created)`; `Exists` → `note_create(type, title, created)` (next free stem, same `id`); then the embed target as in §11.2. |
| `removeGuard.ts` | `guardEmbedRemoval`: null when `convert.skipRemoveConfirm` is set or none of the embeds is a converted object; a converted object is a resolved target whose frontmatter `source` resolves (`link_resolve` from the target) to the host path. Else the `alertdialog` (one for several, plural message); `Don't ask again` sets `convert.skipRemoveConfirm`. |

- **Availability (D-494):** the commands and menu items are enabled only when the note page's editor has focus and `conversionUnit()` isn't null; otherwise aria-disabled with `convert.readOnly` (read view, read-only file), `convert.inEmbed` (focus in a nested editor), `convert.inTemplate` (`_templates/`). Off note routes they aren't run.
- **Commands** (R53, section `edit`, `needsVault: true`): `edit.turnIntoTask` (⇧⌘T, `Turn into task`) and `edit.turnIntoObject` (⇧⌘O, `Turn into object…`). The block menu and the formatting toolbar's `Turn into object` call `edit.turnIntoObject`.
- **Registry:** R6 `task` and `turnIntoObject` built (`FR-TSK-01, FR-CNV-01`, `FR-CNV-01`); R3 `ctl.turnIntoObject` built. The `AC-Test-Change` of D-499 goes in the 5A-2 build commit.
- **Strings:** R54 keys in `app/ui/src/i18n/en.json`; summary and removal messages use plural forms.
- **Remembered state:** `UiStateDto.convert = { lastType: string | null; skipRemoveConfirm: boolean }` (machine-local, D-128; default `{ null, false }`, first-time preselection Task).
- **Source chip** (FR-CNV-04 AC-2): unchanged from §10a item 3 (`selectEmbedOf`).

### 11.5 The Task card (`app/ui/src/embeds/TaskEmbed.tsx`, D-497)

- `Embed.tsx` renders `TaskEmbed` for a block embed with mode `card` whose target's matched type is `task`; `|full` and `|link` keep the 4F frames. The frame is R30's with `data-embed-mode="card"` and `data-task-card`; no preview strip.
- **Header** (D-531: `Embed` keeps its 4F props; the defs come from `task_list`, cached per page): derived by `taskHeader(text, defs)` (new `app/ui/src/tasks/header.ts`, pure: the §2.1 fields `title`, `status`, `state`, `statusKnown`, `priority`, `dueRaw`, `due`, `completed` from the file text, the same rules as `fake-tasks.ts`, which reuses it) with `defs` from `task_list` (cached per page, refreshed on `vault:changed` of a type file). Controls: the R43 checkbox, title text (no `contenteditable`), `Status: …`, `Priority: …`, `Due: …` (the panel's date control: textbox `Due date` and `Clear`, D-537; the name ends with `, overdue` when overdue), `Open …`, `Display as`. DOM hooks as D-509 (`data-status`, `data-priority`, `data-due`, `data-tone`).
- **Writes:** through `tasks/write.ts` (§5) with the card's version as the row version; one write per change; equal values write nothing. The page's `EmbedStore` keeps one version per path: after a write every card and nested editor of that path gets the new text and version (`peerWrote`), so a second card writes with the first write's result as base (FR-CNV-05 AC-8). `Conflict` → reload the card and the tasks.md FR-TSK-02 AC-11 alert.
- **Body:** a nested editor (`EmbedEditor`) on the whole task file, `section: null`, `convertible: false`, with `emptyHint: 'task.addDetails'` (new `EditorOptions.emptyHint?: string`: shown in an empty first paragraph, never saved, no write on focus).
- **Read-only** (R52): read view, depth ≥ 2, and `readOnly` targets (not UTF-8, invalid frontmatter): controls aria-disabled with `This task can't be edited here.`, body `data-embed-editable="false"`.
- `embeds/tree.ts` is unchanged: a Task card is a card node; only rendering differs.

### 11.6 Core and IPC

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `note_discard` | `path`, `base` | `void` | New (D-492). Deletes the file (no trash) only when its current version equals `base`; `Conflict` otherwise, `NotFound` when absent. Only Markdown files outside `.tegg/`, `_templates/` and `.trash/`. Core: `Core::discard_note(path, &FileVersion)`. |
| `note_create` | unchanged | | Refuses `daily-note` with `UseDailyNote` (exists, D-318; FR-CNV-01 AC-6). |
| `note_create_exact`, `note_trash`, `note_read`, `note_write`, `link_resolve`, `daily_create` | unchanged | | Composed by §11.4. |
| `ui_state_get` / `ui_state_set` | unchanged | | `UiStateDto.convert` added. |

- **Kill points (FR-CNV-03 AC-7)**, only with `TEGG_TEST=1`: `TEGG_TEST_HOLD=after-create` makes the next `note_create` write and index its file, emit the perf mark `hold:after-create`, and then block forever; `TEGG_TEST_HOLD=during-source-save:<vault path>` makes the next atomic write of that path write its temp file, emit `hold:during-source-save`, and block before the rename. The L6 test waits for the mark and sends `SIGKILL`.

### 11.7 Fake core additions

- `note_discard` over the in-memory files with the same version check; counted by `writes()` as a write of that path (kind `discard`), and `note_trash` likewise (kind `trash`).
- `UiStateDto.convert` kept in memory. `writeControl` (D-510) applies to `note_discard` too.
- `link_resolve` from a path that doesn't exist resolves from its folder as the core does (§11.2).

### 11.8 Test layout

- **L1:** `packages/doc/test/convert.ac.test.ts` (§11.1, §11.2 bytes: R51, FR-CNV-02 AC-1…AC-5, AC-7, FR-CNV-03 AC-1 bytes, AC-2…AC-4, AC-9, FR-CNV-04 AC-1 text); `packages/editor/test/convert.ac.test.ts` (§11.3: units from selections FR-CNV-01 AC-4, `convertUnit` bytes and one undo step FR-CNV-06 AC-1 transaction, `convertible`, `guardEmbedRemoval` calls FR-CNV-08 AC-5, the slash items); `app/test/convert_registry.ac.test.ts` (R53, R54, FR-CNV-01 AC-8 L1); `app/test/task_embed.ac.test.ts` (R52 roles and names, FR-CNV-05 AC-1 L1, AC-3 bytes, `taskHeader`).
- **L2:** `app/test/convert_property.ac.test.ts` (fast-check, FR-FMT-07 AC-20, on `@tegg/doc`, `@tegg/editor` and the fake core).
- **L4:** `crates/tegg-core/tests/ac_convert.rs`: FR-CNV-01 AC-6 refusal, FR-CNV-02 AC-7 file name, FR-CNV-03 AC-1 write, AC-5, AC-6 create failure, AC-10 daily create, AC-11; FR-CNV-04 AC-1 resolution, AC-3; FR-CNV-05 AC-7 base check; FR-CNV-06 AC-2 create exact, AC-3 trash; `note_discard`.
- **L5:** `app/webkit/convert.ac.test.ts` (FR-CNV-01, FR-CNV-02, FR-CNV-03 AC-1…AC-6, AC-9…AC-11, FR-CNV-04 AC-2, AC-3, tasks.md FR-TSK-11 AC-4), `convert_undo.ac.test.ts` (FR-CNV-06), `convert_remove.ac.test.ts` (FR-CNV-08 AC-1…AC-5), `task_embed_card.ac.test.ts` (FR-CNV-05), `convert_writes.ac.test.ts` (FR-SYN-06 AC-23), with `app/webkit/convert-helpers.ts`. FR-CNV-08 AC-6 is `[MS6]`: written with 6A, not now. FR-CNV-01 AC-6's refusal, FR-CNV-03 AC-6's failed create and FR-CNV-05 AC-7's base check have no new L4 test (D-529: already built; `ac_daily.rs`, `ac_tasks.rs` and L5 cover them). The L2 property counts writes as the record's create plus the host's saves (D-530); per-path IPC counts are L5.
- **L6:** `app/e2e/ms5_convert.ac.test.ts`: FR-CNV-03 AC-7 (kill cycles, milestone gate, `TEGG_KILL_CYCLES`), AC-8; FR-CNV-05 AC-2 (once), AC-5; FR-CNV-08 AC-2 (relaunch), AC-4 (once); FR-SYN-06 AC-23. Exact `modified` stays L5 (AP-345 rule, D-504 `TEGG_NOW` where set).
- **Fixture:** the conversion.md notes added to `tests/fixtures/vaults/tasks/` byte-exact (NFD host in NFD, CRLF host with CRLF and no final newline), README updated, in its own commit before the tests. tasks.md's expected views don't change (the new files hold no task).

### 11.9 Contract choices (no owner decision needed)

1. One text engine (D-82): the editor applies the result of `replaceUnitWithEmbed`, so the bytes are decided in `@tegg/doc` and tested without an editor.
2. Create, then save the source; undo saves the source, then deletes; redo creates, then changes the source. In every order a crash leaves at worst an orphan object, never an embed of a missing file (D-498).
3. A hard delete exists only as `note_discard` with a base: a file whose bytes changed since its creation is never deleted, only trashed (D-492, NFR-REL-02).
4. The Task card's header is computed in TypeScript from the file text the embed already loaded, so a card needs no extra IPC per embed (FR-EMB-02 AC-12's one `embed_load` per level).

### 11.10 Points for the owner (AP-452…AP-466, accepted as recommended 2026-10-18: D-524…D-538)

AP-452…AP-454 came with this contract, AP-455…AP-460 from the L1/L2/L4 red run, AP-461…AP-466 from the L5/L6 red run. Each is decided as its recommendation (AP-452 → D-524 … AP-466 → D-538).

| # | Issue | Recommendation | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| AP-452 → D-524 | **The target type's template.** R51 defines the body from the blocks; conversion.md doesn't say what happens when the chosen type has a template (FR-TYP-11) with its own body and attributes. | The template's frontmatter entries apply as for any new object; its body is not used (the converted blocks are the body). | (b) Template body first, then the converted blocks. (c) Ignore the template entirely. | §11.2, FR-CNV-03 AC-1 |
| AP-453 → D-525 | **Summary count for list items.** R50's `<n> blocks` for a run of list items (and for a nested item). | Each top-level item of the run counts as one block (nested children not counted); a nested item alone is `1 block`. | (b) Count the list as one block. | R50, FR-CNV-01 AC-4 |
| AP-454 → D-526 | **Tags from the first line when the user edits the title.** D-491 moves trailing `#tags` to `tags:`; FR-CNV-02 AC-6 lets the user change the title. | Tags come from the first line regardless of the edited title (shown nowhere in R50; they are in the new object's `tags:`). | (b) Drop them when the title was edited. | FR-CNV-02 AC-3, AC-6 |
| AP-455 → D-527 | **Dvojník (Quick Notes) source text.** FR-CNV-04 AC-1 wrote `"[[Quick Notes/Dvojník]]"`; §11.2 uses `linkText`, which adds `|Dvojník` to a path target. | Follow `linkText` (D-184): `"[[Quick Notes/Dvojník|Dvojník]]"`; the AC and its L1 test change (`AC-Test-Change`). | (b) A source-link rule without the alias. | FR-CNV-04 AC-1, §11.2 |
| AP-456 → D-528 | **Selections mixing blocks and list items.** | Whole top-level blocks: the whole list (kind `blocks`). | (b) The blocks plus only the touched items, splitting the list. | §11.1, FR-CNV-01 AC-4 |
| AP-457 → D-529 | **L4 checks of behaviour already built can't be red** (FR-CNV-01 AC-6, FR-CNV-03 AC-6, FR-CNV-05 AC-7). | No new L4 test; existing `ac_daily.rs`, `ac_tasks.rs` `fr_tsk_02_ac11` and the L5 tests cover them. | (b) A check-red exemption. (c) Tests in existing AC files. | §11.8 |
| AP-458 → D-530 | **L2 "with the fake core"**: `installFakeCore` needs a page. | The property counts the record's create plus the host's saves; per-path IPC counts at L5. | (b) Fake-core handlers in a Node-loadable module. | FR-FMT-07 AC-20 |
| AP-459 → D-531 | **Task card data at L1.** | `Embed` props unchanged; defs via `task_list` (page cache); `taskHeader` returns TaskRowDto-named fields. | — | §11.5 |
| AP-460 → D-532 | **Small R51 details**: nested-item embed range, a callout's custom title, `emptyHint` rendering. | The range covers `<indent>- ![[…]]`; the callout body starts with its `> [!type]` line verbatim (a custom title stays there); `emptyHint` is a muted placeholder, never in the text. | — | §11.1, §11.5, R51 |
| AP-461 → D-533 | **`/turn` right after `.`**: the slash menu opens only at block start or after a space (FR-EDT-03 AC-1). | FR-CNV-01 AC-2 types ` /turn`; Esc removes `/turn` only (AP-348 rule). | (b) Open after punctuation. (c) Esc removes the space too. | FR-CNV-01 AC-2 |
| AP-462 → D-534 | **Task card of a T01 copy with invalid frontmatter**: its type may be unknown. | The invalid-UTF-8 copy is the strict read-only check; for invalid frontmatter a Task card, if shown, is read-only and never written. | (b) Read `type` line by line. (c) Drop the variant. | FR-CNV-05 AC-9 |
| AP-463 → D-535 | **Opening a `_templates/` note at L5.** | The note route opens template files in the editor with `convertible: false`; L5 uses the route hook. | (b) Test only at L1. | FR-CNV-01 AC-5, D-494 |
| AP-464 → D-536 | **Temp-file cleanup after a kill** only removes files older than 1 minute (FR-SYN-02 AC-4). | The L6 test backdates leftovers by 2 minutes before restarting. | (b) Wait 61 s per cycle. (c) A test-only cleanup age. | FR-CNV-03 AC-7 |
| AP-465 → D-537 | **Card Due control names.** | Textbox `Due date` and `Clear` (the panel's date control); the `Due: …` name may end with `, overdue` (D-509). | (b) A dedicated popover. | §11.5, FR-CNV-05 AC-1, AC-3 |
| AP-466 → D-538 | **R50 and FR-UX-03 AC-8; the summary's `{type}`.** | R50's buttons and radios carry `data-command`; `{type}` is the type's Name as written. | (b) Exempt dialog controls. (c) Lower-case type name. | R50, R54, FR-CNV-01 AC-4, AC-7 |

## 12. Slice 5A-1 preview feedback (D-516…D-523)

### 12.1 Tasks views, header, tag filter, Type settings (D-516…D-519)

- `type/task` renders `tasks/AllTasks.tsx`: `TypePage` with a `header` prop (the Tasks header, `tasks/TasksHeader.tsx`); with a header the type page shows no view tab of its own. Every other `type/<key>` is unchanged.
- `TasksUiDto.view` takes `schedule` | `kanban` | `all`; the sidebar entry `Tasks` opens the route of the stored view. Kanban by tag orders its columns by tag name (R42, D-122) in both cases, not by the filter's counts; with a selection, one column per selected key. The sidebar receives `typeEntries(…)` without `task`; `typeEntries` itself (and so `Go to type: Tasks`) is unchanged.
- The tablist's tabs carry `data-command` `tasks.schedule`, `tasks.kanban`, `goto.type:task`.
- `Type settings` is `shell/TypeSettingsButton.tsx` (`data-command="type.openSettings"`, `aria-label` and `title` `Type settings`, icon `sliders`).
- The tag filter is `tasks/TagFilter.tsx`: the `combobox` is the text field (`role="combobox"`, `aria-controls` the listbox, `aria-activedescendant` the highlighted option); options are named `#<label>` with the count as `aria-describedby`; chips and options carry `data-tag`. Bucketing rules: §4.

### 12.2 New objects open unsaved (D-520…D-523)

**Decisions.** AP-449 → D-521, AP-450 → D-522, AP-451 → D-523 (owner, 2026-10-18; BRD v1.70).

- **Entry points.** ⌘N / `New object` (the vault's default type, D-131), a type page's `New <Name>` and the palette's `New <Name>` open the draft route `new/<type>` (param: the type key, NFC). Exceptions: Daily Note → `createToday()` (D-318, D-353, unchanged); Task → `tasks` or `tasks/kanban` (the last of the two shown, else `tasks`) with the caret in the quick-add field `Add a task…` and nothing else focused or written. The switcher's create item, a broken link's Create offer, `[[`/`@` and relation-picker creates keep their typed title and write at once (D-367). The `New object` dialog (`shell/NewObjectDialog.tsx`) is removed.
- **Opening a draft.** The route calls `prepareObject(key)` (§ms3-shell 14.7.1) and renders the bytes with `@tegg/doc` `newObject` and the title `""` (template, defaults and `review` as D-232), stamped with the open time. The note page opens on these bytes as on a virtual Daily Note (ms4-daily §4.1): no read, no write, the editor's original is the draft so it isn't dirty, the `Title` field is empty and in edit mode with the caret in it (D-367), and the status `Not saved yet` (`newObject.notSaved`) shows under the title. The page's `path` is the planned `<folder>/<sanitized "Untitled">.md`; it is never read or written while the note is a draft, and `vault:changed` for it is ignored (D-326 rule).
- **When the first write happens (D-522).** Typing in the title writes nothing. The first write is sent on the title's commit (↩, Tab, ↓ or leaving the field) with a non-empty title, or on the first body or property change (autosave's debounce, ms3-shell §13), or on a flush (leaving the route, quitting, ⌘S). A draft left without any change writes nothing; a title typed and then cleared writes nothing.
- **The first write.** Autosave's `create` hook (as a virtual Daily Note) sends `note_create(type, title, text)` through the one creation path (D-232, D-245): `text` is the editor's current text with `created:` and `modified:` restamped to the write time (`restampDraft`, ms4-daily §3) and, when the title is empty, `title: Untitled` (`newObject.untitled`, D-523); the editor and the title field take that title. The core names the file from the title (` (2)`… suffixes, FR-LNK-14). The UI then reads the new file's version (`note_read`) and later saves use `note_write`. The page stays mounted: the route becomes `note/<path>` the way a rename keeps the page (FR-FMT-08 AC-5), and the caret stays where it was. An `Io` failure keeps the draft with its text, shows the save alert, and the next change retries (as FR-DLY-02 AC-8).
- **History (D-521).** A draft is a history entry only while it is shown: after its first write the entry becomes `note/<path>` (`history.replace`); a navigation away from an unwritten draft replaces its entry, and Back from it removes the entry, so Back/Forward never return to `new/<type>`.
- **Registry.** `new/<type>` is a built route (FR-UX-02 R1 change) with no sidebar entry and no `Go to` command; its tab shows the type icon and `New <Name>` until the first write.
- **Fake core.** No new command: `note_create` and `note_read` exist.

### 12.3 Tests

- L1: `app/test/tasks_views.ac.test.ts` (all-of filter, `counts.tags`), `app/test/history.ac.test.ts` (draft entries).
- L5: `app/webkit/tasks_all_view.ac.test.ts` (FR-TSK-04 AC-15), `tasks_header.ac.test.ts` (AC-16), `tasks_schedule.ac.test.ts` (AC-5), and the D-520 changes of `create_object`, `caret_on_create`, `type_page`, `keyboard` and the other tests that used the `New object` dialog.
- L6: `app/e2e/ms3_shell.ac.test.ts` FR-NAV-01 AC-13 (a) and (b) through the draft.
