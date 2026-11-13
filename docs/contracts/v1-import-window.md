# Contract: the Import window (v1.0 slice I2, Capacities import)

- **Status:** decided, 2026-11-13. Written before the I2 red tests (D-61): the test author writes the L1, L5 and L6 tests of slice I2 from the criteria and this contract only. The owner's points `WP-1`…`WP-9` (§13) were accepted as recommended ("Approve all", 2026-11-13) as D-1571…D-1579, and the report's words of §11 as D-1580 (BRD v1.172); every rule that depended on a point cites its decision. **Revised after the QA review** (2026-11-13): the target `Core`'s lifetime, the vault identity, event forwarding on reattach and the routing of `job:transform` answers (§1.2), the error table, the quit question and the test pace; the four points that needed the owner were decided ("Accept all four") as D-1581…D-1584 (BRD v1.173): a missing default parent is created at `start` (D-1581, §2.3), FR-IMP-21 AC-5 expects `status · select` (D-1582), 4b's lower-case state words `import.state.*` (D-1583, §3.7, §5.2), the text of `import.quit.body` (D-1584, §5.2).
- **ACs:** [import-capacities.md](../acceptance/import-capacities.md), every criterion marked **I2** and the I2 half of the shared ones: R151 (frame), R152 (steps 0–7), R153 (error states; texts approved by D-1524), R154 (entry points), R155 (strings); FR-IMP-07 AC-10, AC-11; FR-IMP-22 AC-5, AC-6; FR-IMP-05 AC-9, AC-10; FR-IMP-19 AC-11, AC-12 (step part); FR-IMP-08 AC-13…AC-16; FR-IMP-10 AC-13; FR-IMP-21 AC-5; FR-IMP-20 AC-3; FR-HIS-04 AC-1 (default), AC-14; FR-UX-07 AC-14, AC-15, AC-16; FR-SYN-06 AC-45; FR-UX-03 AC-43, AC-44; FR-UX-08 AC-19, AC-20; FR-UX-05 AC-21; NFR-OTH-02 AC-18 (window part). Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests.
- **Decisions followed:** D-1517…D-1584, especially D-1519 (Start step), D-1520 (a target that isn't the open vault), D-1521 (tag collections), D-1525 (type matching), D-1527 (4a/4b rules), D-1528 (mapping in memory), D-1531 (a dialog, not a route), D-1532 ("mapped"), D-1536 (step 4c), D-1537 (new vault name and place), D-1539 (`Hide`, status, quitting), D-1540 (repeat warning), D-1542 (stepper), D-1544 (spaces, folder rows, `Images · PDFs`), D-1549 (6) (vault switch), D-1568 (FR-UX-07 AC-16 is I2), D-130 (unusable buttons stay focusable), D-133 (plurals), D-137 (commands without a vault).
- **Builds on** [v1-import.md](v1-import.md) (the engine; its DTOs are the real ones in `crates/tegg-import/src/dto.rs`, `lib.rs`, `run.rs`), [ms3-shell.md](ms3-shell.md) (IPC conventions, test hooks, the fake core, the catalog), [ms4-jobs.md](ms4-jobs.md) (job model, `job:progress`, the status element, interrupted jobs), [ms6-trash-media.md](ms6-trash-media.md) (`SystemTrash`, `TEGG_TEST_DROP`, `TEGG_TEST_SYSTEM_TRASH`). Everything there stays valid unless this contract changes it. v1-import §14 and §15 ("named, not specified") are replaced by this contract.
- **Board:** `design/edit-note-page/Import.dc.html`, section A only (roles and labels as drawn; its header texts are stale, AP-1312).

Until a part is implemented it exists as a stub that compiles and answers a deliberately wrong result (an empty scan, a plan with no types, `NoSession`), so a test fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Where the engine runs

### 1.1 One import session

The shell (`app/src-tauri/src/shellimport.rs`, new, registered next to `shellq`) holds **one** import session in `AppState` (D-1531: one window, one import at a time):

```rust
pub(crate) struct ImportSession {
    source_path: Option<PathBuf>,            // the chosen zip or folder
    scan: Option<Arc<tegg_import::Scan>>,    // the last successful scan
    plans: BTreeMap<u64, StoredPlan>,        // by plan token (§2.3); dropped with the scan, and all of them at `import_start` (§1.2)
    work: Option<Work>,                      // the running scan or plan: its CancelToken
    run: Option<RunState>,                   // the started import, until the window discards it
    memo: Arc<ScanMemo>,                     // import-scan answers of this scan (§1.3)
}
struct StoredPlan { plan: tegg_import::Plan, target: StoredTarget }
enum StoredTarget {
    NewVault { parent: PathBuf, name: String },
    Existing(Arc<tegg_core::Core>),          // a plan, or a run that is not final yet
    Released(PathBuf),                       // a final run's existing vault: its canonical root, no `Core` held (§1.2)
}
struct RunState { run: tegg_import::ImportRun, plan: Plan, target: StoredTarget, space: String, files: u64 /* ScanInfo.files */, last: Option<ImportProgress>, result: Option<ImportResultDto> }
```

- **Threads.** `import_scan` and `import_plan` run `tegg_import::scan` / `plan` on a blocking thread (`tauri::async_runtime::spawn_blocking`); the command returns when the call ends. The IPC thread is never blocked. `import_start` runs `tegg_import::start` there too; the run itself is the engine's job thread (v1-import §9).
- **One operation at a time.** A new `import_scan` cancels a running scan or plan (its call answers `Cancelled`) and drops the old scan and its plans. A new `import_plan` cancels a running plan (the older call answers `Cancelled`), so the latest request wins. While `run` is not in a final phase, `import_scan`, `import_plan`, `import_start` and `import_discard` answer `Busy`.
- **Nothing is written** by any command before `import_start` (FR-SYN-06 AC-45): no vault file, nothing at the new vault's place, nothing in Application Support. The session is memory only (D-1528).
- **`ImportEnv`** in the app: `clock` = `Utc::now()`, or with `TEGG_TEST=1` the clock fixed by `TEGG_NOW` (the instant it names plus the time since launch, as the UI's `TEGG_NOW`, D-504); `zone` = the zone the shell already gives the core (`TZ` under `TEGG_TEST`); `ids` = ULIDs; `transformer` = §1.3; `dirs` = the app's `AppDirs`; `disk` = `SystemDisk` (or §10's hook); `trash` = `shell6a::MacTrash` (honours `TEGG_TEST_SYSTEM_TRASH`); `strings` = the UI's `import.report.*` entries (§2.5); `points` = §10's hooks, `None` outside `TEGG_TEST`.

### 1.2 Targets and the open vault (D-1520, D-1549 (6))

- **New vault:** `Target::NewVault { parent, name }`. The run uses no `Core`; the open vault (if any) is not read or written.
- **This vault:** `Target::Existing(&core)` with the `Arc<Core>` that is open **when the plan is made**; the stored plan keeps that `Arc` (`StoredTarget::Existing`), and `import_start` uses that same `Core`.
- **Which `Arc<Core>`s the session holds, and how long (T1: two `Core`s on one vault would run two watchers, two job engines and two journals' views of one folder).**
  - **Plans.** A stored plan's `Arc` lives only while the window is on steps 3–5. `import_start` drops **every** stored plan (the started one moves into `RunState`), so after it the session holds at most the run's `Arc`. `open_vault` of another vault also drops every stored plan whose target is `Existing` (their tokens then answer `UnknownPlan`; the window plans again when it is shown).
  - **The run.** `RunState.target` holds the `Arc` while the run is not final. When the run reaches a final phase, the watcher thread emits `import:done` and then replaces it by `StoredTarget::Released(<canonical root>)` (the `Arc` is dropped there, on that thread, before the thread ends). `ImportResultDto.vault` and §3.11 work from the root path; no `Core` is held for a final run, so `import_discard` coming late (or never, while the window stays on step 7) keeps nothing open.
  - **One `Core` per vault root in the process.** `open_vault(path)` (lib.rs) first computes the requested vault's **identity** (below). If `AppState.core` already is that vault, it answers that `Core`'s fresh `VaultInfo` and opens nothing. Else, if the session holds an `Arc<Core>` with that identity (a run not final, or one whose `Released` swap is in progress: `open_vault` waits for the swap's drop to return, at most 5 s), it **reattaches** that `Core` (below). Only otherwise does it open a new `Core`. So `Open report` and `Open vault` (§3.11), the title-bar switcher and the recent list never open a second `Core` for a root the session holds, whether the run is final or not.
- **The identity of a vault** is the key its machine-local data is filed under: `Vault::open` canonicalizes the root (`std::fs::canonicalize`: symbolic links resolved) and `local_dir_for` (tegg-vault `lib.rs`) hashes that path; the file name of `vault().local_dir()` is `Host::vault_key()`, the folder the import's journal and the backups use (`tegg-jobs` `import_journal.rs` `journal_dir`, `tagjobs.rs`). `open_vault` compares that key, computed for the requested path in the same way, with the held `Core`'s; it does **not** compare NFC path strings. Because `canonicalize` doesn't promise the on-disk case of every component on a case-insensitive APFS volume, two roots whose folders have the same `(st_dev, st_ino)` are the same vault too (checked when the keys differ).
- **Keeping the target alive across a vault switch.** While a run into an existing vault is not final, the session holds its `Arc<Core>`. `open_vault` of another vault changes:
  - It drops `AppState.core` as today, but the import's `Arc` keeps the old `Core` alive, and its jobs, journal and watcher go on.
  - The **detached** core's forwarding thread (`forward_events`, one per `Core`, started once when the `Core` was opened) gains a **gate**. While closed, the thread drops `vault:changed`, `index:progress`, `note:conflict`, `query:stale` and `job:progress` of the detached core, so the newly opened vault's UI never receives them (the UI reloads its state on reattach from the fresh `VaultInfo`); it **holds back** `JobTransform` requests (below). The run's progress reaches the UI through `ImportRun::on_progress` → `import:progress` (§2.4), which doesn't go through the forwarding.
  - **The detached core's other jobs.** The job engine runs one job at a time, so while the import runs every other job of that `Core` waits in its queue; no command reaches the detached `Core` (every command uses `AppState.core`), so no new job is started on it. A `JobTransform` the detached core emits anyway (a job that was already running the transform when the import took the queue, or the tidy job, D-819) is **held** by the gate, unanswered, and emitted when the gate reopens; if the `Core` is released first, it is dropped and that job meets the engine's own transform timeout (ms4-jobs §2.2). **Routing answers.** `job_transform_result` today goes to `core(&state)`, which after a switch is the wrong `Core`, and two engines number their requests independently. So the forwarding thread gives every forwarded `job:transform` a process-wide `requestId` and records `requestId → (Weak<Core>, the core's own request id)`; `job_transform_result` looks the id up and answers that `Core` (a released one: the answer is dropped). An answer to an unknown id is ignored.
  - **Reattach** puts the same `Arc<Core>` back into `AppState.core`, builds a fresh `VaultInfo` (below), and **reopens the gate on the existing forwarding thread**: it never calls `Core::events()` again. (`Core::events()` replays the whole buffer since `open` to a new subscriber, `crates/tegg-core/src/lib.rs`; a second subscription would deliver every old `vault:changed`, `index:progress` and `job:progress` again, and a second forwarding thread would emit each later event twice.) Held `JobTransform`s are emitted then, in order.
  - **`VaultInfo.interrupted` and the running import.** `Jobs::interrupted()` lists the import journals in its `jobs/<vault key>/` folder (`import_journal::interrupted`), so a reattached vault, or a reload of the open one, would list the running import as interrupted and offer `Undo`. Changed in `tegg-jobs` `engine.rs` `Jobs::interrupted`: an import journal whose job is in this engine's state and not final is left out (the same test as `resolve_interrupted`'s `Busy` guard). `resolve_interrupted` keeps answering `Busy` for such a job; its guard asks only its own engine, which is enough **because** of the one-`Core`-per-root rule above: the engine that runs the import is the engine every `job_resolve_interrupted` for that root reaches. The shell adds no second check. A new test (`tegg-jobs`, non-AC) asserts both: a live import's journal isn't listed and can't be resolved.
- A run into a new vault holds no `Core`, so switching vaults touches nothing of it.

### 1.3 The transformer for imports (D-82, D-1551)

`plan` and the run need `@tegg/doc` (`import-scan`, `import-note`, `import-new`), also with no vault open. The shell's `ImportBridge` implements `tegg_jobs::Transformer` over the main window's existing transform worker, **independent of any `Core`**:

- Request: event `import:transform` `{ requestId, source, text, ops }` to the main window (the same payload as `job:transform`, without `live`). Answer: command `import_transform_result { requestId, result: TransformedDto }` (the `job_transform_result` shape, ms4-jobs §4). `app/ui/src/jobs/bridge.ts` answers both events through the same worker; it starts listening at app mount, with or without a vault.
- Timeout per request: 30 s → `TransformError::Timeout` (the engine's `Transform { reason: timeout }`).
- **Memo (contract choice §12 (3)).** `ScanMemo` caches the answer of every `import-scan` op by `(source path, BLAKE3 of the text)` for the life of the scan, so the second and later plans of one source (every mapping change, §3.5) send no `import-scan` request. `import-note` and `import-new` are never cached.

---

## 2. IPC

All commands are `async`. Errors are the shell's `IpcError { kind, message }` (ms3-shell §2) with one flattened extra, `import`: the engine's `ImportError` as it serializes (`{ "code": "noSpace", "needed": 230686720, "free": 104857600 }`, v1-import §11), present whenever the error came from the engine. `kind` is the engine variant's name in PascalCase (`NotCapacities`, `NoSpace`, `TargetChanged`, …), or one of the shell's own kinds: `NotASource`, `Busy`, `NoSession`, `UnknownPlan`, `NoVault`. The UI shows the catalog text of §5.3 for a kind and never `message`.

TS types are hand-written in `app/ui/src/ipc/import.ts` (as `pins.ts`), mirroring `crates/tegg-import/src/dto.rs` field by field (camelCase, the serde forms of v1-import §5.1); `ipc/client.ts` gains one function per command. A `u64` travels as a JSON number (every count and size the window shows is below 2^53; modification times are already strings, v1-import §5.1).

### 2.1 Commands

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `import_pick_source` | `kind: 'zip' \| 'folder'` | `string \| null` | The open dialog: `zip` a file dialog filtered to `.zip`, `folder` a folder dialog. `null` = cancelled. Test hooks §10.1. Reads nothing. |
| `import_scan` | `path: string` | `ScanInfo` | §2.2. Progress `import:progress` phase `reading`. Starts a new session scan (§1.1). |
| `import_cancel` | — | `{ stopped: 'scan' \| 'plan' \| 'run' \| 'nothing' }` | Cancels whatever runs: a scan or plan (`Control.cancel`; the call answers `Cancelled` within 1 s), or the run (`ImportRun::cancel`; error `NotCancellable` once `writing` began). |
| `import_where` | `space: string` | `WhereDto` | §2.3. The Where step's data. Read-only. |
| `import_check_target` | `parent: string`, `name: string` | `NewVaultDto` | §2.3. The new vault's name and place after `Change…` or an edit of the name. Read-only. |
| `import_plan` | `space: string`, `target: TargetArg`, `mapping: Mapping` | `PlanResultDto` | §2.3. Progress phase `planning`. Latest call wins. |
| `import_start` | `token: number`, `reportStrings: Record<string, string>` | `{ job: number }` | §2.5. Starts the stored plan `token`. The only command that writes. |
| `import_status` | — | `ImportStatusDto \| null` | §2.6. The run, for rebuilding the window or the status element (after a vault switch, a reload). |
| `import_discard` | — | — | Drops the scan, the plans, the memo and a final run. `Busy` while a run is not final. Called when the window closes on steps 0–5 and on step 7. |
| `import_transform_result` | `requestId: number`, `result: TransformedDto` | — | §1.3. |

Reused, unchanged: `vault_pick_dir` (the new vault's `Change…`, `TEGG_TEST_PICK_DIR`, D-135), `vault_open` (with §1.2's reattach rule; `Open vault`, `Open report`, D-1520 adds the vault to the recent list as every `vault_open` does), `vault_current`, `app_quit`.

### 2.2 `import_scan`

- `path` that is neither a folder nor a file whose name ends in `.zip` (ASCII case-insensitive) → `NotASource` **at once**, nothing read, no session change (FR-IMP-07 AC-10: such a drop does nothing).
- Otherwise `tegg_import::scan(path, env, ctl)`; the answer is the engine's `ScanInfo` (v1-import §3) unchanged. Errors: `NotCapacities`, `UnreadableArchive`, `EncryptedArchive`, `Empty`, `SourceGone`, `Cancelled`, `Busy`.

### 2.3 Where and plan

```ts
type NewVaultDto = {
  parent: string;            // absolute, NFC
  name: string;              // sanitized (tegg_format::sanitize_file_stem), NFC; '' when nothing valid is left
  path: string;              // `${parent}/${name}`
  display: string;           // `path` with the home folder shown as `~`
  problem: 'targetExists' | 'targetNotWritable' | 'targetInsideVault' | 'targetInsideSource' | 'invalidName' | null;
};
type WhereDto = {
  newVault: NewVaultDto;     // the proposal of D-1537 (below)
  current: { name: string; path: string; notes: number; alreadyImported: number } | null;   // null: no vault open
};
type TargetArg = { kind: 'newVault'; parent: string; name: string } | { kind: 'existing' };
type TargetTypeDto = {
  key: string; name: string; plural: string; system: boolean;
  attributes: { key: string; name: string; type: string }[];          // R10 type keys, in the type file's order
  statuses: { label: string; state: 'open' | 'in progress' | 'done' | 'cancelled' }[] | null;   // Task only
};
type PlanResultDto = {
  token: number;             // names the stored plan for `import_start`
  plan: Plan;                // the engine's Plan, serde form (v1-import §5.1), `stamps` included
  noSpace: { needed: number; free: number } | null;   // R153's `NoSpace`, decided at plan time (below)
  targetTypes: TargetTypeDto[];                      // the types the plan's target has now
};
```

- **The new vault's proposal (D-1537, FR-HIS-04 AC-14).** Name: the shell builds `Capacities · <space>` itself (a fixed Rust string, **not** the catalog's `import.where.newName`, so neither the UI language nor the pseudo-locale's `⟦ ⟧` can reach a folder name) and passes it through `sanitize_file_stem`. Place: the parent folder of the open vault; with no vault open, the parent of the first entry of `Vault::recent` that exists (D-1575); else `~/Documents/Tegg/`, **also when that folder doesn't exist** (D-1581: proposed as is; the engine creates that one missing level at `start`, below). When `<parent>/<name>` exists **at the time `import_where` is called**, the name is the first free `<name> (2)`, `(3)`… The proposal's `problem` is computed as for `import_check_target`. `NewVaultDto.name` is the **one source** of the name the window shows (§3.4) and sends back (`TargetArg.parent`, `.name`).
- **A missing parent (D-1581, amends D-1537, D-1575 and v1-import §5's `TargetNotWritable`).** A `<parent>` that doesn't exist is accepted when **its own parent** exists, is a folder and is writable (one missing level only, whatever the place: the default `~/Documents/Tegg/` and a typed or picked one alike); `problem` is then `null`. `plan` accepts it too; `start` creates that one folder (`create_dir`, not `create_dir_all`) after its checks, just before `<name>.tegg-importing` (v1-import §9.5 step 2), so nothing exists before `Import` is pressed (FR-SYN-06 AC-45 holds). **This engine change is part of the I2 build**: `tegg_vault::probe_new_vault` and the planner's `probe_new` (`crates/tegg-import/src/planner.rs`, which today refuses a missing parent with `TargetNotWritable`) change as v1-import §5 and §9.5 now say, with a test in `crates/tegg-import/tests/` (`d_1581_missing_parent_is_created_at_start`: `plan` accepts `<tmp>/Documents/Tegg` when only `<tmp>/Documents` exists, nothing is created by `plan`, `start` creates `Tegg/` and the vault in it; two missing levels are still `TargetNotWritable`).
- **`problem`** comes from the engine's read-only target check (`tegg_vault::probe_new_vault`, v1-import §5): `targetExists` (also for a leftover `.tegg-importing` folder that `plan` would refuse), `targetNotWritable`, `targetInsideVault`, `targetInsideSource` (against the session's source), and `invalidName` when the sanitized name is empty. `import_check_target` sanitizes the given name (the UI sends the field's text as typed) and answers the same structure.
- **`current`** (only with a vault open): its folder name and path; `notes` and `alreadyImported` are `PlanTarget::Existing.notes` and `Plan.already_imported` of a plan against the open vault with `Mapping::default()`, which `import_where` makes and **stores** (its token is reused by the first `import_plan` against `existing` with an empty mapping). While the open vault's first index build runs (`IndexNotReady`), `import_where` waits for it (up to 60 s, then `IndexNotReady`); the UI shows the step busy meanwhile (§3.4).
- **`import_plan`** calls `tegg_import::plan` with the session's scan, `space`, the target (`existing` = the vault open now; `NoVault` when none) and `mapping` (the **given** mapping, partial, §3.5). The answer's `plan.mapping` is the effective mapping.
- **`NoSpace` at plan time (R153, contract choice §12 (4)).** The engine answers `NoSpace` instead of a plan, but the window still needs the plan for steps 4a–5. So when the engine answers `NoSpace { needed, free }`, the shell plans again with a `Disk` that reports unlimited free space and returns that plan with `noSpace: { needed, free }`; the stored plan carries the flag, and `import_start` with it answers `NoSpace` (the engine checks again anyway). The window shows the alert on step 5 and keeps `Import` disabled.
- **`targetTypes`:** for `existing`, every valid type file of the open vault (`tegg-schema`, as `type_get` reads them); for `newVault`, the seven system types of `tests/fixtures/vaults/new-empty/.tegg/` as `Vault::create` writes them. The window needs them for 4a's menu (D-1527 (6)), 4b's targets and the Task statuses (D-1527 (3)).
- Errors: `UnknownSpace`, `InvalidMapping` (with `import.entry`, `import.reason`), `TargetExists`, `TargetNotWritable`, `TargetInsideVault`, `TargetInsideSource`, `SourceChanged`, `SourceGone`, `IndexNotReady`, `Transform`, `Cancelled`, `NoSession`, `NoVault`, `Busy`.

### 2.4 Events

| Event | Payload | When |
| --- | --- | --- |
| `import:progress` | `ImportProgressDto` = the engine's `ImportProgress` (v1-import §10.1: `phase`, `step`, `done`, `total`, `stepDone`, `stepTotal`, `counts`, `job`) plus `queued: boolean` | every engine progress event of the scan, the plan (`Control.progress`) and the run (`ImportRun::on_progress`), at least every 500 ms; and, for an existing-vault run waiting in the queue, the shell sends `{ phase: 'planning', done: 0, total: 0, queued: true, … }` on each `JobProgress` with `phase: queued` **whose `job` is the import's job id** (the engine sends no `ImportProgress` there, v1-import §5.1). That `JobProgress` is taken in the target `Core`'s one forwarding thread (§1.2), before its gate, never from a new `Core::events()` subscription (which would replay old events); a `queued` event that arrives while `import_start` hasn't returned the id yet is held and matched once it has |
| `import:done` | `ImportResultDto` (§2.6) | once, when the run reaches `done`, `cancelled` or `failed` |
| `import:transform` | `{ requestId, source, text, ops }` | §1.3 |
| `import:open` | — | the app menu's `File › Import…` (§4.1) |

`job:progress` with `kind: "import"` (an existing-vault run, ms4-jobs §4) is still emitted while the target is the open vault; the UI's job store (`jobs/jobs.ts`) **ignores** `kind: "import"`: the import's status is §6's, driven by `import:progress`.

### 2.5 `import_start`

- Uses the stored plan `token` and its stored target (§1.1): the window never sends a plan back (contract choice §12 (2)). `UnknownPlan` when the token isn't the latest stored plan of the current scan.
- `reportStrings`: every catalog entry whose key starts with `import.report.`, in the current UI language (the pseudo-locale too), plural forms resolved to their `other` text. They become `ImportEnv.strings` (v1-import §2) for this run only.
- Calls `tegg_import::start(plan, scan, target, env)`. Errors before a job exists (nothing written): `InvalidPlan`, `SourceChanged`, `SourceGone`, `TargetChanged`, `TargetExists`, `TargetNotWritable`, `TargetInsideVault`, `TargetInsideSource`, `NoSpace`, `LeftoverNotTrashed`, `Busy`, `UnknownPlan`.
- On success the session's `run` is set, `on_progress` forwards to `import:progress`, and a watcher thread waits for the report and emits `import:done`.

### 2.6 Run status and result

```ts
type ImportResultDto = {
  job: number;
  phase: 'done' | 'cancelled' | 'failed';
  error: ImportError | null;          // the engine's serde form (`{ code, … }`)
  target: 'newVault' | 'existing';
  vault: string | null;               // absolute path of the written vault: the new vault's final folder (may be `… (2)`), or the existing vault's root
  vaultName: string;
  reportPath: string | null;          // vault path of the report Page (after the re-check)
  renamed: [string, string][];        // planned → written (D-1547 (2))
  backup: string | null;              // the zip's file name
  kept: string[];                     // roll-back: files of the run left in place
  totals: Totals;
};
type ImportStatusDto = {
  job: number; space: string;
  target: 'newVault' | 'existing'; vaultName: string; vault: string | null;
  files: number;                      // ScanInfo.files of the scan the run started from (step 6's `read` row)
  backup: boolean;                    // the started plan's `Plan.backup` (step 6's `backup` row)
  objects: number;                    // the started plan's imported objects plus made media objects (the `objects` row before its step, §3.10)
  links: number;                      // §3.9's links count of the started plan (step 7's summary)
  card: { unresolved: number; stubs: number; ambiguous: number; merged: number; mergedExample: [string, string] | null; dropped: number };   // step 7's card (§3.11), from the started plan
  reportDate: string;                 // `report.summary.date` of the started plan, `YYYY-MM-DD` (step 7's card title)
  progress: ImportProgressDto | null; // the last event
  result: ImportResultDto | null;     // set once final
};
```

`ImportReport` (`run.rs`) isn't `Serialize`; the shell maps it field by field (`written` is left out: thousands of paths the window never shows). `ImportStatusDto` carries everything steps 6 and 7 and the status element draw, so a reloaded UI (contract choice §12 (13)) rebuilds them without the plan or the scan: the store keeps the same fields from `import_start`'s plan and scan while it lives, and takes them from `import_status` after a reload.

---

## 3. The window

### 3.1 Modules (`app/ui/src/import/`)

| Module | Owns |
| --- | --- |
| `model.ts` | Pure, L1-tested: the step machine (`next`, `back` with the skips of §3.3), the stepper's number, the given-mapping edits (`setTypeTarget`, `renameNewType`, `setAttrTarget`, `setMerge`, `setSplit`, `setStatusValue`, `setCaseLink`, `toggleTagLike`, `dropEntry`), the 4a rows (§3.6), the 4b rows and summary (§3.7), the 4c rows (§3.8), the preview numbers (§3.9), the phase list (§3.10), the Done card (§3.11), the error → text table (§5.3). |
| `store.ts` | The one window state, **module-level** (it outlives a vault switch, the chooser and a closed window): `{ open, step, sub, source, scan, space, destination, newVault, where, given, planResult, planBusy, alert, run, hiddenAt }`; `openImport()`, `hideImport()`, `closeImport()`; the IPC calls in order (one `import_plan` in flight, the newest wins); `import:progress` / `import:done` listeners started at app mount. |
| `ImportDialog.tsx` | The dialog frame (§3.2), the stepper, the footer, focus and Esc; renders the step. |
| `steps/*.tsx` | `StartStep`, `SourceStep`, `SpaceStep`, `WhereStep`, `TypesStep` (4a and its menu), `AttributesStep` (4b), `DecideStep` (4c and its two lists), `PreviewStep`, `RunStep`, `DoneStep`. |
| `ImportStatus.tsx` | §6, mounted in `Frame.tsx`'s `titlebar-status` before `JobStatus`; also shown over the chooser. |
| `format.ts` | Sizes (`Intl.NumberFormat(region, { style: 'unit', unit: 'megabyte' \| 'gigabyte', maximumFractionDigits: n < 10 ? 1 : 0 })`; under 1 MB shown in MB with one decimal), counts (the catalog's region number formatting, D-133), list joins (`Intl.ListFormat(region, { type: 'conjunction' })` for 4b's `{keys}`). |

`App.tsx` mounts `<ImportDialog/>` once, outside the vault-scoped tree, so it renders over the frame and over the chooser. While it is open, the page behind it is `inert` and receives no keys (FR-UX-03 AC-44: the focus is never lost to the page).

### 3.2 The dialog (R151)

| Part | Element | Attributes and rules |
| --- | --- | --- |
| Dialog | `div` | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the heading, `data-import-step="<0\|1\|2\|3\|4a\|4b\|4c\|5\|6\|7>"`, class `dialog import-dialog` |
| Heading | `h2` | `tabindex="-1"`; text: `import.title` (step 0), `import.titleCapacities` (1–6 and 4a, 4c and their lists), `import.attrs.title` `{source}` = the row's source folder (`Tasks`), `{target}` = the target type's name (`Task`) (4b), `import.titleDone` (7) |
| Stepper | `div` | steps 1–6 only; `role="group"`, `aria-label` = `import.step` with `{n}`, `{total: 6}`; six `span`s with the R155 labels, each `aria-hidden="true"`, the current one `data-current`, earlier ones `data-done`. 4a, 4b, 4c and their lists are 4; Importing is 6; `Step 3 of 6` also when step 2 was skipped (D-1542) |
| Body | `div.import-body` | the step (§3.3) |
| Footer | `div.import-footer` | right-aligned `button`s in R151's order: `Back` (steps 2–5 and 4c), `Cancel`, the primary (`class="primary"`). An unusable button is `aria-disabled="true"`, stays focusable and does nothing (D-130); its reason, when it has one, is its `aria-description` |

- **Focus.** On open and after every step change (sub-views included) the focus is on the heading, and a polite live region (`div.sr-live`, `role="status"`) announces the new heading once (FR-UX-08 AC-19). Tab and ⇧Tab cycle inside the dialog. Closing from steps 0–5 returns the focus to the element that had it before the window opened (the palette's opener when opened from the palette); `Hide` and closing from step 7 return it the same way.
- **Esc** (R151): `Cancel` on steps 0–5 and 4c; `Back to types` on 4b; back to 4c from 4c's lists; `Hide` on step 6; closes on step 7. An open menu or a rename field takes Esc first.
- **Data commands** (`data-command`): `import.back`, `import.cancel`, `import.continue`, `import.hide`, `import.close`, `import.start` (step 5's primary), `import.openReport`, `import.openVault`, `import.readAgain`, `import.planAgain`, `import.chooseZip`, `import.chooseFolder`, `import.stop`, `import.changePlace`.
- **Cancel on steps 0–5** closes the window, calls `import_cancel` (if a scan or plan runs) and `import_discard`, and writes nothing (FR-IMP-05 AC-10). With a vault open the open route is unchanged.
- **Reduce motion** (FR-UX-08 AC-20): with `prefers-reduced-motion: reduce`, step changes, the progress bar and the phase list have no transition or animation (values jump); nothing moves on its own.
- Every colour is a theme token (FR-UX-05 AC-21): the orange dot `--warning`, the badges (`Recommended`, `New`, `Later`) and the repeat warning use the existing badge and warning tokens; no literal colour in `import/*.css`.

### 3.3 Steps and moves

| From | `Continue` / primary goes to | `Back` goes to |
| --- | --- | --- |
| 0 Start | 1 | — |
| 1 Source | 2, or 3 when the scan has one space (FR-IMP-22 AC-6) | — |
| 2 Space | 3 | 1 (the scan kept) |
| 3 Where | 4a, after the plan for the chosen destination is there (§3.4) | 2, or 1 with one space |
| 4a Types | 4c, or 5 when 4c has no row (D-1536) | 3 |
| 4b | (`Back to types`, `Done`) 4a, focus on the row's status button | — |
| 4c | 5 | 4a |
| 5 Preview | 6 (`import_start`) | 4c, or 4a when 4c has no row |
| 6 Importing | — (`Hide`) | — |
| 7 Done | — | — |

4c's row set is computed from the latest plan whenever it changes (D-1536 (3)), so the skip can change both ways.

**Step 0 (R152, D-1519).** `div role="radiogroup"` `aria-label` `import.source.group` with three `role="radio"` buttons (roving tabindex, ↑/↓ move and check, as the chooser's kinds): `import.source.capacities` (checked; `aria-description` `import.source.capacitiesHelp`), `import.source.obsidian` and `import.source.notionAnytype`, both `aria-disabled="true"`, each with the visible badge `import.source.later` and `aria-description` = its help (Obsidian: `import.source.obsidianHelp`) then `import.source.laterHelp` (D-1572). Footer `Cancel`, `Continue`.

**Step 1 (R152, FR-IMP-07 AC-10, AC-11).**
- Drop area `div.import-drop` `role="group"` `aria-label` `import.drop`, visible `import.drop` and `import.dropHelp`; inside it the buttons `import.chooseZip` and `import.chooseFolder` (`import_pick_source('zip' | 'folder')`, then `import_scan`). A file drop (Tauri's window event `tauri://drag-drop`) whose position is inside the drop area starts `import_scan(paths[0])`; a `NotASource` answer changes nothing. While the window is open, the editor and the capture paths ignore `tauri://drag-drop` (contract choice §12 (8)).
- After a choice: a row `div.import-source` with the file or folder name (`ScanInfo.name`, or the path's last part while reading) and, for a zip, its size (`ScanInfo.size`, shown once the scan answers; contract choice §12 (9)).
- While reading: `div role="progressbar"` `aria-label` `import.readingName`, `aria-valuemin="0"`, `aria-valuemax` = `total`, `aria-valuenow` = `done`, `aria-valuetext` = `import.reading` (`{done}`, `{total}`), the same text visible; and the button `import.stop` (`import_cancel`; on `Cancelled` the step returns to the empty drop area within 1 s). The text follows `import:progress` with phase `reading`.
- The line `import.readSafe` is always shown.
- `Continue` is `aria-disabled` until a scan answered without an error; ⏎ on it goes on.
- Errors: §5.3's table, in a `div role="alert"` under the row; `Continue` stays disabled; a new choice (or a drop) clears the alert. With unreadable entries only (`ScanInfo.unreadable.length > 0`), the line `import.unreadableCount` (`{count}`) is shown (not an alert) and `Continue` is enabled.
- A new source resets the space, the destination choice and the given mapping (FR-IMP-08 AC-16).

**Step 2 (R152, FR-IMP-22 AC-5).** Text `import.spaces` (`{count}` spaces). `radiogroup` `aria-label` `import.space.group`; one `radio` per `SpaceInfo` in the scan's order (already by object count, then name, D-1544), named by the space, `aria-description` `import.space.counts` (`{objects}` = `SpaceInfo.objects`, `{types}` = `SpaceInfo.types.length`), the first checked; ↑/↓ move and check. Hint `import.space.hint`. Choosing another space than the one the mapping was made for resets the given mapping.

### 3.4 Step 3, Where (R152, FR-HIS-04 AC-14, FR-IMP-20 AC-3)

- On entering, `import_where(space)`; until it answers, the radiogroup shows its rows without counts and `Continue` is `aria-disabled`.
- `radiogroup` `aria-label` `import.where.group`:
  - `radio` `import.where.new`, checked by default (FR-HIS-04 AC-1); visible badge `import.where.recommended`; below it `import.where.newHelp`, the name field (`input`, labelled by the radio through `aria-labelledby`; its value is `WhereDto.newVault.name` as `import_where` answers it, then as the user edits it; contract choice §12 (10)), the path line (`NewVaultDto.display`) and the button `import.where.change` (`vault_pick_dir`, then `import_check_target(picked, name)`). Editing the name calls `import_check_target(parent, field text)` (debounced 200 ms).
  - `radio` `import.where.current` (`{vault}` = `current.name`) with `import.where.currentHelp` (`{count}` = `current.notes`); absent when `current` is null (no vault open, D-1531). The repeat warning `import.where.repeat` (`{count}` = `current.alreadyImported`) is shown under it **whether or not it is checked**, only when the count is above 0; it is part of the radio's `aria-description`.
  - Accessible reading (FR-UX-08 AC-19): each radio's name is its label and badge (`A new vault, Recommended`); its `aria-description` is the help, then the name and path for the new vault (`Capacities · PKM, ~/Documents/Tegg/Capacities · PKM`), then the warning.
- A `problem` shows under the name: `targetExists` → `import.error.targetExists` (`{name}`); `targetNotWritable` → `import.error.targetNotWritable`; `targetInsideVault`, `targetInsideSource` → `import.error.targetInside`; `invalidName` → no text, the field is `aria-invalid="true"`. With a problem and `A new vault` checked, `Continue` is `aria-disabled`.
- **Plans.** On entering step 3 the window asks for the plan of the checked destination (`import_plan` with the given mapping); switching destination asks for the other one. `Continue` waits for the plan of the checked destination (the button shows the busy state `aria-busy="true"`, its text by D-1572). Switching between `A new vault` and `This vault` resets the given mapping (FR-IMP-08 AC-16); changing the new vault's name or place doesn't (contract choice §12 (11)).

### 3.5 The mapping in memory (D-1528, FR-IMP-08 AC-16)

- The window keeps the **given** mapping: a `Mapping` (v1-import §4) holding only the user's choices, never the effective one. Every choice on 4a, 4b and 4c edits it and calls `import_plan` again with it (latest wins); the window then draws the new plan. Until the new plan arrives, the edited control shows the chosen value and the rest shows the previous plan (no spinner under 300 ms; after 300 ms the body is `aria-busy="true"`).
- **Kept** across `Back` / `Continue` between steps 3–5, across 4b and 4c's lists, and across `Hide` (only step 6 hides). **Reset to `{}`** when the source, the space or the destination (`newVault` ↔ `existing`) changes. **Discarded** by `Cancel`, by closing the window and by quitting. It is never sent anywhere but `import_plan` (nothing in the vault, nothing in Application Support).
- **A refused entry.** When `import_plan` answers `InvalidMapping { entry, reason }` for an entry the user just changed, the window removes that entry from the given mapping (`dropEntry`), plans again, and puts the control back to its previous value; for a rename it keeps the field open with `aria-invalid="true"` (FR-IMP-08 AC-14: ⏎ commits only a non-empty, unused name). The window checks names before sending: a new type name must be non-empty and differ (NFC, case-insensitive) from every `targetTypes` name and plural and every other new type name of the plan.
- **`Plan again`** (R153 `TargetChanged`) and **`Read again`** (R153 `SourceChanged`) keep the given mapping and plan again; entries the new plan refuses are dropped one by one as above (D-1576).

### 3.6 Step 4a, types (R152, FR-IMP-08 AC-13, AC-14; D-1521, D-1527, D-1532, D-1544)

**Rows.** `table` (named by the dialog's heading through `aria-labelledby`), header row with `columnheader`s `import.types.colSource`, `import.types.colTarget`, `import.types.colAttributes`. One `row` per entry below, in this order (contract choice §12 (5)): source types `Page`, `Task`, `DailyNote`, then the other source types by name (D-122), then the media row, then `Weblink`, `AIChat`, `Query`, then the tag-collections row.

| Row | Source cell | Target cell | Attributes cell |
| --- | --- | --- | --- |
| a `PlannedType` | `source_folder` and the count `objects` | a `button` (`aria-haspopup="menu"`, `aria-expanded`) showing the target (below) | the status button, or `import.types.none` |
| **media** (`Image` and `PDF` together, D-1544; one of them alone the same way) | the two `source_folder`s joined by ` · `, the summed count | text, not a button: the two target type names joined by ` · ` | one status over both types' attributes |
| **tag collections** (D-1521) | `import.types.tagCollections`, count = `other_files` of kind `tagCollection` (D-1572) | text `import.types.notExported` (D-1572) | `import.types.none` |

**Target text** (content joined with ` · `, contract choice §12 (6)): existing type → its name from `targetTypes`; `new` → the new type's name, ` · `, `import.types.new` (`Meeting · New`); `skip` → `import.types.skip`; a `Weblink` row not skipped adds ` · url`; a `Query` row not skipped adds ` · ` + `import.types.stub`.

**Status** (D-1532, D-1573): over the row's **listed** attributes (§3.7): `n` = listed, `k` = listed with `needsLook: false`. A `button` (`data-command="import.mapAttributes"`) with visible `import.types.status` (`{mapped}` = k, `{total}` = n) followed by an `aria-hidden` `›`, accessible name `import.types.statusA11y`; when `k < n`, an `aria-hidden` orange dot before it and the text `import.types.needsLook` appended to the button's `aria-description` (FR-UX-08 AC-19). `import.types.none` (text) when `n` is 0 or the target is `skip`. ⏎, Space or a click opens 4b for the row.

**Hint** `import.types.hint`, `{count}` = rows with `k < n`, `{example}` = the first such row's status text followed by ` ›`; absent at 0. `Continue` is always enabled (D-1532).

**The `becomes` menu** (`PopupMenu`, `role="menu"`, `aria-label` `import.types.menu` with `{source}` = the source folder, `People becomes`), in order:
1. A line (a `PopupMenu` entry of kind `note`, not focusable) `import.types.noMatch` (`{source}`) — only when the type's default (with `Mapping` `{}`) was a new type.
2. `menuitemradio` `import.types.newType` (`{name}` = the new type's name), then `menuitem` `import.types.rename` — both only for a user source type (not a fixed R148 row) whose default was a new type (D-1577). `rename…` replaces the item by an `input` (`aria-label` `import.types.renameLabel`, D-1572) holding the name; ⏎ commits a valid name (§3.5) as `TypeTarget::New { name }`, Esc restores the old name; the menu stays open.
3. A `group` labelled `import.types.useExisting` with one `menuitemradio` per allowed type (D-1527 (6)): `page` and every non-system type of `targetTypes`, by name (D-122); plus `task`, `daily-note`, `image`, `pdf`, `quick-note`, `tag` only for the source types that default to them. → `TypeTarget::Existing { key }`.
4. `menuitemradio` `import.types.skip` with `aria-description` and visible `import.types.skipped` (`{count}` = `objects`) → `TypeTarget::Skip`.

The checked item is the effective target. Choosing updates the row at once (§3.5) and closes the menu; the focus returns to the target button. ↑/↓, ⏎, Space and Esc as every `PopupMenu`.

### 3.7 Step 4b, attributes and values (R152, FR-IMP-08 AC-15; D-1527 (2)–(5), (7); D-1573, D-1574)

**Listed attributes:** the `PlannedType.attributes` of the row's type(s) except `type` and `title` (D-1573), in source order. `n`, `k` as in §3.6.

- **Summary** (a `p`, `aria-live="polite"`): `import.attrs.summary` with `{mapped}` = k, `{total}` = n, `{keys}` = the source keys with `needsLook` joined by `format.ts`'s list join (`status and priority`); when every row is mapped, only `import.types.status` (`{mapped} of {total} mapped`).
- **Rows** (`ul`, one `li` per attribute, `data-attr="<source key>"`): the source key (content); the target control; the chips.
  - **Target control.** For `consumed` rows: text, the key written (`PlannedAttr.key`, content), no menu (v1-import §4: a consumed key takes no other target in I1). Otherwise a `button` (`aria-haspopup="menu"`) showing: `keep` / `rename` → the target attribute's name (`targetTypes`); `new` → `PlannedAttr.name`, ` · `, the kind word `import.attrs.kind.<R10 key>` (D-1572; FR-IMP-21 AC-5's `status · select`, D-1582: a new attribute is named after its source key, D-1553); `drop` → `import.attrs.skip`; `notCreated` → `import.types.none`.
  - **The `<key> becomes` menu** (`aria-label` `import.attrs.menu`): `menuitemradio` `import.attrs.newAttr` (`{name}`) with `menuitem` `import.types.rename` (rename as in §3.6, `aria-label` `import.attrs.renameLabel`); a `group` `import.attrs.kindGroup` with one `menuitemradio` per kind word (`text`, `number`, `checkbox`, `date`, `date-time`, `date-range`, `select`, `relation`) → `AttrTarget::New { name, type }`; a `group` `import.attrs.useExisting` (`{type}` = the target type's name) with one `menuitemradio` per attribute of the target type (`targetTypes`) → `AttrTarget::Existing { key }`; `menuitemradio` `import.attrs.skip` → `AttrTarget::Drop`. A refused choice (`KindMismatch`, `DuplicateTarget`, `KeyTaken`, …) is undone by §3.5 and announced in the step's `role="alert"` with `import.attrs.refused` (`{key}`) (D-1572).
  - **Chips.** `import.attrs.values` (`{count}` = `statuses.length` for a Task `status`, else `options.length` of a select; shown when the count is above 0): a `button` with `aria-expanded` that shows or hides `Values of <key>`. `import.attrs.merge`: shown when `merges` isn't empty; a toggle `button`, `aria-pressed="true"` while the merges apply (`Merge` absent or `Keep`), `false` for `Merge::Off`. `import.attrs.split`: shown when the plan proposes a split (`split` set) or the given mapping has one; a toggle `button`, `aria-pressed` = `split.on`.
- **`Values of <key>`** (a `section`, heading `h3` `import.attrs.valuesOf`): for a Task `status`, one row per `StatusMap`: the value (`import.attrs.empty` for `""`) and its count joined by ` · `, then a `button` (`aria-haspopup="menu"`) showing the status label and the state word in lower case, as the board draws it (`To do · open`; D-1583: the keys `import.state.open`, `.inProgress`, `.done`, `.cancelled`, §5.2; the engine's state `"in progress"` maps to `import.state.inProgress`, the others to the key of the same name; the Task type's capitalized `state.*` keys are not used here) that opens the `menu` `import.attrs.valueMenu` (`{value}`) with one `menuitemradio` per Task status of `targetTypes` → `AttrMapping.values[value] = label`. For a select: one row per option (text only).
- **Merge notes** under the attribute: one `p` per `ValueMerge` with two or more variants: `import.attrs.mergeNote` (`{a}`, `{b}` = the first two variants, `{kept}`); `{kept}` is a `button` (`aria-haspopup="menu"`) opening `import.attrs.keepMenu` with one `menuitemradio` per variant → `Merge::Keep { spellings }` (D-1574).
- **Split target.** When `split.on` and the attribute's kind is `relation`, a `button` `import.attrs.linksTo` (`{type}` = the chosen source type, or `import.types.none`) opens a menu of the space's source types (by name) → `Split { on: true, to }` (D-1574).
- Footer `import.attrs.back`, `import.attrs.done` (primary); both return to 4a with the focus on the row's status button.

### 3.8 Step 4c, things to decide (R152, FR-IMP-10 AC-13, FR-IMP-21 AC-5; D-1536)

Rows (`ul`), each present only when its list is non-empty, in this order:

| Row | First line | Second line (one example) | Control |
| --- | --- | --- | --- |
| case links | `import.decide.case` (`{count}` = `decisions.caseLinks.length`) | `import.decide.caseExample` (`{link}` = the first's `written`, `{title}` = its `candidateTitle`) | `button` `import.decide.review` → the case list |
| ambiguous | `import.decide.ambiguous` (`{count}`) | `import.decide.ambiguousHelp` | `button` `import.decide.info` → the ambiguous list |
| tag-like | `import.decide.tagLike` (`{count}` = `decisions.tagLike.length`) | `import.decide.tagLikeExample` (`{key}` = the first's `sourceKey`, `{link}` = its `example`) | toggle `button` `import.decide.select`, `aria-pressed` = the first's `selected` |

- **`Select`** (FR-IMP-21 AC-5) toggles **every** listed tag-like attribute (one row, one button): pressed → each gets `AttrMapping { to: New { name: <PlannedAttr.name or source key>, type: "select" } }` in the given mapping; pressed again → those entries are removed. 4b then shows the attribute as `<name> · select` (`status · select` for `c09`'s `Trip.status`, D-1582).
- **The case list** (a sub-view of 4c; heading unchanged; D-1572 for its texts): a `list` with one `listitem` per `CaseLinkCandidate`: the linking note's title (content; the note's `PlannedObject.title`), `import.decide.caseExample` (`{link}`, `{title}`) and a `checkbox` `import.decide.use`, unchecked unless the candidate is `confirmed` (D-81). A change sets `CaseLinkChoice { note, target, use }` in the given mapping and plans again. Footer `import.decide.done` returns to 4c.
- **The ambiguous list**: one `listitem` per `AmbiguousLink`: the note's title, `import.decide.ambiguousRow` (`{link}` = `written`, `{title}` = the chosen object's title). Read-only; changes nothing. Footer `import.decide.done`.
- Footer of 4c `Back`, `Cancel`, `Continue`.

### 3.9 Step 5, preview (R152, FR-IMP-05 AC-9; FR-IMP-20 AC-3; R153 `NoSpace`)

Four groups (`section` with an `h3` each); a row with a count of 0 is not rendered; a group with no row is not rendered except `Not in the export` (always). Each row: label, count, help, as one `div role="group"` named by the label.

| Group | Row | Count | Help |
| --- | --- | --- | --- |
| `import.preview.will` | `import.preview.objects` | `totals.objects.imported` | `import.preview.objectsHelp`: `{types}` = distinct `PlannedObject.type` of imported objects, `{new}` = those whose `PlannedType.new` |
| | `import.preview.attachments` | `totals.attachments.imported` | `import.preview.attachmentsHelp` |
| | `import.preview.links` | links with outcome `resolved`, `date-mention` or `attachment` (the criteria's reading, "Board items") | `import.preview.linksHelp` |
| `import.preview.attention` | `import.preview.unresolved` | `report.unresolved.length` | `import.preview.unresolvedHelp` |
| | `import.preview.stubs` | `report.stubs.length` | `import.preview.stubsHelp` |
| `import.preview.notExported` | — | — | `import.preview.notExportedList` |
| `import.preview.leftOut` | `import.preview.technical` | `import.preview.kinds` `{count}` = distinct source keys dropped by D-78's default (action `drop` with no `to` in the given mapping) (D-1578) | the first two keys joined by `, `, then `, …` when there are more |
| | `import.preview.missing` | `report.files` of kind `droppedReference` | — |

- The line: `import.preview.nothingNew` (`{name}` = the new vault's name) or `import.preview.nothingCurrent` (`{count}` = `totals.objects.imported`, `{vault}`).
- With `This vault` and `alreadyImported > 0`, `import.where.repeat` is shown above the footer (FR-IMP-20 AC-3). **Its count is `planResult.plan.alreadyImported`**, the plan this step previews (D-1540: "again in the preview"); step 3's warning counts `where.current.alreadyImported` (the default plan `import_where` made, §2.3). Both are `Plan.already_imported` against the same vault, which doesn't depend on the mapping, so the two numbers are equal; the canned fixtures agree (§7.1).
- `PlanResultDto.noSpace` → `role="alert"` `import.error.noSpace` (`{needed}`, `{free}` as sizes) and the primary `aria-disabled`.
- **While a plan is in flight** (an `import_plan` the step's numbers don't reflect yet, `planBusy`), the primary is `aria-disabled="true"` and `aria-busy="true"` with `aria-description` `import.planning`, as step 3's `Continue` (§3.4); it is enabled again when the newest plan arrives, so `import_start` always starts the plan the step shows.
- Primary `import.preview.go` (`{count}` = `totals.objects.imported`). Pressing it calls `import_start(token, reportStrings)`; on success → step 6. A refusal → §5.3 (step 6's alert for `SourceChanged`, `SourceGone`, `TargetChanged`; step 3 for the target refusals; step 5 for `NoSpace`, `LeftoverNotTrashed`).
- No IPC call before `import_start` writes (FR-IMP-05 AC-9, FR-SYN-06 AC-45).

### 3.10 Step 6, importing (R152, FR-UX-07 AC-14, AC-15)

A `ul` `aria-label` `import.run.list` (D-1572), one `li` per phase, in this order; each `li` has `data-phase`, a state `data-state="pending|running|done"`, its label, its count, and, for `done`, a check icon whose text alternative is `import.run.stateDone`; the `li`'s accessible text is `label, count, state` (`Writing objects, 2 of 3, running`, FR-UX-08 AC-19), the state word from `import.run.statePending|Running|Done` (D-1572).

| `data-phase` | Label | Count | `running` while | `done` when |
| --- | --- | --- | --- | --- |
| `read` | `import.run.read` | `import.run.files` (`ScanInfo.files`) | the job's `planning` | `backup` or `writing` begins |
| `create` (new vault) / `backup` (existing vault with `Plan.backup`) | `import.run.create` / `import.run.backup` | — | `writing` step `vault` or `types` / phase `backup` | the next step begins |
| `objects` | `import.run.objects` | `import.run.of` (`stepDone`, `stepTotal` of step `objects`; before it, 0 of the plan's imported objects plus made media objects) | step `objects` | step `report` begins |
| `attachments` | `import.run.attachments` | `import.run.of` (step `attachments`) | step `attachments` | step `objects` begins |
| `report` | `import.run.report` | — | step `report` | phase `done` |

- An existing-vault run without a backup has no `create`/`backup` row **unless `backup` events arrive**: the job decides again whether to back up (D-1549 (5): a vault that gained notes since the plan is backed up after all), so the row is shown from the first `import:progress` with phase `backup` even when `Plan.backup` was false, between `read` and `objects`. The engine writes attachments before objects (R149); the list keeps the board's order and each row follows its own step.
- **Queued** (`import:progress` with `queued: true`): the note is replaced by `import.run.waiting`.
- The note `import.run.note` under the list.
- Footer: `Cancel` (enabled in `queued`, `planning`, `backup`; `import_cancel`; a cancelled run closes the window, calls `import_discard` and shows nothing else) and, from the first `writing` event, `aria-disabled="true"` with `aria-description` `import.run.cantStop` (D-1572); `Hide` (always enabled; `hideImport()`).
- **The progressbar** of reading is not shown here; counts update at least every 500 ms (the events' pace).
- **Failure** (`import:done` with `failed`, or a refusal of `import_start`): the note is replaced by a `role="alert"` with §5.3's text; the footer becomes the alert's action (`Read again`, `Plan again`) if any, and `import.close` (closes, `import_discard`).
- **Done** → step 7 (the window, when shown, moves on by itself).

### 3.11 Step 7, done (R152, FR-IMP-19 AC-11, AC-12; D-1520)

- Heading `import.titleDone`. `p` `import.done.objects` (`{count}` = `totals.objects.imported`); `p` `import.done.summary` (`{attachments}` = `totals.attachments.imported`, `{links}` = §3.9's links count, `{vault}` = `vaultName`).
- With `target: 'existing'` and `backup` set: `p` `import.done.noUndo` (FR-IMP-19 AC-12); not for a new vault and not when no backup was made.
- The card (`section`, `aria-labelledby` its title `import.done.report` with `{date}` = `report.summary.date`, `YYYY-MM-DD` as written in the report name): rows with a count above 0 only: `import.done.unresolved` (`report.unresolved.length`, help `import.done.unresolvedHelp`), `import.done.stubs` (`report.stubs.length`), `import.done.ambiguous` (`report.ambiguous.length`), `import.done.merged` (`report.merged.length`; help: the first `MergedRow`'s first variant ` → ` its `kept`, content), `import.done.dropped` (`report.files` of kind `droppedReference`). Numbers are the started plan's (after the re-check they are equal, v1-import §9).
- Footer: `import.done.openReport`, `import.done.openVault` (primary). `Open vault` is absent when the target is the vault open now (`target: 'existing'` and `vault` equals the open vault's path). 
  - `Open vault` → `vault_open(vault)`, then the landing of FR-UX-02 AC-16; the window closes (`import_discard`).
  - `Open report` → when `vault` isn't the open vault, `vault_open(vault)` first (FR-UX-07 AC-16: "switches back to the target first"; §1.2: that call opens the vault fresh, since a final run holds no `Core`, or reattaches the run's `Core` while its release is still in progress, and never opens a second one); then the route `note/<reportPath>`; the window closes (`import_discard`, after the `vault_open`).
- Esc or closing → the window closes, `import_discard`.

---

## 4. Entry points (R154; D-1531, D-137)

### 4.1 The app menu

`File › Import…`: a `MenuItem` with id `tegg-import`, no accelerator, appended to the default menu's `File` submenu in `lib.rs`'s menu setup. Its text is `cmd.import`'s English text, read from a new row of `strings.rs` (`("cmd.import", "Import…")`, looked up by a second function `strings::command(key)`), so no new catalog key is added. `app/test/catalog_5b.ac.test.ts` does **not** cover the row (it matches only `menubar.*` entries of `strings.rs`); the new `app/test/import_catalog.ac.test.ts` (§9.1) checks that `strings.rs`'s `cmd.import` equals the catalog's. The menu event shows the main window (`shell5b::show_main`) and emits `import:open`; the UI runs the command `import.open`.

### 4.2 The command

| Id | Title key | Section | Shortcut | `needsVault` |
| --- | --- | --- | --- | --- |
| `import.open` | `cmd.import` | `file` | — | `false` (listed with and without a vault: D-137 gains it, D-1531) |

**The section `file` is new**: `Command.section` (`app/ui/src/shell/commands.ts`) is today `'navigate' | 'create' | 'view' | 'vault' | 'app' | 'edit'`, and the union gains `'file'` (the command lives in the app menu's `File`). Sections are not shown in the palette and have no catalog key, so nothing else changes in the UI. The shell tables (`app/test/shell-tables.ts`) don't list the sections as a set; they carry a section per row (R13 rows and the R4 notes), so they gain the `import.open` row with `file` and nothing else.

`ShellActions` gains `openImport: () => void`. `openImport()`: when the window is open, or a run is not final (window hidden), shows it (at its current step, or at 6/7 for a run) and focuses its heading; else opens a new window at step 0, clearing a finished status (§6) and calling `import_discard` for a final run. Never a second window.

### 4.3 The chooser

`pages/Chooser.tsx` gains a third button after `chooser.open`: text `cmd.import`, `data-command="import.open"`. With no vault open the window offers only `A new vault` (step 3's `current` is null). `FR-VLT-01 AC-14`'s `Import isn't available yet` for a folder without `.tegg/` stays (Obsidian slice).

### 4.4 The `import` route goes (app-shell R1)

`shell/registry.ts`'s `ROUTES` loses `import`; the catalog loses `route.import`, `purpose.import`, `cmd.goto.import`; `Go to Import` leaves the palette and `import` parses as an unknown route. The tests that assert the route change with the red tests: `app/test/registry.ac.test.ts`, `app/test/shell-tables.ts` (row `import`), `app/e2e/ms3_shell.ac.test.ts` (line 613's command list), with the trailer `AC-Test-Change: the import is a window, not a route (slice I2, D-1531, D-1571); approved-by: owner` (D-1571). app-shell.md's planned notes on R1, R4 and FR-UX-03 AC-3 take effect in the same commit.

---

## 5. Strings (NFR-OTH-02 AC-18)

### 5.1 R155's keys

Every key of R155 joins `app/ui/src/i18n/catalog.ts` with R155's English text and plural forms (D-133): `import.title`, `.titleCapacities`, `.titleDone`, `.step`, `.steps.source|space|where|mapping|preview|import`, `.back`, `.cancel`, `.continue`, `.hide`, `.close`; `import.source.group|capacities|capacitiesHelp|obsidian|obsidianHelp|notionAnytype|later`; `import.drop`, `.dropHelp`, `.chooseZip`, `.chooseFolder`, `.reading`, `.readingName`, `.stop`, `.readSafe`, `.unreadableCount`; `import.spaces`, `import.space.group|counts|hint`; `import.where.group|new|recommended|newHelp|newName|change|current|currentHelp|repeat`; `import.types.colSource|colTarget|colAttributes|new|stub|status|statusA11y|none|hint|menu|noMatch|newType|rename|useExisting|skip|skipped`; `import.attrs.title|summary|menu|skip|values|merge|split|valuesOf|empty|mergeNote|back|done`; `import.decide.case|caseExample|review|ambiguous|ambiguousHelp|info|tagLike|tagLikeExample|select`; `import.preview.will|objects|objectsHelp|attachments|attachmentsHelp|links|linksHelp|attention|unresolved|unresolvedHelp|stubs|stubsHelp|notExported|notExportedList|leftOut|technical|kinds|missing|nothingNew|nothingCurrent|go`; `import.run.read|files|create|backup|objects|attachments|report|of|note|waiting`; `import.status.running|done`; `import.done.objects|summary|report|unresolved|unresolvedHelp|stubs|ambiguous|merged|dropped|openReport|openVault|noUndo`; `import.error.notCapacities|unreadableArchive|encrypted|empty|sourceChanged|sourceGone|targetExists|targetNotWritable|targetInside|noSpace|backupFailed|stopped|targetChanged`, `import.error.reason.fileAppeared|sourceChanged`; `import.readAgain`, `import.planAgain`; `cmd.import`. R155's line that the state words reuse the Task type's `state.*` keys is replaced by D-1583: 4b's state words are the lower-case `import.state.*` keys of §5.2.

- `backups.label.import` (`Import · {space}`) is in the catalog already (D-1566 (5)); Settings › Backups lists import zips with it unchanged.
- `import.types.tags` (`Tags`) has no use after D-1521 (the row's target is `Not in the export`); it is left out of the list above and of the catalog (D-1572).
- **The report's words** `import.report.*`: every key of v1-import §5.3's table plus `import.report.stub.note` (the query stub's body line, `crates/tegg-import/src/lib.rs` `REPORT_ENGLISH`), with the English texts of `ReportStrings::english()`; the L1 catalog test checks the catalog's `import.report.*` entries equal that table (it reads the Rust source, as `catalog_5b` reads `strings.rs`). The † texts and `stub.note` are approved by D-1580 (§11).
- **Content, not catalog text:** space, type, vault, attribute and source-folder names, keys, values, file names, paths, sizes and numbers, and the separator ` · ` and arrow ` → ` / ` ›` joining content in §3.6–§3.11 (contract choice §12 (6)). In the pseudo-locale every other visible text and accessible name of the window, its menus, alerts and the status element is inside `⟦ ⟧`.

### 5.2 Keys this contract adds (D-1572, D-1583)

None of these is given word for word by R155 or the board; criteria give the texts marked ✓ but no key. The 39 keys of D-1572 and the four `import.state.*` keys of D-1583 (the last row) are R155's additions, so NFR-OTH-02 AC-18 counts R155 plus 43 keys.

| Key | English | Where | Source of the text |
| --- | --- | --- | --- |
| `import.source.laterHelp` | `Coming later` | step 0, the disabled sources' description | ✓ D-1519 |
| `import.types.needsLook` | `needs a look` | 4a status button's description | ✓ FR-UX-08 AC-19 |
| `import.types.tagCollections` | `Tag collections` | 4a row | board |
| `import.types.notExported` | `Not in the export` | 4a row target | ✓ D-1521 |
| `import.types.renameLabel` | `Name of the new type` | rename field | new |
| `import.attrs.newAttr` | `New attribute “{name}”` | 4b menu | new |
| `import.attrs.renameLabel` | `Name of the new attribute` | 4b rename field | new |
| `import.attrs.kindGroup` | `Kind` | 4b menu group | new |
| `import.attrs.kind.text`, `.number`, `.checkbox`, `.date`, `.date-time`, `.date-range`, `.select`, `.relation` | `text`, `number`, `checkbox`, `date`, `date and time`, `date range`, `select`, `links` | 4b target text and menu | board (`date`, `links`), ✓ FR-IMP-21 AC-5 (`select`); others new |
| `import.attrs.useExisting` | `Use an attribute of {type}` | 4b menu group | new |
| `import.attrs.valueMenu` | `{value} becomes` | 4b value menu | new (as `import.attrs.menu`) |
| `import.attrs.keepMenu` | `Keep which spelling?` | 4b merge note menu | new |
| `import.attrs.linksTo` | `Links to {type}` | 4b split target | new |
| `import.attrs.refused` | `{key} can’t be mapped that way. The earlier choice is back.` | 4b alert | new |
| `import.decide.use` | `Use this object` | case list checkbox | ✓ FR-IMP-10 AC-13 |
| `import.decide.ambiguousRow` | `{link} points to {title}` | ambiguous list | new |
| `import.decide.done` | `Done` | case and ambiguous lists | new |
| `import.planning` | `Preparing the mapping…` | step 3's busy `Continue` description, and 4a–5 when a plan takes over 300 ms | new |
| `import.run.list` | `Import steps` | step 6 list name | new |
| `import.run.statePending`, `.stateRunning`, `.stateDone` | `pending`, `running`, `done` | step 6 states | ✓ FR-UX-07 AC-14, FR-UX-08 AC-19 |
| `import.run.cantStop` | `Writing can’t be stopped half-way.` | step 6 `Cancel` description | ✓ FR-UX-07 AC-14 |
| `import.quit.title` | `An import is running. Quit anyway?` | quit question (§6.3) | ✓ FR-UX-07 AC-15 |
| `import.quit.body` | `Tegg will offer to undo the unfinished import the next time you open the vault.` (existing vault) / none for a new vault | quit question | new; changed by D-1584 (was `Tegg will undo the unfinished import …`: the next open offers `Undo` in the banner, §6.4, and undoes nothing by itself) |
| `import.quit.keep` | `Keep importing` | quit question, default | ✓ FR-UX-07 AC-15 |
| `import.status.failed` | `Import stopped` | status element after a hidden failure (§6) | new |
| `import.error.reason.write` | `{path} couldn’t be written` | `stopped`'s `{reason}` for `Write` | new |
| `import.error.reason.engine` | `a note couldn’t be converted` | `stopped`'s `{reason}` for `Transform` | new |
| `import.error.leftover` | `An unfinished import in “{name}.tegg-importing” couldn’t be moved to the Trash. Move it yourself, then try again.` | step 5 alert (`LeftoverNotTrashed`) | new |
| `import.error.generic` | `Something went wrong. Nothing was written.` | any other refusal before a write (`InvalidPlan`, `Io`, `UnknownPlan`, `Transform` at plan time) | new |
| `job.interrupted.import` | `Importing “{space}” was interrupted: {done} of {total} files written` | the interrupted-job banner (v1-import §9.6), with `Undo` only | new (v1-import §9.6: "approved with slice I2") |
| `import.state.open`, `.inProgress`, `.done`, `.cancelled` | `open`, `in progress`, `done`, `cancelled` | 4b's value rows and value menu (`To do · open`, §3.7) | board; added by D-1583 (not among D-1572's 39) |

`banner.dismiss` (`Dismiss`) and `quit.anyway` (`Quit anyway`) are reused.

### 5.3 Errors → window

| `kind` | Where | Text | Controls |
| --- | --- | --- | --- |
| `NotCapacities`, `UnreadableArchive`, `EncryptedArchive`, `Empty`, `SourceGone` (from `import_scan`) | step 1 alert | `import.error.notCapacities`, `.unreadableArchive`, `.encrypted`, `.empty`, `.sourceGone` | `Continue` disabled |
| `SourceChanged`, `SourceGone` from `import_plan` (steps 3–5) | step 1 alert (the source row kept) | `import.error.sourceChanged` | `import.readAgain` (re-scans the same path, §3.5) (D-1576) |
| `TargetExists`, `TargetNotWritable`, `TargetInsideVault`, `TargetInsideSource` from `import_plan` or `import_start` | back to step 3, under the name | as §3.4 | `Continue` disabled |
| `NoSpace` | step 5 alert | `import.error.noSpace` | primary disabled |
| `LeftoverNotTrashed` | step 5 alert | `import.error.leftover` | — |
| `SourceChanged`, `SourceGone` from `import_start` or the job before its first write | step 6 alert | `import.error.sourceChanged` | `import.readAgain`, `import.close` |
| `TargetChanged` | step 6 alert | `import.error.targetChanged` | `import.planAgain` (→ 4a with a new plan, §3.5), `import.close` |
| `BackupFailed` | step 6 alert | `import.error.backupFailed` | `import.close` |
| `FileAppeared`, `Write`, `SourceChanged`/`SourceGone` after the first write, `Transform` in the job | step 6 alert | `import.error.stopped` with `{reason}` = `import.error.reason.fileAppeared` (`{path}`), `.write` (`{path}`), `.sourceChanged`, `.engine` | `import.close` |
| `UnknownSpace` (from `import_plan` or `import_where`, after `Read again` read a source that no longer has the chosen space) | back to step 2 (step 3 when the new scan has one space, §3.3), the given mapping reset to `{}` (a new space, §3.5) | no alert: the step shows the new scan's spaces with the first checked | — |
| `Cancelled` | — | ignored: the answer of a call the window itself superseded or stopped (an older `import_plan` when a newer one was sent, an `import_scan` after `Stop` or a new choice, §1.1); the window already shows the newer state | — |
| `NotCancellable` (from `import_cancel` during `writing`) | — | ignored; the run goes on; step 6's `Cancel` is already `aria-disabled` from the first `writing` event (§3.10), so this only answers a race | — |
| `IndexNotReady` | — | the step stays busy and asks again on `index:progress` `done` | — |
| `InvalidMapping` | §3.5 | — | — |
| `Busy` | — | the window brings the running import forward (§4.2) | — |
| anything else | the current step's alert | `import.error.generic` | — |

An alert is inserted once per error (FR-UX-08 AC-19: announced once) and removed by the next choice that clears it.

---

## 6. The status element (FR-UX-07 AC-15, AC-16; D-1539, D-1549 (6))

### 6.1 What it shows

`ImportStatus.tsx`: `span.import-status` `role="status"` holding a `button` (`data-command="import.open"`; a click or ⏎ shows the window, §4.2) and, after the end, a `button` `banner.dismiss` (`aria-label`; an `×` icon). It is rendered when the window is **hidden** and a run exists:

| Run | Text of the first button |
| --- | --- |
| queued | `import.run.waiting` |
| planning, backup, writing | `import.status.running` with `{done}`, `{total}` = the `objects` row's numbers (§3.10) |
| done | `import.status.done` |
| failed | `import.status.failed` (D-1572) |

- It is shown in **whichever vault is open**, and over the chooser: the store is module-level and `import:progress` doesn't depend on the target being open (§1.2). After a vault switch it keeps updating (FR-UX-07 AC-16).
- After the end it stays until the window is shown (the status button) or it is dismissed (`Dismiss`: `import_discard`, nothing else). When the window was **shown** at the end, no status appears.
- A cancelled run shows nothing.

### 6.2 After a switch

With an existing-vault run in `writing`, opening another vault from the title-bar switcher is not blocked and asks nothing (D-1549 (6)). The status follows the run. Step 7 then shows `Open vault` (the target is no longer the open vault) and `Open report` opens the target first (§3.11).

### 6.3 Quitting (D-1539)

`App.tsx`'s `app:quit-requested` handler asks the import store first:
- **`writing`:** the main window is **shown first**: a quit can come from the Dock or the menu-bar status item while the main window is hidden or minimized, and a question nobody sees would hold the quit for ever. The shell's paths that emit `app:quit-requested` (`lib.rs`, the two `emit_to("main", "app:quit-requested", …)` sites) call `shell5b::show_main(app)` (show, unminimize, focus) before emitting, whatever the UI then decides. Then the question: a `dialog` (`aria-modal`, `aria-label` `import.quit.title`) with `p` `import.quit.body` (existing-vault target only; D-1584's text) and `button`s `import.quit.keep` (focused, default; Esc and ⏎ choose it) and `quit.anyway`. `Keep importing` closes the question and the app keeps running. `Quit anyway` continues the existing quit flow (note flush, `app_quit`) and the process **exits without waiting for the import's job thread** (no join, no cancel: `NotCancellable` holds in `writing`): the process ends mid-write, which is the crash path of D-1523 (new vault: a leftover with its marker, trashed by the next same-name import; existing vault: the journal, `Undo` offered on the next open, §6.4).
- **`queued`, `planning`, `backup`:** no question; `import_cancel` is sent and the quit waits for `import:done` (at most 1 s), then continues.
- Steps 0–5: no question; the mapping is discarded (D-1528).

### 6.4 The interrupted import

`VaultInfo.interrupted` lists an interrupted import (`kind: "import"`, v1-import §9.6). `App.tsx`'s interrupted banner shows `job.interrupted.import` (`{space}` = `title`, `{done}`, `{total}`) with only `job.undo` (`job_resolve_interrupted(job, 'undo')`); no `Finish`.

---

## 7. Fake core (L5)

`app/ui/test/fake-import.ts`, installed by `installFakeCore`, answers every §2.1 command over canned data; the fake's command-coverage test (ms3-shell §5) includes them.

### 7.1 Canned data, from the real engine

- **`tests/fixtures/import/window/`** (new, committed by the test author with the red tests): `scan-<fixture>.json` (`ScanInfo`) and `plan-<fixture>-<space>-<new|existing>.json` (`Plan`, the serde form, `stamps` left out, `target.parent` `/fake/parent`) for every fixture and target the criteria name: `c01-spaces` (`PKM`, `Work`, `IDC`; new), `c01-spaces` zipped (scan only: `kind: zip`, `size`), `c12-task-dates` (new), `c09-unresolved-links` (new; the tag-like `Trip.status`), `c05+c07` (the two spaces' files merged into one folder `PKM` at generation time; new and existing) and `c01-spaces` `PKM` against `target-existing-vault` (existing; `alreadyImported: 1`).
- **Generated by** `cargo run -p tegg-import --example window_fixtures -- --out tests/fixtures/import/window` (`crates/tegg-import/examples/window_fixtures.rs`: the test clock, Europe/Prague, ids from `testing::env`, the `NodeTransformer`). The non-AC test `window_fixtures_follow_the_engine` in `crates/tegg-import/tests/ac_import_window_fixtures.rs` regenerates them in memory and compares, so a DTO change in the engine fails the gate (it runs in the existing `import-test` step).
- **The repeat count agrees** (§3.9): a `WhereDto` and the existing-vault plan used with it carry the same `alreadyImported`: `where-osobni.json` (38) goes with `plan-board.json` (`alreadyImported: 38`); the fake's default `where` (§7.2) takes `current.alreadyImported` from the canned `existing` plan of the chosen space (1 for `c01-spaces` `PKM` against `target-existing-vault`, 0 when there is none). The fixture check asserts it for the committed pairs.
- **Hand-written** (each checked by the same test to deserialize as `ScanInfo` / `Plan` and to have `totals` that agree with its lists):
  - `plan-board.json`: the board's 4a example against an existing vault `Osobní` (`alreadyImported: 38`) (types Page, Task, Daily Note, Meeting, Project, Idea): Pages 310, Tasks 142 (attributes `type`, `title`, `status` with four `StatusMap`s of the board, one with `fallback`, `priority` with the merge `HIgh`/`High`, `dueDate`, `people` with a proposed split, `fileSize` dropped: `3 of 5 mapped · status and priority still need a look`), Daily notes 205, Meetings 58 (`Meeting`, existing), People 31 (new `Person`, 7 attributes, none mapped), Images 61 and PDFs 40, Weblinks 44, Queries 11, two tag-collection CSVs.
  - `plan-decisions.json`: 3 `caseLinks`, 2 `ambiguous`, 0 `tagLike` (FR-IMP-10 AC-13).
  - `where-osobni.json`: `WhereDto` with `current: { name: "Osobní", notes: 1180, alreadyImported: 38 }` (FR-HIS-04 AC-14, FR-IMP-20 AC-3).
- `app/ui/test/fake-import.ts` reads them with `loadImportFixture(name)`.

### 7.2 Options and handle

```ts
type FakeImportOptions = {
  sources?: Record<string, { scan: string } | { error: 'NotCapacities' | 'UnreadableArchive' | 'EncryptedArchive' | 'Empty' | 'SourceGone' }>;
                                        // path (NFC) → canned scan file name or the error `import_scan` answers; any other path: `NotASource`
  plans?: Record<string, string>;       // `${space}|${'newVault'|'existing'}` → canned plan file name, for the current source
  where?: string | WhereDto;            // `import_where`'s answer; default: the fake vault's name, its note count, and the canned `existing` plan's `alreadyImported` (0 without one; §7.1)
  targetTypes?: TargetTypeDto[];        // default: the fake vault's types (`fake-schema.ts`), or the seven system types for a new vault
  pickFile?: string | null;             // `import_pick_source('zip')`
  pickSourceDir?: string | null;        // `import_pick_source('folder')`
  taken?: string[];                     // paths `import_check_target` answers `targetExists` for
  free?: number | null;                 // bytes free: a plan with `neededBytes` above it answers `noSpace`
};
type FakeImportHandle = {
  importCalls(): Promise<{ cmd: string; args: unknown }[]>;          // every import_* call in order
  importPace(ms: number): Promise<void>;                              // per progress event in reading, planning and writing (default 20)
  importHold(at: 'reading' | 'planning' | 'queued' | 'backup' | 'writing' | null): Promise<void>;  // stop before emitting that phase until released
  importRelease(): Promise<void>;
  importFail(f: { at: 'scan' | 'plan' | 'start' | 'backup' | 'writing'; error: ImportError } | null): Promise<void>;  // the next call or the run answers that error
  importQueued(on: boolean): Promise<void>;                          // `import_start` against `existing` waits in `queued` until turned off
};
```

### 7.3 How it answers

- `import_scan(path)`: `NotASource` for an unknown path; else `reading` events (`total` = the scan's `files`, `done` stepping by `ceil(files / 10)` every `importPace` ms), then the canned scan or error. `import_cancel` during it → `Cancelled` within one pace step.
- `import_where`, `import_check_target`: from the options; `name` sanitized as `fake-jobs.ts`'s `sanitize`; `display` `~/…` for `/fake/home/…`.
- `import_plan(space, target, mapping)`: the canned plan for `space|target.kind`, passed through **`applyMapping(plan, mapping, targetTypes)`**, a TypeScript twin of the parts of the engine the window reads: `types[].target`, `.key`, `.name`, `.new` from `TypeTarget`; for `skip` the type's objects get outcome `skipped` and `totals` follow; `attributes[].action`, `.key`, `.name`, `.type` from `AttrTarget` (an `existing` target becomes `keep` when the key equals the source key, else `rename`); `merges[].applied` from `merge`; `split` from `split`; `statuses[].to`, `.state`, `.fallback` from `values` (state from `targetTypes`' Task statuses); `needsLook` by v1-import §5.1's four rules; `decisions.caseLinks[].confirmed` and `decisions.tagLike[].selected` from `caseLinks` and the select targets; `mapping` = the effective mapping (v1-import §4). Validation: a new type name equal to a `targetTypes` name or plural or another new type (NFC, case-insensitive) → `InvalidMapping` `NameTaken`; an `existing` attribute target named `rating` with source values that aren't numbers → `KindMismatch` (enough for the refusal path). Progress: `planning` events as above. `noSpace` when `free` is set and below `neededBytes` (the plan returned with it, §2.3).
- `import_start(token)`: counts as the fake's **first write call** (`writes()` is 0 before it, FR-SYN-06 AC-45). Then `queued` (when `importQueued`), `planning`, `backup` (existing target with `plan.backup`), `writing` with the steps of §3.10 in the engine's order (`vault` for a new vault, `types`, `attachments`, `objects`, `report`), `stepDone` by one file per `importPace` ms, then `import:done`. For an **existing** target it writes, after each object, the file `<path>` with `---\nimport-id: "<importId>"\n---\n` into the fake vault (`vault:changed` per file); for a **new** target it adds a fake vault at `<parent>/<name>` to `dirs` (`.tegg/` of `new-empty` plus the same stub files and the report), so `Open vault` and `Open report` work. `import_cancel` in `queued`/`planning`/`backup` → `cancelled`; in `writing` → `NotCancellable`.
- `import_status`, `import_discard`, `import_transform_result` as §2; the fake never emits `import:transform` (it doesn't call `@tegg/doc`).
- `vault_open` of the target while its run is not final keeps the run going; the fake emits `import:progress` whatever vault is open.
- Menu and quit: the handle's existing `emit` sends `import:open` and `app:quit-requested`. Its type (`app/ui/test/fake-core.ts`, `FakeCoreHandle.emit`) is today `'index:progress' | 'vault:changed' | 'note:conflict'`; it widens to `… | 'import:open' | 'app:quit-requested'` (the fake's `__teggFake.emit` already forwards any name). `import:progress` and `import:done` are not emitted through it: the fake sends them itself (§7.3).

---

## 8. Test hooks (L6, only with `TEGG_TEST=1`)

| Hook | Effect |
| --- | --- |
| `TEGG_TEST_PICK_FILE=<path>` | `import_pick_source('zip')` answers `<path>` with no dialog; empty = cancelled (as `TEGG_TEST_PICK_DIR`, D-135). ms3-shell §1 gains the line. |
| `TEGG_TEST_PICK_SOURCE_DIR=<dir>` | `import_pick_source('folder')` answers `<dir>`; when unset, `TEGG_TEST_PICK_DIR` answers it (so one test can pick a source folder and a different new-vault parent) |
| `TEGG_TEST_DROP=<paths>@<x>,<y>` | (existing, ms6-trash-media) the drop on the drop area |
| `TEGG_TEST_IMPORT_PACE=<ms>` | Makes steps 1 and 6 observable and leaves time to hide, switch vaults or quit (FR-UX-07 AC-14…AC-16). The engine emits progress **at most every 100 ms** (the scan's and plan's ticker, `crates/tegg-import/src/source.rs`; the run's `emit`, `run.rs`), except an event that starts or ends a phase or step, so a sleep in a progress sink slows events, not files. Where the pace acts: **`reading` and `planning` (`import_scan`, `import_plan`)**: the shell wraps `Control.progress`; the wrapped sink sleeps `<ms>` before it forwards each event. The ticker calls the sink on the scanning thread, so the scan waits; with `<ms>` ≥ 100 every file or note becomes an event (each next step is ≥ 100 ms after the last event) and the phase lasts about `files × <ms>`; with less, about one event per 100 ms of work. **`writing`**: `ImportEnv.points` sleeps `<ms>` at every `BeforeTemp` (one per created file: marker, vault file, type files, attachments, objects, report), which the engine raises before the staged create and **outside the vault lock** (the vault lock is taken only inside `commit_new`, for the name check and the rename, `crates/tegg-core/src/jobs4c.rs`; staging is outside it too), so the user's saves during an import aren't delayed by the pace (FR-UX-07 AC-15's 100 ms). **The run's `planning` and `backup`**: one sleep of `<ms>` at `BeforeChecks` and one at `BeforeBackup`. The run's progress reaches the shell through `ImportRun::on_progress`; that sink never sleeps (it is the `import:progress` forwarding, called on the job thread). |
| `TEGG_TEST_IMPORT_FAIL=<kind>:<n>:<errno>` | `ImportEnv.points` answers `PointAction::Fail(<errno>)` at the `<n>`-th `BeforeTemp` of `FileKind` `<kind>` (`object`, `attachment`, `typeFile`, `report`); `<errno>` `StorageFull` or `PermissionDenied`: the job fails with `Write` and rolls back (R153 "A write fails") |
| `TEGG_TEST_IMPORT_FREE=<bytes>` | `ImportEnv.disk.free` answers `<bytes>` (R153 `NoSpace`) |
| `TEGG_TEST_SYSTEM_TRASH=<dir>` | (existing) where a leftover goes |
| `TEGG_NOW`, `TZ`, `TEGG_APP_SUPPORT`, `TEGG_VAULT` | (existing) the engine clock follows `TEGG_NOW` (§1.1), so the report is `Import report 2026-11-12 PKM.md` |

Marks: `import-step:<step>` is written once per step change (`perf_mark`), so Appium waits on steps instead of sleeping; `import-done` when `import:done` arrives.

---

## 9. Test plan

AC test names follow the criteria (`fr_imp_07_ac10_source_step`, …). L5 tests use the fake core (§7) with the fixture vaults `tests/fixtures/vaults/shell` (a vault open) or none (the chooser); L6 tests use the built app, the fixtures copied to a temporary folder, `TEGG_APP_SUPPORT` in a temporary folder, vault checks by bytes, mtime and inode, keys only to Tegg (D-799).

### 9.1 Layers and files

| Layer | File | Criteria |
| --- | --- | --- |
| L1 | `app/test/import_model.ac.test.ts` | the model of §3 (steps and skips, mapping edits and resets, 4a rows, status counts, 4b summary, 4c rows, preview numbers, phase states, Done rows) under FR-IMP-08 AC-13, AC-15, AC-16; FR-IMP-22 AC-6; FR-IMP-05 AC-9; FR-UX-07 AC-14 (model parts, each test named after its AC) |
| L1 | `app/test/import_registry.ac.test.ts` | FR-UX-03 AC-43 (registry: `import.open`, title `Import…`, section `file`, no shortcut, `needsVault: false`; no `import` route, no `Go to Import`); FR-UX-03 AC-7 with the command added |
| L1 | `app/test/import_catalog.ac.test.ts` | NFR-OTH-02 AC-18 (catalog part: R155's keys and texts, §5.2's 43 keys (D-1572, D-1583), no `import.types.tags`, `import.report.*` = `REPORT_ENGLISH`, the Czech test catalog's plurals for `import.preview.go`, `import.where.repeat`, `import.space.counts` at 1, 3, 5; `strings.rs` `cmd.import` equals the catalog) |
| L4 (fixture check) | `crates/tegg-import/tests/ac_import_window_fixtures.rs` | `window_fixtures_follow_the_engine` (no AC; §7.1) |
| L5 | `app/webkit/import_source.ac.test.ts` | FR-IMP-07 AC-10, AC-11; FR-IMP-22 AC-5, AC-6 |
| L5 | `app/webkit/import_where.ac.test.ts` | FR-HIS-04 AC-14; FR-IMP-20 AC-3 |
| L5 | `app/webkit/import_mapping.ac.test.ts` | FR-IMP-08 AC-13, AC-14, AC-15, AC-16; FR-IMP-10 AC-13; FR-IMP-21 AC-5 |
| L5 | `app/webkit/import_preview.ac.test.ts` | FR-IMP-05 AC-9, AC-10 (all steps, `Cancel` and Esc; "closing the app" is L6's); FR-SYN-06 AC-45 (`writes()` and `importCalls()` before `import_start`) |
| L5 | `app/webkit/import_run.ac.test.ts` | FR-UX-07 AC-14, AC-15 (status, reopen, quit question; the save-latency part only as "saves are sent", §9.3), AC-16; FR-IMP-19 AC-11, AC-12 (step part) |
| L5 | `app/webkit/import_keyboard.ac.test.ts` | FR-UX-03 AC-43 (palette with and without a vault, the chooser button, bring-forward), AC-44 (the whole flow by keyboard; the start call's plan is `Work`'s) |
| L5 | `app/webkit/import_a11y.ac.test.ts` | FR-UX-08 AC-19 (names, descriptions, live announcements, axe on every step), AC-20; FR-UX-05 AC-21 (both themes, the listed states); NFR-OTH-02 AC-18 (pseudo-locale on every step, menu, alert and the status element) |
| L5 helpers | `app/webkit/import-helpers.ts` | opening the window, going to a step with canned data, reading the stepper |
| L6 | `app/e2e/import.ac.test.ts` | FR-IMP-07 AC-10 (once, `c01-spaces` zipped, `TEGG_TEST_PICK_FILE`); FR-HIS-04 AC-14 (once, `Change…` with `TEGG_TEST_PICK_DIR`, a taken folder); FR-IMP-05 AC-10 (steps 3 and 5 with a copy of `target-existing-vault`: `Cancel`, Esc and quitting the app; snapshot of the vault and the new-vault place); FR-SYN-06 AC-45 (snapshot of the vault and its Application Support folder through every step up to the preview, then after an import into a new vault); FR-UX-03 AC-43 (the menu `File › Import…`), AC-44 (keyboard only, `c01-spaces` zipped, `Work`, the written vault checked as FR-IMP-22 AC-1 expects); FR-UX-08 AC-19 (once: the macOS accessibility tree has the names of step 0, 3, 4a and 6) |
| L6 | `app/e2e/import_run.ac.test.ts` | FR-UX-07 AC-14 (once, `c05-media-objects`, `TEGG_TEST_IMPORT_PACE`), AC-15 (once: `Hide`, the status element, an edit saved meanwhile with its latency measured, reopen; the quit question during `writing`, `Keep importing`), AC-16 (once: an import into the open vault, a switch to another vault during `writing`, the status there, `Open report` back); FR-IMP-19 AC-11 (once, `c09-unresolved-links` into a new vault, `Open vault`, `Open report`) |

**"Once" L6 tests** (one run each, the rest at L5): FR-IMP-07 AC-10, FR-IMP-19 AC-11, FR-HIS-04 AC-14, FR-UX-07 AC-14, AC-15, AC-16, FR-UX-08 AC-19. **Full L6** (every case the criterion names): FR-IMP-05 AC-10 (steps 3 and 5), FR-SYN-06 AC-45, FR-UX-03 AC-43 (menu part), AC-44.

### 9.2 Changes to existing tests and files (with the red tests)

- `AC-Test-Change: the import is a window, not a route (slice I2, D-1531, D-1571); approved-by: owner` (D-1571): `app/test/registry.ac.test.ts`, `app/test/shell-tables.ts` (the `import` row and `Go to Import`), `app/e2e/ms3_shell.ac.test.ts` (line 613). Any other test that lists every palette command or the D-137 no-vault list (`app/webkit/keyboard.ac.test.ts`, `layout.ac.test.ts`, `vault.ac.test.ts`: the test author checks) changes under the same trailer.
- `docs/acceptance/app-shell.md`: R1's `import` row removed; FR-UX-03 AC-3's list and D-137's list per the planned notes.
- `docs/contracts/ms3-shell.md` §1: `TEGG_TEST_PICK_FILE`, `TEGG_TEST_PICK_SOURCE_DIR`; the app menu's `File › Import…`.
- `docs/contracts/ms4-jobs.md` §10: the job status ignores `kind: "import"`; §8: the interrupted import's banner (`job.interrupted.import`, `Undo` only).
- `docs/contracts/v1-import.md` §14, §15: point to this contract.
- No new `qa.config.json` step: the tests live in packages that have steps (`app` L1, webkit, e2e; the crate's `import-test`).

### 9.3 Criteria that can't be tested as written

1. **FR-UX-07 AC-15, "none of those saves is delayed by more than 100 ms"**: the fake core has no vault lock, so L5 can only check that saves are sent and answered; the latency is measured in the L6 once-test (time from the editor's save call to its answer while `writing` runs with `TEGG_TEST_IMPORT_PACE`).
2. **FR-UX-08 AC-19, the spoken string `Capacities · PKM, A new vault, Recommended, selected, 1 of 2`** can't be produced as written and isn't tested as a string. VoiceOver composes the spoken order itself, and no ARIA attribute puts the vault's name before the radio's label (the name is part of the description, §3.4). L5 asserts what ARIA fixes: the radio's accessible name (`A new vault, Recommended`), its description (help, then name and path, then the warning), `aria-checked` and the group's size (`1 of 2` is VoiceOver's own count of the radiogroup's radios); L6 asserts the macOS accessibility tree's names. Recorded here so that the test author doesn't assert the spoken order and the criterion's reading isn't taken as a failure.
3. **FR-IMP-05 AC-10, "closing the app" on steps 0–5**: L5 has no app to close; it is checked at L6 on steps 3 and 5 only, as the criterion's layers say.
4. **FR-UX-03 AC-44, "the written vault is the one FR-IMP-22 AC-1 expects"**: the fake core writes stubs; L5 asserts the `import_start` call names `Work`'s plan, L6 checks the vault.
5. **FR-IMP-21 AC-5, `Status · select`**: resolved by D-1582. The engine names a new attribute after its source key (D-1553), so the expected text is `status · select`; the criterion is changed to it ("Changed by D-1582"), the kind word is D-1572's lower-case `import.attrs.kind.select`, and the canned plan (`c09-unresolved-links`, generated) keeps the engine's `name: "status"`.
6. **NFR-OTH-02 AC-18, "exactly R155's keys"**: false as soon as any §5.2 key is added, and `import.types.tags` stays unused. Resolved by D-1572: AC-18 counts R155 with §5.2's 39 keys and without `import.types.tags`; D-1583 adds the four `import.state.*` keys (43 in all).

---

## 10. Size of the work

| Part | Estimate |
| --- | --- |
| Shell (`shellimport.rs`: session, ten commands, events, `ImportBridge` and memo, keep-alive and reattach in `open_vault`, the menu item, hooks) | 700–900 lines Rust |
| UI model and store (`import/model.ts`, `store.ts`, `format.ts`, `ipc/import.ts`) | 1,000–1,300 lines |
| UI views (dialog, ten steps, menus, lists, status element, quit question, chooser button, CSS for both themes) | 2,000–2,600 lines TSX/CSS |
| Catalog (R155, §5.2, `import.report.*`) | ~200 lines |
| Fake core (`fake-import.ts` with `applyMapping`) and the fixture generator (`examples/window_fixtures.rs`), canned JSON | 600–800 lines + generated JSON |
| Tests (test author): 3 L1, 7 L5, 2 L6 files, one fixture check | ~3,000 lines |

About 5,000 lines of product and fake code: the size of slice Q's UI. The shell's keep-alive and reattach (§1.2) and 4b's controls (§3.7) carry the most risk.

---

## 11. Report wording (v1-import §5.3 †; approved by D-1580)

These are the report Page's own words (`import.report.<key>`) that R150 and R155 describe but don't give word for word. v1-import §5.3 planned to approve them "with the expected outputs"; they are listed here so that one answer approves them. **Approved as proposed** (owner, 2026-11-13: "Approve all"; D-1580, BRD v1.172). The texts are those of `ReportStrings::english()` today (`crates/tegg-import/src/lib.rs`); a changed text changes the expected report files under `tests/fixtures/import/capacities-expected/` (`Fixture-Change:`).

| Key (`import.report.` +) | English (approved, D-1580) |
| --- | --- |
| `word.notImported` | `not imported` |
| `type.noDay` | `Daily Note with no readable day, imported as a Page` |
| `attr.notCreated` | `not created, no values` |
| `attr.valueNotInOptions` | `value not in the type’s options` |
| `attr.splitUnmatched` | `no object with this name, kept as text` |
| `attr.asStored` | `kept as stored` |
| `key.reserved` | `reserved key` |
| `key.invalidKey` | `not a valid key` |
| `key.keyTaken` | `key already used` |
| `key.rangeClash` | `clashes with a date range` |
| `date.unreadable` | `not a date, kept as written` |
| `date.importTime` | `objects without a creation date; the import time was used` |
| `file.droppedReference` | `reference to a missing file dropped` |
| `file.unreferenced` | `no note referenced it` |
| `file.genericName` | `generic name renamed` |
| `name.reserved` | `reserved name` |
| `name.empty` | `no valid character` |
| `name.suffix` | `name taken` |
| `name.characters` | `characters replaced` |
| `skip.yaml` | `frontmatter isn’t valid YAML` |
| `skip.noType` | `no type` |
| `skip.notUtf8` | `not UTF-8` |
| `skip.read` | `couldn’t be read` |
| `skip.encrypted` | `password-protected` |
| `skip.engine` | `couldn’t be converted` |
| `skip.badName` | `unreadable name` |
| `skip.traversal` | `unsafe path` |
| `skip.tagCollection` | `tag collection` |
| `skip.csv` | `CSV file` |
| `skip.dotfile` | `hidden file` |
| `skip.outsideSpace` | `outside every space` |
| `skip.unreadableEntry` | `unreadable entry` |
| `skip.type` | `type not imported` |
| `stub.note` (not in §5.3; the query stub's body line, FR-IMP-16 AC-1 gives no text) | `This query was imported from Capacities. Its definition wasn’t exported, so it needs rebuilding.` |

33 † rows of §5.3 plus `stub.note`: 34 texts.

---

## 12. Contract choices (no owner decision needed)

1. **A shell session, not engine state.** The engine keeps nothing between calls (v1-import §4); the shell keeps the scan, the plans and the run for the window's life and drops them on `import_discard`.
2. **The window never sends a plan back.** `import_start` takes the token of a plan the shell stored; the plan the user saw is the plan that starts, and the IPC carries no multi-megabyte plan twice. The engine still validates it (`InvalidPlan`).
3. **`import-scan` answers are memoized per scan** (§1.3), so each mapping change is a fast re-plan and the window can re-plan on every change instead of keeping a TypeScript copy of the planner.
4. **`NoSpace` comes with a plan** (§2.3): the engine refuses a plan, the shell plans once more with unlimited space so steps 4a–5 can be drawn, and `import_start` refuses as the engine does.
5. **4a row order** follows R148's first table, then user types by name, then media, `Weblink`, `AIChat`, `Query`, tag collections; the board's order matches it except where it is illustrative.
6. **` · `, ` → `, ` ›` between content parts are literal** (as the report's ` · `, v1-import §5.3), and a catalog word joined to content (`Meeting · New`) is the word's own key; D-1530's "joins inside one key" applies to sentences.
7. **The status element counts objects**, not every file the job creates, so its numbers equal step 6's `Writing objects` row and stay fixed from the start.
8. **The window takes file drops while open**: the editor and the capture paths ignore `tauri://drag-drop` while the import dialog is open, so a drop never lands in the note behind the modal.
9. **A zip's size shows when the scan answers**, from `ScanInfo.size`; no extra command reads it earlier.
10. **The new vault's name is an editable field** (D-1537 "the name is editable in place") labelled by its radio (`aria-labelledby`, so it reads `A new vault`); its value is the name. **One source:** the field shows `NewVaultDto.name` from `import_where` (the shell's `Capacities · <space>`, with ` (2)` when taken, D-1537, FR-HIS-04 AC-14), never a catalog text; a folder name must not depend on the UI language or carry the pseudo-locale's `⟦ ⟧`. R155's `import.where.newName` stays in the catalog (NFR-OTH-02 AC-18) but isn't used for the folder name.
11. **Only `A new vault` ↔ `This vault` resets the mapping** (FR-IMP-08 AC-16 "another destination vault"); a new name or place of the new vault doesn't change the target's types.
12. **Quitting during `planning`/`backup` cancels first** (§6.3), so no partial backup zip is left by a quit.
13. **The import store is module-level** and outlives vault switches and the chooser; `import_status` rebuilds it after a reload: `ImportStatusDto` (§2.6) carries the scan's file count, the backup flag, the counts of step 6's rows, step 7's summary and card and the report date, so steps 6 and 7 and the status element are drawn from it alone.
14. **`import_where` makes the default plan against the open vault** to answer `notes` and `alreadyImported`, and stores it, so the first plan of `This vault` costs nothing more.
15. **A Done card's merge help** is the first merge as `variant → kept` (content), the board's `HIgh → High`.
16. **4c's `Select` acts on every tag-like attribute** (one row, one button), as the board draws one row.

---

- **Build notes (QA review of the I2 build, 2026-11-13).** While an import run is live, the frame's re-reads after `vault:changed` are throttled: the first change re-reads at once, then at most every 500 ms, and the last change is always read (within NFR-PERF-08's 2 s). The tags store's change-driven refresh is single-flight (one read at a time, one more after it if changes came in). Drag-and-drop listeners are scoped to their window (`capture` / `main`): in Tauri 2 a listener with the default target also received the other window's drops, so a file dropped on the main window was staged in Quick Capture as well.

## 13. Points for the owner

Each changes what the user sees or what a test asserts. **Decided** (owner, 2026-11-13: "Approve all"; BRD v1.172): every recommendation accepted, WP-1…WP-9 → D-1571…D-1579; the rules above cite the decision.

| WP-n → D-n | Issue | Recommendation (accepted) | Alternatives (not chosen) | Affects |
| --- | --- | --- | --- | --- |
| WP-1 → D-1571 | **The AC-test change for the `import` route.** D-1531 removes the route and import-capacities.md names the trailer `AC-Test-Change: the import is a window, not a route (slice I2); approved-by: owner`, but no decision approves the test change itself (as D-1390 did for slice PIN). | Approve the change of `app/test/registry.ac.test.ts`, `app/test/shell-tables.ts`, `app/e2e/ms3_shell.ac.test.ts` and any other test that lists the palette's commands or D-137's list, with that trailer, as a decision. | (b) Read D-1531 and the approved criteria as the approval (no new decision). | §4.4, §9.2 |
| WP-2 → D-1572 | **Strings beyond R155.** The window needs 39 keys that R155 lacks (§5.2): texts the criteria give without a key (`Coming later`, `needs a look`, `Use this object`, `pending`/`running`/`done`, `Writing can’t be stopped half-way.`, the quit question and `Keep importing`, `Not in the export`) and new ones (4b's menus and kind words, 4c's lists, the busy text, the failed status, error reasons, the interrupted-import banner). NFR-OTH-02 AC-18 says "exactly R155's keys". `import.types.tags` (`Tags`) has no use after D-1521. FR-IMP-21 AC-5 expects the kind word `select` in lower case. | Approve §5.2's keys and texts as an addition to R155 (AC-18 then counts R155 plus §5.2); keep `import.types.tags` out of the catalog; 4b's kind words lower case (`links` for a relation, as the board). | (b) Approve the keys, change some texts (one answer per row). (c) Reuse `attrType.*` (capitalized `Select`; FR-IMP-21 AC-5's text changes). | §3, §5.2, §6, NFR-OTH-02 AC-18, FR-IMP-21 AC-5 |
| WP-3 → D-1573 | **Which attributes 4b lists and counts in `k of n`.** The plan lists every frontmatter key of a type, `type` and `title` included, and R148's on-purpose keys (`createdAt`, `tags`, Task `status`, …) can't be retargeted (v1-import §4). The board's Tasks row shows 5 rows (`status`, `priority`, `dueDate`, `people`, `fileSize`). | List every attribute except `type` and `title`; on-purpose keys are rows with their fixed target as text (Task `status` and `priority` keep their values and merges); `n` counts the listed rows. | (b) List only attributes that can be retargeted (on-purpose keys hidden; Task `status`'s values then have no row). (c) List everything, `type` and `title` too. | §3.6, §3.7, FR-IMP-08 AC-13, AC-15 |
| WP-4 → D-1574 | **4b's controls the board doesn't draw.** The board shows 4b's targets and chips but not what they open; D-1526 says every inferred kind can be changed in 4b, D-1527 (2) lets the user pick the kept spelling, (4) a split into links to a type. | The `<key> becomes` menu: `New attribute “<name>”` with `rename…`, a `Kind` group, `Use an attribute of <Type>`, `Don’t import`; a value's status menu; the merge note's kept spelling as a menu; `Links to <type>` when a split relation is on (§3.7). | (b) Only targets and `Don’t import` in 4b; kinds and spellings stay as inferred (D-1526's "can be changed" not built). (c) A separate attribute editor dialog. | §3.7 |
| WP-5 → D-1575 | **The new vault's place with no vault open.** D-1537 says "else the last place a vault was created"; Tegg records no such place. | Use the parent folder of the most recent existing vault in the recent-vaults list (no new state). | (b) Record the parent folder in Application Support whenever a vault is created (a new machine-local value). (c) Skip the rule: `~/Documents/Tegg/`. | §2.3, FR-HIS-04 AC-14 |
| WP-6 → D-1576 | **What `Read again` and `Plan again` keep, and where a plan-time source change shows.** R153 gives the texts for a change found at `Import`; a change found while planning (steps 3–5) isn't placed. | A source change found while planning returns to step 1 with `The export changed since it was read. Nothing was written.` and `Read again`; `Read again` re-reads the same source and **keeps** the mapping choices that still apply, as `Plan again` does (D-1548); the space stays chosen when it still exists. | (b) `Read again` resets the mapping (a new read is a new source, FR-IMP-08 AC-16). (c) Show the change on the current step. | §3.5, §5.3 |
| WP-7 → D-1577 | **When 4a's menu offers `New type`.** The board draws it for `People` (no vault type matched). Not said: for a type that matched a vault type, and for `Weblink`, `Query`, `AIChat` (D-1544 lets them be retargeted). | Offer `New type “<name>”` (with `rename…`) only for a user source type whose default was a new type; a matched type offers `Use a type you have` and `Don’t import`; `Weblink`, `Query`, `AIChat` never become new types. | (b) Always offer `New type` for user source types (a matched one then needs a different name: `Book (2)`). (c) Also for `Weblink` and friends. | §3.6, FR-IMP-08 AC-14 |
| WP-8 → D-1578 | **What `Technical attributes <n> kinds` counts.** The preview's `Left out` row counts "technical attributes"; the user can also drop any attribute in 4b. | Count the source keys dropped by D-78's default (no `to` in the given mapping); a user's own `Don’t import` shows in 4b, not here. | (b) Count every dropped key, the user's too. | §3.9, FR-IMP-05 AC-9 |
| WP-9 → D-1579 | **The finished status and a new `Import…`.** D-1539 shows `Import finished` until the window is opened or the status dismissed. Not said: whether `Import…` after a finished, hidden import reopens step 7 or starts anew. | `Import…` with no window open and no run in progress starts a new import at step 0 and clears the finished status; the status button itself reopens step 7. | (b) `Import…` shows step 7 until it is closed. | §4.2, §6.1, R154 |

## 14. After the QA review: the owner's decisions (QA-1…QA-4 → D-1581…D-1584)

The QA review of this contract (2026-11-13) found four points that only the owner could settle; the owner accepted the recommendations ("Accept all four", 2026-11-13; BRD v1.173). The other findings were contract fixes (§1.2, §2.3, §2.4, §2.6, §3.4, §3.9, §3.10, §4.1, §4.2, §5.1, §5.3, §6.3, §7, §8, §9.3) and needed no decision.

| QA-n → D-n | Issue | Decision | Where |
| --- | --- | --- | --- |
| QA-1 → D-1581 | The default place `~/Documents/Tegg/` often doesn't exist, and the planner refuses a missing parent (`TargetNotWritable`), so the default proposal failed on a fresh machine | Proposed even when missing; `plan` accepts a parent whose own parent exists and is writable (one level); `start` creates that folder after `Import`, never before (FR-SYN-06 AC-45 holds). Amends D-1537, D-1575; an engine change built with I2, with its test | §2.3; v1-import §5, §9.5 |
| QA-2 → D-1582 | FR-IMP-21 AC-5 expects `Status · select`, the engine names a new attribute after its source key (`status`, D-1553) | The criterion expects `status · select` | §3.7, §3.8, §9.3 (5); import-capacities.md FR-IMP-21 AC-5 |
| QA-3 → D-1583 | 4b shows `To do · open` (lower case, board), R155 reused the Task type's capitalized `state.*` keys | Four new keys `import.state.open`, `.inProgress`, `.done`, `.cancelled` (`open`, `in progress`, `done`, `cancelled`); the engine's `"in progress"` maps to `import.state.inProgress` | §3.7, §5.1, §5.2; R155 |
| QA-4 → D-1584 | `import.quit.body` said Tegg "will undo" the unfinished import; the next open only offers `Undo` (§6.4) | `Tegg will offer to undo the unfinished import the next time you open the vault.` Amends D-1572, R155 | §5.2, §6.3 |
