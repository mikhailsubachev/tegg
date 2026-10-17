# MS4 Jobs Interface Contract (slice 4C)

- **Status:** draft, 2026-10-17. Written before the 4C red tests. Follows D-267…D-269, D-290, D-291, D-382 and the 4C decisions D-383…D-399 (BRD v1.60); corrected after the red tests by D-400…D-413 (BRD v1.61).
- **ACs:** [docs/acceptance/rename.md](../acceptance/rename.md) (FR-FMT-08 AC-5…AC-10, FR-LNK-03 AC-7…AC-20, FR-HIS-04 AC-4…AC-6, FR-UX-07 AC-8…AC-11, FR-SYN-06 AC-10, AC-11) and the existing criteria it lists. Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests.
- **Builds on** [ms4-links.md](ms4-links.md) (§1 one resolution rule, §3.1 free stems), [ms3-shell.md](ms3-shell.md) (§5 fake core, §13 editor and autosave), [ms1-core.md](ms1-core.md) (`Vault`, `FileVersion`), [architecture.md](../architecture.md) §5.6. Everything there stays valid unless this contract changes it.
- **Clients.** One job model for every bulk operation. 4C ships the engine and **note rename** only. Tag rename/delete and merge (D-290, D-392) ship with 4D-lite; key rename, value removal, type/folder move and type delete with 4E (v1.0, D-372); import with MS7. Their op shapes and flags are defined here so later slices only add planners (§9).

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result, so a test fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Job model

`plan → confirm (if the kind needs it) → backup (if the kind needs it) → write → report`.

| Kind | `needsConfirm` | `backup` | `undoable` | Cancellable in | Ships |
| --- | --- | --- | --- | --- | --- |
| `note-rename` | no (D-268) | no (D-269) | yes (D-385) | `planning` (D-393) | 4C |
| `tag-rename`, `tag-delete` | yes | yes | no (zip, D-395) | `planning`, `confirm`, `backup` | 4D-lite |
| `merge` | yes | yes | no (D-290) | `planning`, `confirm`, `backup` | 4D-lite (D-392) |
| `key-rename`, `value-remove`, `type-move`, `folder-move`, `type-delete` | yes | yes | no | `planning`, `confirm`, `backup` | v1.0 |
| `test-backup` | no | yes | no | `planning`, `backup` | 4C, only with `TEGG_TEST=1` and in Rust tests (FR-HIS-04 AC-5) |

- **One job at a time** (D-393): a FIFO queue in the core. A job whose files overlap a running job waits for it. `job_start` returns at once with the `jobId`; the job runs on the core's job thread.
- **Phases:** `queued`, `planning`, `confirm`, `backup`, `writing`, `done`, `cancelled`, `failed`. `done`, `cancelled` and `failed` are final.

## 2. Crate `tegg-jobs` (new, `crates/tegg-jobs`)

Platform-neutral (AR-03): depends on `tegg-vault`, `tegg-index`, `tegg-format`; no Tauri, no desktop APIs. `tegg-core` owns a `Jobs` instance and exposes it (§4).

```rust
pub type JobId = u64;

pub enum JobOp {
    NoteRename { path: String, title: String },          // title as committed (NFC, trimmed by the core)
    Undo { job: JobId },                                  // undo of an undoable job (D-385)
    Redo { job: JobId },
    TestBackup { paths: Vec<String> },                    // FR-HIS-04 AC-5 only
    // 4D-lite / v1.0 (shape fixed now, planners return NotImplemented until their slice):
    TagRename { from: String, to: String },
    TagDelete { tag: String, keep_text: bool },
    Merge { keep: String, others: Vec<String> },
    KeyRename { r#type: String, from: String, to: String },
    ValueRemove { r#type: String, key: String },
    TypeMove { path: String, to_type: String },
    FolderMove { r#type: String, to_folder: String },
    TypeDelete { r#type: String, objects: TypeDeleteChoice },
}

pub struct JobPlan {
    pub job: JobId,
    pub kind: JobKind,
    pub files: Vec<PlannedFile>,      // files whose text may change, in path order
    pub renames: Vec<(String, String)>, // (from, to) vault paths; for note-rename at most one
    pub creates: Vec<String>,
    pub trashes: Vec<String>,
    pub counts: PlanCounts,           // { files, links } (links: occurrences the planner expects to rewrite)
}
pub struct PlannedFile { pub path: String, pub version: FileVersion, pub ops: Vec<TextOp> }
```

### 2.1 Planners

- **Note rename.** Input `{path, title}` (and `from_title` through `start_note_rename`). A commit is a no-op (empty plan, nothing written) when the title, NFC and trimmed, is empty or equals both the stored title and the title when the edit started; the autosave may already have written the new title while typing (D-394), so equality with the stored title alone isn't enough. Refused with `JobError::NotRenamable` for a Daily Note (D-320), for `_templates/` and `.trash/` paths (D-391: the caller writes only `title:` there), and for a path whose last read was not UTF-8 (D-180). New stem `s′ = free_stem(folder(path), sanitize(title))` (ms4-links §3.1, D-384) where the note's own current stem is treated as free, so a case-only change keeps the same stem key (FR-FMT-08 AC-8). The stem is chosen when the job starts, never at the keystroke (FR-FMT-08 AC-10). Files: the note itself (title + self-links, D-389) and every note `S ≠ N` outside `.trash/` with at least one link that **resolves to N under D-291 from S** (index link records), including `_templates/` (D-391) and Daily Notes. Links in code (links.md AC-3) are never extracted and so never planned.
- **Undo / redo** (§7) plan from the undo record, not the index.
- **Case-only and same-key renames (D-402).** A new stem whose key (NFC, case-folded) equals the note's own current stem key is never a collision, whatever other files share that stem elsewhere in the vault.
- **The plan is a hint.** Every file is re-read at write time and checked against `version` (§5).

### 2.2 Text ops and the transformer (D-82)

Rust never edits Markdown (architecture §3). Each planned file's new bytes come from a `Transformer`:

```rust
pub enum TextOp {
    RetargetLinks { from_stem: String, from_path: String, from_title: String,
                    to_stem: String, to_path: String, to_title: String, paths: Vec<String> },
    SetTitle { title: String, now: String },  // the renamed note only; also touches `modified` (FR-FMT-11)
    // later: RenameTag, RemoveTag, RenameKey, RemoveValue, SetType, MergeInto
}
pub enum Transformed { Bytes(Vec<u8>, Vec<Edit>), Unchanged }
pub struct Edit { pub start: usize, pub end: usize }  // byte range in the input that was replaced

pub trait Transformer: Send + Sync {
    /// `source`: the vault path of the file (for relative Markdown links). Pure: same input, same output.
    fn transform(&self, source: &str, bytes: &[u8], ops: &[TextOp]) -> Result<Transformed, TransformError>;
}
pub enum TransformError { Unavailable, Timeout, Engine(String) }
```

- **In the app** the transformer is the UI's `@tegg/doc` worker: the core emits `job:transform { requestId, source, text, ops }`; the UI answers `job_transform_result(requestId, result)` (§4). Timeout 10 s per file → that file is skipped with reason `io` (§5); the job continues.
- **In Rust tests** `tegg_jobs::testing::NodeTransformer::start(script)` / `from_repo(root)` runs one persistent `node packages/doc/dist/transform-cli.js` process (JSON lines: `{id, source, text, ops}` → `{id, result | error}`, D-405; built by `npm run build` in `packages/doc`), so L4 and L2 bytes come from the real engine. `tegg_jobs::testing::FailingTransformer` covers the error paths.
- Which links `RetargetLinks` rewrites: in the source document, every link node (wikilink, embed, Markdown link; body and every frontmatter string value, D-388) whose target **resolves to the old path** from `source` (the same D-291 rule, implemented in `@tegg/doc` `resolve` with the vault path list the op carries in `paths`). The op therefore carries `paths: Vec<String>` (the vault's note paths before the rename); the TS side does not query the core.

### 2.3 `@tegg/doc` additions

```ts
export type TextOp =
  | { op: 'retarget-links'; fromPath: string; fromStem: string; fromTitle: string;
      toPath: string; toStem: string; toTitle: string; paths: string[] }
  | { op: 'set-title'; title: string; now: string };
export type Transformed = { kind: 'bytes'; text: string; edits: { start: number; end: number }[] } | { kind: 'unchanged' };

/** Applies `ops` in order (D-82). Byte offsets in `edits` are UTF-8 offsets into the input. */
export function transform(source: string, text: string, ops: TextOp[]): Transformed;

/** The link rewrite alone (FR-LNK-03 AC-7, AC-9, AC-20). Same edit rules as `transform`. */
export function rewriteLinks(source: string, text: string, op: Extract<TextOp, { op: 'retarget-links' }>): Transformed;
```

**Link form rules (D-383).** For each matching link, only these bytes change:

| Written | Rewritten to (`toStem` = `Gama`) |
| --- | --- |
| `[[Alfa]]`, `![[Alfa]]` | `[[Gama]]`, `![[Gama]]` |
| `[[Alfa#Úvod]]`, `[[Alfa#^b1]]` | `[[Gama#Úvod]]`, `[[Gama#^b1]]` (subpath kept) |
| `[[Alfa\|text]]` | `[[Gama\|text]]`; an alias exactly equal to `fromTitle` becomes `toTitle`, or is dropped when `toTitle == toStem` |
| `[[Pages/Alfa]]`, `[[Alfa.md]]` | `[[Pages/Gama]]`, `[[Gama.md]]` (path and extension forms kept) |
| `[label](Alfa.md)`, `[label](../Pages/Alfa.md)` | the URL gets the new relative path, percent-encoded as the original was (spaces as `%20` if the original encoded them, else `<…>` form kept); the label is never changed |
| non-embed wikilink without an alias, when `toTitle` needs one (sanitized stem ≠ title) | `[[Q3 plan budget\|Q3: plan/budget]]`, also with a subpath `[[Q3 plan budget#Úvod\|Q3: plan/budget]]` |
| embeds | never get an alias |

- Written target text is NFC (FR-FMT-12); everything outside the replaced ranges is byte-identical (CRLF, missing final newline, NFD elsewhere, quoting style).
- `set-title` writes `title:` with `formatScalar` quoting and updates `modified` with `now` (FR-FMT-11; editor AC-10 rules). Aliases are compared with the title as it was when the edit started (D-394): the caller passes it as `fromTitle`, not the autosaved intermediate.
- A worker entry `app/ui/src/jobs/worker.ts` wraps `transform`; `app/ui/src/jobs/bridge.ts` answers `job:transform` events.

## 3. File operations

- **Note rename write (D-389, FR-SYN-06 AC-11).** One atomic step: the new bytes are written to a temp file in the folder, then renamed to the new path with `RENAME_EXCL`, then the old path is removed after a base check. The index sees one `rename(from, to)`; `Pages/Gama.md` never holds the old title. A taken name at that moment (external create) → the planner's next free stem is used (`Gama (2)`), never an overwrite (FR-FMT-08 AC-10).
- **Case-only rename** on case-insensitive APFS goes through a temp name in the same folder (`.<stem>.tegg-tmp`), so the directory listing shows the new case.
- **Other files** are written with `Vault::write(path, bytes, base)` (ms3-shell §13.1): `Unchanged` is counted `unchanged` (FR-SYN-06 AC-10); `Conflict`/`Gone` are skips (§5). Exactly one write per affected file.
- **Delete** (later kinds) moves to `.trash/` keeping the relative path. **Moves** use the free-stem rule in the target folder.
- New `tegg-vault` method: `Vault::rename_with(from, to, bytes, base) -> Result<FileVersion, VaultError>` (the atomic step above); errors `NameTaken`, `Conflict { disk }`, `Gone`.

## 4. Core API and IPC

```rust
impl Core {
    pub fn jobs(&self) -> &Jobs;
}
impl Jobs {
    pub fn set_transformer(&self, t: Arc<dyn Transformer>);
    pub fn start(&self, op: JobOp) -> Result<JobId, JobError>;          // queued; planning starts when the queue reaches it
    pub fn plan(&self, job: JobId) -> Option<JobPlan>;
    pub fn confirm(&self, job: JobId) -> Result<(), JobError>;          // kinds with needsConfirm
    pub fn cancel(&self, job: JobId) -> Result<(), JobError>;           // NotCancellable outside the allowed phases
    pub fn wait(&self, job: JobId, timeout: Duration) -> Option<JobReport>;
    pub fn report(&self, job: JobId) -> Option<JobReport>;
    pub fn retry(&self, job: JobId, path: &str) -> Result<RetryOutcome, JobError>;
    pub fn last_undoable(&self) -> Option<JobId>;
    pub fn interrupted(&self) -> Vec<Interrupted>;                       // §8
    pub fn resolve_interrupted(&self, job: JobId, choice: Finish | Undo) -> Result<JobId, JobError>;
}
pub enum JobError { NotRenamable, Busy, NotCancellable, NotFound, NotImplemented, BackupFailed(String), Core(String) }  // String: no crate cycle (D-405)
impl Jobs {
    /// The IPC path: `from_title` is the title when the edit started (D-394); `JobOp::NoteRename` uses the stored title.
    pub fn start_note_rename(&self, path: &str, title: &str, from_title: &str) -> Result<JobId, JobError>;
    pub fn editor_open(&self, path: &str);                              // §9
    pub fn editor_close(&self, path: &str);
    pub fn transform_result(&self, request: u64, result: Result<Transformed, TransformError>);
    #[doc(hidden)] pub fn set_point_hook(&self, hook: Option<PointHook>); // §5.1, tests only
}
```

`CoreEvent` gains `JobProgress(JobProgress)` and `JobTransform { request: u64, source: String, text: String, ops: Vec<TextOp>, live: bool }`.

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `note_rename` | `path`, `title`, `fromTitle` | `{ jobId, toPath }` | Starts a `note-rename` job. `toPath` is the planned path; the final one is in the report. Errors: `NotRenamable`. Same-stem commits (FR-FMT-08 AC-8) still run as a job (only the note, `renames: []`). |
| `job_cancel` | `jobId` | — | `NotCancellable` outside the allowed phases. |
| `job_confirm` | `jobId` | — | Not used by 4C's UI. |
| `job_report` | `jobId` | `JobReportDto \| null` | |
| `job_retry` | `jobId`, `path` | `{ outcome: 'written' \| 'unchanged' \| 'skipped', reason? }` | Re-reads the file's **current** bytes and version and transforms them (D-398); never uses the job's old base. |
| `job_undo` | `jobId` | `{ jobId }` | Starts the undo job (§7). `NotFound` after quit or a vault switch. |
| `job_redo` | `jobId` | `{ jobId }` | |
| `job_transform_result` | `requestId`, `result: TransformedDto \| { error }` | — | Answer to `job:transform`. |
| `job_interrupted` | — | `InterruptedDto[]` | §8. The app reads them from `VaultInfo.interrupted` (`vault_current`, `vault_open`), so opening a vault sends no extra call. |
| `job_resolve_interrupted` | `jobId`, `choice: 'finish' \| 'undo'` | `{ jobId }` | §8. |
| `backups_list` | — | `BackupDto[]` | FR-HIS-04 AC-6; UI ships with 4D-lite (D-396). |
| `backup_restore` | `name` | `{ jobId }` | Backs up the current state first. |

```ts
type JobProgressDto = { jobId: number; kind: JobKind; phase: Phase; done: number; total: number;
  counts?: { written: number; unchanged: number; skipped: number } };          // counts on the final event
type JobReportDto = { jobId: number; kind: JobKind; phase: 'done' | 'cancelled' | 'failed';
  renamed?: { from: string; to: string };
  written: string[]; unchanged: string[];
  skipped: { path: string; reason: SkipReason }[]; error?: string };
type SkipReason = 'changed' | 'missing' | 'placeholder' | 'readOnly' | 'io';
type TransformedDto = { kind: 'bytes'; text: string; edits: { start: number; end: number }[] } | { kind: 'unchanged' };
```

- **Events:** `job:progress` (`JobProgressDto`), `job:transform` (`{ requestId, source, text, ops }`). Progress rules: FR-UX-07 AC-8 (`done` never decreases, `total` fixed from `writing`, at least one event per 500 ms, final event with counts).
- `vault:changed` is still emitted per written file, after the index has been updated and links re-resolved (ms4-links §1).

## 5. Base versions and skips

- At write time each file is read again. If its version is not `same_content` as the planned one, or the plan predates an own write to it, the file is **skipped** with `changed` and nothing is written to it (NFR-REL-02, FR-LNK-03 AC-15). `missing`: the file is gone. `placeholder`: an online-only file (ms2-core placeholders). `readOnly`: a file the editor opens read-only (not UTF-8, NFR-REL-03). `io`: any other error, including a transformer error or timeout.
### 5.1 Job points (D-404, tests only)

`JobPoint::{AfterPlanning, AfterRead { path }, TempWritten { path }}` are reported to the hook set by `Jobs::set_point_hook` on the job thread (it may block). `AfterPlanning` is still in `planning`; `AfterRead` and `TempWritten` are in `writing`. `TempWritten` is reported when the new bytes are ready and right before the base-checked write (`Vault::write`, which makes its own temp file and rename under the vault lock), so an external change at that point is caught by that check (the renamed note's own rename re-checks its base after its temp file, §3).

- No automatic retries. `job_retry` is the only retry, per file, from the current bytes.
- The skipped files form the **"link not updated" list** (D-398): kept in memory per vault until quit, never written to disk; a successful retry removes the row.

## 6. Backups (D-57, FR-HIS-04)

- Location `~/Library/Application Support/Tegg/backups/<vault-hash>/`, name `<UTC yyyymmdd-hhmmss>-<kind>.zip`. Contents: every `.md` file and every file under `.tegg/`, UTF-8 (NFC) names; attachments only when the job touches them. Rotation: 10 per vault; the 11th deletes the oldest (data-safety AC-2, AC-3).
- Written before the first vault write; failure → the job ends `failed` with `BackupFailed`, and nothing in the vault is written (data-safety AC-1).
- `note-rename` makes no zip (D-269, FR-HIS-04 AC-4). The engine is tested in 4C through `test-backup`; the Settings › Backups UI ships with 4D-lite.

## 7. Undo and redo (D-385, D-395)

- The undo record of a `note-rename` holds the rename pair, and for every written file its pre-job bytes and post-job version. It lives in memory until quit or a vault switch. Only `note-rename` is undoable in the MVP.
- **Undo is a job** (`JobOp::Undo`, kind `note-rename`, no zip): for each written file whose current version equals its post-job version, write the pre-job bytes (renamed note: rename back with §3's atomic step, free stem if the old name was taken meanwhile); any other file is skipped with `changed` and listed (FR-LNK-03 AC-14). Redo re-applies the same bytes under the same checks.
- UI entry points: ⌘Z / ⇧⌘Z in the renamed note (title or body) right after the rename, undo or redo, before any other edit; palette `Undo rename` (last undoable job); the status toast's `Undo` for 5 s.
- A linking note open in an editor is undone and redone through the editor with the reversed (or forward) retarget op, like §9; the renamed note itself is moved back on disk and its page follows (§9).

## 8. Crash recovery (D-387)

- While a `note-rename` (or its undo) is in `writing`, the core keeps a journal at `~/Library/Application Support/Tegg/jobs/<vault-hash>/<jobId>.json`: op, the rename pair, the planned file list with versions, and the pre-job bytes of each file (base64). It is not a zip and not in the backup rotation; it is deleted when the job reaches a final phase.
- On open, a journal left behind gives `job_interrupted()` → `[{ jobId, from, to, done, total }]`; the UI shows `Renaming "<old>" was interrupted: <done> of <total> links updated` with `Finish` (re-plan from the current index and rewrite the rest) and `Undo` (restore the pre-job bytes of files still at their written version). `.tegg-tmp` leftovers are removed by the vault open (data-safety AC-4).

## 9. Editor, watcher and index

- **Open notes (D-386).** For a planned file open in an editor (the UI registers open paths with `editor_open(path)` / `editor_close(path)`, new commands), the core does not write it. It emits `job:transform` with `live: true` in the payload; the UI applies the returned edits as one transaction to the live document (one undo step in that note), and its autosave writes the file through `note_write` as usual. The job counts it `written` when that save lands, or `skipped: changed` if the editor is closed first without saving.
- **The renamed note while open.** The title commit (`NotePage`, ms3-shell §13) calls `note_rename`; until the job has moved the note (or finished without moving it) the autosave holds its writes, and a write already on its way to the old path is treated as stale and redone at the new path. The editor keeps its document; when the job reports `renamed`, the route is replaced (not pushed) with the new path, and history entries for the old path are rewritten (FR-FMT-08 AC-5). Autosave of `title:` while typing stays (D-394).
- **Watcher.** Own writes and renames are registered as own events and not re-processed (echo suppression, ms2-core §3).
- **Index.** Updated per written file inside the job, links re-resolved before `vault:changed` (ms4-links §1).

## 10. UI

- `app/ui/src/jobs/`: `worker.ts`, `bridge.ts` (§2.3), `status.tsx` (status element), `notUpdated.tsx` (the list), `jobs.ts` (`renameNote(path, title, fromTitle)`, `undoLast()`, `subscribe(onProgress)`).
- **Status element** (FR-UX-07 AC-9): `role="status"`, no dialog. Text keys `job.rename.running` (`Updating links in {count} notes`), `job.rename.done` (`Updated links in {count} notes`) with `Undo` (`job.undo`) for 5 s, `job.rename.cancel` (`Cancel`). Nothing is shown when no other file is rewritten.
- **List** (FR-LNK-03 AC-16): status entry `job.notUpdated.count` (`{count} links not updated`, plural); rows with title, path, reason (`job.skip.changed` `changed by another app`, `job.skip.missing` `missing`, `job.skip.placeholder` `not downloaded`, `job.skip.readOnly` `read-only`, `job.skip.io` `could not be written`; D-406), `Open`, `Retry`; `Retry all`. Accessible names: list `Links not updated`, buttons `Retry <title>`, `Retry all`.
- **Commands** (FR-UX-03): `job.undoRename` (`Undo rename`), `job.showNotUpdated` (`Show links not updated`).
- **Interrupted job** banner: `job.interrupted` with `job.finish`, `job.undo`.
- **Merge button** (D-392): relabelled `Coming in MS4 (4D)`.

## 11. Fake core additions (ms3-shell §5)

The fake implements every command of §4 over its in-memory files, using the real `@tegg/doc` `transform` in-process (no worker) and the TS `resolve` for planning. `FakeCoreHandle` gains:

```ts
jobs(): Promise<JobReportDto[]>;
holdJob(phase: 'planning' | 'writing'): Promise<() => Promise<void>>;   // pauses the next job before that phase; returns release()
skipOnWrite(path: string, reason: SkipReason): Promise<void>;           // the next job write to `path` is skipped with `reason`
```

`writeControl` (D-309, D-363) covers job writes. The registered-commands check (ms3-shell §5) includes the new commands.

## 12. Test layout

- **L1** `packages/doc/test/rewrite_links.ac.test.ts` (FR-LNK-03 AC-7, AC-8, AC-9, AC-11 bytes; FR-FMT-08 AC-6 `sanitize` cases), `app/test/jobs_catalog.ac.test.ts` (plural keys).
- **L2** `packages/doc/test/rewrite_links.property.ac.test.ts` (FR-LNK-03 AC-20), `crates/tegg-jobs/tests/ac_property_rename.rs` (FR-LNK-03 AC-19, `NodeTransformer` + in-memory `VaultFs`; fixed seed + one random seed per push, 10 × 1,000 nightly).
- **L4** `crates/tegg-jobs/tests/ac_rename.rs` (FR-FMT-08 AC-6…AC-8, AC-10; FR-LNK-03 AC-7…AC-15, AC-18 conflict path; FR-SYN-06 AC-10, AC-11), `crates/tegg-jobs/tests/ac_job_engine.rs` (FR-HIS-04 AC-4, AC-5; FR-UX-07 AC-8, AC-10), `crates/tegg-jobs/tests/ac_sync_rename.rs` (FR-LNK-03 AC-15 with the sync simulator).
- **L5** `app/webkit/rename.ac.test.ts` (FR-FMT-08 AC-5 gestures, AC-7, AC-9; FR-LNK-03 AC-14 gestures, AC-15 list and Retry, AC-16, AC-18; FR-UX-07 AC-9).
- **L6** `app/e2e/ms4_rename.ac.test.ts` (FR-FMT-08 AC-5; FR-LNK-03 AC-13, AC-14 one round trip, AC-16 one skipped file; FR-UX-07 AC-9 on the hub; FR-HIS-04 AC-6 is `[MS4]` with 4D-lite), `app/e2e/nightly_rename_crash.ac.test.ts` (FR-LNK-03 AC-17, nightly), benchmark `app/e2e/perf_rename.ts` (FR-UX-07 AC-11). Every L6-marked AC has its `app/e2e/` test in the red commit (D-382).
- **Fixture:** `tests/fixtures/vaults/rename/` with its README, byte-exact, in its own commit before the tests (NFD and CRLF files).
- **`qa.config.json`:** new steps for `crates/tegg-jobs` (`cargo test`) at push; the transform CLI build runs before them.
- **AC-Test-Change** in the 4C build commit: editor FR-EDT-01 AC-10's "links stay unchanged" part (now FR-LNK-03 AC-7), daily-notes FR-DLY-08 AC-10 (now FR-FMT-08 AC-9).

## 13. Contract choices (no owner decision needed)

1. The transformer is a trait so the engine is tested in Rust against the real `@tegg/doc` through Node, and the app's worker is only a transport.
2. `RetargetLinks` carries the vault's path list so the TS side can apply the D-291 rule per link without calling back into the core; the core and `@tegg/doc` resolution are kept equal by the ms4-links shared corpus.
3. A same-stem title commit runs as a one-file job, so there is one path for every title commit and undo works the same way.
4. Open notes are rewritten through their editors (D-386) and counted when their save lands; a job therefore can finish after a short wait on autosave (≤ the autosave debounce).
5. Journals hold pre-job bytes as base64 JSON: small for a rename, and readable without the app for support.
