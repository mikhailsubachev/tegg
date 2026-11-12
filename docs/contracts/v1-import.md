# v1.0 Import Interface Contract (slice I1, the Capacities import engine)

- **Status:** draft, 2026-11-12. Written before the I1 red tests. Follows D-41…D-50, D-57, D-75…D-84, D-110, D-801 and the import decisions D-1517…D-1550 (BRD v1.163, v1.164). Seven points are **pending** with the owner (CP-1…CP-7, §18); the contract is written to their recommendations and each place that depends on one names it.
- **ACs:** [docs/acceptance/import-capacities.md](../acceptance/import-capacities.md), every criterion marked *I1* (tables R147…R150, R153), and [daily-notes.md](../acceptance/daily-notes.md) FR-DLY-01 AC-12 (D-1546, added with this contract). Where this contract and the ACs disagree, the ACs win and this contract is corrected before the red tests.
- **Builds on** [ms4-jobs.md](ms4-jobs.md) (job model §1, transformer §2.2, backups §6, crash recovery §8), [ms4-links.md](ms4-links.md) (§1 resolution, D-184 link text), [ms4-daily.md](ms4-daily.md) (§2 duplicates of a date), [ms6-trash-media.md](ms6-trash-media.md) (Image and PDF objects), [ms1-core.md](ms1-core.md) (`VaultFs`, `FileVersion`), [architecture.md](../architecture.md) §3.2, §5.6, §5.7, ADR 0003 (D-82). Everything there stays valid unless this contract changes it.
- **Slices.** This contract fixes **I1** only: the engine, with no window. **I2** (the Import window) gets its own sections later; §15 names what it will add and fixes nothing.
- **Port, not import (D-83).** The S5 spike is in commit `75b3382` (`spikes/s5-capacities-import/src/`). §1.2 says what is ported from which file. Tests are re-authored from the ACs (D-61); the spike's tests are not ported.

Until a part is implemented it exists as a stub that compiles and returns a deliberately wrong result (an empty plan, `ImportError::Io("stub")`), so a test fails on its assertion, never on a build or import error (TS-I1).

---

## 1. Crate `tegg-import` (new, `crates/tegg-import`)

### 1.1 Place in the dependency rules

Platform-neutral (AR-03): no Tauri, no desktop API, no network crate. It sits **above** `tegg-core`:

| May use | For |
| --- | --- |
| `tegg-format` | `nfc`, `sanitize_file_stem`, `type_key`, `RESERVED_KEYS`, date parsing |
| `tegg-schema` | reading the target's type files, `serialize` / `patch` for type-file bytes (§7.2), `derive_attr_key`, `check_attr_key`, `check_type_name` |
| `tegg-vault` | **all** file access (AR-04 AC-1): `LocalFs` for the target, the new read-only source access and disk queries of §12.2 |
| `tegg-jobs` | `Transformer`, `TextOp`, `JobId`, `Phase`, the `import` job kind and its journal (§9, §12.1) |
| `tegg-core` | an **existing-vault** target: its index (`import-id`s, link resolution), its type files, its `Jobs` queue, its events |
| external crates | `zip` 2 (`default-features = false`, `deflate`), `yaml-rust2`, `regex`, `serde`, `serde_json`, `chrono`, `chrono-tz`, `unicode-normalization`, `percent-encoding` |

- `tegg-core` does **not** depend on `tegg-import`. The shell (`app/src-tauri`, slice I2) calls both. So an import with no vault open needs no `Core`.
- No Markdown parser in this crate: no `pulldown-cmark` (CP-1). The independent link counter of §6.4 uses `regex` on purpose.
- `std::fs`, `File::create`, `OpenOptions` and `notify` never appear in `crates/tegg-import/src` (the AR-04 AC-1 check reads every crate under `crates/`, so it covers this crate with no change; the AR-03 AC-1 check reads `cargo tree --workspace`, so it covers it once the crate is a workspace member).
- `zip` joins the L0 network allow-list review (test-strategy TS-L0): it opens no socket.

### 1.2 What is ported from the spike

| Spike file (`75b3382`) | Becomes | How |
| --- | --- | --- |
| `source.rs` | `src/source.rs` | **Rewritten.** The spike read every entry's bytes into memory. The engine keeps a directory (name, size, modification time) and reads entries on demand, in place; it adds the refusals of R153, path-traversal handling and the source stamp (§3) |
| `plan.rs`: `layout`, `space_of`, `spaces`, `is_object_file`, `is_attachment_file`, `split_frontmatter`, `parse_note`, `status_state`, `join_relative` | `src/layout.rs`, `src/note.rs` | Ported nearly as written |
| `plan.rs`: `map_type`, `map_attr`, `infer`, `dry_run`, `Report` | `src/mapping.rs`, `src/planner.rs`, `src/plan.rs` | **Rewritten around the mapping as data** (§4): defaults become R148 rows, `infer` follows D-1526 and D-1545, `Report` becomes the plan DTO (§5), file names come from `tegg_format::sanitize_file_stem` |
| `convert.rs` | `src/dates.rs` | Ported nearly as written; the zone is injected (§2) |
| `scan.rs` | — | **Not ported** (CP-1): links, clean-up counts and code spans come from `@tegg/doc` (§7.1). Only `decode_path` moves to `src/note.rs` |
| `accounting.rs` | `src/accounting.rs` | Ported; it now counts external links too (R147) and gains the check on the written vault (§6.4) |
| `report.rs`: `counts_only`, `is_counts_only` | `src/real_export.rs` | Ported (§13). `markdown()` is dropped: the report Page is rendered by `@tegg/doc` from data (§7.4) |
| `main.rs`, `tests/real_export.rs` | `examples/real_export.rs` | Rewritten as the owner's run (§13) |

New code with no spike source: the mapping format and its validation, the write phase, the journal and roll-back, the new-vault folder, type-file bytes, the `@tegg/doc` import ops.

### 1.3 Modules and public surface

`pub mod accounting; pub mod mapping; pub mod plan; pub mod real_export; pub mod testing;` and the items of §2…§10 re-exported from the crate root. Everything else is private.

---

## 2. Environment and injection points

Every call takes an `ImportEnv`. Nothing in the engine reads the system clock, the system time zone, the free disk space or a random source directly.

```rust
#[derive(Clone)]
pub struct ImportEnv {
    /// Now (UTC). Read once per `start`: the import time of D-1538 and the report's date come from it.
    pub clock: Arc<dyn Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync>,
    /// The machine's zone (FR-IMP-09, R150's date). Criteria marked (Z) run with three zones.
    pub zone: chrono_tz::Tz,
    /// Object ids, in write order (R149). The app passes ULIDs; tests pass `01JB5V000000000000000000nn`.
    pub ids: Arc<dyn Fn() -> String + Send + Sync>,
    /// The one text engine (D-82). Used by `plan` (CP-1) and by the run.
    pub transformer: Arc<dyn tegg_jobs::Transformer>,
    /// `<Application Support>/Tegg`: journals and backups (existing-vault target only).
    pub dirs: tegg_vault::AppDirs,
    /// Free space and volume identity (FR-IMP-07 AC-12).
    pub disk: Arc<dyn Disk>,
    /// The report Page's own words (R150, NFR-OTH-02 AC-18). `ReportStrings::english()` is R155's text.
    pub strings: ReportStrings,
    /// Tests only: named points of a run (§2.1). `None` in the app.
    pub points: Option<PointHook>,
}

pub trait Disk: Send + Sync {
    fn free(&self, path: &Path) -> io::Result<u64>;      // bytes free on the volume holding `path` (or its nearest existing parent)
    fn volume(&self, path: &Path) -> io::Result<u64>;    // an id equal for two paths on one volume
}
pub struct SystemDisk;                                    // `tegg_vault::free_space`, `tegg_vault::volume_id` (§12.2)

/// Catalog key (`import.report.*`, R155) → text. A missing key is written as the key itself.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportStrings(pub BTreeMap<String, String>);

#[derive(Clone, Default)]
pub struct Control {
    pub cancel: CancelToken,                              // `CancelToken::new()`, `.cancel()`, `.is_cancelled()`
    pub progress: Option<Arc<dyn Fn(&ImportProgress) + Send + Sync>>,
}
```

`tegg_import::testing::env(dirs: &AppDirs, transformer) -> ImportEnv` gives the test clock (`2026-11-12T10:00:00+01:00`), Europe/Prague, the `01JB5V…nn` id source starting at `01`, `SystemDisk`, English strings and no hook.

### 2.1 Run points (tests only)

```rust
pub type PointHook = Arc<dyn Fn(&ImportPoint) -> PointAction + Send + Sync>;
pub enum PointAction { Continue, Fail(io::ErrorKind) }

pub enum ImportPoint {
    /// The job left the queue; the re-checks of §9.2 haven't run. Nothing is written.
    BeforeChecks,
    /// Every object's bytes are rendered; nothing is written. Still cancellable.
    Rendered,
    BeforeBackup,
    /// The zip is complete; no vault file is written yet (FR-IMP-03 AC-13's second case).
    AfterBackup,
    /// `path` (a vault path of the target): its journal line is on disk, its temp file isn't.
    BeforeTemp { path: String, kind: FileKind },
    /// The temp file is complete; the rename hasn't happened.
    TempWritten { path: String, kind: FileKind },
    /// The file is at its final name.
    Renamed { path: String, kind: FileKind },
    /// New vault only: every file is written; the folder still has its temporary name.
    BeforeFinalRename,
    AfterFinalRename,
}
pub enum FileKind { Marker, VaultFile /* `.tegg/vault.yml`, system type files */, TypeFile, Attachment, Object, Report }
```

- The hook runs on the run's thread and may block (to change the vault, the source or the target place from outside).
- `PointAction::Fail(kind)` at `BeforeTemp` or `TempWritten` makes that write fail with an `io::Error` of that kind, as if the file system had answered it (`StorageFull` is the `ENOSPC` of FR-IMP-03 AC-4).
- **A kill** is a hook that panics (as the existing crash tests of `tegg-jobs` do) or a child process killed with SIGKILL (as `tegg-vault/tests/ac_crash.rs`). The engine runs no roll-back and no clean-up when the hook panics, and holds no clean-up in `Drop`: what is on disk is what a kill leaves.
- **No socket counter in the engine.** FR-IMP-03 AC-1's network check at L4 is the test's own: it samples `lsof -i -a -p <pid>` for the test process and the transformer's Node process (`NodeTransformer::pid()`, §12.1) during scan, plan and write, and requires no socket. The L0 allow-list covers the crate's dependencies.

---

## 3. Scan

```rust
pub fn scan(path: &Path, env: &ImportEnv, ctl: &Control) -> Result<Scan, ImportError>;

pub struct Scan {
    pub source: Arc<Source>,          // opaque handle: the directory of entries; no file content is kept
    pub info: ScanInfo,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanInfo {
    pub kind: SourceKind,             // "zip" | "folder"
    pub name: String,                 // the file or folder name, NFC
    pub size: Option<u64>,            // the zip file's size; None for a folder (D-1544)
    pub files: usize,                 // entries read (folders not counted)
    pub unreadable: Vec<Unreadable>,  // counted, never dropped (FR-IMP-07 AC-7, AC-8)
    pub outside_spaces: usize,        // files in no space (AC-5): counted here and in every plan's `otherFiles`
    pub spaces: Vec<SpaceInfo>,       // by object count, largest first, ties by name (D-1544)
}
pub struct SpaceInfo { pub name: String, pub objects: usize, pub attachments: usize, pub types: Vec<TypeCount> }
pub struct TypeCount { pub source_type: String, pub objects: usize }          // by `type:` value, in name order
pub struct Unreadable { pub entry: String /* lossy name or `#<index>` */, pub reason: UnreadableReason }
pub enum UnreadableReason { BadName, Traversal, Read, Encrypted }
```

- **Input.** A path to a `.zip` file or a folder (FR-IMP-07 AC-1). A zip is read **in place**, through the `zip` crate, never with the system `unzip` and never extracted (AC-8): the engine has no temporary directory of its own for a source.
- **Names.** Decoded as UTF-8 also without the zip's UTF-8 flag, `\` read as `/`, leading `./` dropped, then NFC (AC-2). An entry whose name isn't valid UTF-8 is `BadName`. An entry named with `..` as a path part, an absolute path or a drive letter is `Traversal`: never read into a plan, never written (AC-8).
- **Layout** (AC-5, ported): a space is a folder with typed notes one level below it; one wrapper folder around the spaces is skipped; an export with no space folder is one space named after the source's file or folder name without `.zip`.
- **Classes** (D-79, R147): object = `.md` that isn't a dotfile and lies in a space; other file = `.csv` and dotfiles; attachment = every other file in a space.
- **Progress:** `ImportProgress { phase: Reading, done, total }` per file, at least every 500 ms (§10.2). `ctl.cancel` ends the call within 1 s with `Err(Cancelled)` after a final `Cancelled` event.
- **Refusals** (§11): `NotCapacities`, `UnreadableArchive`, `EncryptedArchive` (every entry needs a password; single encrypted entries are `Unreadable { Encrypted }`), `Empty`, `SourceGone`.
- **The stamp.** `Source` records, for a zip, the file's size and modification time and each entry's uncompressed size and CRC from the directory; for a folder, each file's size and modification time. `SourceChanged` and `SourceGone` are decided against it (§9.2, §9.6).
- Scanning writes nothing anywhere (FR-IMP-05 AC-5).

---

## 4. The mapping (data)

A mapping is given as data and may be partial; the engine fills the rest with R148's defaults and returns the **effective** mapping in the plan (`Plan.mapping`). The default mapping is therefore `plan(…, &Mapping::default(), …)?.mapping`. Nothing about a mapping is stored by the engine (D-1525, D-1528).

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mapping {
    pub version: u32,                                   // 1; 0 (the default) is read as 1
    /// Key: the Capacities `type:` value, NFC (`Book`, `DailyNote`).
    pub types: BTreeMap<String, TypeMapping>,
    /// D-81: case-only links the user confirmed. Default: none.
    pub case_links: Vec<CaseLinkChoice>,
}

#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TypeMapping {
    pub to: Option<TypeTarget>,                         // None: R148's default
    /// Key: the source attribute key as written, NFC.
    pub attributes: BTreeMap<String, AttrMapping>,
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TypeTarget {
    Existing { key: String },                           // a type key of the target vault (`book`)
    New { name: String },                               // plural and folder stay the export folder's name (D-1526)
    Skip,                                               // `Don’t import` (D-1527 (1))
}

#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttrMapping {
    pub to: Option<AttrTarget>,                         // None: R148's default
    /// D-1527 (2). None: merge as proposed. `Off`: no merge. `Keep`: folded value → the spelling kept.
    pub merge: Option<Merge>,
    /// FR-IMP-08 AC-5, AC-11.
    pub split: Option<Split>,
    /// Task `status` only (D-1527 (3)): source value → an existing status label of the Task type. "" is the empty value.
    pub values: BTreeMap<String, String>,
}

#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttrTarget {
    Existing { key: String },                           // an attribute key of the target type
    New { name: String, r#type: Option<String> },       // R10 type key (`text`, `checkbox`, `select`, …); None: inferred (D-1526)
    Drop,
}
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Merge { Off, Keep { spellings: BTreeMap<String, String> } }
#[serde(rename_all = "camelCase")]
pub struct Split { pub on: bool, pub to: Option<String> /* source `type:` value of the link targets, e.g. `Person` */ }
#[serde(rename_all = "camelCase")]
pub struct CaseLinkChoice { pub note: String /* source path in the space */, pub target: String /* link text as written, NFC */, pub r#use: bool }
```

JSON form (FR-IMP-08 AC-6's mapping, plus one of each option):

```json
{
  "version": 1,
  "types": {
    "Book": {
      "to": { "kind": "new", "name": "Kniha" },
      "attributes": {
        "author":   { "to": { "kind": "new", "name": "autor", "type": "text" } },
        "finished": { "to": { "kind": "new", "name": "přečteno", "type": "checkbox" } },
        "language": { "merge": { "kind": "keep", "spellings": { "eng": "ENG" } } },
        "domain":   { "to": { "kind": "drop" } }
      }
    },
    "Idea":   { "to": { "kind": "existing", "key": "page" } },
    "Person": { "to": { "kind": "skip" } },
    "Task":   { "attributes": {
      "status": { "values": { "Not Started": "To do", "": "To do" } },
      "people": { "to": { "kind": "new", "name": "people", "type": "relation" }, "split": { "on": true, "to": "Person" } } } },
    "Trip":   { "attributes": { "status": { "to": { "kind": "new", "name": "status", "type": "select" } } } }
  },
  "caseLinks": [ { "note": "Pages/Odkazy.md", "target": "tomáš", "use": true } ]
}
```

### 4.1 Defaults and inference

- **Types:** R148's first table. A source type other than the fixed ones maps onto the vault type whose name or plural equals it (NFC, case-insensitive; D-1525), else `New { name: <type: value> }`.
- **Attributes:** R148's second table, in this order: the on-purpose rows (`title`, `description`, `aliases`, `tags`, `createdAt`, `lastUpdated`, `reviewed`, `icon`, `coverImage`, the Task rows); the dropped technical keys (D-78); any other reserved key of `tegg_format::RESERVED_KEYS` → `<key>-text` (D-1550); else the target type's attribute with the same key when every value converts without loss (D-1529 (3), the widen-only table of ms4-jobs §14.9.7), else a new attribute.
- **Kind of a new attribute:** D-1526's order (checkbox, number, date, date-time, date range, relation, select, text) over the non-null values of the attribute in the space; distinct values for the select rule are counted after trimming and case-folding (D-1545 (2)); a mixed attribute is text; an all-null attribute isn't created and is reported.
- **Values are converted one by one** whatever the attribute's kind (D-1545 (3)): a UTC-midnight date-time → `YYYY-MM-DD`; another date-time → the local offset of `env.zone`; `a -> b` → `<key>-start`, `<key>-end`; `null` → omitted; anything else as written.
- **Merges:** proposed only for values equal after trimming and case-folding; the kept spelling is the one used by more objects, then one matching an existing option of the target attribute, then the first by source path (D-1527 (2)).
- **A link-select attribute** (FR-IMP-21): an attribute whose every value is a link with no matching object is listed in `Plan.decisions.tagLike`; it becomes a select only when the mapping gives it `"type": "select"` (D-1536).
- **Key of a new attribute (CP-3, pending).** The name as given when it is a valid Tegg key (`tegg_schema::check_attr_key`: letters, digits, `-`, `_`, starting with a letter, not reserved); else `tegg_schema::derive_attr_key(name)`. The attribute's `name` in the type file is the name as given. The default name is the source key, so `peopleInvolved` stays `peopleInvolved`, and `Datum konání` becomes the key `datum-konání` with the name `Datum konání`; the change of key is a row of the report's Attributes section.

### 4.2 Validation (FR-IMP-08 AC-12, FR-IMP-03 AC-8)

`plan` returns `ImportError::InvalidMapping { entry, reason }` before anything else when the mapping can't be applied. `entry` is `MappingEntry { source_type: String, attribute: Option<String> }`.

| `reason` | When |
| --- | --- |
| `UnknownSourceType`, `UnknownSourceAttribute` | the mapping names a type or attribute the space doesn't have |
| `UnknownTargetType`, `UnknownTargetAttribute` | `Existing` names a key the target doesn't have (a new vault has only the seven system types) |
| `TypeNotAllowed` | a target of D-1527 (6)'s closed set (Task, Daily Note, Image, PDF, Quick Note, Tag) for a source type that doesn't default to it; `Image` / `PDF` retargeted (D-1544) |
| `NameTaken` | a new type named as an existing type or as another new type of the mapping (name or plural, NFC, case-insensitive) |
| `ReservedKey` | a new attribute whose key is reserved (FR-TYP-15) |
| `EmptyName` | a new type name that sanitizes to an empty folder name, or an empty attribute name |
| `DuplicateTarget` | two source attributes of one type onto one target key |
| `KindMismatch` | an existing attribute whose kind can't hold every value (`author` onto `rating`), or a `type` that isn't an R10 key |
| `UnknownStatus` | a `values` entry naming a status the Task type doesn't have |
| `UnknownVersion` | `version` above 1 |

---

## 5. Plan

```rust
pub enum Target<'a> {
    /// `<parent>/<name>` must not exist; `name` is sanitized by the caller's rules (D-1537) and checked here.
    NewVault { parent: PathBuf, name: String },
    /// An open vault. Its first index build must have ended (`IndexNotReady` otherwise, as D-1510).
    Existing(&'a tegg_core::Core),
}

pub fn plan(scan: &Scan, space: &str, target: &Target<'_>, mapping: &Mapping, env: &ImportEnv, ctl: &Control)
    -> Result<Plan, ImportError>;
```

- Read-only: no file, no folder, nothing in Application Support is created or changed (FR-IMP-05 AC-5). A dropped `Plan` is a cancelled preview (AC-2).
- Deterministic: objects in source-path order (NFC paths compared by code point); the same inputs give equal plans (FR-IMP-03 AC-9). `Plan` is `PartialEq`.
- **Links are read by `@tegg/doc`** (CP-1, pending): `plan` sends each readable note to `env.transformer` with the op `import-scan` (§7.1). A transformer error on a note makes that note `unreadable` with the reason `engine`; `Unavailable` fails the call with `ImportError::Transform`.
- Progress: `phase: Planning`, `done` / `total` in notes. Cancel ends within 1 s with `Err(Cancelled)`.
- Refusals: `UnknownSpace`, `InvalidMapping`, the target refusals of R153 (`TargetExists`, `TargetNotWritable`, `TargetInsideVault`, `TargetInsideSource`), `NoSpace { needed, free }`, `SourceChanged` / `SourceGone` (the stamp is checked at the start of `plan`).

### 5.1 The plan DTO

All structs are `Clone + Debug + PartialEq + Serialize + Deserialize`, `camelCase` in JSON, with public fields (FR-IMP-05 AC-6 changes a plan on purpose).

```rust
pub struct Plan {
    pub version: u32,                         // 1
    pub space: String,
    pub source: ScanInfo,
    pub target: PlanTarget,                   // { kind: "newVault", parent, name } | { kind: "existing", name, notes: usize }
    pub mapping: Mapping,                     // effective (§4)
    pub types: Vec<PlannedType>,              // one per source type, in name order
    pub objects: Vec<PlannedObject>,          // every object of R147, in source-path order
    pub attachments: Vec<PlannedAttachment>,  // every attachment of R147, in source-path order
    pub other_files: Vec<OtherFile>,          // `.csv`, dotfiles, files outside every space: reported only
    pub links: Vec<PlannedLink>,              // every link of R147, by note then by position
    pub report: ReportData,                   // §5.3: R150's rows
    pub totals: Totals,
    pub decisions: Decisions,                 // step 4c's candidates (D-1536)
    pub already_imported: usize,              // FR-IMP-20 AC-2; 0 for a new vault
    pub report_path: String,                  // `Pages/Import report 2026-11-12 PKM.md` (R150; ` (2)` when taken)
    pub space_bytes: u64,                     // uncompressed size of the space's entries
    pub backup: Option<BackupPlan>,           // { files: usize, bytes: u64 } when D-1549 (5) asks for a zip
    pub needed_bytes: u64,                    // FR-IMP-07 AC-12
    pub stamps: Stamps,                       // the source stamp and the type-file stamps (§9.2); opaque to callers
}

pub struct PlannedType {
    pub source_type: String, pub source_folder: String, pub objects: usize,
    pub target: TypeTarget,                   // effective
    pub key: Option<String>,                  // target type key; None for Skip
    pub name: Option<String>, pub plural: Option<String>, pub folder: Option<String>,
    pub new: bool,
    pub attributes: Vec<PlannedAttr>,         // in source order (first seen by source path)
}
pub struct PlannedAttr {
    pub source_key: String,
    pub action: AttrAction,                   // "keep" | "rename" | "drop" | "new" | "consumed" (title, type, …) | "notCreated" (all null)
    pub key: Option<String>, pub name: Option<String>,
    pub r#type: Option<String>,               // R10 type key as written to the type file
    pub values: usize, pub nulls: usize,
    pub options: Vec<String>,                 // select: in first-seen order, after merges
    pub merges: Vec<ValueMerge>,              // { variants: Vec<String>, kept: String, applied: bool }
    pub statuses: Vec<StatusMap>,             // Task status: { value, to, state, count, fallback: bool }
    pub split: Option<Split>,
    pub needs_look: bool,                     // D-1532 (the window's count; I2)
}

pub struct PlannedObject {
    pub source: String,                       // path inside the space, NFC, "/" (`Meetings/Tomáš  Eva (1).md`); for a D-77 media object the media file's path
    pub import_id: String,                    // `capacities:<space>/<source>` (FR-IMP-15 AC-7)
    pub outcome: ObjectOutcome,               // "imported" | "skipped" | { "unreadable": { reason, line } }
    pub source_type: Option<String>,
    pub r#type: Option<String>,               // target type key
    pub title: Option<String>,
    pub path: Option<String>,                 // planned vault path (`Books/Book 1 (2).md`)
    pub kind: ObjectKind,                     // "note" | "media" (has a source `.md`) | "orphanMedia" (D-77) | "queryStub"
    pub frontmatter: Vec<(String, serde_json::Value)>,   // R149's order without `id`; `created` / `modified` absent when the import time is used (D-1538 (4))
    pub name_changes: Vec<NameChange>,        // "reserved" | "empty" | "cut" | "suffix" | "characters" (R150 Files)
}

pub struct PlannedAttachment {
    pub source: String,
    pub outcome: AttachmentOutcome,           // "imported" | { "unreadable": { reason } }
    pub path: Option<String>,                 // `_attachments/Mapa řeky (2).jpeg`
    pub object: Option<String>,               // `source` of its Image or PDF object
    pub bytes: u64,
    pub renamed_from_generic: bool,           // FR-IMP-14 AC-3
    pub referenced: bool,                     // false: D-77
}
pub struct OtherFile { pub source: String, pub kind: OtherKind /* "tagCollection" | "csv" | "dotfile" | "outsideSpace" */ }

pub struct PlannedLink {
    pub note: String,                         // `source` of the linking object
    pub n: u32,                               // index among the note's links, as `import-scan` numbers them
    pub line: u32,                            // 1-based, frontmatter lines counted
    pub place: LinkPlace,                     // "body" | { "frontmatter": { key } }
    pub form: LinkForm,                       // "wikilink" | "embed" | "markdown" | "image"
    pub written: String,                      // the link's source text, byte for byte
    pub target: String,                       // the target as read: wikilink target, or the decoded destination, NFC
    pub outcome: LinkOutcome,
    pub to: Option<String>,                   // planned vault path of the object or attachment it resolves to
    pub simplified: bool,                     // D-1533: formatting or an image dropped from the link text
    pub kept_as_markdown: bool,               // CP-2: the text can't be a wikilink alias
}

#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LinkOutcome {
    Resolved, DateMention, Attachment, External,                                  // imported
    Unresolved, OtherSpace { space: String }, Ambiguous, CaseMismatch { confirmed: bool },
    SelectValue, MissingFile, InSkippedNote, TargetNotImported,                   // reported
}
impl LinkOutcome { pub fn imported(&self) -> bool; }

pub struct Totals { pub objects: Tally, pub attachments: Tally, pub links: Tally, pub other_files: Tally }
pub struct Tally { pub total: usize, pub imported: usize, pub reported: usize }
pub struct Decisions { pub case_links: Vec<CaseLinkCandidate>, pub ambiguous: Vec<AmbiguousLink>, pub tag_like: Vec<TagLikeAttr> }
```

- **Outcome names are R147's**, in kebab-case in JSON: `resolved`, `date-mention`, `attachment`, `external`, `unresolved`, `other-space`, `ambiguous`, `case-mismatch`, `select-value`, `missing-file`, `in-skipped-note`, `target-not-imported`. `imported()` is true for the first four. `ambiguous` and a confirmed `case-mismatch` carry `to` (they are written as links) and are still counted as reported, as R147 lists them.
- **Totals:** `objects.imported` counts `imported`; `reported` counts `skipped` and `unreadable`. `links.imported` counts `imported()`. `other_files` are all reported.
- **`needed_bytes`** (D-1549 (3)): `ceil(1.1 × space_bytes)`, plus `backup.bytes` when the backup folder is on the target's volume (`env.disk.volume`). `NoSpace` when `needed_bytes > env.disk.free(target place)`, or when the backup folder is on another volume and `backup.bytes > env.disk.free(backup folder)`; then `needed` and `free` are that volume's.
- **`already_imported`** (FR-IMP-20 AC-2): objects of the target's index (so never `.trash/` or `_templates/`) whose `import-id`, NFC, equals a planned `import_id`.

### 5.2 Names and paths

- **Stem:** `tegg_format::sanitize_file_stem(title)` after the clean-up of FR-IMP-17 and trimming (D-51, D-52, D-68, D-80: `CON` → `CON_`, no valid character → `Untitled`, at most 200 UTF-8 bytes at a character boundary and never inside a combining sequence).
- **Folder:** the target type's folder (`Books/`, `Daily/`, `_attachments/` for files).
- **Free name (CP-5, pending: per folder, as FR-IMP-03 AC-7 says):** the first of `<stem>`, `<stem> (2)`, `<stem> (3)`… whose key (NFC, case-folded) no existing file of that folder and no earlier planned file of that folder has. Objects are named in source-path order, attachments after them in source-path order.
- **Daily Notes:** stem `YYYY-MM-DD` from the note's date (FR-IMP-11 AC-6), `title` the same; a day the vault already has gets ` (2)` (D-1529 (2), D-1546).
- **Attachments:** the source file name, NFC; a generic name (`@tegg/doc` `isGenericName`: `image (3)`, `Untitled (44)`) becomes `<owning note title> <n>` (FR-IMP-14 AC-3); an unreferenced file keeps its name (D-77).
- **The report:** `Pages/Import report <YYYY-MM-DD> <space>.md`, the date from `env.clock` in `env.zone`, the same free-name rule.

### 5.3 Report data

`ReportData` is R150 as data, one field per section, each a list of rows that hold source paths (`note`), link text as written, keys, values and counts, never rendered text. `ReportData.summary` holds the three tallies, the source name, the space and the date. The same struct is what `@tegg/doc` renders into the report Page (§7.4), so the report's numbers are the plan's (FR-IMP-05 AC-7). After a re-check that renames a planned path (§9.2) the run adds the row to `files` before rendering.

---

## 6. Accounting (R147, FR-IMP-05 AC-6)

```rust
pub mod accounting {
    pub fn check_plan(source: &Source, plan: &Plan) -> Vec<Violation>;
    /// `root`: the written vault's folder. Reads it through `tegg-vault`.
    pub fn check_vault(source: &Source, plan: &Plan, root: &Path) -> Vec<Violation>;
    pub fn totals(source: &Source, space: &str) -> RawTotals;           // { objects, attachments, links, other_files }
    pub fn count_links(text: &str) -> usize;
}
pub struct Violation { pub class: Class /* Objects | Attachments | Links | OtherFiles */, pub code: ViolationCode, pub detail: String }
pub enum ViolationCode { TotalMismatch, SumMismatch, MissingRow, ForeignItem, DuplicateItem, NotWritten, WrittenNotPlanned }
```

- An empty list means `imported + reported = total` for objects, attachments and links, and every reported item is in a report list.
- **6.1 Independence.** `accounting` imports nothing from `layout`, `planner` or `source`'s classification: space membership by path alone, classes by extension, and its own link counter. A test asserts the module's `use` lines.
- **6.2 Totals.** `totals()` recomputes them from the raw entries; `check_plan` compares them with `plan.totals` (`TotalMismatch`), checks `imported + reported == total` per class (`SumMismatch`), that every non-imported object, attachment and link has its row in `plan.report` (`MissingRow`), that every planned item's `source` lies in the space (`ForeignItem`) and occurs once (`DuplicateItem`).
- **6.3 Written vault.** `check_vault` also requires each `imported` object and attachment to exist at its planned path (`NotWritten`) and no file with an `import-id` of this run outside the plan (`WrittenNotPlanned`).
- **6.4 The link counter** counts, outside fenced code and code spans, every `[[…]]` with a non-empty target and every `](destination)` with a non-empty destination, **external ones included** (R147 counts them; the spike didn't), in the whole file text (frontmatter included). It is a regex on purpose, so it shares nothing with `@tegg/doc`.
- `detail` holds source paths and counts. The real-export run prints only `ViolationCode` counts (§13).

---

## 7. Who produces which bytes (D-1534, D-82)

| File | Bytes come from | Notes |
| --- | --- | --- |
| Object files (`.md`), query stubs | `@tegg/doc` `importNote`, through `env.transformer` with `TextOp::ImportNote` | input: the source note's text; Rust supplies data only |
| Image / PDF objects with no source note (D-77), the report Page | `@tegg/doc` `importNew`, through `TextOp::ImportNew` | input: empty text |
| New and extended type files | `tegg-schema` (`serialize`, `patch`) in Rust | not Markdown; the one writer of type files |
| `.tegg/vault.yml` and the seven system type files of a new vault | `tegg_vault::EMPTY_VAULT` | byte-equal to `tests/fixtures/vaults/new-empty/.tegg/` |
| Attachments | copied byte for byte from the source | streamed; never held whole in memory |
| The marker `.tegg-import`, the journal | Rust | machine data, not vault content |

Rust never builds or edits Markdown or YAML frontmatter text for a note (ADR 0003). It decides values, names, link outcomes and the order of keys, and passes them as JSON.

### 7.1 The seam: three text ops

`tegg-jobs` `TextOp` gains three variants (JSON shapes in `ops.rs`, `op_json` / `op_from_json`, as for every op). The `Transformer` trait, the transform CLI's line protocol and the app's worker bridge don't change: an op is still `transform(source, text, ops) → Transformed`.

```rust
pub enum TextOp {
    // … existing …
    /// Read-only. `Transformed::Bytes(json, [])`: the text is an `ImportScanDto` as JSON, never written to disk.
    ImportScan,
    /// The source note's text → the object file's text. `spec`: an `ImportNoteSpec` as JSON.
    ImportNote { spec: Arc<serde_json::Value> },
    /// Empty input → a new file's text. `spec`: an `ImportNewSpec` as JSON.
    ImportNew { spec: Arc<serde_json::Value> },
}
```

```ts
// packages/doc/src/import.ts, exported from the package root; `transform` dispatches on the op.
export type TextOp = /* … */ | { op: 'import-scan' } | { op: 'import-note'; spec: ImportNoteSpec } | { op: 'import-new'; spec: ImportNewSpec }

export function importScan(text: string): ImportScanDto
export function importNote(source: string, text: string, spec: ImportNoteSpec): string
export function importNew(source: string, spec: ImportNewSpec): string

export type ImportScanDto = {
  frontmatter: { ok: true } | { ok: false; reason: string; line: number }   // YAML validity is the engine's own check too (yaml-rust2); this one is for the line
  links: ScannedLink[]                         // every wikilink, embed, Markdown link and image outside code, frontmatter string values included, in document order
  invisible: { u200b: number; ufeff: number; u200c: number; u200d: number } // outside code spans and fenced code; ZWJ / ZWNJ inside emoji sequences not counted (FR-IMP-17)
  crlf: boolean
}
export type ScannedLink = {
  n: number; line: number
  place: 'body' | { frontmatter: { key: string } }
  form: 'wikilink' | 'embed' | 'markdown' | 'image'
  written: string                              // the span's source text
  target: string                               // wikilink target without alias and subpath, or the destination percent-decoded; NFC
  external: boolean                            // a URL with a scheme, `mailto:`, `tel:`, or `#…`
  text: string                                 // the link's plain text: alias, or link text with formatting removed and line breaks as one space; an image's alt
  simplified: boolean                          // the text held formatting or an image
  inside: number | null                        // `n` of the link whose text contains this one (an image inside a link)
  aliasSafe: boolean                           // false when `text` holds `[`, `]` or `|` (CP-2)
  inTable: boolean                             // inside a GFM table cell
}

export type ImportNoteSpec = {
  frontmatter: [string, FmValue][]             // the whole frontmatter, in R149's order, `id` and the times included
  links: LinkEdit[]                            // one per scanned link the run changes; a link not listed stays byte for byte
  paths: string[]                              // vault paths (existing and planned) whose stem equals a link target's stem, NFC case-folded: what D-184 needs
  stub?: { note: string }                      // FR-IMP-16: the body is this line, a blank line and an empty ```query fence
}
export type FmValue = string | number | boolean | string[] | { date: string } | { datetime: string } | { link: string } | { links: string[] }
export type LinkEdit =
  | { n: number; do: 'link'; toPath: string; shown: string }          // → `[[<D-184 target>|shown]]`, or a Markdown link (CP-2)
  | { n: number; do: 'embed'; file: string }                          // → `![[<file name>]]`
  | { n: number; do: 'date'; date: string }                           // → `[[YYYY-MM-DD]]`
  | { n: number; do: 'drop' }                                         // a reference to a missing file (FR-IMP-14 AC-4)
  | { n: number; do: 'text'; value: string }                          // FR-IMP-21: the link in a frontmatter value becomes plain text

export type ImportNewSpec =
  | { kind: 'media'; frontmatter: [string, FmValue][]; file: string }               // body: `![[file]]`, as 6A's `mediaObject`
  | { kind: 'report'; frontmatter: [string, FmValue][]; data: ReportData; strings: Record<string, string>; paths: string[] }
```

**What `importNote` does to the text** (R149 "Body"; FR-IMP-10 AC-9, FR-IMP-17):

1. The frontmatter block is replaced whole by `spec.frontmatter`, serialized with `formatScalar`'s quoting (D-230): strings quoted only when YAML needs it, `{ date }` bare, `{ datetime }` bare, `{ link }` as `"[[…]]"`, `{ links }` and `string[]` as flow lists, an empty list as `[]`. No key is written twice. A source note without frontmatter gets one.
2. Each listed link span is replaced (§8). Spans come from the same parse `importScan` used, so `n` means the same link.
3. Outside code spans and fenced code, U+200B and U+FEFF are removed everywhere, and U+200C / U+200D unless inside an emoji sequence. CRLF becomes LF everywhere, code included. NFC is applied to the title and to written link targets, not to other body text.
4. Every other byte stays. The result ends with one newline. It must read back through `@tegg/doc` `parse` with no frontmatter error and survive `open → save` with 0 bytes changed (FR-IMP-03 AC-10); `importNote` throws when its own output doesn't.

- **Errors.** A transformer error (`Timeout`, `Engine`) on `ImportNote` or `ImportNew` fails the run **before the first write**: every text is rendered in the pre-write phase (§9.2).
- **In Rust tests** the engine is `tegg_jobs::testing::NodeTransformer` (one persistent `node packages/doc/dist/transform-cli.js`, built by `npm run build --prefix packages/doc`), shared per test binary as in `crates/tegg-jobs/tests/common/mod.rs`. So L4 bytes are the real engine's. `FailingTransformer` covers the error path.

### 7.2 Type files

- **A new type** (D-1526): `tegg_schema::serialize` of a `TypeFile` with `version: 1`, `system: false`, `name` (the mapping's name, default the `type:` value), `plural` and `folder` (the export folder's name), the default icon and colour of `new_type_file`, and the planned attributes in source order (`key`, `name`, `type`, select `options` in first-seen order, relation `to` when a split names a type). File `.tegg/types/<tegg_format::type_key(name)>.yml`.
- **An existing type** (D-1529 (3)): `tegg_schema::patch(key, text, &[TypeOp::AddAttribute(..), …], ctx)`, one op per new attribute in source order. `patch` appends, so the file differs from before only by the appended entries (FR-IMP-03 AC-6). A select value that the Task type doesn't have is never added to `task.yml` (FR-IMP-08 AC-10).
- A system type file of a **new** vault that gains attributes is `EMPTY_VAULT`'s text patched the same way.

### 7.3 Frontmatter order and values

R149: `id, type, title, description, aliases, <attributes in source order>, tags, import-id, created, modified`. `type` is the type key. Renamed keys keep the place of their source key. `description` and `aliases` are omitted when absent; `tags: []` is kept when the source had it. `created` / `modified` are the source's `createdAt` / `lastUpdated` converted by §4.1, else the import time (`env.clock` at `start`, offset of `env.zone`, seconds precision). The report Page has `id, type: page, title, created, modified` and no `import-id`.

### 7.4 The report Page

`importNew({ kind: 'report' })` renders `ReportData` in R150's section order, each section omitted when it has no row:

- A section is `## <section name>` (from `strings`), a blank line, then one list item per row: `- ` and the row's fields joined by ` · `.
- A row's object is a wikilink in D-184 form from `Pages/` (`[[Lisbon]]`, `[[Trips/Lisbon|Lisbon]]`), by `paths`.
- Link text quoted from the source is a code span, with a backtick run longer than any in the text and padding spaces when it starts or ends with a backtick, so the report adds no link of its own (FR-IMP-19 AC-8).
- Numbers are plain digits with no grouping (the Page is file content, not UI).
- The Summary's first rows are the source name, the space, the date, then `Objects`, `Attachments`, `Links` as `<imported> · <reported> · <total>` with their labels; after an import into an existing vault that made a backup, the sentence `import.report.noUndo` and the zip's file name (FR-IMP-19 AC-12).

The exact bytes are fixed by the expected outputs (`tests/fixtures/import/capacities-expected/`, §16.2), which the owner approves before the implementation.

---

## 8. Link rules the criteria leave to the contract

1. **Resolution** (FR-IMP-10; ported): a wikilink target is matched against the titles of the space's objects, NFC, exact case; a path destination against the source path. One match → `resolved`. Several title matches → `ambiguous`, bound to the first by source path (D-76). Only a case-insensitive match → `case-mismatch`, bound only when `Mapping.caseLinks` says `use` (D-81). `Date/YYYY-MM-DD` with a valid date → `date-mention`. A path into a `Media/` folder → `attachment` or `missing-file`. Binding is by **source file**, never by title, so it survives suffixes and renames (FR-IMP-10 AC-1).
2. **Wikilink form.** `{ do: 'link' }` writes Tegg's own link text, D-184 (`@tegg/doc` `d184Text(source, toPath, shown, paths)`): the target is the stem when the stem resolves to that file from the linking note's planned path (ms4-links §1: same folder first), else the vault path without `.md`; then `|shown` when `shown` differs from the target. So a suffixed target is `[[Article (2)|Article]]`, an imported twin of the user's note is `[[PKM task (2)|PKM task]]`, and a same-stem object in another folder is `[[Tasks/Plán|Plán]]`.
3. **`shown`** is the link's `text` from the scan: the alias, else the target as written (a title), else the Markdown link's plain text, else the image's alt (D-1533). It is dropped when it equals the written target.
4. **Embeds and attachments.** A link or image to an imported attachment becomes `![[<file name>]]` with the planned file name (`![[Mapa řeky (2).jpeg]]`), no alias and no path: attachment names are unique in `_attachments/`. A wikilink to an Image or PDF **object** is an ordinary link (FR-IMP-14 AC-8).
5. **Relation values** in frontmatter: `{ link }` / `{ links }` written as `"[[<D-184 target>]]"` with no alias unless D-184 needs one.
6. **Date links (D-1546).** Always `[[YYYY-MM-DD]]`, also when the imported day was written as `Daily/2026-02-02 (2).md`: a date link means the day, and the day's note is decided by the index (§12.3). The engine never writes a path form to an imported Daily Note for a date mention.
7. **Text that can't be an alias (CP-2, pending).** Tegg's wikilink syntax has no escape: inner text can't hold `[` or a single `]`, and `|` separates the alias (`packages/doc/src/wikilink.ts`). A Markdown link whose plain text holds `[`, `]` or `|` therefore **stays a Markdown link**: only its destination is rewritten, to the target's path relative to the linking note's folder, percent-encoded as Tegg writes it (spaces as `%20`, D-825): `[viz [poznámka] zde](C%C3%ADl.md)` keeps its text byte for byte and becomes `[viz [poznámka] zde](Cíl.md)`. It resolves in Tegg (D-155) and in Obsidian, and renames follow it (ms4-jobs §2.3). `PlannedLink.kept_as_markdown` is true; it is not a simplified link. FR-IMP-10 AC-9's expected text for that link changes with the owner's answer.
8. **In a table cell** the alias separator is written `\|` (dialect §5), so a rewritten link never splits a row.
9. **Simplified links (D-1533).** Formatting in the text is dropped; an image inside a rewritten link is dropped with it and its own outcome stays `external` or `attachment` (FR-IMP-10 AC-12). Both are rows of the report's `Simplified links`.
10. **Links that stay as written:** `unresolved`, `other-space`, an unconfirmed `case-mismatch`, `target-not-imported`, `in-skipped-note` and `external` get no `LinkEdit`; their bytes don't change (FR-IMP-10 AC-11, AC-12). `missing-file` in a body gets `drop`; in a frontmatter value it stays as written and is reported.

---

## 9. Start, the job and the write phase

```rust
pub fn start(plan: Plan, scan: &Scan, target: &Target<'_>, env: &ImportEnv) -> Result<ImportRun, ImportError>;

pub struct ImportRun { /* … */ }
impl ImportRun {
    pub fn job(&self) -> tegg_jobs::JobId;
    pub fn cancel(&self) -> Result<(), ImportError>;                 // NotCancellable once `writing` began
    pub fn wait(&self, timeout: Duration) -> Option<ImportReport>;
    pub fn report(&self) -> Option<ImportReport>;
    pub fn on_progress(&self, sink: Arc<dyn Fn(&ImportProgress) + Send + Sync>);
}

pub struct ImportReport {
    pub job: tegg_jobs::JobId,
    pub phase: tegg_jobs::Phase,                // Done | Cancelled | Failed
    pub error: Option<ImportError>,
    pub vault: Option<PathBuf>,                 // new vault: the final folder (may be `… (2)`, FR-IMP-03 AC-14)
    pub vault_name: String,
    pub written: Vec<String>,                   // vault paths created, the report last; empty unless Done
    pub report_path: Option<String>,
    pub renamed: Vec<(String, String)>,         // planned path → written path, after the re-check (D-1547 (2))
    pub backup: Option<String>,                 // the zip's file name
    pub kept: Vec<String>,                      // roll-back: files of the run left in place because they changed
    pub totals: Totals,                         // as the plan's after the re-check
}
```

### 9.1 Job kind `import` (changes ms4-jobs §1)

| Kind | `needsConfirm` | `backup` | `undoable` | Cancellable in |
| --- | --- | --- | --- | --- |
| `import` | no (CP-4, pending: the caller's preview is the confirmation; `start` is the user's `Import`) | only for an existing vault that D-1549 (5) calls non-empty | no (D-1523, D-1549 (8)) | `queued`, `planning`, `backup` (D-110) |

- **Phases:** `queued → planning → backup (when needed) → writing → done | cancelled | failed`. There is no `confirm`.
- **Existing vault.** The run is a job of the target's own engine (`core.jobs()`, new `Jobs::start_import`, §12.1): it waits in `queued` behind that vault's other jobs (R153) and they wait behind it. `job:progress` carries `kind: "import"`. The target need not be the vault the window shows: the job belongs to the `Core` it was started on and finishes as long as that `Core` lives (D-1549 (6); keeping it alive across a vault switch is the shell's work, I2).
- **New vault.** The run is a job of a private engine over the temporary folder (D-1520): no `Core`, no index, no other job to wait for, nothing in the open vault read or written, no journal. Its `JobId` is 1.
- `start` itself runs the cheap checks of §9.2 first and returns `Err` with **no job created** when one fails (`SourceChanged`, `SourceGone`, `TargetChanged`, the target refusals, `NoSpace`). The job repeats them after the queue.

### 9.2 `planning`: checks and rendering, nothing written

In this order; any failure ends the job `failed` with nothing written and no backup made:

1. **Source stamp:** the zip file's size and modification time, or every entry's of a folder, against the plan's → `SourceChanged { entry }` / `SourceGone` (FR-IMP-07 AC-9).
2. **Type-file stamps (D-1548):** the plan recorded, for every type file it read to match a type or an attribute, the path and its content (`FileVersion`: size and hash), and for every type file it will create, that the path was absent. Any difference in **content** → `TargetChanged { path }`. A changed modification time with equal content is not a change.
3. **Planned paths (D-1547 (2)):** every planned path is looked up again. A taken one gets the next free ` (n)` by §5.2's rule, replacing a suffix the planner gave (never `X (2) (2)`); the object's or attachment's links follow, the pair goes to `ImportReport.renamed`, and a `files` row is added to the report data.
4. **Rendering:** every object's text and the report's, through `env.transformer` (§7.1), with ids taken from `env.ids` in write order. A transformer error → `Transform`.

`ImportPoint::Rendered` follows. Cancel is honoured between files and ends the job `cancelled`.

### 9.3 `backup` (existing vault; D-57, D-1549 (5), FR-HIS-04 AC-12, AC-13)

- **When:** the vault holds at least one `.md` outside `.tegg/` (a live object, one in `.trash/`, a template), **or** the run will change an existing type file. Never for a new vault.
- **What:** ms4-jobs §6 unchanged: `<Application Support>/Tegg/backups/<vault key>/<UTC yyyymmdd-hhmmss>-import.zip` with every `.md` and every file under `.tegg/`, NFC UTF-8 names, rotation 10. Label `backups.label.import` `{ space }`.
- Failure → `failed` with `BackupFailed`, nothing written. Cancel during the zip removes the partial zip.

### 9.4 `writing`: order and the exclusive create

Order (R149): **type files**, **attachments** in source-path order, **objects** in source-path order (a D-77 media object at the place of its media file's path), **the report**. From the first of them the job is not cancellable.

- **Every create is exclusive (D-1547 (1)).** A file is written to `.<name>.tegg-tmp` in its folder, synced, then renamed with a rename that fails when the target exists. That primitive already exists behind the platform trait: `VaultFs::create_new` (§12.2 adds its streaming twin), which on macOS is `renamex_np(tmp, target, RENAME_EXCL)` and elsewhere `link` + `unlink` (`tegg-vault/src/local.rs`, `rename_no_clobber`, both `cfg`-gated as AR-03 AC-3 asks). The engine never calls `VaultFs::replace` for a file of the run, except the one base-checked type-file extension below.
- **`AlreadyExists` during `writing` (D-1547 (3))** → the job fails with `FileAppeared { path }` and is rolled back. No second name is tried here: links to the planned name may already be written.
- **An extended type file** is the only replace: it is re-read immediately before, its content compared with the plan's stamp again (`TargetChanged` otherwise), then written with the base-checked write (`Vault::write(path, bytes, Some(base))`). The window between that check and the rename is the accepted one (D-84). Type files come first, so a `TargetChanged` here has written nothing else.
- **Attachments** are streamed from the source. Before the copy, the entry's size and modification time (zip: size and CRC) are compared with the stamp; the bytes copied must have the size and hash recorded → `SourceChanged { entry }` / `SourceGone` otherwise, and the temp file is removed (FR-IMP-03 AC-15).
- **Folders** are created when first needed; the run notes each folder it created.
- After each file of an existing-vault run the index is updated and `vault:changed` is sent, as for every job write (ms4-jobs §4).

### 9.5 New vault (D-1523, D-1549 (1), (2), FR-IMP-03 AC-4, AC-14)

1. **Clean-up, at this moment only.** If `<parent>/<name>.tegg-importing` exists: with a marker `.tegg-import` whose run isn't running in this process, the folder is removed whole; without the marker → `TargetExists`, and nothing in it is read, written or removed.
2. Create `<parent>/<name>.tegg-importing/`. Its **first file** is `.tegg-import`: `{"version":1,"run":"<run id>","started":"<ISO time>"}`. The run id is `<clock in ms>-<process id>`; it never takes an id from `env.ids`.
3. `.tegg/vault.yml` and the seven system type files (§7), then §9.4's order.
4. **Final rename** with the no-replace rename: `<name>.tegg-importing` → `<name>`. When `<name>` exists by then (a file or a folder), nothing is replaced or merged: the next free `<name> (2)`, `(3)`… is taken and `ImportReport.vault` names it.
5. The marker is removed from the final folder. A marker left in a finished vault by a kill between 4 and 5 is an inert dot file.
6. **Failure** at any point before 4 (a write error, `FileAppeared`, `SourceChanged`): the temporary folder is removed whole; no folder with the final name was ever created by the run. A **kill** leaves the temporary folder with its marker for step 1 of the next run.

Nothing is written outside `<parent>`: no Application Support entry, no recent-vault entry (opening the vault later does that).

### 9.6 Existing vault: journal and roll-back (D-1523, FR-IMP-03 AC-5)

- **Location:** `<Application Support>/Tegg/jobs/<vault key>/<jobId>.json` and `<jobId>.log`, next to the rename journals of ms4-jobs §8. Never in the vault.
- **Header** (`.json`, written when `writing` starts, before the first vault write): `{ "job", "kind": "import", "title": "<space>", "source": "<source name>", "total": <files to create>, "backup": "<zip name>" | null }`.
- **Log** (`.log`), one line appended and synced **before** the action it names (write-ahead):

| Line | Written before | Meaning |
| --- | --- | --- |
| `D\t<dir>` | creating a folder that doesn't exist | the run created it |
| `C\t<path>\t<size>\t<hash>` | `BeforeTemp` of a created file | the run may create `path` with exactly these bytes (BLAKE3, as `FileVersion`) |
| `R\t<path>\t<post size>\t<post hash>\t<pre bytes, hex>` | replacing an extended type file | restore to the pre bytes when the file is still the post version |

  So no file of the run can exist that the log doesn't name. An attachment's hash is known before its copy because the entry is read once for the stamp check.
- **Roll-back** (after a failure in `writing`, in the same process): walk the log backwards. `C`: when the file exists with that size and hash, it is removed (`Vault::discard_checked`: a checked delete, not a move to `.trash/`, since the file never belonged to the user); when it differs, it is **kept** and listed in `ImportReport.kept`; when absent, nothing. `R`: when the file is the post version, the pre bytes are written back; else kept and listed. `D`: the folder is removed when empty (`VaultFs::remove_empty_dir`); a folder that existed before, or holds anything, stays (D-1549 (7)). Leftover `.tegg-tmp` files of the run are removed. Then both journal files go. The backup zip stays.
- **After a kill** the journal is left. On the next open of the vault `Jobs::interrupted()` lists it with `kind: "import"`, `title` the space, `done` the `C` lines, `total` the header's. `resolve_interrupted(job, Undo)` does the roll-back above from the log alone, with no transformer and no source; `Finish` answers `JobError::NotImplemented` (an import is never resumed). `.tegg-tmp` leftovers are removed by the vault open as today (data-safety AC-4).
- A finished import removes its journal and can't be undone (D-1549 (8)).

---

## 10. Progress and cancel (FR-UX-07 AC-13)

### 10.1 Event

```rust
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: ImportPhase,          // "reading" | "planning" | "backup" | "writing" | "done" | "cancelled" | "failed"
    pub step: Option<WriteStep>,     // writing only: "vault" | "types" | "attachments" | "objects" | "report"
    pub done: u64, pub total: u64,   // reading: files; planning: notes; backup: files; writing: files to create
    pub step_done: u64, pub step_total: u64,
    pub counts: Option<Totals>,      // on the final event
    pub job: Option<tegg_jobs::JobId>,
}
```

### 10.2 Rules

- Within one phase `done` never decreases and `total` is fixed once known; at least one event per 500 ms while a call or a job runs; the last event of a successful run is `Done` with `done == total` and `counts`.
- `reading` comes from `scan`, `planning` from `plan` and from the job's pre-write phase (§9.2), `backup` and `writing` from the job. The sink is `Control.progress` for the two calls and `ImportRun::on_progress` for the job; an existing-vault job also emits the engine's `JobProgress` (`kind: import`, `done` / `total` as `writing`'s) for the status element.
- **Cancel:** `Control.cancel` during `scan` or `plan`, `ImportRun::cancel` in `queued`, `planning` or `backup`: stops within 1 s, final event `Cancelled`, nothing written (a partial zip removed). `ImportRun::cancel` in `writing` → `Err(NotCancellable)` and the import finishes.
- **The open vault stays responsive:** the run holds no lock of another vault and, in its own, takes the vault lock per file only, as every job.

---

## 11. Errors

```rust
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum ImportError {
    // scan (R153)
    NotCapacities, UnreadableArchive, EncryptedArchive, Empty,
    SourceGone { entry: Option<String> },
    SourceChanged { entry: Option<String> },
    // plan
    UnknownSpace { space: String },
    InvalidMapping { entry: MappingEntry, reason: MappingReason },
    TargetExists, TargetNotWritable, TargetInsideVault, TargetInsideSource,
    NoSpace { needed: u64, free: u64 },
    IndexNotReady,
    // start and the run
    TargetChanged { path: String },                    // D-1548
    BackupFailed { reason: String },
    FileAppeared { path: String },                     // D-1547 (3)
    Write { path: String, reason: String },            // any other I/O failure after the first write
    Transform { note: Option<String>, reason: String },
    NotCancellable, Cancelled,
    Io { reason: String },
}
```

| Case of R153 | Where | Answer |
| --- | --- | --- |
| Not a Capacities export; broken zip; password-protected zip; no objects | `scan` | `NotCapacities`, `UnreadableArchive`, `EncryptedArchive`, `Empty` |
| Some entries unreadable | `scan`, `plan` | no error: `ScanInfo.unreadable`, `PlannedObject` / `PlannedAttachment` outcome `unreadable` |
| The source disappears while reading | `scan`, `plan` | `SourceGone` |
| The source changed between reading and `Import` | `plan`, `start`, the job's `planning` | `SourceChanged`, nothing written |
| New-vault folder exists; not writable; inside a vault; inside the source | `plan`, `start` | `TargetExists`, `TargetNotWritable`, `TargetInsideVault` (a `.tegg/` at or above the place), `TargetInsideSource` |
| Not enough free space | `plan`, `start` | `NoSpace { needed, free }` |
| The backup fails | the job | `failed`, `BackupFailed` |
| A write fails after the first write | the job | `failed`, `Write`, rolled back |
| Another job runs in the target vault | the job | waits in `queued` |
| A type file changed since the plan | `start`, the job (twice, §9.2, §9.4) | `TargetChanged { path }` |
| A file arrives at a planned path | the job's `planning` / `writing` | renamed and reported / `FileAppeared`, rolled back |
| The source changes during the write | the job | `SourceChanged { entry }` / `SourceGone { entry }`, rolled back |

`reason` strings are for logs and tests; the window's texts are R153's (I2). No error value holds file content.

---

## 12. Changes to other crates

### 12.1 `tegg-jobs`

- `JobKind::Import` (`"import"`), flags of §9.1.
- `TextOp::{ImportScan, ImportNote, ImportNew}` with their JSON shapes (§7.1).
- `Jobs::start_import(job: Arc<dyn ImportJob>) -> Result<JobId, JobError>`: the seam through which `tegg-import` runs inside the engine's queue, phases, backup, cancel and progress. The trait's shape (`prepare`, `needs_backup`, `write`) is the implementer's; what the engine does around it is §9. `JobOp` is unchanged (it stays `Eq`).
- `journal`: the `import` journal of §9.6 (`interrupted`, `resolve` with `Undo` only).
- `Host` gains, with stub defaults (TS-I1): `create_from(&self, path: &str, src: &mut dyn io::Read) -> Result<FileVersion, WriteError>` (exclusive, streamed), `discard(&self, path: &str, base: &FileVersion) -> Result<(), WriteError>`, `remove_empty_dir(&self, dir: &str) -> bool`.
- `testing::NodeTransformer::pid(&self) -> u32` (§2.1).

### 12.2 `tegg-vault`

All new file access lives here (AR-04 AC-1), each with an in-memory twin where a test needs one:

- `VaultFs::create_new_from(&self, path: &str, src: &mut dyn io::Read) -> io::Result<FileVersion>`: `create_new`, streamed. Default: reads to memory and calls `create_new`.
- `VaultFs::create_dir_new(&self, path: &str) -> io::Result<()>` (fails when it exists) and `pub fn rename_dir_no_replace(from: &Path, to: &Path) -> io::Result<()>`, `pub fn remove_dir_tree(path: &Path) -> io::Result<()>` for §9.5 (the latter refuses a folder without the marker `.tegg-import`).
- **Read-only source access:** `pub trait ExternalRead { fn stat(&self, rel: &str) -> io::Result<Option<(u64, i128)>>; fn list(&self) -> io::Result<Vec<(String, u64, i128)>>; fn open(&self, rel: &str) -> io::Result<Box<dyn ReadSeek>>; }`, `pub struct ExternalFolder`, `pub fn open_external_file(path: &Path) -> io::Result<Box<dyn ReadSeek>>`, `pub fn stat_external(path: &Path) -> io::Result<Option<(u64, i128)>>`. None of them can write.
- `pub fn free_space(path: &Path) -> io::Result<u64>`, `pub fn volume_id(path: &Path) -> io::Result<u64>` (`statvfs` / `stat`).
- `pub use new_vault::EMPTY_VAULT`.
- A test hook for the three kill points inside `create_new` / `create_new_from` (before the temp file, after it, after the rename), next to the existing `BEFORE_RENAME`; the engine's `ImportPoint`s of those names are raised from it.

### 12.3 `tegg-index` and `@tegg/doc`: the order of a day's notes (D-1546, amends D-319)

D-319's order is implemented today in two places:

- `crates/tegg-index/src/lib.rs`, `fn daily_order(a: &Meta, b: &Meta)` (used when the index sorts the Daily Notes of a date; `Index::daily_note`, the losers list, the Duplicate titles group and date-link resolution all read that order);
- its twin for the fake core, `packages/doc/src/daily.ts`, `export function dailyOrder(a, b)`.

Both gain one leading key: **a note without `import-id` comes before a note with one**; D-319 / D-335's order (newest `created`, newest `modified`, NFC path bytes) decides inside each group. "With `import-id`" means the frontmatter has the key with a non-empty string value. `dailyOrder`'s argument type gains `importId?: unknown`. The rule reads only files (AR-01). Criterion: daily-notes.md FR-DLY-01 AC-12 (marked `[MS7]` like the import criteria, so the MS4 gate doesn't check it before slice I1); the tests are added to `crates/tegg-core/tests/ac_daily.rs` and `app/webkit/daily.ac.test.ts` under `AC-Test-Change: among Daily Notes of one date a note without import-id comes first (D-1546); approved-by: owner`.

### 12.4 `@tegg/doc`

`packages/doc/src/import.ts` (§7.1), `transform` dispatch for the three ops, `dailyOrder` (§12.3). Nothing else changes; `d184Text`, `formatScalar`, `isGenericName` and `mediaObject` are reused.

### 12.5 `ms4-jobs.md`

Applied with this contract: §1 gains the `import` row and the rule for a target that isn't the open vault; §8 gains the import journal and `Undo` only. Text ops and the `Host` additions are specified here and referenced from there.

---

## 13. The owner's real-export run (FR-IMP-23, D-1543, FR-IMP-03 AC-11)

- **Command** (owner only, D-62): `TEGG_REAL_EXPORTS=1 cargo run --release -p tegg-import --example real_export -- [--keep <dir>]` from the repository root. Without `TEGG_REAL_EXPORTS=1` it prints `skipped: 1` and exits 0. It reads `<repository>/test exports/*.zip` and nothing else.
- **Where it is declared:** `crates/tegg-import/examples/real_export.rs`, a thin `main` over `tegg_import::real_export::run`. It is **not** a test and **not** a step of `qa.config.json`, so no gate, hook or CI job runs it; `cargo test` only compiles it. Claude never starts it (TS-P3; `test exports/` stays denied in `.claude/settings.json`).
- **Library entry** (so the format and the refusal are testable on synthetic input):

```rust
pub mod real_export {
    pub struct Args { pub exports: PathBuf, pub keep: Option<PathBuf>, pub repo: PathBuf }
    /// Writes the report to `out`. 0: every check passed; 1: a check failed; 2: refused.
    pub fn run(args: &Args, env: &ImportEnv, out: &mut dyn io::Write) -> i32;
    pub fn is_counts_only(s: &str) -> bool;
}
```

- **What it does:** for every zip that scans as a Capacities export, for every space: plan with the default mapping; write into a new vault in a fresh temporary directory outside the repository; `accounting::check_plan` and `check_vault`; FR-IMP-03 AC-10's checks on every written file; FR-IMP-10 AC-10 (each `resolved` link resolves, in an index of the written vault, to the planned file); then delete the temporary vault.
- **Output: counts and indexes only.** Every line matches `^[a-z0-9_.]+: [0-9]+(,[0-9]+)*$` and passes `./verify counts-only`. Exports and spaces are numbered (`export.0`, `space.1`), never named. Lines: `export.<i>.capacities`, `.spaces`, `.unreadable`, `.files_outside_spaces`; per space `.objects.total|imported|reported`, the same for `attachments` and `links`, `.links.<outcome>` (underscored), `.types`, `.types_new`, `.accounting_errors`, `.accounting.<violation code>`, `.written_files`, `.roundtrip_failures`, `.unresolved_written_links`, `.failing_object_indexes` (indexes into the plan's object list). `is_counts_only` asserts the format on the run's own output before it is printed; a line that fails is replaced by `format_violation: 1`.
- **`--keep <dir>`:** the written vaults are kept under `<dir>/export-<i>-space-<j>/`. Before anything is read, the run refuses and exits 2 when `<dir>`, or its nearest existing parent after resolving symlinks, lies inside a Git repository or worktree (a `.git` file or folder at or above it; this covers every worktree of this repository and `test exports/`) or inside a vault (a `.tegg/` at or above it). It prints one line, `refused: 1`, and a reason line `refused.inside_repository: 1` or `refused.inside_vault: 1`; never a path.

---

## 14. IPC

None in I1. The names the criteria start from (`import_scan`, `import_plan`, `import_start`) are thin shell commands over `scan`, `plan` and `start`, specified with I2.

## 15. What I2 will add (named, not specified)

The IPC commands and their DTOs (`ScanInfo`, `Plan`, `Mapping`, `ImportProgress`, `ImportError` are already serde types); a transformer for the app with no vault open; keeping the target `Core` alive across a vault switch (D-1549 (6)); the window's model and steps (R151, R152); `TEGG_TEST_PICK_FILE` in ms3-shell (D-135); `File › Import…` and `import.open` (R154); the status element; the fake core's canned scans, plans and progress; the catalog (R155) and passing `import.report.*` to `ReportStrings`; the `backups.label.import` label in Settings › Backups; the quit question during `writing`.

---

## 16. Test plan (for the test author)

### 16.1 Layers and files

Rust AC tests are `crates/tegg-import/tests/ac_*.rs`, each test named after its AC (`fr_imp_07_ac2_zip_names_are_utf8_and_nfc`); helpers in `crates/tegg-import/tests/common/mod.rs` (no assertions there; copy the fixtures into a temp folder, build zips, snapshot bytes / mtime / inode as `tegg-jobs/tests/common`). Every test uses `testing::env` and the shared `NodeTransformer`.

| File | Criteria |
| --- | --- |
| `ac_import_engine.rs` | FR-IMP-03 AC-1 (offline: the `lsof` sample; the crate's `use` lines), AC-2, AC-9, AC-10 (L4 part) |
| `ac_import_input.rs` | FR-IMP-07 AC-1, AC-2, AC-5…AC-9, AC-12; FR-IMP-22 AC-1, AC-2 |
| `ac_import_plan.rs` | FR-IMP-05 AC-1, AC-2, AC-5…AC-7; FR-IMP-19 AC-8, AC-12 (report part); FR-IMP-05 AC-3; NFR-OTH-02 AC-18 (report part, with pseudo-locale `ReportStrings`) |
| `ac_import_mapping.rs` | FR-IMP-08 AC-1…AC-12; FR-IMP-09 AC-1…AC-6 (Z); FR-IMP-21 AC-1…AC-4; FR-IMP-24 AC-1…AC-3; FR-TYP-15 AC-1, AC-3 |
| `ac_import_links.rs` | FR-IMP-10 AC-1…AC-12; FR-IMP-11 AC-1…AC-6; FR-IMP-16 AC-1…AC-3 |
| `ac_import_content.rs` | FR-IMP-14 AC-1…AC-4, AC-6…AC-8; FR-IMP-15 AC-1…AC-8; FR-IMP-17 AC-1…AC-4 |
| `ac_import_existing.rs` | FR-IMP-03 AC-6…AC-8; FR-IMP-11 AC-7; FR-IMP-14 AC-9; FR-IMP-20 AC-1 (count), AC-2; FR-IMP-22 AC-3, AC-4; FR-HIS-04 AC-1, AC-12, AC-13 |
| `ac_import_write.rs` | FR-IMP-03 AC-3, AC-4, AC-5, AC-12…AC-15 (crash harness: panicking hook and a SIGKILLed child) |
| `ac_import_progress.rs` | FR-IMP-07 AC-3; FR-UX-07 AC-13 (events, cancel, `NotCancellable`), AC-16 (the job part) |
| `ac_import_property.rs` | L2: FR-IMP-03 AC-10 on generated exports (300 notes; fixed seed plus one random seed per push; 10 × 1,000 nightly, name prefix `nightly_`) |
| `ac_import_real_export.rs` | FR-IMP-03 AC-11: the output format and the `--keep` refusals, with `c01-spaces` zipped as the input |
| `crates/tegg-core/tests/ac_daily.rs` (existing) | FR-DLY-01 AC-12 |
| `packages/doc/test/import.ac.test.ts` (L1) | the bytes of `importScan` / `importNote` / `importNew`: FR-IMP-10 AC-7, AC-9, AC-12; FR-IMP-15 AC-6; FR-IMP-17 AC-4; FR-IMP-16 AC-1; FR-IMP-19 AC-8 (layout) |
| `packages/doc/test/import.property.ac.test.ts` (L2) | FR-FMT-07 on `importNote` output: open and save changes 0 bytes |

- The `[real-export]` criteria (FR-IMP-03 AC-11's run, FR-IMP-05 AC-4, FR-IMP-07 AC-4, FR-IMP-14 AC-5) have no automated test beyond AC-11's format test; the owner starts the run.
- **The latency sentence of FR-UX-07 AC-13** (`index.switcher` and `note.read` under 100 ms p95 while an import runs) is a latency target: by D-343 it runs as `nfr_perf_fr_ux_07_ac13_open_vault_stays_responsive` in `ac_import_progress.rs`, skipped at push by the name filter and run nightly.
- No L5 or L6 test in I1: no criterion marked I1 names those layers.

### 16.2 Fixtures

- Inputs: `tests/fixtures/import/capacities/` as they are (read-only; copies in temp folders; zips built at test time, never committed).
- **Expected outputs:** `tests/fixtures/import/capacities-expected/<fixture>/` holds the written vault (every file, byte-exact, with ids `01JB5V000000000000000000nn` and the test clock) and `plan.json` (the `Plan` as JSON without `stamps`). One folder per fixture that a criterion compares against (`c02-typed-frontmatter`, `c05-media-objects`, `c09-unresolved-links`, `c10-duplicate-titles`, `c12-task-dates`, `c14-reserved-keys`, `c15-common-attributes`, `c22-link-shapes` at least), plus `README.md`. Written by the test author in their own commit and approved by the owner before the implementation (as D-99). A later change needs `Fixture-Change:`.
- FR-DLY-01 AC-12 needs no committed file: its note is written at test time into the temporary copy of `tests/fixtures/vaults/daily/`.

### 16.3 Gate configuration (with the red tests, not now)

Neither edit is a pure addition today, because the crate doesn't exist yet: a step that lists no test file fails `cargo-junit.ts`, and `core-rust-test`'s glob would otherwise pick the new files up. They go in the red-test commit, together with the stub crate:

- `Cargo.toml`: `crates/tegg-import` joins `members`.
- `qa.config.json`: a new push step, and `core-rust-test`'s file list gains `| grep -v '^crates/tegg-import/'`:

```json
{ "id": "import-test", "lane": "cargo",
  "inputs": ["crates","Cargo.toml","Cargo.lock","tests/fixtures","packages/doc","tools/qa/src/cargo-junit.ts"], "dir": ".",
  "run": "npm run --silent --prefix packages/doc build && node tools/qa/src/cargo-junit.ts --junit \"$VERIFY_RESULTS/import-ac.xml\" --threads 2 $(ls crates/tegg-import/tests/ac_*.rs 2>/dev/null) -- --skip nfr_perf_ --skip nightly_",
  "level": "push" }
```

  and a nightly step `import-nightly` running the same files with `-- nfr_perf_ nightly_`. The `acRunners` entry for `crates/*/tests/ac_*.rs` already covers the crate. No step runs `examples/real_export.rs`.
- `docs/acceptance/architecture-rules.md`: a note under AR-03 AC-1 and AR-04 AC-1 that the checks cover `tegg-import` (applied with this contract: a note only, no criterion changes). The existing static tests (`crates/tegg-vault/tests/ac_vault_static.rs`, `crates/tegg-format/tests/ac_platform_static.rs`) read every crate under `crates/` and need no change.

---

## 17. Contract choices (no owner decision needed)

1. **`tegg-import` sits above `tegg-core`**, not inside `tegg-jobs` as architecture §5.7 sketched: an import must run with no vault open, and the planner needs the target's index. `tegg-jobs` keeps the queue, the journal and the backup; the crate table of architecture.md §3 and its §5.7 get the new crate with the red tests.
2. **A zip is read in place**, so the engine has no temporary directory for a source and FR-IMP-07 AC-8's clean-up has nothing to remove.
3. **Everything is rendered before the first write.** A transformer failure, a mapping problem found late or a cancel therefore never leaves a partly written target; the cost is the notes' text in memory for the run.
4. **The three text ops reuse `transform`**, with `import-scan` returning JSON as its text, so the transport (CLI, worker bridge, IPC) is untouched.
5. **The journal is write-ahead with content hashes**, so `Undo` after a kill needs neither the source nor the engine, and an attachment is read twice (stamp, then copy).
6. **Roll-back deletes** the run's own unchanged files with a checked delete instead of moving them to `.trash/`: they were never the user's, and `.trash/` would then hold a second copy of an import that "added nothing".
7. **`TargetChanged` compares content**, not modification times: a sync client that touches a type file without changing it doesn't block the import.
8. **`ImportEnv.ids` is used only for objects**; the run id and the marker never take one, so the expected outputs' ids don't depend on the target kind.
9. **The report is rendered by `@tegg/doc` from `ReportData`** as lists, not tables: link text with `|` or backticks then needs only the code-span rule.
10. **An existing-vault target is an open `Core`.** Importing into a vault that isn't open is not offered (the window offers `This vault` only).
11. **The real-export run is a Cargo example**, so `cargo test` and every gate can only compile it.

## 18. Points for the owner (CP-1…CP-7, pending)

The contract above follows each **Recommendation**. Each row changes behaviour or data on disk.

| CP | Issue | Recommendation (the contract follows it) | Alternatives | Affects |
| --- | --- | --- | --- | --- |
| CP-1 | **Who reads the links for the plan.** The plan needs every link's outcome before any write; the write rewrites link spans in `@tegg/doc` (ADR 0003: "links taken from the mdast parse"). The spike read them in Rust (regex plus pulldown-cmark). Two readers can disagree (S4 P1/P3/P9, S5 F12), and then the preview isn't what gets written (FR-IMP-05 AC-7). | **One reader:** the plan sends each note to `@tegg/doc` (`import-scan`) and the write uses the same parse, so link `n` is the same link in both. `plan` therefore needs the transformer (Node in tests, the worker in the app); the spike's scanner isn't ported. | (b) Rust reads links at plan time (port `scan.rs`); the write checks the engine's list against the plan and fails the run on a difference, before the first write. (c) As (b) without the check. | §1.2, §5, §7.1; FR-IMP-10 AC-7; FR-IMP-05 AC-7 |
| CP-2 | **Link text that can't be a wikilink alias.** FR-IMP-10 AC-9 expects `[[Cíl|viz [poznámka] zde]]` "in the form `@tegg/doc` escapes". No such form exists: Tegg's wikilink syntax rejects `[` and a single `]` inside `[[…]]`, and the link wouldn't be a link in Tegg or Obsidian. | **Keep that link a Markdown link** and rewrite only its destination: `[viz [poznámka] zde](Cíl.md)`. The text stays byte for byte, it resolves in Tegg and Obsidian, renames follow it, and it isn't a simplified link (AC-9's count of two stays). AC-9's expected text for this one link changes. | (b) Replace `[` `]` by `(` `)` in the alias and list the link as simplified (three rows in AC-9). (c) Add an escape (`\[`, `\]`) to the dialect: a file-format change in the tokenizer, the Rust extractor and the dialect doc, unverified in Obsidian. | §8 (7); FR-IMP-10 AC-9; `capacities-expected/c22-link-shapes/` |
| CP-3 | **The key of a new attribute.** A Tegg attribute key allows letters, digits, `-`, `_` and must start with a letter; Capacities keys needn't (`Datum konání`, `2nd contact`). R148 says "a new attribute" without the key. | The name as given when it is a valid key (so `peopleInvolved`, `autor`, `přečteno` stay); else `derive_attr_key(name)` (`datum-konání`) with the given name kept as the attribute's `name`, and a row in the report's Attributes section. | (b) Always `derive_attr_key` (`peopleinvolved`: every camelCase key changes). (c) Refuse the plan until the user renames such attributes. | §4.1; FR-IMP-08 AC-2, AC-6, AC-8; type files and frontmatter keys |
| CP-4 | **Does the job stop in `confirm`?** The criteria's "Still to do" table says `needsConfirm` yes; but the preview is shown from `import_plan` before any job exists, and a job waiting in `confirm` holds its vault's queue (ms4-jobs §14.9.2). | **No `confirm` phase:** `start` is the user's `Import`; cancellable in `queued`, `planning`, `backup`. | (b) `start` when the preview opens, the job waits in `confirm`, `Import` is `job_confirm`: the target vault's other jobs wait while the user reads the preview. | §9.1; ms4-jobs §1; R152 step 5 (I2) |
| CP-5 | **Free names: per folder or vault-wide.** FR-IMP-03 AC-7 says names are compared "per folder". Tegg's own creation picks a stem free in the whole vault (D-291 part 2, ms4-links §3.1), so that a bare `[[stem]]` is never ambiguous. | **Per folder, as the criterion says.** Capacities spaces hold many same-titled objects across types; links are written in D-184 form, so they stay right (path form where a stem is shared). | (b) Vault-wide, as Tegg's own creation: more ` (2)` suffixes (`Tasks/Plán (2).md` because `Pages/Plán.md` exists), simpler links; changes AC-7's wording and the expected outputs. | §5.2; FR-IMP-03 AC-7; FR-IMP-11 AC-3 |
| CP-6 | **A leftover marker and "running".** D-1549 (1) removes a leftover `<name>.tegg-importing` with a marker "and no running import of that job id". Across a crash the job id means nothing. | The marker holds a run id (`<clock ms>-<process id>`); "running" means a run of this process (Tegg is single-instance). A marker left in a finished vault by a kill between the final rename and its removal is left alone. | (b) Also require the marker to be older than a time limit. (c) Remove a leftover marker from a finished vault when it is next opened (a write on open, against FR-VLT-01 AC-4). | §9.5; FR-IMP-03 AC-14 |
| CP-7 | **A transformer failure on one note.** Not covered by R153. | At plan time the note is `unreadable` (reason `engine`) and reported, like broken YAML. At write time (after a clean plan) the run fails before the first write with `Transform`. | (b) At write time skip the note and report it (the result then differs from the preview). | §5, §7.1, §9.2; FR-IMP-07 AC-7 |
