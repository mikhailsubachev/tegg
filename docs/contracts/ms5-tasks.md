# MS5 Tasks Interface Contract (slice 5A-1; 5A-2 conversion in §11)

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

`UiStateDto.tasks = { view: 'schedule' | 'kanban'; groupBy: 'status' | 'tag'; dateFilter: 'all' | 'today' | 'week'; tags: string[]; doneExpanded: boolean }`, written with `ui_state_set` on change (machine-local, never in the vault).

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

Written before the 5A-2 red tests, once 4F is on `main` and its embed contract (`ms4-embeds.md`) is final. It will cover: the `@tegg/doc` split and embed helpers (D-490, D-491), the editor conversion command and popover (D-493, D-494), the D-74 card node (D-497), the undo exception (D-492), the create-then-save order and its kill points (D-498), and the fake-core support.
