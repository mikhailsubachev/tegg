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
    KeyRename { r#type: String, from: String, to: String },  // not planned: keys are fixed for good (D-806); the shape stays, the planner returns NotImplemented
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
- **Case-only rename**: the new bytes replace the file atomically under its old spelling, then `VaultFs::rename_case` changes only the case, so the note always exists under one of its two names.
- **Files that aren't valid UTF-8** are never transformed or written by a job (D-180, NFR-REL-03): skipped `readOnly`, also on Retry and Finish.
- **Retry** never rewrites the renamed note in place (it would get the new title under its old name); its row answers `changed`. Retry after an undo or redo reverses or re-applies only the link. Retry accepts only a row the job skipped (else `NotFound`), and answers `changed` without writing when the rename has been undone or its note is no longer at the new name; an undo removes that rename's rows from the list (D-433).
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
- **The note first (D-433):** undo and redo move the renamed note before any linking file; if it can't move (changed since, or its old name taken by another note) no linking file is changed and all are listed as not updated.
- **Undo is a job** (`JobOp::Undo`, kind `note-rename`, no zip): for each written file whose current version equals its post-job version, write the pre-job bytes (renamed note: rename back with §3's atomic step; if the old name was taken meanwhile, nothing moves, D-433); any other file is skipped with `changed` and listed (FR-LNK-03 AC-14). Redo re-applies the same bytes under the same checks.
- UI entry points: ⌘Z / ⇧⌘Z in the renamed note (title or body) right after the rename, undo or redo, before any other edit; palette `Undo rename` (last undoable job); the status toast's `Undo` for 5 s.
- A linking note open in an editor is undone and redone through the editor with the reversed (or forward) retarget op, like §9; the renamed note itself is moved back on disk and its page follows (§9).

## 8. Crash recovery (D-387)

- While a `note-rename`, its undo or its redo writes, the core keeps a journal at `~/Library/Application Support/Tegg/jobs/<vault-key>/<jobId>.json`: the kind, the link op and the new title, and one entry per file (path, target path, its bytes when the job started, and for undo/redo the bytes to write). `<jobId>.log` gets one line per entry when it is done: the version written (`W`, size and hash) or nothing written (`N`). Bytes are stored as hex. Both files go when the job reaches a final phase. Job ids start above the highest id with a journal on disk, so a new job never overwrites an unresolved journal.
- On open, `VaultInfo.interrupted` lists them; the UI shows `Renaming "<old>" was interrupted: <done> of <total> links updated` with `Finish` and `Undo`.
  - **Undo**: each file the job wrote that is still exactly the logged version gets its bytes from before the job (the note its old name too); a file changed since is left alone (NFR-REL-02).
  - **Finish**: files not done yet get the job's change from their current bytes, only if they are still what the job found and valid UTF-8; for a rename whose note wasn't renamed yet, the note is renamed first, and if that fails nothing else is changed.
- `.tegg-tmp` leftovers are removed by the vault open (data-safety AC-4). A case-only rename never leaves the note only in a temp file: its bytes are replaced in place, then only the case of the name changes (§3).

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
5. Journals hold pre-job bytes as hex in JSON: small for a rename, and readable without the app for support.

---

## 14. Slice 4E: type moves and schema rewrites (D-803…D-818)

- **Status:** draft, 2026-10-27, written before the 4E-1 red tests; corrected after them by D-819…D-833 (BRD v1.104). **ACs:** [docs/acceptance/type-moves.md](../acceptance/type-moves.md) (approved; D-810…D-818). Where this section and the ACs disagree, the ACs win and this section is corrected before the red tests. §14.1…§14.8 are 4E-1; §14.9 is 4E-2's outline, completed before its red tests (D-818).
- Everything in §1…§13 stays valid unless this section changes it.

### 14.1 Kinds (changes §1)

| Kind | `needsConfirm` | `backup` | `undoable` | Cancellable in | Part |
| --- | --- | --- | --- | --- | --- |
| `type-move`, one note (`Change type…`, a single Inbox convert) | no (the mapping dialog, when shown, is the UI's step before `job_start`) | no (board G) | yes, journal of §8 (D-812) | `planning` | 4E-1 |
| `type-move`, more than one note (bulk Inbox convert) | no (the UI's dialog confirms) | yes | yes, in memory (D-812) | `planning`, `backup` | 4E-1 |
| `folder-move` (folder save, tidy) | no (D-805: no confirmation) | yes, only when it moves something (D-811) | yes, in memory | `planning`, `backup` | 4E-1 |
| `value-remove` | yes | yes | yes, in memory | `planning`, `confirm`, `backup`, `writing` (§14.9) | 4E-2 |
| `type-delete` | yes | yes | yes, in memory | `planning`, `confirm`, `backup`, `writing` (board F2) | 4E-2 |
| `key-rename` | — | — | — | — | never (D-806; `NotImplemented`) |

The `inbox` kind's `SetType` change (ms5-capture §7.3) is replaced by `type-move` for converts; its other changes stay.

### 14.2 Ops and errors (changes §2)

```rust
pub enum JobOp {
    // … §2 unchanged, then:
    /// One or more notes to `to_type` (a type key). `mapping` applies to every note (D-813: one mapping per type pair);
    /// `review`: write `review: reviewed` too (an Inbox convert, D-557).
    TypeMove { paths: Vec<String>, to_type: String, mapping: Vec<PropertyMap>, review: bool },
    /// `to_folder: Some(f)`: the folder save of `r#type` (D-805), every object of the type outside `f` and its
    /// subfolders. `None` with `r#type: None`: the tidy job over every defined type (D-811).
    FolderMove { r#type: Option<String>, to_folder: Option<String> },
    ValueRemove { r#type: String, key: String },                 // 4E-2
    TypeDelete { r#type: String },                               // 4E-2 (D-809: one path; `TypeDeleteChoice` goes)
}
/// One schema property of the old type (D-813: only schema properties are mapped).
pub struct PropertyMap { pub from: String, pub to: MapTarget }
pub enum MapTarget { Property(String), Content }
pub enum JobError { /* … */ NotMovable, UnknownType, NoChange }
```

`TypeMove` replaces the §2 shape `{ path, to_type }` (no planner existed). `NotMovable`: a Daily Note, Tag, Image or PDF object as source, one of those types as target, a file last read as not UTF-8 (D-180), or a path under `.trash/` (FR-STO-04 AC-12). `UnknownType`: `to_type` has no definition. `NoChange`: the target is the note's current type. A note in `_templates/` gets only its `type:` line changed: no mapping, no `modified`, no move (D-829).

### 14.3 Planners (4E-1)

- **Target path** of a moved note: `<folder of the type>/<stem>.md` at the folder's root (D-811), the stem kept when no other note outside `_templates/` and `.trash/` has it (NFC, case-folded, vault-wide), else `free_stem(folder, stem)` (D-291, D-384). A note already directly in or under the target folder doesn't move (its type change is still written).
- **Type move.** Per note: `MapProperties` (§14.4) and `SetType` on the note itself (4E's `set-type`: `type` and `modified` only; `SetReview` too only when `review`, D-826), then the rename to the target path. Linking notes (`Host::linking`) get `RetargetLinks` only for link nodes whose written form stops resolving to the note or that name a renamed stem (D-810; the `@tegg/doc` side decides per node with `paths` before and after). The moved note gets `KeepTargets` (§14.4).
- **Folder move.** Notes: every indexed object whose `type` matches a defined type (D-239) and lies outside that type's folder and its subfolders, minus the exemption list (§14.6); with `to_folder`, only `r#type`'s objects and the folder of the type file is written by the caller before the job (`type_patch`, §14.7). Each note: the rename, `KeepTargets` on itself, `RetargetLinks` on linking notes as above; `modified` is not touched (FR-STO-01 AC-8). Never: notes without `type` (FR-TYP-10), undefined types (D-121), `_templates/`, `.trash/`, non-Markdown files. An empty plan ends `done` with no zip, no write and no progress event after `planning` (D-811).
- **Placeholders** and files with a pending conflict (`Host::has_conflict`, below) are skipped `placeholder` / `changed` and left for the next tidy run (D-805).

### 14.4 Text ops (changes §2.2, §2.3)

```rust
pub enum TextOp {
    // … §2.2 unchanged, then:
    /// D-804, D-813: `map` in old schema order; `labels` are the old properties' display names for the Content lines.
    MapProperties { map: Vec<(String, MapTargetDto)>, labels: Vec<(String, String)> },
    /// D-810: rewrite links in this note that would resolve to another file from `to_path` than from `from_path`.
    KeepTargets { from_path: String, to_path: String, paths: Vec<String> },
    RemoveKey { key: String },                                    // 4E-2 (D-814)
}
```

```ts
export type TextOp =
  | /* … existing … */
  | { op: 'map-properties'; map: { from: string; to: string | 'content' }[]; labels: Record<string, string> }
  | { op: 'keep-targets'; fromPath: string; toPath: string; paths: string[] }
  | { op: 'remove-key'; key: string }
/** D-813: the Content lines of `map-properties`, exported for the dialog's preview and the L1 tests. */
export function contentLine(label: string, value: unknown): string        // `**Autor:** Frank Herbert`
```

- **`map-properties`** (D-804, D-813): a `Property(k)` with `k ≠ from` renames the key in place (value bytes kept, D-230); `Property(from)` leaves the line; `Content` removes the entry (its value lines and full-line comments directly inside its block; a comment line above it goes with it, FR-STO-04 AC-6) and adds `contentLine` at the start of the body, in `map` order, then one blank line. Values: scalars as stored without quotes, dates as `YYYY-MM-DD`, lists joined with `, `, relations as their `[[links]]`, booleans `true`/`false`; empty values write nothing. Keys outside `map` are untouched.
- **`keep-targets`** (D-810): for each link node, resolve from `fromPath` and from `toPath` with `paths`; when they differ, rewrite it to resolve as before: a relative Markdown link gets the relative path from the new folder (same encoding style as §2.3's table), a wikilink or embed gets the shortest path form that resolves (`[[Quick Notes/Plán cesty|Plán cesty]]`; the alias is the written text when there was none; embeds never get an alias). Bytes outside the replaced ranges are unchanged.
- **Percent-encoding** (D-825): a rewritten relative Markdown link encodes only the characters the original encoded (`../Quick%20Notes/Plán.md` → `../Knihy/Plán.md`), in `retarget-links` and `keep-targets`.
- **`retarget-links`** keeps its §2.3 rules; with `fromStem == toStem` only path forms and relative Markdown links change (FR-STO-04 AC-7).

### 14.5 Writes (changes §3)

A move is `Host::rename(from, to, bytes, base)` (`Vault::rename_with` across folders, creating folders), the same atomic step as a note rename; `NameTaken` at that moment → the next free stem, never an overwrite. New `Host` methods (default bodies are stubs, TS-I1):

```rust
fn type_folder(&self, r#type: &str) -> Option<String>;       // the type file's folder, NFC
fn defined_types(&self) -> Vec<String>;                       // keys with a valid definition
fn objects_of(&self, r#type: &str) -> Vec<String>;            // indexed objects whose `type` matches (D-239), no templates, no .trash
fn schema(&self, r#type: &str) -> Vec<HostProperty>;          // key, name, value type, relation targets
fn has_conflict(&self, path: &str) -> bool;                   // a pending FR-SYN-04 conflict
fn local_exempt(&self) -> Vec<String>;                        // §14.6, by id
fn set_local_exempt(&self, ids: &[String]);
```

`HostProperty { key: String, name: String, kind: String /* R10 type key */, to: Vec<String> /* relation targets */ }`. `MapTargetDto` is `String` (a property key) or the literal `content`.

### 14.6 Undo (changes §7, D-812)

- Every 4E-1 job keeps the §7 record (renames, pre-job bytes and post-job version per written file). `Jobs::last_undoable` covers them; `job_undo` / `job_redo` work for them; a file changed since is skipped `changed` and listed. A single-note `type-move` writes the §8 journal (banner text `job.interrupted.typeMove`: `Changing the type of "<title>" was interrupted: <done> of <total> links updated`); multi-file jobs keep no journal (their zip is the recovery, ms4-tags §5.3).
- **Exemptions.** Undoing a `folder-move` adds the moved notes' ids to `<Application Support>/Tegg/jobs/<vault-key>/tidy-exempt.json` (`{ "version": 1, "ids": [...] }`); the tidy planner skips them; an id leaves the list when its note's type changes or its type's `folder` changes.

### 14.7 Core API and IPC (adds to §4)

| Command | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `type_move_plan` | `paths: string[]`, `toType` | `TypeMovePlanDto` | Read-only: the R101 rows (`{ from, name, kind, value: string \| null, default: string \| 'content', offered: { key: string; name: string }[], fixed: boolean }`, D-821) and `needsDialog`. Backed by `Core::type_move_plan(paths, to_type) -> TypeMovePlan`, the one implementation of R101 (D-833). |
| `type_move` | `paths: string[]`, `toType`, `mapping: { from: string; to: string }[]`, `review: boolean` | `{ jobId }` | Errors `NotMovable`, `UnknownType`, `NoChange`. |
| `type_patch` | unchanged | | A `setFolder` op is not written by the command: it starts a `folder-move` job with the new folder, and the job writes `folder:` as its first write after the zip (D-822), so Cancel or a failed zip leaves the type file unchanged. The result gains `jobId: number \| null` (`null`: nothing to move; the folder line is then written directly). The Rust `Core::type_patch` stays a type-file write (D-820). |
| `folder_move_preview` | `type`, `folder` | `{ count: number }` | Read-only: B1's `Saving moves <n> …` count. |
| `tidy_now` | — | `{ jobId: number \| null }` | Tests and the palette only; the core starts the tidy job itself at vault open (after the first index and once the transformer is set) and after 30 s without a watcher event, only when the vault was opened with its watcher (D-819); a skipped stray starts a new 30 s period after its skip (D-832). `TEGG_TEST_QUIET_MS` overrides the 30 s. |
| `job_undo`, `job_redo` | unchanged | | Accept 4E-1 jobs. |

`JobProgressDto.kind` gains `type-move`, `folder-move`; `JobReportDto` gains `moved: { from: string; to: string }[]`.

### 14.8 UI, fake core and tests (4E-1)

- `app/ui/src/types/ChangeTypeDialog.tsx` (board A; from `Change type…` and the Inbox's `Convert to…` when `needsDialog`), `app/ui/src/types/FolderField.tsx` (B1 help text from `folder_move_preview`), `app/ui/src/jobs/status.tsx` gains the R99 texts of A, B2 (keys `job.typeMove.done` `Now a {type}`, `job.folderMove.running`, `job.folderMove.done`, `job.folderMove.tidy`, `job.folderMove.skipped`), `job.undo.*` commands of R100. The Inbox's convert calls `type_move` with `review: true` (replaces the `set-type` single write and the bulk `inbox` `SetType`).
- **Test points** (D-823): `JobPoint::BeforeBackup`; the fake core's `holdJob('backup')` and `setConflict(path)`; at L4 the test host answers `has_conflict`. Hook `TEGG_TEST_FOCUS_FOLDER` focuses `Folder in the vault` (D-831). The `job.undo.*` commands are always registered and run only while a matching job is undoable (D-830). `ChangeTypeDialog` props: `{ plan, fromName, toName, targetNames, onConfirm, onCancel }` (D-821).
- **Fake core** (§11): `type_move_plan`, `type_move`, `folder_move_preview`, `tidy_now`, the `type_patch` folder job, undo of both kinds, over its files with the real `@tegg/doc`; `FakeCoreHandle.tidyExempt(): Promise<string[]>`.
- **Test layout:** L1 `packages/doc/test/type_moves.ac.test.ts` (`map-properties`, `contentLine`, `keep-targets`, `retarget-links` path forms), `app/test/type_moves_catalog.ac.test.ts`; L2 `packages/doc/test/type_moves.property.ac.test.ts` (FR-FMT-07 AC-26, 4E-1 ops); L4 `crates/tegg-jobs/tests/ac_type_move.rs`, `ac_folder_move.rs` (with the sync simulator and an injected quiet period); L5 `app/webkit/type_moves.ac.test.ts`; L6 `app/e2e/ms7_type_moves.ac.test.ts`, nightly `app/e2e/nightly_type_move_crash.ac.test.ts`, benchmark `app/e2e/perf_type_move.ts`. Fixture `tests/fixtures/vaults/type-moves/` with its README, byte-exact, in its own commit before the tests.

### 14.9 4E-2 outline (completed before the 4E-2 red tests)

`value-remove`: confirm with `{ files, empty }` counts in `job_plan` (D-807, D-814); `RemoveKey` on each object with a non-empty value, then `type_patch`'s item and `preview` removal as the job's last write; Cancel during `writing` reverses the files written so far (board D3). `type-delete`: `Host::trash` per object, then `_templates/<Name>/` and the type file last, only when nothing was skipped (D-815); Cancel during `writing` untrashes what was trashed; `trash_restore` of an object whose type key has no definition also restores the type file from `.trash/.tegg/types/` (D-815). The widen-only `Type` menu (D-808) is UI and `tegg-schema` only: `type_misfits` goes.
