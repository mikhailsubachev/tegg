# v1.0 Import Interface Contract (slice I1, the Capacities import engine)

- **Status:** accepted, 2026-11-12. Written before the I1 red tests. Follows D-41…D-50, D-57, D-75…D-84, D-110, D-801 and the import decisions D-1517…D-1550 (BRD v1.163, v1.164). Its seven points for the owner are **decided**: the owner accepted every recommendation ("Accept all seven", 2026-11-12) as D-1551…D-1557 (CP-1…CP-7, §18; BRD v1.165); each place that depends on one names its decision. **Revised after a QA review** (2026-11-12, author-level fixes that follow from D-1517…D-1557; no new behaviour): roll-back by knowledge, not by bytes (§9.6), the report and decision DTOs written out (§5.1, §5.3), what counts as a link (§6.4), the staged exclusive create (§9.4, §12.2), plan validation (§9), attribute-key edge cases (§4.1), `FmValue` (§7.1), plan comparison (§5.4), the real-export run's privacy (§13). The three questions that review left for the owner are **decided** ("Accept all three", 2026-11-12) as D-1558…D-1560 (O1…O3, §19; BRD v1.166): in an existing vault a name is free against every existing file of the vault (§5.2, §9.2), a dead run's leftover folder is moved to the system Trash (§9.5, §12.2), a plain link to a media file stays a link (§8 (4)). Two smaller points are still open and come to the owner with the red tests (§19). **Revised after the red tests** (2026-11-12; sixteen gaps the test author reported, §20): rules that follow from the criteria, the decisions and Tegg's conventions are written in place, each agreeing with the red tests of `1db39a7`; four choices that change data on disk and follow from no decision **waited for the owner** (CP-8…CP-11, §20), and the rules they touch were marked *pending*. **Decided** (owner, 2026-11-13: "Approve all"): CP-8…CP-11 as D-1562…D-1565 (BRD v1.168): CP-8, CP-10, CP-11 as recommended, CP-9 as its alternative (b) (the value is kept as text under `<key>-text`); the slice I1 build's AC-test changes are D-1566.
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
- No Markdown parser in this crate: no `pulldown-cmark` (D-1551). The independent link counter of §6.4 uses `regex` on purpose.
- `std::fs`, `File::create`, `OpenOptions` and `notify` never appear in `crates/tegg-import/src` (the AR-04 AC-1 check reads every crate under `crates/`, so it covers this crate with no change; the AR-03 AC-1 check reads `cargo tree --workspace`, so it covers it once the crate is a workspace member).
- **L0 dependency allow-list (test-strategy TS-L0, NFR-SEC-01).** The crate's dependencies that are new to `Cargo.lock` are `zip`, its `flate2` back end with `miniz_oxide`, `crc32fast` and `adler2`, and `percent-encoding`; none opens a socket. Each gets its allow-list entry with the red tests (§16.3). The others (`yaml-rust2`, `regex`, `serde`, `serde_json`, `chrono`, `chrono-tz`, `unicode-normalization`, `blake3` through `tegg-vault`) are in the workspace already. The forbidden-crate check `fr_syn_07_ac1_core_crates_depend_on_no_network_crate` (`crates/tegg-core/tests/ac_core_static.rs`) reads every crate under `crates/` and `Cargo.lock`, so it covers the new crate with no change.

### 1.2 What is ported from the spike

| Spike file (`75b3382`) | Becomes | How |
| --- | --- | --- |
| `source.rs` | `src/source.rs` | **Rewritten.** The spike read every entry's bytes into memory. The engine keeps a directory (name, size, modification time) and reads entries on demand, in place; it adds the refusals of R153, path-traversal handling and the source stamp (§3) |
| `plan.rs`: `layout`, `space_of`, `spaces`, `is_object_file`, `is_attachment_file`, `split_frontmatter`, `parse_note`, `status_state`, `join_relative` | `src/layout.rs`, `src/note.rs` | Ported nearly as written |
| `plan.rs`: `map_type`, `map_attr`, `infer`, `dry_run`, `Report` | `src/mapping.rs`, `src/planner.rs`, `src/plan.rs` | **Rewritten around the mapping as data** (§4): defaults become R148 rows, `infer` follows D-1526 and D-1545, `Report` becomes the plan DTO (§5), file names come from `tegg_format::sanitize_file_stem` |
| `convert.rs` | `src/dates.rs` | Ported nearly as written; the zone is injected (§2) |
| `scan.rs` | — | **Not ported** (D-1551): links, clean-up counts and code spans come from `@tegg/doc` (§7.1). Only `decode_path` moves to `src/note.rs` |
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
    /// The one text engine (D-82). Used by `plan` (D-1551) and by the run.
    pub transformer: Arc<dyn tegg_jobs::Transformer>,
    /// `<Application Support>/Tegg`: journals and backups (existing-vault target only).
    pub dirs: tegg_vault::AppDirs,
    /// Free space and volume identity (FR-IMP-07 AC-12).
    pub disk: Arc<dyn Disk>,
    /// The system Trash (D-1559, §9.5 step 1): where a dead run's leftover `<name>.tegg-importing` goes. The shell passes
    /// its `NSFileManager trashItemAtURL` implementation (ms6-trash-media §1.1); the engine never unlinks a leftover.
    pub trash: Arc<dyn tegg_vault::SystemTrash>,
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

/// Catalog key → text. **The map's keys are the full catalog keys, with the prefix** (`import.report.section.summary`,
/// R155): the shell passes its catalog entries as they are. An entry without the prefix is ignored. A missing key is
/// written as the full key itself. The same map is `ImportNewSpec.strings` (§7.1).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportStrings(pub BTreeMap<String, String>);

#[derive(Clone, Default)]
pub struct Control {
    pub cancel: CancelToken,                              // `CancelToken::new()`, `.cancel()`, `.is_cancelled()`
    pub progress: Option<Arc<dyn Fn(&ImportProgress) + Send + Sync>>,
}
```

`tegg_import::testing::env(dirs: &AppDirs, transformer) -> ImportEnv` gives the test clock (`2026-11-12T10:00:00+01:00`), Europe/Prague, the `01JB5V…nn` id source starting at `01`, `SystemDisk`, English strings (`ReportStrings::english()`), no hook, and a `SystemTrash` that **answers an error and moves nothing**: a test that forgets to set a trash can never move a folder anywhere. `testing` has no other public item: the tests bring their own `SystemTrash` implementations (`tests/common/mod.rs`: `Trash { dir }`, which renames the folder into `dir`, and `NoTrash`, which answers `PermissionDenied`) and set `env.trash` themselves. The names `testing::TrashSink` and `testing::FailingTrash` of the earlier text are **not part of this contract** (the compile-only stub still declares them; the implementation may drop them or keep them private).

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
    /// `path` (a vault path of the target): its journal line (`C` or `R`, §9.6) is on disk, its temp file isn't.
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
- **A kill** is a hook that panics (as the existing crash tests of `tegg-jobs` do) or a child process killed with SIGKILL (as `tegg-vault/tests/ac_crash.rs`). The engine runs no roll-back and no clean-up when the hook panics, and holds no clean-up of **files** in `Drop`: what is on disk is what a kill leaves. One thing is released when the run's thread unwinds: the run's entry in the in-memory registry of running runs (§9.5), which touches no file; so a run ended by a panicking hook is not "running" for the next run of the same process.
- **The hook is per run, never process-global.** Every point is raised by the engine itself from `ImportEnv.points`, around its own calls (§9.4): no point depends on `tegg_vault::local::BEFORE_RENAME` (a process-wide `OnceLock`, set once, unusable by parallel tests). The one point that lies inside a `tegg-vault` call, between the temp file and the rename of an extended type file, is passed down per call (`Vault::write_with`, §12.2). Two runs in one test binary therefore never see each other's points.
- **Where the three file points lie** (§9.4, §9.6): `BeforeTemp` after the `C` line is synced and before the temp file exists; `TempWritten` after the temp file is complete and its `T` line is synced; `Renamed` after the rename and **before** the `K` line, so a kill there tests the window in which only the `T` line says whose file it is. For the extended type file the lines are `R`, then the temp file, then the rename.
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
- **Unreadable entries and the classes.** An entry of a space that has a usable name but can't be read (`Read`, `Encrypted`) is still an object or an attachment by its name, with the outcome `unreadable` in every plan of that space (§5.1). An entry with no usable name (`BadName`, `Traversal`) belongs to no space: it is an other file of kind `unreadableEntry` in every plan and a row of the report's Skipped section, named by `Unreadable.entry` (the lossy name or `#<index>`).
- Scanning writes nothing anywhere (FR-IMP-05 AC-5).

---

## 4. The mapping (data)

A mapping is given as data and may be partial; the engine fills the rest with R148's defaults and returns the **effective** mapping in the plan (`Plan.mapping`). The default mapping is therefore `plan(…, &Mapping::default(), …)?.mapping`. Nothing about a mapping is stored by the engine (D-1525, D-1528).

```rust
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Mapping {
    pub version: u32,                                   // 1; absent or 0 is read as 1
    /// Key: the Capacities `type:` value, NFC (`Book`, `DailyNote`).
    pub types: BTreeMap<String, TypeMapping>,
    /// D-81: case-only links the user confirmed. Default: none.
    pub case_links: Vec<CaseLinkChoice>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct TypeMapping {
    pub to: Option<TypeTarget>,                         // None: R148's default
    /// Key: the source attribute key as written, NFC.
    pub attributes: BTreeMap<String, AttrMapping>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TypeTarget {
    Existing { key: String },                           // a type key of the target vault (`book`)
    New { name: String },                               // plural and folder stay the export folder's name (D-1526)
    Skip,                                               // `Don’t import` (D-1527 (1))
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct AttrMapping {
    pub to: Option<AttrTarget>,                         // None: R148's default
    /// D-1527 (2). None: merge as proposed. `Off`: no merge. `Keep`: folded value → the spelling kept.
    pub merge: Option<Merge>,
    /// FR-IMP-08 AC-5, AC-11.
    pub split: Option<Split>,
    /// Task `status` only (D-1527 (3)): source value → an existing status label of the Task type. "" is the empty value.
    pub values: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttrTarget {
    Existing { key: String },                           // an attribute key of the target type
    New { name: String, #[serde(default)] r#type: Option<String> },   // R10 type key (`text`, `checkbox`, `select`, …); None: inferred (D-1526)
    Drop,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Merge { Off, Keep { spellings: BTreeMap<String, String> } }
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Split { pub on: bool, #[serde(default)] pub to: Option<String> /* source `type:` value of the link targets, e.g. `Person` */ }
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaseLinkChoice { pub note: String /* source path in the space */, pub target: String /* link text as written, NFC */, pub r#use: bool }
```

**Serde, exactly** (so the example below deserializes with the structs as written, and a test asserts it): `Mapping`, `TypeMapping` and `AttrMapping` derive `Default` and carry the container attribute `#[serde(default)]`, so `version`, `types`, `caseLinks`, `to`, `attributes`, `merge`, `split` and `values` may each be absent; `{}` is the default mapping. An unknown field is an error (`deny_unknown_fields`), reported by the caller's deserializer, not by `plan`. `r#type` and `r#use` are the JSON fields `type` and `use`. The effective mapping in `Plan.mapping` is written in full: every source type and every source attribute has its entry with `to` set, and `version` is 1.

**The effective mapping, entry by entry** (so `plan.json` can be written from the rules, §5.4):

- `types` has one entry per source type of the space (the keys of `Plan.types`). Its `to` is `existing { key }`, `new { name }` or `skip`, never absent.
- A type's `attributes` has **exactly the keys of its `PlannedType.attributes`**: every top-level frontmatter key that a note of that type has, `type` included. Each entry's `to` is:

| The attribute's `action` (§5.1) | `to` |
| --- | --- |
| `keep`, `rename` | `{ "kind": "existing", "key": <target key> }` |
| `new` | `{ "kind": "new", "name": <name>, "type": <the R10 key written to the type file> }`: `type` is always set |
| `notCreated` (every value null) | `{ "kind": "new", "name": <source key>, "type": null }`: given back, it is inferred again and again not created |
| `drop` | `{ "kind": "drop" }` |
| `consumed` (R148's on-purpose rows, §4.1) | `{ "kind": "existing", "key": <the key written: `PlannedAttr.key`> }` (`title` → `title`, `createdAt` → `created`, `reviewed` → `review`, Task `deadline` and `date` → `due`, `type` → `type`) |

- `merge`, `split` and `values` are **echoed as given and never filled in**: an entry the given mapping doesn't have, or has without them, has `merge: null`, `split: null`, `values: {}`. What the engine proposes is in the plan, not in the mapping (`PlannedAttr.merges`, `.statuses`, `.split`). `caseLinks` is echoed as given.
- **A consumed key takes no other target in I1.** Given back with the `to` of the table, the entry is accepted and changes nothing; any other `to` for a consumed key is `InvalidMapping`, `UnknownTargetAttribute` (no criterion gives an on-purpose row another target; `values` for Task `status` and `merge` for Task `priority` stay as §4 defines them). Two consumed keys onto one key (Task `deadline` and `date` onto `due`) are not a `DuplicateTarget`.
- Planning with the effective mapping gives the same files as planning with the mapping it came from. Only `needsLook` can differ (§5.1): an entry with a `to` counts as confirmed.

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
- **The on-purpose rows are a closed list** (action `consumed`, §5.1). For every type: `type`, `title`, `description`, `aliases`, `tags`, `createdAt`, `lastUpdated`, `reviewed`, `icon`, `coverImage`. When the target type is Task: `status`, `priority`, `deadline`, `date`, `completed`. When it is Daily Note: `date`. For a source `Weblink`: `previewImage` (FR-IMP-24 AC-2: its target is `cover`). A consumed key never becomes an attribute of a type file and is never `notCreated`: with every value null it is a `consumed` row with `values: 0`.
- **A Task's `due`** (FR-IMP-15 AC-3, FR-TSK-13, D-46): the day of `deadline` when it has a value, else the day of `date`, else no `due`. `due` is written at the place of the source key that gave its value; neither `deadline` nor `date` is written as a key. **When both have a value** (`c12-task-dates`, `Plan the release`), `due` is the deadline, and the `date` value is **kept as text under `date-text`** (CP-9, D-1563): the day (`date-text: 2026-02-09`; the value as written when it is no date), at the place of the source key `date`, an **undeclared** key (not added to `task.yml`, shown under Other properties; D-46: a Task has only a due date). The report's Attributes section has one row `Task · date · renamed · date-text · key already used` (`AttrChange::Renamed { key: "date-text", reason: KeyTaken }`, §5.3), so nothing disappears unreported. `task.yml` gains no attribute with the default mapping (`fr_imp_08_ac4_…`). Expected output: `capacities-expected/c12-task-dates/Tasks/Plan the release.md`.
- **`coverImage` and `previewImage`** (FR-IMP-15 AC-4, FR-IMP-24 AC-2). **Input form** (BRD §15.1 C6, C15 and the S5 report: "null or a Markdown link"; no fixture shows a stored one yet, §16.2): the value is `null`, or a string whose whole content is **one** inline Markdown image or link (`'![](./Media/N%C3%A1hled.png)'`, `'[Obal](../Images/Media/Obal.jpeg)'`) with a relative, percent-encoded destination into a `Media/` folder, as in a body. The string is read as any frontmatter string value (§6.5), so the link is a counted link with the place `frontmatter` and is resolved by §8 (1).
  - `null` → no `cover`, nothing reported (the red tests on `c06`, `c15`).
  - Outcome `attachment` → `cover: "[[<D-184 target of the file's Image object>]]"` (`FmValue` `{ link }`; "as an Image object link"). The file is imported like any referenced media file; when it has no note of its own it gets a made object (§5.1, `orphanMedia` with `referenced: true`).
  - **Any other value** (the file is missing; an external URL; other text) → **no `cover` key is written** (CP-11, D-1565): a missing file is reported as in a body (`unresolved` row `missingFile` and Files row `droppedReference`), another value in an Attributes row `dropped` with its count.
  - A `Weblink` with a value in both keys: `coverImage` gives `cover`, whatever the keys' order; `previewImage`'s value lost its key and is **kept as text under `previewImage-text`** (CP-9, D-1563): the value as written (a bound link in it (wikilink or Markdown link or image) rewritten as the same link in a body (§8), D-1570), an undeclared key at the place of `previewImage`, and one Attributes row `Weblink · previewImage · renamed · previewImage-text · key already used`.
- **An Image or PDF object** (source `Image` / `PDF` note, or made for a media file with no note). The import always writes `file: "[[<planned file name>]]"` (`FmValue` `{ link }`; the file name alone, as attachment names are unique, §8 (4)), **first among the attributes**; a source key `file` is `file-text` by D-1550. The source's `mimeType`, `fileSize`, `width`, `height`, `colors` are dropped by default (D-78), also though the Image type has attributes `width` and `height`: D-78's row comes before the same-key rule. The import does **not** write the Image and PDF types' own `media-type` and `size` (nor `width`, `height`), which Tegg's own `mediaObject` computes (ms6-trash-media §3.5): CP-10, D-1564; the engine reads no media file's header, so a made object's frontmatter is `id, type, title, file, import-id, created, modified` and nothing else (the L1 red test `fr_imp_14_ac6_import_new_writes_a_media_object` has this shape).
- **Kind of a new attribute:** D-1526's order (checkbox, number, date, date-time, date range, relation, select, text) over the non-null values of the attribute in the space; distinct values for the select rule are counted after trimming and case-folding (D-1545 (2)); a mixed attribute is text; an all-null attribute isn't created and is reported.
- **Values are converted one by one** whatever the attribute's kind (D-1545 (3)): a UTC-midnight date-time → `YYYY-MM-DD`; another date-time → the local offset of `env.zone`; `a -> b` → `<key>-start`, `<key>-end`; `null` → omitted; anything else as written.
- **Merges:** proposed only for values equal after trimming and case-folding; the kept spelling is the one used by more objects, then one matching an existing option of the target attribute, then the first by source path (D-1527 (2)).
- **A link-select attribute** (FR-IMP-21): an attribute whose every value is a link with no matching object is listed in `Plan.decisions.tagLike`; it becomes a select only when the mapping gives it `"type": "select"` (D-1536).
- **Key of a new attribute (D-1553).** The name as given when it is a valid Tegg key (letters, digits, `-`, `_`, starting with a letter, not reserved); else `tegg_schema::derive_attr_key(name)`. The attribute's `name` in the type file is the name as given. The default name is the source key, so `peopleInvolved` stays `peopleInvolved`, and `Datum konání` becomes the key `datum-konání` with the name `Datum konání`; the change of key is a row of the report's Attributes section. The check is `tegg_schema::check_attr_key(key, def, new_type)` (its real signature: the key, the target type's `TypeFile` as the plan will leave it, the new attribute's `AttrType`); its errors decide what happens, in this order, **once per attribute in source order**, each attribute checked against the type's existing attributes plus the new attributes planned before it:

| `check_attr_key` answers | A default name (the source key) | A name given by the mapping (`New { name }`) |
| --- | --- | --- |
| `AttrKeyInvalid` (a character that isn't allowed, or no leading letter) | the key is `derive_attr_key(name)`, then checked again; Attributes row `renamed`, reason `invalidKey` | the same |
| `Empty` after deriving (name `123`, `!!!`: nothing is left) | the key is `attr-` + the name's characters that are letters, digits, `-` or `_` after `type_key` (`123` → `attr-123`), or `attr` when none is left; then checked again; row `renamed`, reason `invalidKey` | `InvalidMapping`, `EmptyName` |
| `ReservedKey` | never reached: R148's rows map the key on purpose or make it `<key>-text` (D-1550) first | `InvalidMapping`, `ReservedKey` |
| `AttrKeyTaken` (the key is an attribute of the target type that this source attribute is **not** mapped onto, or an earlier new attribute of this run) | the first of `<key>-2`, `<key>-3`… that passes the check; row `renamed`, reason `keyTaken` | `InvalidMapping`, `KeyTaken` |
| `RangeCollision` (the key is `<k>-start` / `<k>-end` of a date range of the type, or a new date range whose `-start` / `-end` exists) | the same suffix rule, on the attribute that comes later in source order (`trip` → `trip-2`, written as `trip-2-start`, `trip-2-end`); row `renamed`, reason `rangeClash` | `InvalidMapping`, `RangeCollision` |

  So a default mapping always gives a plan (D-1553 didn't choose "refuse until renamed"), a name the user typed is never changed silently, and in both cases a new attribute is **appended** and no existing attribute's key, name, kind or options change (D-1529 (3)). Every changed key has its Attributes row (§5.3), and the frontmatter key written is the final key.
- **A Daily Note's date.** The day of an imported Daily Note is, in this order: the day of the source's `date:` value (converted as above: `2026-02-02T00:00:00.000Z` → `2026-02-02`; fixture `c13-daily-notes` has it), else the source `title` when it is a valid `YYYY-MM-DD`, else the source file's stem when it is one. The import **always writes the key `date: YYYY-MM-DD`** (the Daily Note type's own attribute) from that day, also when the source has no `date:` key, at the place of the source's `date` key or, without one, first among the attributes: Tegg's index finds a day's note by `date` (ms4-daily §2), never by title or file name, so an imported Daily Note without the key would belong to no day. The stem and the `title` come from the same day (§5.2). A source with a day in none of the three places is imported as a Page (D-1561, §19).

### 4.2 Validation (FR-IMP-08 AC-12, FR-IMP-03 AC-8)

`plan` returns `ImportError::InvalidMapping { entry, reason }` before anything else when the mapping can't be applied. `entry` is `MappingEntry { source_type: String, attribute: Option<String> }`.

| `reason` | When |
| --- | --- |
| `UnknownSourceType`, `UnknownSourceAttribute` | the mapping names a type or attribute the space doesn't have |
| `UnknownTargetType`, `UnknownTargetAttribute` | `Existing` names a key the target doesn't have (a new vault has only the seven system types) |
| `TypeNotAllowed` | a target of D-1527 (6)'s closed set (Task, Daily Note, Image, PDF, Quick Note, Tag) for a source type that doesn't default to it; `Image` / `PDF` retargeted (D-1544) |
| `NameTaken` | a new type named as an existing type or as another new type of the mapping (name or plural, NFC, case-insensitive) |
| `ReservedKey` | a new attribute whose given name is a reserved key (FR-TYP-15) |
| `EmptyName` | a new type name that sanitizes to an empty folder name, an empty attribute name, or a given attribute name whose derived key is empty (§4.1) |
| `KeyTaken`, `RangeCollision` | a given attribute name whose key is an attribute of the target type, another new attribute of the mapping, or clashes with the `-start` / `-end` keys of a date range (§4.1; a default name is suffixed instead) |
| `DuplicateTarget` | two source attributes of one type onto one target key |
| `KindMismatch` | an existing attribute whose kind can't hold every value (`author` onto `rating`), or a `type` that isn't an R10 key |
| `UnknownStatus` | a `values` entry naming a status the Task type doesn't have |
| `UnknownVersion` | `version` above 1 |

**One error per call, and which one.** Checks run in this order and the first failure is the answer: `UnknownVersion`; then types in name order (`UnknownSourceType`, `UnknownTargetType`, `TypeNotAllowed`, `EmptyName`, `NameTaken`); then, per type in name order, its attributes in **source order** (the order of `PlannedType.attributes`): `UnknownSourceAttribute`, `UnknownTargetAttribute`, `EmptyName`, `ReservedKey`, `KindMismatch`, `UnknownStatus`, then **`DuplicateTarget`, then `KeyTaken` / `RangeCollision`**.

- **`DuplicateTarget` wins over `KeyTaken`.** Two source attributes of one type whose targets are **both given by the mapping** (`existing` or `new`) and come to one key are `DuplicateTarget`; `entry` names the **later** of the two in source order. So two new attributes given one name (`author` and `medium` both `new { name: "stejné" }`) are `DuplicateTarget` on `medium`, never `KeyTaken`.
- `KeyTaken` is left for a **given** name whose key is an attribute of the target type that this source attribute isn't mapped onto, or the key that **another source attribute of the type gets by default, wherever it stands in source order**: `author` given the name `pages` beside the source attribute `pages` is `KeyTaken` on `author` (the red test's case), not a silent `pages-2` for the other one. So §4.1's "checked against the new attributes planned before it" is for default names only: given names are checked first, against the type's attributes and every default key, and a name the user typed never moves another attribute to a suffix. (A default name that meets a taken key is suffixed, §4.1, and is never an error.)
- The red test `fr_imp_08_ac12_invalid_mapping_refused` accepts either reason and either attribute for the two-names case; this rule is the stricter one it allows.

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
- Deterministic: objects in source-path order (NFC paths compared by code point); the same inputs give equal plans (FR-IMP-03 AC-9). `Plan` is `PartialEq`; a zip and a folder of the same export are compared with `Plan::same_as` (§5.4).
- **Links are read by `@tegg/doc`** (D-1551): `plan` sends each readable note to `env.transformer` with the op `import-scan` (§7.1). A transformer error on a note makes that note `unreadable` with the reason `engine`; `Unavailable` fails the call with `ImportError::Transform`.
- Progress: `phase: Planning`, `done` / `total` in notes. Cancel ends within 1 s with `Err(Cancelled)`.
- Refusals: `UnknownSpace`, `InvalidMapping`, the target refusals of R153 (`TargetExists`, `TargetNotWritable`, `TargetInsideVault`, `TargetInsideSource`), `NoSpace { needed, free }`, `SourceChanged` / `SourceGone` (the stamp is checked at the start of `plan`).
- **The target refusals are decided by reading only** (`tegg_vault::probe_new_vault`, §12.2; nothing is created, not even a probe file), the same way in `plan` and in `start`:
  - `TargetExists`: `<parent>/<name>` exists (a file or a folder); **or** `<parent>/<name>.tegg-importing` exists without the marker `.tegg-import`; **or** it exists with a marker whose run id is a run running in this process (§9.5). A leftover with the marker of a run that isn't running is **not** a refusal in `plan`: `plan` leaves it alone and `start` moves it to the system Trash (§9.5 step 1, D-1559).
  - `TargetNotWritable`: `<parent>` doesn't exist, isn't a folder, or the process may not create entries in it (`access(W_OK | X_OK)`, which also answers for a read-only volume). The check can't promise the later write: a create that is then refused fails the run with `Write` (§9.5 step 6).
  - `TargetInsideVault`: `<parent>`, after resolving symbolic links, or a folder above it holds a `.tegg/` entry. `TargetInsideSource`: for a folder source, the resolved `<parent>` is the source folder or lies inside it.
  - `name` must equal `tegg_format::sanitize_file_stem(name)` and be non-empty; otherwise `InvalidPlan { reason: Target }` (§9), since it is a caller's bug and not a state of the disk.

### 5.1 The plan DTO

All structs are `Clone + Debug + PartialEq + Serialize + Deserialize`, `camelCase` in JSON, with public fields (FR-IMP-05 AC-6 changes a plan on purpose).

```rust
pub struct Plan {
    pub version: u32,                         // 1
    pub space: String,
    pub source: ScanInfo,
    pub target: PlanTarget,                   // { kind: "newVault", parent, name } | { kind: "existing", name, notes: usize }; `parent` is an absolute path as a string
    pub mapping: Mapping,                     // effective (§4)
    pub types: Vec<PlannedType>,              // one per source type, in name order
    pub objects: Vec<PlannedObject>,          // every object of R147 **and** every made media object (`orphanMedia`, at its media file's path), in source-path order
    pub attachments: Vec<PlannedAttachment>,  // every attachment of R147, in source-path order
    pub other_files: Vec<OtherFile>,          // `.csv`, dotfiles, files outside every space: reported only
    pub links: Vec<PlannedLink>,              // every link of R147, by note then by position
    pub report: ReportData,                   // §5.3: R150's rows
    pub totals: Totals,
    pub decisions: Decisions,                 // step 4c's candidates (D-1536)
    pub already_imported: usize,              // FR-IMP-20 AC-2; 0 for a new vault
    pub report_path: String,                  // `Pages/Import report 2026-11-12 PKM.md` (R150; ` (2)` when taken)
    pub space_bytes: u64,                     // uncompressed size of the space's entries
    pub backup: Option<BackupPlan>,           // { files: usize, bytes: u64 } when D-1549 (5) asks for a zip. The plan-time answer only: the job decides again (§9.3)
    pub needed_bytes: u64,                    // FR-IMP-07 AC-12
    pub stamps: Stamps,                       // the source stamp and the type-file stamps (§9.2); defined below; callers pass it back unchanged
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
    pub merges: Vec<ValueMerge>,
    pub statuses: Vec<StatusMap>,             // Task `status` only
    pub split: Option<Split>,
    pub needs_look: bool,                     // D-1532 (the window's count; I2)
}

pub struct PlannedObject {
    pub source: String,                       // path inside the space, NFC, "/" (`Meetings/Tomáš  Eva (1).md`); for a D-77 media object the media file's path
    pub import_id: String,                    // `capacities:<space>/<source>` (FR-IMP-15 AC-7)
    pub outcome: ObjectOutcome,               // "imported" | "skipped" | { "unreadable": { "reason": "yaml", "line": 4 } }
    pub source_type: Option<String>,
    pub r#type: Option<String>,               // target type key
    pub title: Option<String>,
    pub path: Option<String>,                 // planned vault path (`Books/Book 1 (2).md`)
    pub kind: ObjectKind,                     // "note" | "media" (has a source `.md`) | "orphanMedia" (D-77) | "queryStub"
    pub frontmatter: Vec<(String, FmValue)>,  // R149's order without `id`; `created` / `modified` absent when the import time is used (D-1538 (4)). `FmValue`: §7.1; JSON `[key, value]` pairs
    pub name_changes: Vec<NameChange>,        // why the file name differs from the title (R150 Files); empty when it doesn't
}

pub struct PlannedAttachment {
    pub source: String,
    pub outcome: AttachmentOutcome,           // "imported" | { "unreadable": { "reason": "read" } }
    pub path: Option<String>,                 // `_attachments/Mapa řeky (2).jpeg`
    pub object: Option<String>,               // `source` of its Image or PDF object
    pub bytes: u64,
    pub renamed_from_generic: bool,           // FR-IMP-14 AC-3
    pub referenced: bool,                     // false: D-77
}
pub struct OtherFile { pub source: String, pub kind: OtherKind /* "tagCollection" | "csv" | "dotfile" | "outsideSpace" | "unreadableEntry" (§3) */ }

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
    pub kept_as_markdown: bool,               // D-1552: the text can't be a wikilink alias
}

#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LinkOutcome {
    Resolved, DateMention, Attachment, External,                                  // imported
    Unresolved, OtherSpace { space: String }, Ambiguous, CaseMismatch { confirmed: bool },
    SelectValue, MissingFile, InSkippedNote, TargetNotImported,                   // reported
}
impl LinkOutcome { pub fn imported(&self) -> bool; }

```

**Every type named above, written out** (all `camelCase` in JSON; an enum without data is its name as a camelCase string; an enum with data is `{ "<variant>": { … } }` unless a `kind` tag is shown; field order below is the JSON field order):

```rust
// ---- outcomes
pub enum ObjectOutcome { Imported, Skipped, Unreadable { reason: ObjectUnreadable, line: Option<u32> } }
/// `yaml`: the frontmatter isn't valid YAML (`line`: 1-based line of the error). `noType`: no frontmatter, or no `type:` string in it.
/// `notUtf8`: the file isn't UTF-8. `read`: the entry can't be read (I/O error, bad CRC, `UnreadableReason::Read`).
/// `encrypted`: a single password-protected entry. `engine`: the transformer failed on `import-scan` (D-1557). `line` is `Some` only for `yaml`.
pub enum ObjectUnreadable { Yaml, NoType, NotUtf8, Read, Encrypted, Engine }
pub enum AttachmentOutcome { Imported, Unreadable { reason: AttachmentUnreadable } }
pub enum AttachmentUnreadable { Read, Encrypted }
pub enum ObjectKind { Note, Media, OrphanMedia, QueryStub }
pub enum OtherKind { TagCollection, Csv, Dotfile, OutsideSpace, UnreadableEntry }
pub enum LinkPlace { Body, Frontmatter { key: String } }
pub enum LinkForm { Wikilink, Embed, Markdown, Image }

// ---- attributes
/// `keep`: onto the target type's attribute with the same key. `rename`: onto an existing attribute with another key.
/// `drop`: not written. `new`: a new attribute (`key` may differ from `source_key`: `<key>-text`, a derived or suffixed key, §4.1).
/// `consumed`: R148's on-purpose rows, which the engine maps onto reserved keys or system attributes (`type`, `title`, `description`,
/// `aliases`, `tags`, `createdAt`, `lastUpdated`, `reviewed`, `icon`, `coverImage`, the Task rows, a Daily Note's `date`); `key` is the key written.
/// `notCreated`: every value is null (D-1526).
pub enum AttrAction { Keep, Rename, Drop, New, Consumed, NotCreated }
pub struct ValueMerge { pub variants: Vec<String> /* as written, first-seen order */, pub kept: String, pub applied: bool /* false: `Merge::Off` */ }
pub struct StatusMap { pub value: String /* "" is the empty value */, pub to: String /* status label */, pub state: String /* open | in progress | done | cancelled */, pub count: usize, pub fallback: bool /* no status of that name and no `values` entry: `To do` (D-1527 (3)) */ }
pub enum NameChange { Reserved /* `CON` → `CON_` */, Empty /* no valid character → `Untitled` */, Cut /* to 200 bytes */, Suffix /* ` (n)`: the name was taken */, Characters /* forbidden characters replaced */ }

// ---- step 4c's candidates (D-1536), each list in note order, then by `n`
pub struct Decisions { pub case_links: Vec<CaseLinkCandidate>, pub ambiguous: Vec<AmbiguousLink>, pub tag_like: Vec<TagLikeAttr> }
pub struct CaseLinkCandidate {
    pub note: String, pub n: u32,             // the link: `PlannedLink.note`, `.n`
    pub written: String,                      // the link's source text
    pub target: String,                       // what `CaseLinkChoice.target` must repeat
    pub candidate: String,                    // `source` of the object that matches case-insensitively (the first by source path when several)
    pub candidate_title: String,
    pub confirmed: bool,                      // the mapping says `use`
}
pub struct AmbiguousLink { pub note: String, pub n: u32, pub written: String, pub title: String, pub candidates: Vec<String> /* `source` paths in path order */, pub chosen: String /* candidates[0] (D-76) */ }
pub struct TagLikeAttr {
    pub source_type: String, pub source_key: String,
    pub objects: usize,                       // objects that have a value
    pub values: Vec<String>,                  // distinct link targets, first-seen order
    pub example: String,                      // the first value as written (`[[in progress]]`)
    pub selected: bool,                       // the mapping gives it `"type": "select"`
}

// ---- totals
pub struct Totals { pub objects: Tally, pub attachments: Tally, pub links: Tally, pub other_files: Tally }
pub struct Tally { pub total: usize, pub imported: usize, pub reported: usize }
pub struct RawTotals { pub objects: usize, pub attachments: usize, pub links: usize, pub other_files: usize }   // `accounting::totals` (§6)

// ---- targets and stamps
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlanTarget { NewVault { parent: String, name: String }, Existing { name: String, notes: usize } }
pub struct BackupPlan { pub files: usize, pub bytes: u64 }
#[derive(Default)]
pub struct Stamps { pub source: SourceStamp, pub type_files: Vec<TypeFileStamp> /* in path order */ }
#[derive(Default)]
pub struct SourceStamp {
    pub container: Option<FileStamp>,         // a zip: the file itself; None for a folder
    pub entries: Vec<EntryStamp>,             // every entry of the selected space, in path order
}
pub struct FileStamp { pub size: u64, pub mtime_ns: String }
pub struct EntryStamp { pub entry: String, pub size: u64, pub mtime_ns: Option<String> /* folder */, pub crc32: Option<u32> /* zip */ }
pub struct TypeFileStamp { pub path: String, pub version: Option<ContentStamp> /* None: the path was absent at plan time (a type file the run creates) */ }
pub struct ContentStamp { pub size: u64, pub hash: String /* BLAKE3, hex, as `FileVersion` */ }

// ---- progress (§10)
pub enum ImportPhase { Reading, Planning, Backup, Writing, Done, Cancelled, Failed }
pub enum WriteStep { Vault, Types, Attachments, Objects, Report }
pub enum SourceKind { Zip, Folder }
```

- **Modification times are decimal strings** of nanoseconds since the epoch: an `i128` (or any integer above 2^53) doesn't survive JSON in the UI, and a `Plan` must come back from the window unchanged (§9).
- **`PlannedAttr.key` / `name` / `type`** are `None` for `drop`, `notCreated`; `consumed` has `key` only.
- **Waiting in the queue has no `ImportPhase`:** an existing-vault job that waits is reported by the engine's `JobProgress` (`phase: queued`) only; `ImportProgress` starts with `planning`.

- **Outcome names are R147's**, in kebab-case in JSON: `resolved`, `date-mention`, `attachment`, `external`, `unresolved`, `other-space`, `ambiguous`, `case-mismatch`, `select-value`, `missing-file`, `in-skipped-note`, `target-not-imported`. `imported()` is true for the first four. `ambiguous` and a confirmed `case-mismatch` carry `to` (they are written as links) and are still counted as reported, as R147 lists them.
- **Totals:** `objects.imported` counts `imported`; `reported` counts `skipped` and `unreadable`. `links.imported` counts `imported()`. `other_files` are all reported.
- **`totals.objects` counts the space's `.md` objects only** (R147: "every `.md` in the selected space that is not a dotfile"): the `PlannedObject`s whose `kind` isn't `orphanMedia`. A **made media object** (`orphanMedia`: an Image or PDF object the import makes for a media file that has no note of its own, D-77) is in `Plan.objects` so that it is written, gets its id in write order and its `import-id`, but it is **in no tally**: its media file is counted once, as an attachment. So `c05-media-objects` has `totals.objects.total` 4, `totals.attachments.total` 4 and `plan.objects.len()` 5. The accounting treats it the same way (§6.2), `ReportSummary.objects` and the report's Types rows don't count it (it has no `source_type`), and it is reported by its Files row (`unreferenced`) when no note referenced the file. `ImportProgress` counts it among the files to create.
- **`ObjectKind::OrphanMedia` means "made, no source note"**, whether or not a note references the file: `PlannedAttachment.referenced` says which. D-77's Files row and "keeps its name" (§5.2) are for `referenced: false` only.
- **`PlannedType.attributes`, for every target, system types included:** one row per top-level frontmatter key that a note of the source type has (`type` included), in source order; never a row for an attribute of the target type that no source key maps onto. A row is `consumed` by §4.1's closed list, else `drop`, `keep`, `rename`, `new` or `notCreated` as for any type. `values` counts the non-null values and `nulls` the null ones over the type's readable notes. `options` is filled for a select target (new or existing: the values written, in first-seen order, after merges), `merges` for every proposed or applied merge, `statuses` for a Task's `status`.
- **`needs_look` (D-1532), exactly:** true when at least one holds, else false: (1) `action` is `new` and the **given** mapping has no `to` for the attribute; (2) `merges` isn't empty and the given mapping has no `merge` for it; (3) it is a Task's `status` and one of its `statuses` has `fallback: true`; (4) it is a **split candidate** and the given mapping has no `split` for it. A split candidate is an attribute written as text (action `new` with the kind `text`, or `keep` / `rename` onto a text attribute) of which at least one value holds `, ` between two non-empty parts (`Jana, Tomáš, Eva`; `c16`). A `consumed`, `drop` or `notCreated` row never needs a look, except by (2) and (3). The flag feeds I2's count only and changes no written byte.
- **`needed_bytes`** (D-1549 (3)): `ceil(1.1 × space_bytes)`, plus `backup.bytes` when the backup folder is on the target's volume (`env.disk.volume`). `NoSpace` when `needed_bytes > env.disk.free(target place)`, or when the backup folder is on another volume and `backup.bytes > env.disk.free(backup folder)`; then `needed` and `free` are that volume's.
- **`already_imported`** (FR-IMP-20 AC-2): objects of the target's index (so never `.trash/` or `_templates/`) whose `import-id`, NFC, equals a planned `import_id`.

### 5.2 Names and paths

- **Stem:** `tegg_format::sanitize_file_stem(title)` after the clean-up of FR-IMP-17 and trimming (D-51, D-52, D-68, D-80: `CON` → `CON_`, no valid character → `Untitled`, at most 200 UTF-8 bytes at a character boundary and never inside a combining sequence).
- **Folder:** the target type's folder (`Books/`, `Daily/`, `_attachments/` for files).
- **Free name (D-1555, D-1558):** the first of `<stem>`, `<stem> (2)`, `<stem> (3)`… whose key (the file name, NFC, case-folded) is free. Objects are named in source-path order, attachments after them in source-path order.
  - **Among the run's own files: per folder** (D-1555, as FR-IMP-03 AC-7 says). A key is taken when an earlier planned file of that folder has it. Capacities spaces hold many same-titled objects across types; `Pages/Plán.md` and `Tasks/Plán.md` of one run both keep their names, and links between them are written in D-184 form (§8 (2)).
  - **Against an existing vault's files: vault-wide** (D-1558). A key is also taken when **any existing file of the vault** has it, in whatever folder, compared as Tegg's own creation compares (D-291 part 2, ms4-links §3.1: every file outside `_templates/` and `.trash/`, NFC and case-insensitive). So no bare link the vault already has changes its target (FR-IMP-03 AC-7): with `Pages/Plán.md` in the vault, an imported Task `Plán` is `Tasks/Plán (2).md`, and the owner's `[[Plán]]` still means the Page. An object's key is its `.md` file name, an attachment's is its file name with the extension, so an object and an attachment never take each other's names.
  - **A new vault** has no existing files: only the per-folder rule applies (the system type files and `vault.yml` lie under `.tegg/` and share no name with an object).
  - The vault-wide comparison is made by `plan` and again by the re-check before the first write (§9.2 step 3). During `writing` only the exclusive create at the planned path guards a name (§9.4, D-1547 (3)).
- **Daily Notes:** stem `YYYY-MM-DD` from the note's day (§4.1 "A Daily Note's date"; FR-IMP-11 AC-6), `title` the same, and the key `date` always written; a day the vault already has gets ` (2)` (D-1529 (2), D-1546).
- **Attachments:** the source file name, NFC; a generic name (`@tegg/doc` `isGenericName`: `image (3)`, `Untitled (44)`) becomes `<owning note title> <n>` (FR-IMP-14 AC-3); an unreferenced file keeps its name (D-77).
  - **The generic-name rule is Tegg's own** (trash-media.md R73, D-621; `mediaNames` in `packages/doc/src/media.ts`): the number is **always written and starts at 1**. The file is `sanitize_file_stem("<title> <n>")` + `.` + the source file's extension as written, with the smallest `n ≥ 1` whose name is free by the rule above; so the first generic file of `Whiteboard sketch` is `Whiteboard sketch 1.png`, the next `Whiteboard sketch 2.png`, and ` (2)` is never added by the planner to such a name. (The re-check of §9.2 step 3 keeps its own rule: a name taken since the plan gets ` (n)`.)
  - **The owning note** is the file's own Image or PDF note (`PlannedAttachment.object`, when that is a source note), else the first **imported** note in source-path order that has a link to the file (body or frontmatter). Its title is the title after clean-up and trimming. A file referenced only by skipped or unreadable notes has no owning note and keeps its name, as an unreferenced one.
  - Only the file is renamed: the Image or PDF object keeps its own title and file name (`Images/Whiteboard sketch.md`), and its `file`, every embed and every link follow the new file name. The Files row is `genericName` with the new name.
- **The report:** `Pages/Import report <YYYY-MM-DD> <space>.md`, the date from `env.clock` in `env.zone`, the same free-name rule.

### 5.3 Report data

`ReportData` is R150 as data: **one field per section, in R150's order**, each a list of rows that hold source paths, link text as written, keys, values and counts, never rendered text. The same struct is what `@tegg/doc` renders into the report Page (§7.4), so the report's numbers are the plan's (FR-IMP-05 AC-7). A test author can write a `plan.json` from this section alone.

```rust
pub struct ReportData {
    pub summary: ReportSummary,
    pub types: Vec<TypeRow>,                  // by source type name
    #[serde(default)]
    pub no_day: Vec<NoDayRow>,                // D-1561: Daily Notes imported as Pages, by note. JSON `noDay`; may be absent (read as empty). Rows of the Types section
    pub unresolved: Vec<UnresolvedRow>,       // by note, then `n`
    pub ambiguous: Vec<AmbiguousRow>,         // by note, then `n`
    pub case_links: Vec<CaseRow>,             // by note, then `n`
    pub simplified: Vec<SimplifiedRow>,       // by note, then `n`
    pub attributes: Vec<AttributeRow>,        // by source type name, then the attribute's source order, then the order of `AttrChange` below
    pub merged: Vec<MergedRow>,               // by source type name, then source order
    pub dates: Vec<DateRow>,                  // `unreadable` rows by note then key; the `importTime` row last
    pub files: Vec<FileRow>,                  // by `source`, then the order of `FileChange` below
    pub stubs: Vec<StubRow>,                  // by note
    pub skipped: Vec<SkippedRow>,             // in the order of `SkippedRow`'s variants, each group by path or name
    pub cleanup: Cleanup,
    pub not_exported: Vec<NotExported>,       // always the three, in this order
}

pub struct ReportSummary {
    pub source: String,                       // `ScanInfo.name` without a final `.zip`, as the single-space name of §3: a zip and its folder give one report (FR-IMP-07 AC-1)
    pub space: String,
    pub date: String,                         // YYYY-MM-DD, `env.clock` in `env.zone`
    pub objects: Tally, pub attachments: Tally, pub links: Tally,   // = `Plan.totals`
    pub backup: Option<String>,               // None in a plan; the run sets the zip's file name when it made one (FR-IMP-19 AC-12)
}
pub struct TypeRow { pub source_type: String, pub objects: usize, pub target: Option<String> /* the target type's name; None: not imported */, pub new: bool }
pub struct NoDayRow { pub note: String /* `source` of the object */ }
pub struct UnresolvedRow { pub note: String, pub n: u32, pub written: String, pub reason: UnresolvedReason }
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UnresolvedReason { NotInExport, OtherSpace { space: String }, TargetNotImported, MissingFile, InSkippedNote }
pub struct AmbiguousRow { pub note: String, pub n: u32, pub title: String /* the target as written */, pub chosen: String /* `source` of the object chosen */ }
pub struct CaseRow { pub note: String, pub n: u32, pub written: String, pub candidate: String /* `source` */, pub confirmed: bool }
pub struct SimplifiedRow { pub note: String, pub n: u32, pub written: String, pub kept: String /* the plain text kept as the alias */ }
pub struct AttributeRow { pub source_type: String, pub source_key: String, pub change: AttrChange }
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttrChange {
    Renamed { key: String, reason: KeyReason },        // `source` → `source-text`; a derived or suffixed key (§4.1)
    Dropped { values: usize },                         // D-78, or `Drop` in the mapping
    New { key: String, r#type: String },
    NotCreated { nulls: usize },                       // every value null (D-1526)
    SelectValues { values: usize },                    // FR-IMP-21: link values written as select values
    ValueNotInOptions { value: String, objects: usize },   // FR-IMP-08 AC-10: a value the Task type's options don't have
    SplitUnmatched { value: String, objects: usize },  // FR-IMP-08 AC-11: a name with no object of the split's type, kept as text
    AsStored { values: usize },                        // §7.1: nested values copied as stored
}
pub enum KeyReason { Reserved /* D-1550 */, InvalidKey /* D-1553 */, KeyTaken, RangeClash /* §4.1 */ }
pub struct MergedRow { pub source_type: String, pub key: String, pub variants: Vec<String>, pub kept: String }   // applied merges only
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DateRow {
    Unreadable { note: String, key: String, value: String },   // D-1545 (3): not a date, kept as written
    ImportTime { objects: usize },                             // D-1538 (4): objects without `createdAt`
}
pub struct FileRow { pub source: String /* the object's or the file's source path */, pub change: FileChange }
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileChange {
    DroppedReference { n: u32, written: String },      // FR-IMP-14 AC-4: `source` is the note; the link is also an `unresolved` row (`missingFile`)
    Unreferenced,                                      // D-77: `source` is the media file
    GenericName { name: String },                      // FR-IMP-14 AC-3: the new file name
    NameChanged { name: String, reasons: Vec<NameChange> },   // the written file name without its folder; also the row a re-check adds (§9.2, reason `suffix`)
}
pub struct StubRow { pub note: String }
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SkippedRow {
    Note { source: String, reason: ObjectUnreadable, line: Option<u32> },
    Attachment { source: String, reason: AttachmentUnreadable },
    Entry { entry: String, reason: UnreadableReason },         // `BadName`, `Traversal` (§3)
    Ignored { source: String, #[serde(rename = "file")] kind: OtherKind },   // `.csv`, dotfiles, files outside every space. The Rust field is `kind`; in JSON it is `file`, because `kind` is the tag: `{ "kind": "ignored", "source": "Tags.csv", "file": "tagCollection" }`
    Type { source_type: String, objects: usize },              // `Don’t import`
}
pub struct Cleanup { pub u200b: usize, pub ufeff: usize, pub u200c: usize, pub u200d: usize, pub crlf_files: usize }   // the section is empty when all are 0
pub enum NotExported { QueryDefinitions, TagColoursAndCollections, Comments }
```

- **`note`** is always the `source` of a `PlannedObject` (also of a skipped or unreadable one); `n` is the link's `PlannedLink.n`. They are what the accounting check matches (§6.2) and are not written to the Page.
- **Which row a reported link has:** `unresolved`, `other-space`, `target-not-imported`, `missing-file`, `in-skipped-note` → `unresolved`; `ambiguous` → `ambiguous`; `case-mismatch` → `case_links`; `select-value` → counted in the attribute's `SelectValues` row. A link kept as a Markdown link (D-1552) has no row.
- **After the re-check** (§9.2) the run changes `files`, `summary.backup` and nothing else before rendering.

**How a row is written** (§7.4): `- `, then the fields below joined by ` · `. An **object** is a wikilink in D-184 form when the object is imported, else its source path in a code span; **quoted** text (link text, values, entry names, file names) is a code span; a **word** is the catalog text of the key given.

| Section (`import.report.section.*`) | Fields, in order |
| --- | --- |
| `summary` | six rows: `summary.source` · source (quoted); `summary.space` · space; `summary.date` · date; then for `objects`, `attachments`, `links`: the label · `<imported>` `summary.imported` · `<reported>` `summary.reported` · `<total>` `summary.total`. Then, when `backup` is set, a paragraph: `import.report.noUndo`, a space, the zip's file name (quoted) |
| `types` | source type · objects · target type name, or `word.notImported` · `word.new` when `new`. Then, after the type rows, one row per `noDay` entry (D-1561): object (`note`) · `type.noDay` |
| `unresolved` | object (`note`) · `written` (quoted) · `reason.*` |
| `ambiguous` | object · `title` (quoted) · object chosen |
| `caseLinks` | object · `written` (quoted) · candidate object · `word.confirmed` or `word.leftUnresolved` |
| `simplified` | object · `written` (quoted) · `kept` (quoted) |
| `attributes` | source type · source key (quoted) · `attr.<kind>` · then by kind: `renamed`: key (quoted), `key.<reason>`; `dropped`: values; `new`: key (quoted), the R10 type key; `notCreated`: nulls; `selectValues`: values; `valueNotInOptions`, `splitUnmatched`: value (quoted), objects; `asStored`: values |
| `merged` | source type · key (quoted) · each variant (quoted), joined by `, ` · `kept` (quoted) |
| `dates` | `unreadable`: object · key (quoted) · value (quoted) · `date.unreadable`; `importTime`: `date.importTime` · objects |
| `files` | `droppedReference`: object · `written` (quoted) · `file.droppedReference`; `unreferenced`: the media object · `file.unreferenced`; `genericName`: the media object · source file name (quoted) · `file.genericName`; `nameChanged`: object · `name` (quoted) · each `name.<reason>`, joined by `, ` |
| `stubs` | object |
| `skipped` | `note`: source path (quoted) · `skip.<reason>` · line when set; `attachment`, `entry`: path or entry (quoted) · `skip.<reason>`; `ignored`: path (quoted) · `skip.<kind>`; `type`: source type · `skip.type` · objects |
| `cleanup` | one row per count above 0, in the order U+200B, U+FEFF, U+200C, U+200D, CRLF: the code point's name as plain text (`U+200B`, not from the catalog, no code span) · count, so `- U+200B · 4`; then `cleanup.crlf` · `crlf_files` |
| `notExported` | `notExported.queries`; `notExported.tags`; `notExported.comments` |

**Catalog keys** (`import.report.` + the key; `ReportStrings`, §2). R155 gives the rule "one key per section name and reason of R150"; this is the list. Texts marked † aren't given word for word by R150 or R155: they are the author's wording of R150's row descriptions and are approved with the expected outputs (§16.2), like every byte of the report.

| Key | English |
| --- | --- |
| `section.summary`, `.types`, `.unresolved`, `.ambiguous`, `.caseLinks`, `.simplified`, `.attributes`, `.merged`, `.dates`, `.files`, `.stubs`, `.skipped`, `.cleanup`, `.notExported` | `Summary`, `Types`, `Unresolved links`, `Ambiguous links`, `Links that differ only in case`, `Simplified links`, `Attributes`, `Merged values`, `Dates`, `Files`, `Query stubs`, `Skipped`, `Clean-up`, `Not in the export` |
| `summary.source`, `.space`, `.date`, `.objects`, `.attachments`, `.links`, `.imported`, `.reported`, `.total` | `Source`, `Space`, `Date`, `Objects`, `Attachments`, `Links`, `imported`, `reported`, `total` |
| `noUndo` | R155's sentence (D-1549 (8)) |
| `reason.notInExport`, `.otherSpace`, `.targetNotImported`, `.missingFile`, `.inSkippedNote` | `not in the export`, `in another space: {space}`, `target not imported`, `missing file`, `in a skipped note` |
| `word.new`, `.confirmed`, `.leftUnresolved`, `.notImported` | `new`, `confirmed`, `left unresolved`, `not imported` † |
| `type.noDay` | `Daily Note with no readable day, imported as a Page` † (D-1561) |
| `attr.renamed`, `.dropped`, `.new`, `.notCreated`, `.selectValues`, `.valueNotInOptions`, `.splitUnmatched`, `.asStored` | `renamed`, `dropped`, `new`, `not created, no values` †, `link values turned into select values`, `value not in the type’s options` †, `no object with this name, kept as text` †, `kept as stored` † |
| `key.reserved`, `.invalidKey`, `.keyTaken`, `.rangeClash` | `reserved key` †, `not a valid key` †, `key already used` †, `clashes with a date range` † |
| `date.unreadable`, `.importTime` | `not a date, kept as written` †, `objects without a creation date; the import time was used` † |
| `file.droppedReference`, `.unreferenced`, `.genericName` | `reference to a missing file dropped` †, `no note referenced it` †, `generic name renamed` † |
| `name.reserved`, `.empty`, `.cut`, `.suffix`, `.characters` | `reserved name` †, `no valid character` †, `cut to 200 bytes`, `name taken` †, `characters replaced` † |
| `skip.yaml`, `.noType`, `.notUtf8`, `.read`, `.encrypted`, `.engine`, `.badName`, `.traversal`, `.tagCollection`, `.csv`, `.dotfile`, `.outsideSpace`, `.unreadableEntry`, `.type` | `frontmatter isn’t valid YAML` †, `no type` †, `not UTF-8` †, `couldn’t be read` †, `password-protected` †, `couldn’t be converted` †, `unreadable name` †, `unsafe path` †, `tag collection` †, `CSV file` †, `hidden file` †, `outside every space` †, `unreadable entry` †, `type not imported` † |
| `cleanup.crlf` | `files with CRLF` |
| `notExported.queries`, `.tags`, `.comments` | `Query definitions`, `Tag colours and collections`, `Comments` |

**Rows, to the byte.** A tally row of the Summary is the label, then each number followed by one space and its word, the three groups joined by ` · `: `- Objects · 3 imported · 0 reported · 3 total` (with keys for words: `- ⟦summary.objects⟧ · 3 ⟦summary.imported⟧ · 0 ⟦summary.reported⟧ · 3 ⟦summary.total⟧`). The source row quotes the source name, the space and date rows don't: `` - Source · `c09-unresolved-links` ``, `- Space · PKM`, `- Date · 2026-11-12`. A type row has no code span (`- Trip · 2 · Trip · new`). The L1 red tests (`fr_imp_19_ac8_import_new_report_*`) hold every row kind of the table above.

**The D-1561 row.** A Daily Note imported as a Page (§4.1, §19) stays counted in its source type's `TypeRow` (`DailyNote`, whose `target` is still `Daily Note`); its own row is the `noDay` entry, written in the Types section after the type rows: `- [[Poznámky bez data]] · ⟦type.noDay⟧`. `TypeRow` gets no reason field.

`{space}` is the only placeholder. D-1538 (4)'s count ("counted in the report") has no section of its own in R150: it is the last row of `dates` (§17 (12)).

### 5.4 Comparing plans, and `plan.json`

A `Plan` holds fields that depend on the machine or on the source's container, so `==` is for two plans of **one** scan (FR-IMP-03 AC-9) and nothing else. For a zip against a folder (FR-IMP-07 AC-1) and for the expected files:

```rust
impl Plan {
    /// The plan without what depends on the machine or the container.
    pub fn normalized(&self) -> Plan;
    /// `self.normalized() == other.normalized()`.
    pub fn same_as(&self, other: &Plan) -> bool;
}
```

`normalized()` changes exactly these fields and no other:

| Field | Becomes | Why it varies |
| --- | --- | --- |
| `source.kind` | `folder` | zip or folder |
| `source.size` | `None` | the zip file's size |
| `source.name` | the name without a final `.zip` (ASCII case-insensitive) | `c10-duplicate-titles.zip` against `c10-duplicate-titles` |
| `source.unreadable[].entry` of the form `#<index>` | `#` | a directory index is the container's |
| `target.parent` (new vault) | `""` | a temporary folder |
| `needed_bytes` | `0` | depends on which volume the backup folder is on |
| `stamps` | `Stamps::default()` | sizes, modification times and CRCs of this copy |

Everything else is equal for equal inputs, **when the fixture is zipped as `<fixture folder name>.zip`** (the helper of §16.1 does): `report_path`, the single-space space name of FR-IMP-07 AC-5 and every `import_id` then agree. `plan.json` (§16.2) is `serde_json::to_string_pretty(&plan.normalized())` plus a final newline, with the key `stamps` left out (`Stamps` is skipped when it is the default). The written vaults of a zip run and of a folder run are byte-identical (FR-IMP-07 AC-1): nothing written holds the container's kind, size or `.zip` name (`ReportSummary.source` is the name without `.zip`).

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
- **6.2 Totals.** `totals()` recomputes them from the raw entries; `check_plan` compares them with `plan.totals` (`TotalMismatch`), checks `imported + reported == total` per class (`SumMismatch`), that every non-imported object, attachment and link has its row in `plan.report` (`MissingRow`; the row is found by `source` for objects and attachments in `skipped`, and by `note` + `n` for links in `unresolved`, `ambiguous` or `case_links`; a `select-value` link is covered by its attribute's `SelectValues` row), that every planned item's `source` lies in the space (`ForeignItem`) and occurs once (`DuplicateItem`). **A made media object** (`kind: orphanMedia`, §5.1) is left out of the objects class: it isn't in `totals()`'s object count (that is the space's `.md` files) nor in `plan.totals.objects`, its `source` is a media file's path, which must be the `source` of an imported `PlannedAttachment` of the plan (`ForeignItem` otherwise), and it needs no report row to be accounted (its file is an imported attachment).
- **6.3 Written vault.** `check_vault` also requires each `imported` object and attachment to exist at its planned path (`NotWritten`) and no file with an `import-id` of this run outside the plan (`WrittenNotPlanned`).
- **6.4 The link counter** counts, in the whole file text (frontmatter included), every `[[…]]` with a non-empty target and every `](destination)` with a non-empty destination whose `[` it can pair, **external ones included** (R147 counts them; the spike didn't). It is a line scanner built on `regex`, with no Markdown parser, so it shares nothing with `@tegg/doc`.
- **6.5 What counts as a link: one table for the reader and the counter.** `importScan` (§7.1) and `count_links` must give the same number for the same text; the fixtures of FR-IMP-10 AC-7 and a generated corpus (§16.1, `ac_import_property.rs`) hold them to it. The rule both follow: **a link is a span that starts with `[[`, `![[`, `[` or `![` and is written as a wikilink, an embed, an inline Markdown link or an inline image, outside the places listed as "no".**

| Construct | Counted | Reader (`importScan`) | Counter |
| --- | --- | --- | --- |
| `[[target]]`, `[[target\|alias]]`, `![[file]]` | yes, one each | wikilink and embed nodes | `[[` … `]]` on one line with a non-empty target |
| `[text](dest)`, `![alt](dest)`, also with a title, with `<dest with spaces>`, with balanced parentheses in `dest` (F1), with text over several lines or holding brackets (F12) | yes, one each; an image inside a link's text is a second link | `link` and `image` nodes whose source span starts with `[` or `![` | `](` followed by a destination read with balanced parentheses, whose opening `[` is found by bracket pairing across lines of one paragraph |
| Autolink `<https://example.com>`, `<eva@example.com>` | **no** | a `link` node whose span starts with `<` is left out | has no `](`: not seen |
| GFM bare URL or address (`https://example.com`, `eva@example.com`) | **no** | a `link` node whose span doesn't start with `[` is left out | not seen |
| Reference-style link or image (`[text][ref]`, `[ref][]`, `[ref]`) and its definition (`[ref]: dest`) | **no**; the bytes stay, and such a link isn't rewritten | `linkReference`, `imageReference` and `definition` nodes are left out | has no `](`: not seen |
| HTML `<a href="…">`, `<img src="…">`, and any link syntax inside an HTML **block** | **no** | `html` nodes are opaque (dialect: not links) | lines of an HTML block are skipped: from a line that starts (after at most 3 spaces) with `<` and a tag name, `</`, `<!--` or `<?`, to the next blank line |
| Fenced code, code spans | **no** | `code`, `inlineCode` | fences ```` ``` ```` / `~~~` paired by length; backtick runs paired by length |
| Indented code block | **no** | `code` without a fence | a run of lines indented by 4 or more spaces or a tab that follows a blank line (or starts the body) while no list is open; a list is open from a list-item line to the next non-blank, unindented line that isn't a list item |
| Math `$$…$$`, comments `%%…%%` | **no** | dialect: not links | the spans are skipped |
| Escaped `\[\[target]]`, `\[text](dest)` (an odd number of backslashes before the opening bracket) | **no** | the parser reads text | an opening bracket preceded by an odd number of backslashes opens nothing |
| A frontmatter string value that holds `[[…]]` or `[text](dest)` (`'[[Jana]]'`, a list of them) | yes, place `frontmatter` | every string scalar of the frontmatter is read with the same inline rules | the frontmatter is text like the body |
| A bare URL as a frontmatter value (`url: https://example.com`) | **no** | not a link by the rule above | not seen |

  **Known limit, stated so nobody relies on more:** the counter recognizes indented code only at the top level, not inside a list item, and HTML blocks by their first line. On such text the two can differ; the difference is a `TotalMismatch`, so it fails a check loudly and never loses a link silently. A fixture that shows a real export doing this becomes a `bug_` test and a sharper rule.
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
  links: ScannedLink[]                         // every link by §6.5's table (and nothing else), frontmatter string values included, in document order
  numbers: { key: string; item: number | null; raw: string }[]   // every frontmatter value, or list item (`item`: its index), that YAML reads as a number: its source characters (`1.50`, `0123`)
  nested: string[]                             // frontmatter keys whose value has no `FmValue` form (below)
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
  aliasSafe: boolean                           // false when `text` holds `[`, `]` or `|` (D-1552)
  inTable: boolean                             // inside a GFM table cell
}

export type ImportNoteSpec = {
  frontmatter: [string, FmValue][]             // the whole frontmatter, in R149's order, `id` and the times included
  links: LinkEdit[]                            // one per scanned link the run changes; a link not listed stays byte for byte
  paths: string[]                              // vault paths (existing and planned) whose stem equals a link target's stem, NFC case-folded: what D-184 needs
  stub?: { note: string }                      // FR-IMP-16: the body is this line, a blank line and an empty ```query fence
}
export type FmValue =
  | string | boolean | string[]                // text, a checkbox, a list of text
  | { raw: string }                            // a plain scalar written bare with exactly these characters: every number
  | { date: string } | { datetime: string } | { link: string } | { links: string[] }
  | { asStored: string }                       // the value of this **source** key, copied byte for byte from the source frontmatter
export type LinkEdit =
  | { n: number; do: 'link'; toPath: string; shown: string }          // → `[[<D-184 target>|shown]]`, or a Markdown link (D-1552); `toPath` is an object's path, or an attachment's for a plain link to a media file (D-1560)
  | { n: number; do: 'embed'; file: string }                          // → `![[<file name>]]`: image syntax and embeds only (D-1560)
  | { n: number; do: 'date'; date: string }                           // → `[[YYYY-MM-DD]]`
  | { n: number; do: 'drop' }                                         // a reference to a missing file (FR-IMP-14 AC-4)
  | { n: number; do: 'text'; value: string }                          // FR-IMP-21: the link in a frontmatter value becomes plain text

export type ImportNewSpec =
  | { kind: 'media'; frontmatter: [string, FmValue][]; file: string }               // body: `![[file]]`, as 6A's `mediaObject`
  | { kind: 'report'; frontmatter: [string, FmValue][]; data: ReportData; strings: Record<string, string>; paths: string[] }
```

**What `importNote` does to the text** (R149 "Body"; FR-IMP-10 AC-9, FR-IMP-17):

1. The frontmatter block is replaced whole by `spec.frontmatter`, serialized with `formatScalar`'s quoting (D-230): strings quoted only when YAML needs it, `{ raw }` bare and unchanged, `{ date }` bare, `{ datetime }` bare, `{ link }` as `"[[…]]"`, `{ links }` and `string[]` as flow lists, an empty list as `[]`, `{ asStored }` as the source entry's value text (below). No key is written twice. A source note without frontmatter gets one.
   - **Quoting is `formatScalar`'s and nothing else's (D-1534, D-230), for every string value, `title` and `import-id` included** (`packages/doc/src/edit.ts`): a string is written plain when YAML allows it and double-quoted otherwise; always double-quoted when it looks like a date or date-time or holds `[[`. So `title: 1:1 2026-03-19 Jana`, `title: ???` and `import-id: capacities:PKM/Pages/Plan.md` are written **without** quotes (a `:` not followed by a space and a leading `?` not followed by a space are plain YAML), `pages: "100"` and `file: "[[Mapa řeky.jpeg]]"` with them. Where a criterion's example shows quotes that `formatScalar` doesn't write (FR-IMP-11 AC-1 `title: "1:1 2026-03-19 Jana"`, AC-4 `title: "???"`), the example shows the **value**, not the bytes; both criteria carry a note saying so, and the red tests compare the value (`unquoted(…)`). The bytes are fixed by the expected outputs (§16.2).
   - The block is `---\n`, one `key: value` line per entry, `---\n`. What follows it is the source's body, untouched by this step.
2. Each listed link span is replaced (§8). Spans come from the same parse `importScan` used, so `n` means the same link. **`{ do: 'drop' }` removes exactly the link's span** and nothing around it: the spaces before and after it, the rest of its line and the line's newline stay (`a ![x](./Media/pryč.png) b` → `a  b`, with both spaces; a line that held only the link becomes an empty line).
3. Outside code spans and fenced code, U+200B and U+FEFF are removed everywhere, and U+200C / U+200D unless inside an emoji sequence. CRLF becomes LF everywhere, code included. NFC is applied to the title and to written link targets, not to other body text.
4. Every other byte stays. **The body is every byte of the source after the newline of the frontmatter's closing `---` line**, changed only by steps 2 and 3; no blank line is added, removed or trimmed, at the start or at the end. "Ends with one newline" means only this: a result that doesn't end with `\n` gets one. So:

   | Source after the closing `---` line | Written after `---\n` | The file ends |
   | --- | --- | --- |
   | one empty line (Capacities' form of an empty body: the source ends `---\n\n`) | `\n` | `---\n\n` |
   | nothing (the source ends `---\n`, or `---` with no newline) | nothing | `---\n` |
   | `\nText\n` | `\nText\n` | `…---\n\nText\n` |
   | `\nText` (no final newline) | `\nText\n` | the one added newline |
   | `\nText\n\n\n` | `\nText\n\n\n` | as the source: trailing empty lines stay |

   A note without frontmatter keeps its whole text as the body, directly after the new `---\n`. **A body that is made, not kept, follows `---\n` with no blank line:** a query stub (`spec.stub`: `<note>\n\n```query\n```\n` replaces the source body whole), a made media object (`importNew` `media`: `![[file]]\n`) and the report (§7.4). An Image or PDF object that has a source note keeps that note's body by the table above (`\n\nMedia: ![[Mapa řeky.jpeg]]\n` in `c05`).

   It must read back through `@tegg/doc` `parse` with no frontmatter error and survive `open → save` with 0 bytes changed (FR-IMP-03 AC-10); `importNote` throws when its own output doesn't.

**Values that JSON or the list above can't hold** (ms4-jobs §14.4: "non-string scalars are written as stored"):

- **Numbers never travel as JSON numbers**, in a spec or in a `Plan`: a JSON number changes `1.50` to `1.5`, `0123` to `123` and an integer above 2^53 to another integer. A number is `{ raw }` with the characters of the source scalar, which Rust takes from `ImportScanDto.numbers`, never from a parsed number. Written onto a text attribute (FR-IMP-03 AC-8, `pages: "100"`) it is the string of the same characters. Kind inference (D-1526) still reads the value as a number.
- **Nested values** are those with no form above: a map, a list that holds anything but strings (numbers, maps, lists, nulls), a block scalar (`|`, `>`), an anchored, aliased or tagged value. `import-scan` names their keys in `nested`. Such a value is **kept as stored**: `{ asStored: <source key> }` makes `importNote` copy the entry's value text (every line of it, with its indentation and comments) under the target key, so only the key's name can change (as `map-properties` renames a key in place, D-230). For the kind of a new attribute it counts as text (D-1526: a mixed attribute is text; all nested: text). It is reported: one Attributes row `asStored` with the count of such values per attribute (§5.3). It **can't be mapped** onto an existing attribute whose kind isn't text, nor converted, split or merged: a mapping that asks for it is `InvalidMapping`, `KindMismatch`; with the default mapping the attribute then becomes a new one (D-1529 (3)). This rule is for attributes (R148's last row and the `<key>-text` rows); the on-purpose rows (`title`, `tags`, `aliases`, the Task rows) keep the rules of their own criteria.
- `null` and an absent value are omitted (R149).

- **Errors.** A transformer error (`Timeout`, `Engine`) on `ImportNote` or `ImportNew` fails the run **before the first write**: every text is rendered in the pre-write phase (§9.2). The engine's message is never copied into a plan, an error value, the report or a journal: an `unreadable` object has the reason `engine`, and `ImportError::Transform.reason` is a code (§11).
- **In Rust tests** the engine is `tegg_jobs::testing::NodeTransformer` (one persistent `node packages/doc/dist/transform-cli.js`, built by `npm run build --prefix packages/doc`), shared per test binary as in `crates/tegg-jobs/tests/common/mod.rs`. So L4 bytes are the real engine's. `FailingTransformer` covers the error path.

### 7.2 Type files

- **A new type** (D-1526): `tegg_schema::serialize` of a `TypeFile` with `version: 1`, `system: false`, `name` (the mapping's name, default the `type:` value), `plural` and `folder` (the export folder's name), the default icon and colour of `new_type_file`, and the planned attributes in source order (`key`, `name`, `type`, select `options` in first-seen order, relation `to` when a split names a type). File `.tegg/types/<tegg_format::type_key(name)>.yml`.
- **An existing type** (D-1529 (3)): `tegg_schema::patch(key, text, &[TypeOp::AddAttribute(..), …], ctx)`, one op per new attribute in source order. `patch` appends, so the file differs from before only by the appended entries (FR-IMP-03 AC-6). A select value that the Task type doesn't have is never added to `task.yml` (FR-IMP-08 AC-10).
- A system type file of a **new** vault that gains attributes is `EMPTY_VAULT`'s text patched the same way.

### 7.3 Frontmatter order and values

R149: `id, type, title, description, aliases, <attributes in source order>, tags, import-id, created, modified`. `type` is the type key. Renamed keys keep the place of their source key. `description` and `aliases` are omitted when absent; `tags: []` is kept when the source had it. `created` / `modified` are the source's `createdAt` / `lastUpdated` converted by §4.1, else the import time (`env.clock` at `start`, offset of `env.zone`, seconds precision). The report Page has `id, type: page, title, created, modified` and no `import-id`. A Daily Note always has `date` (§4.1), at the place of the source's `date` key or, without one, first among the attributes.

### 7.4 The report Page

`importNew({ kind: 'report' })` renders `ReportData` in R150's section order, each section omitted when it has no row:

- A section is `## <section name>` (from `strings`), a blank line, then one list item per row: `- ` and the row's fields joined by ` · `. Which fields, in which order, with which catalog keys: the table of §5.3.
- **Blank lines, exactly.** The first heading follows the frontmatter's `---\n` directly (a made body, §7.1). Rows of one section follow each other with no blank line. Sections are separated by **one** blank line. The Summary's no-undo paragraph is separated from the last Summary row by one blank line and from the next heading by one blank line (`…total\n\n<noUndo> `<zip>`\n\n## Types`). The file ends with one `\n` after its last row.
- `strings` holds full catalog keys (`import.report.section.summary`, §2); the renderer looks up `import.report.` + the key of §5.3 and ignores entries without the prefix.
- A row's object is a wikilink in D-184 form from `Pages/` (`[[Lisbon]]`, `[[Trips/Lisbon|Lisbon]]`), by `paths`. **The spec's `objects` map** (source path → planned vault path of the object, for every imported object a row can name) decides which objects are imported and where they are, so a row links to a renamed or suffixed object (`Images/Media/image (3).png` → `Images/Whiteboard sketch.md`); a source path not in it is not imported and is quoted. Without `objects` the renderer falls back to the path in `paths` equal to the source path, else the only one with its file stem. The engine always passes `objects`.
- Link text quoted from the source is a code span, with a backtick run longer than any in the text and padding spaces when it starts or ends with a backtick, so the report adds no link of its own (FR-IMP-19 AC-8).
- Numbers are plain digits with no grouping (the Page is file content, not UI).
- The Summary's rows are the source name, the space, the date, then `Objects`, `Attachments`, `Links`, each with its three numbers and their labels (§5.3); after an import into an existing vault that made a backup (`summary.backup`), the sentence `import.report.noUndo` and the zip's file name (FR-IMP-19 AC-12).

The exact bytes are fixed by the expected outputs (`tests/fixtures/import/capacities-expected/`, §16.2), which the owner approves before the implementation.

---

## 8. Link rules the criteria leave to the contract

1. **Resolution** (FR-IMP-10; ported): a wikilink target is matched against the titles of the space's objects, NFC, exact case; a path destination against the source path. One match → `resolved`. Several title matches → `ambiguous`, bound to the first by source path (D-76). Only a case-insensitive match → `case-mismatch`, bound only when `Mapping.caseLinks` says `use` (D-81). `Date/YYYY-MM-DD` with a valid date → `date-mention`. A path into a `Media/` folder → `attachment` or `missing-file`. Binding is by **source file**, never by title, so it survives suffixes and renames (FR-IMP-10 AC-1).
2. **Wikilink form.** `{ do: 'link' }` writes Tegg's own link text, D-184 (`@tegg/doc` `d184Text(source, toPath, shown, paths)`): the target is the stem when the stem resolves to that file from the linking note's planned path (ms4-links §1: same folder first), else the vault path without `.md`; then `|shown` when `shown` differs from the target. So a suffixed target is `[[Article (2)|Article]]`, an imported twin of the user's note is `[[PKM task (2)|PKM task]]`, and a same-stem object in another folder is `[[Tasks/Plán|Plán]]`.
3. **`shown`** is the link's `text` from the scan: the alias, else the target as written (a title), else the Markdown link's plain text, else the image's alt (D-1533). It is dropped when it equals the written target.
4. **Embeds and attachments (D-1560).** What the source wrote decides the form:
   - **Image syntax** `![…](…)` (and an embed `![[…]]`) to an imported attachment becomes `![[<file name>]]` with the planned file name (`![[Mapa řeky (2).jpeg]]`), no alias and no path (FR-IMP-14 AC-2, AC-8). `LinkEdit` `embed`.
   - **A plain Markdown link** `[…](…)` (and a wikilink) to an imported attachment **stays a link**: `[Manual](../PDFs/Media/Manual.pdf)` → `[[Manual.pdf|Manual]]`. `LinkEdit` `link` with `toPath` the attachment's planned vault path (`_attachments/Manual.pdf`); the written target is the planned file name with its extension, and `|shown` follows rule 3 (dropped when it equals the written target; D-184 form). Rules 7, 8 and 9 apply as to any link: text that can't be an alias keeps the Markdown link with its destination rewritten to the attachment's relative path (D-1552), and formatting in the text is dropped and reported (D-1533). It never becomes an embed.
   - In both forms the link's outcome is `attachment` and the target carries no path: attachment names are unique in `_attachments/`, and in an existing vault free of every existing file's name (§5.2).
   - A wikilink to an Image or PDF **object** is an ordinary link to that object (FR-IMP-14 AC-8).
5. **Relation values** in frontmatter: `{ link }` / `{ links }` written as `"[[<D-184 target>]]"` with no alias unless D-184 needs one.
6. **Date links (D-1546).** Always `[[YYYY-MM-DD]]`, also when the imported day was written as `Daily/2026-02-02 (2).md`: a date link means the day, and the day's note is decided by the index (§12.3). The engine never writes a path form to an imported Daily Note for a date mention.
7. **Text that can't be an alias (D-1552).** Tegg's wikilink syntax has no escape: inner text can't hold `[` or a single `]`, and `|` separates the alias (`packages/doc/src/wikilink.ts`). A Markdown link whose plain text holds `[`, `]` or `|` therefore **stays a Markdown link**: only its destination is rewritten, to the target's path relative to the linking note's folder, percent-encoded as Tegg writes it (spaces as `%20`, D-825): `[viz [poznámka] zde](C%C3%ADl.md)` keeps its text byte for byte and becomes `[viz [poznámka] zde](Cíl.md)`. It resolves in Tegg (D-155) and in Obsidian, and renames follow it (ms4-jobs §2.3). `PlannedLink.kept_as_markdown` is true; it is not a simplified link. FR-IMP-10 AC-9 expects this form (changed by D-1552).
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

**`start` trusts no plan.** `Plan` is public and deserializable (the window sends it back over IPC, and FR-IMP-05 AC-6 changes one on purpose), so `start` validates it before the cheap checks of §9.1 and answers `ImportError::InvalidPlan { path, reason }` with **no job created and nothing written** when it fails:

| `reason` | Rule |
| --- | --- |
| `Version` | `plan.version` is 1 |
| `Target` | `plan.target` describes the `target` given (same kind; a new vault's `parent` and `name`; an existing vault's name), `plan.space` is a space of `scan`, and a new vault's `name` is a sanitized, non-empty stem |
| `Path` | every planned path (each `PlannedObject.path`, `PlannedAttachment.path`, `PlannedLink.to`, `report_path`) is relative, uses `/`, is NFC, has no empty, `.` or `..` part, no `\`, no NUL and no part that starts with a dot (so never `.trash/`, never `.tegg/`), and each part is a valid name by FR-FMT-08 (≤ 200 UTF-8 bytes) |
| `Place` | an object's path is `<its planned type's folder>/<name>.md` (the type is `PlannedObject.type`: for a Daily Note imported as a Page, D-1561, that is `page` and `Pages/`, not its source type's target); an attachment's is `_attachments/<name>`; `report_path` is `Pages/<name>.md`; no path lies in `_templates/` |
| `TypeKey` | type files are never paths of a plan: the run derives `.tegg/types/<key>.yml` from `PlannedType.key`, which must equal `tegg_format::type_key(key)`. This is the only way the run writes under `.tegg/` |
| `Duplicate` | no two planned paths are equal after NFC and case-folding |
| `Unknown` | every `PlannedObject.source` and `PlannedAttachment.source` is an entry of `plan.space` in `scan`; `import_id` is `capacities:<space>/<source>` |

`path` names the first offending value in plan order (or is `None` for `Version` and `Target`). The job repeats nothing of this: the plan can't change between `start` and the job.

### 9.1 Job kind `import` (changes ms4-jobs §1)

| Kind | `needsConfirm` | `backup` | `undoable` | Cancellable in |
| --- | --- | --- | --- | --- |
| `import` | no (D-1554: the caller's preview is the confirmation; `start` is the user's `Import`) | only for an existing vault that D-1549 (5) calls non-empty | no (D-1523, D-1549 (8)) | `queued`, `planning`, `backup` (D-110) |

- **Phases:** `queued → planning → backup (when needed) → writing → done | cancelled | failed`. There is no `confirm`.
- **Cancel in `queued` is new engine behaviour (D-1554).** No kind lists `Phase::Queued` in `JobKind::flags().cancellable` today (`crates/tegg-jobs/src/lib.rs`), so `Jobs::cancel` answers `NotCancellable` for a waiting job. `import` is the first kind that lists it: a cancelled waiting job leaves the queue, ends `cancelled` with a final event, and never reaches `planning`. Other kinds don't change.
- **Existing vault.** The run is a job of the target's own engine (`core.jobs()`, new `Jobs::start_import`, §12.1): it waits in `queued` behind that vault's other jobs (R153) and they wait behind it. `job:progress` carries `kind: "import"`. The target need not be the vault the window shows: the job belongs to the `Core` it was started on and finishes as long as that `Core` lives (D-1549 (6); keeping it alive across a vault switch is the shell's work, I2).
- **New vault.** The run is a job of a private engine over the temporary folder (D-1520): no `Core`, no index, no other job to wait for, nothing in the open vault read or written, no journal. Its `JobId` is 1. The private engine's host **implements the whole `Host` trait** (`crates/tegg-jobs/src/host.rs`: reads, writes, the local-file functions, `backup_files`, `vault_key`, `progress`, and the additions of §12.1) over a `LocalFs` of the temporary folder; the methods an import never calls (links, tags, pins, queries, renames) keep the trait's defaults. It is not a second job engine: `tegg-jobs` runs it.
- `start` itself validates the plan (above), then runs the cheap checks of §9.2 (steps 1 and 2, the target refusals of §5, `NoSpace`) and returns `Err` with **no job created** when one fails (`InvalidPlan`, `SourceChanged`, `SourceGone`, `TargetChanged`, the target refusals, `NoSpace`). The job repeats the checks after the queue.

### 9.2 `planning`: checks and rendering, nothing written

In this order; any failure ends the job `failed` with nothing written and no backup made:

1. **Source stamp:** the zip file's size and modification time, or every entry's of a folder, against the plan's → `SourceChanged { entry }` / `SourceGone` (FR-IMP-07 AC-9).
2. **Type-file stamps (D-1548):** the plan recorded, for every type file it read to match a type or an attribute, the path and its content (`ContentStamp`: size and hash), and for every type file it will create, that the path was absent. Any difference in **content** → `TargetChanged { path }`. A changed modification time with equal content is not a change.
3. **Planned paths (D-1547 (2)):** every planned path is looked up again, in planning order (objects in source-path order, then attachments). A taken one gets the next free ` (n)` by §5.2's rule, replacing a suffix the planner gave (never `X (2) (2)`). **"Free" here is §5.2's rule on the vault as it is now (D-1558): free of every file now in the vault, in whatever folder (outside `_templates/` and `.trash/`; a new vault's temporary folder holds none), and of every planned name of the run in that folder, the later ones too** (as they stand at that moment, renamed or not). "Taken" is the same test, so a file that arrived in **another** folder with a planned file's name since the plan also moves that planned file to its next ` (n)`: a renamed path must never land on a name the plan gave to another object further down. The object's or attachment's links follow, the pair goes to `ImportReport.renamed`, and the `files` row is added or updated (`NameChanged`, reason `suffix`, §5.3).
4. **Whether a backup is needed** is decided **now**, by D-1549 (5)'s rule on the vault as it is (§9.3). `Plan.backup` is the plan-time answer and only feeds the preview and `NoSpace`: a vault that gained its first `.md` since the plan gets a backup, one that lost its last gets none. `NoSpace` is computed again with the job's answer.
5. **Rendering:** every object's text and the report's, through `env.transformer` (§7.1), with ids taken from `env.ids` in write order. **Each source note is checked against its stamp when it is read here:** for a folder its size and modification time before the read and the length of the bytes read; for a zip the container's size and modification time and the entry's size and CRC over the bytes read. A difference → `SourceChanged { entry }` (`SourceGone` when it can't be opened). So a note changed after the plan is never rendered with link indexes (`n`) that the plan took from its earlier text. A transformer error → `Transform`.

`ImportPoint::Rendered` follows. Cancel is honoured between files and ends the job `cancelled`.

### 9.3 `backup` (existing vault; D-57, D-1549 (5), FR-HIS-04 AC-12, AC-13)

- **When:** the vault holds at least one `.md` outside `.tegg/` (a live object, one in `.trash/`, a template), **or** the run will change an existing type file. Never for a new vault. The question is answered in the job (§9.2 step 4), not taken from `Plan.backup`.
- **What:** ms4-jobs §6 unchanged: `<Application Support>/Tegg/backups/<vault key>/<UTC yyyymmdd-hhmmss>-import.zip` with every `.md` and every file under `.tegg/`, NFC UTF-8 names, rotation 10. **Plus the manifest entry `tegg-backup.json` of ms4-tags §5.1, first in the zip** (`version`, `kind: import`, `label`, `vault`, `time`, `job`, an empty `planned`, `done: null`) with the label `backups.label.import` `{ space }`, so Settings › Backups lists it as "Import · <space>" (D-1566 (5)). A restore of it reverses no moves: it gives the zipped files back and leaves the imported ones in place (D-1549 (8)).
- **The zip's time is `ImportEnv.clock`'s**, the value read once at `start` (§2), in UTC: with the test clock the zip is `20261112-090000-import.zip`. The engine's existing rule for a taken second stays (the next free second; `crates/tegg-jobs/src/engine.rs`), so a second import in the same clock second is `20261112-090001-import.zip`. Today the backup step reads `chrono::Utc::now()` itself and no clock can be injected there: the import job hands its time to the step (§12.1); other job kinds keep the system clock. `ImportReport.backup` and `ReportSummary.backup` are that file name.
- Failure → `failed` with `BackupFailed`, nothing written. Cancel during the zip removes the partial zip.

### 9.4 `writing`: order and the exclusive create

Order (R149): **type files**, **attachments** in source-path order, **objects** in source-path order (a D-77 media object at the place of its media file's path), **the report**. From the first of them the job is not cancellable.

- **Every create is exclusive (D-1547 (1)) and staged**, in two calls of `Vault` (§12.2; the new-vault run makes the same two calls on its private `LocalFs`):
  1. **`stage_new(path, tag, src)`, outside the vault lock.** The bytes are streamed into `<folder>/.<file name>.<tag>.tegg-tmp`, opened create-new (never truncating an existing file), and synced. `tag` is `i<job id>`, so the name is unique to the run: job ids start above every journal on disk (ms4-jobs §8), and nothing else in Tegg writes that name. It still starts with `.` and ends with `.tegg-tmp`, so it is unmanaged (FR-STO-09) and covered by the vault open's clean-up. The call returns the bytes' size and hash and the temp file's **file id** (its inode).
  2. **`commit_new(staged)`, under the vault lock**, which is held only for the name check of `Vault::create_exact` (no file of that folder has the name, NFC and case-folded) and the no-replace rename: `renamex_np(tmp, target, RENAME_EXCL)` on macOS, `link` + `unlink` elsewhere (`tegg-vault/src/local.rs`, `rename_no_clobber`, both `cfg`-gated as AR-03 AC-3 asks). Neither keeps the lock while bytes are copied.

  Why not `LocalFs::create_new` as it is: its `write_temp` uses the fixed name `.<name>.tegg-tmp` and truncates, which is safe only while `Vault`'s lock is held (its own comment says so). An attachment streamed under that lock would hold the owner's saves for the length of the copy (FR-UX-07 AC-15 allows 100 ms). With the staged pair a save waits for one rename at most. The engine never calls `VaultFs::replace` for a file of the run, except the one base-checked type-file extension below.
- **The sequence for one created file**, with the journal lines of §9.6 (existing vault) and the points of §2.1: `C` line synced → `BeforeTemp` → `stage_new` → `T` line synced → `TempWritten` → `commit_new` → `Renamed` → `K` line synced → index update and `vault:changed`. A staged size or hash that differs from the `C` line is `SourceChanged` (below).
- **`AlreadyExists` / `NameTaken` during `writing` (D-1547 (3))** → the temp file is removed, an `N` line is written, the job fails with `FileAppeared { path }` and is rolled back. No second name is tried here: links to the planned name may already be written. The file that arrived is **never** touched by the roll-back, whatever its bytes are (§9.6).
- **An extended type file** is the only replace: it is re-read immediately before, its content compared with the plan's stamp again (`TargetChanged` otherwise), then written with the base-checked write (`Vault::write_with(path, bytes, Some(base), hook)`, §12.2). The window between that check and the rename is the accepted one (D-84). Type files come first, so a `TargetChanged` here has written nothing else.
- **Attachments** are streamed from the source. Before the copy, the entry's size and modification time (zip: size and CRC) are compared with the stamp; the bytes staged must have the size and hash of the `C` line → `SourceChanged { entry }` / `SourceGone` otherwise, and the temp file is removed (FR-IMP-03 AC-15).
- **Folders** are created when first needed, each after its `D` line; the run notes each folder it created.
- After each file of an existing-vault run the index is updated and `vault:changed` is sent, as for every job write (ms4-jobs §4).

### 9.5 New vault (D-1523, D-1549 (1), (2), D-1556, D-1559, FR-IMP-03 AC-4, AC-14)

1. **Clean-up, at this moment only.** If `<parent>/<name>.tegg-importing` exists:
   - with a marker `.tegg-import` whose run isn't running in this process, the folder is **moved whole to the system Trash** (D-1559: `tegg_vault::trash_import_leftover(dir, env.trash)`, §12.2, through the `SystemTrash` seam as D-619 does for vault files). The engine never deletes it permanently and never removes anything inside it. **If the move fails**, or the folder is still there after it, `start` answers `LeftoverNotTrashed { reason }` (§11): no job is created, nothing is removed, and nothing is created in `<parent>`. The move is made by `start` itself, after its other checks passed (§9.1), so a refused start leaves the leftover where it was;
   - with a marker whose run **is** running in this process (a second import of the same name into the same place while the first still writes) → `TargetExists`; nothing in the folder is read beyond the marker, written or removed. `plan` gives the same answer (§5);
   - without the marker, **completely empty or holding only the marker's own temp file** (`..tegg-import.i<job>.tegg-tmp`, §9.4's staged name) → a dead run's (CP-8, D-1562): `start` removes that one temp file, then the empty folder (`remove_empty_dir`, which can't remove a folder that holds anything; something put into it meanwhile makes this `TargetExists`), and goes on. `plan` reads the folder's entries and doesn't refuse;
   - without the marker, holding anything else → `TargetExists`, and nothing in it is written or removed. `plan` gives the same answer.
2. Create `<parent>/<name>.tegg-importing/`. Its **first file** is `.tegg-import`: `{"version":1,"run":"<run id>","started":"<ISO time>"}`. The run id is `<clock in ms>-<process id>`; it never takes an id from `env.ids`. **"Running in this process"** is membership in a process-wide registry of run ids: a run enters it before it creates the folder and leaves it when it reaches a final phase, **and also when its thread unwinds** (a panicking hook, the tests' kill): the registry entry is the one thing released on unwind, and releasing it touches no file (§2.1). A marker that can't be parsed counts as a marker of a run that isn't running.
   - **The marker is the first entry the run makes in the folder**, written like every file of the run (temp file, then rename; points `BeforeTemp`, `TempWritten`, `Renamed` with `FileKind::Marker`, path `.tegg-import`). Nothing else, no folder and no file, is created in `<name>.tegg-importing` before the marker is at its name.
   - **A kill between the folder's creation and the marker's rename** (the points `BeforeTemp` and `TempWritten` of the marker) leaves a folder with no marker: empty, or holding only the marker's own temp file. It provably holds no data of the user's, so the next new-vault import of that name into that place removes it (step 1; CP-8, D-1562, amending D-1549 (1)) and writes a whole vault. `fr_imp_03_ac3_atomic_writes_survive_a_kill` asserts this (D-1566).
3. `.tegg/vault.yml` and the seven system type files (§7), then §9.4's order.
4. **Final rename** with the no-replace rename: `<name>.tegg-importing` → `<name>`. When `<name>` exists by then (a file or a folder), nothing is replaced or merged: the next free `<name> (2)`, `(3)`… is taken and `ImportReport.vault` names it.
5. The marker is removed from the final folder. A marker left in a finished vault by a kill between 4 and 5 is an inert dot file.
6. **Failure** at any point before 4 (a write error, `FileAppeared`, `SourceChanged`): the temporary folder is removed whole (D-1523; the run's own folder, in the process that made it: `remove_dir_tree`, §12.2. D-1559's Trash is for a dead run's leftover only); no folder with the final name was ever created by the run. A **kill** leaves the temporary folder with its marker for step 1 of the next run.

Nothing is written outside `<parent>`: no Application Support entry, no recent-vault entry (opening the vault later does that).

### 9.6 Existing vault: journal and roll-back (D-1523, FR-IMP-03 AC-5)

**The rule (T1).** Roll-back removes a file only when the journal **knows** the run created it. Equal bytes are never the proof: a byte-identical file that arrived at a planned path (the owner pasting the same image, a sync client delivering it) is the owner's file. Bytes decide only the second question, whether a file the run did create is still unchanged (D-1523: "exactly the files the run created that are still byte-identical").

- **Location:** `<Application Support>/Tegg/jobs/<vault key>/<jobId>.json` and `<jobId>.log`, next to the rename journals of ms4-jobs §8. Never in the vault.
- **Header** (`.json`, written when `writing` starts, before the first vault write): `{ "job", "kind": "import", "title": "<space>", "source": "<source name>", "total": <files to create>, "backup": "<zip name>" | null }`.
- **Log** (`.log`): one line per event, appended with `tegg_vault::append_local_file` and **synced before the engine goes on** (§12.2; the rename journals rewrite the whole log per line, which an import of thousands of files can't afford). Fields are tab-separated; a path is a vault path, NFC.

| Line | Written | Meaning |
| --- | --- | --- |
| `D\t<dir>` | before creating a folder that doesn't exist | the run created it |
| `C\t<path>\t<size>\t<hash>` | before `BeforeTemp` of a created file (write-ahead) | intent: the run may create `path` with exactly these bytes (BLAKE3, as `FileVersion`). Its temp file is `<folder>/.<file name>.i<job>.tegg-tmp` |
| `T\t<path>\t<file id>` | after the temp file is complete and synced, before the rename | the temp file's file id (inode): what will be at `path` if the rename happens |
| `K\t<path>` | after the no-replace rename succeeded (as the `W` lines of `crates/tegg-jobs/src/journal.rs`) | **the run created `path`** |
| `N\t<path>` | after a create failed (`AlreadyExists`, `NameTaken`, an I/O error, a stamp mismatch) and its temp file was removed | nothing at `path` is the run's |
| `R\t<path>\t<post size>\t<post hash>\t<pre size>\t<pre hash>\t<pre bytes, hex>` | before replacing an extended type file (write-ahead) | restore to the pre bytes when the file is still the post version |

  So no file of the run can exist that the log doesn't name (FR-IMP-03 AC-5), and no file can be removed that the log doesn't prove. An attachment's size and hash are known before its copy because the entry is read once for the stamp check.
- **Roll-back** walks the log backwards. It is one procedure, run after a failure in `writing` in the same process and by `Undo` after a kill; in both it reads only the log.

| Log says, for a `C` line | The run's file? | Action |
| --- | --- | --- |
| `N` | no | `path` is not touched and not listed, whatever is there. This is the in-process case of a create that failed with `AlreadyExists`: **it is never rolled back** |
| `K` | yes | absent → nothing (a file the owner moved to `.trash/` meanwhile **stays in `.trash/`**: the roll-back never looks there). Present with the logged size and hash → removed with the checked delete (`Vault::discard_checked`: not a move to `.trash/`, since the file never belonged to the user). Present with other bytes → **kept**, listed in `ImportReport.kept` |
| `T` but no `K` and no `N` (a kill between the temp file and the `K` line) | only if the rename happened, which the file id tells | a file at `path` **with the logged file id** is the run's (a rename, or the `link` half of the fallback, keeps the file id): removed when it has the logged size and hash, kept and listed when not. A file at `path` with another file id, or none, is not the run's: not touched, not listed. A file id alone never deletes anything: the size and hash must match too |
| neither `T`, `K` nor `N` (a kill before the temp file was complete) | no | `path` is not touched |

  In every case of a `C` line, and for every `R` line, **the run's temp file is removed when it exists**: `.<file name>.i<job>.tegg-tmp` for `C`, `.<file name>.tegg-tmp` for `R` (under the vault lock, where no write can be in flight). `Vault::clean_temp_files` removes only temp files older than one minute, so the vault open alone would leave them; with this step no `.tegg-tmp` file is left after `Undo`, as FR-IMP-03 AC-5 asks.
- **`R`:** the restore **is** the base-checked write, `Vault::write(path, pre, Some(&post))`, and its outcome is the answer: `Written` → restored; `Unchanged` (the file still holds the pre bytes: the replace never happened, or someone put them back) → **nothing to do, not `kept`**; `Conflict` (neither pre nor post) → kept and listed; `Gone` → nothing (a deleted type file is not brought back).
- **`D`:** the folder is removed when empty (`VaultFs::remove_empty_dir`); a folder that existed before, or holds anything, stays (D-1549 (7)).
- Then both journal files go. The backup zip stays.
- **After a kill** the journal is left. On the next open of the vault `Jobs::interrupted()` lists it as an `Interrupted` (`crates/tegg-jobs/src/lib.rs`; `from` and `to` are required strings there): `kind: "import"`, `title: Some(<space>)`, `from` the header's `source` (the source's file or folder name), `to` the empty string (an import has no second path), `done` the number of `K` lines, `total` the header's. `resolve_interrupted(job, Undo)` does the roll-back above from the log alone, with no transformer and no source; `Finish` answers `JobError::NotImplemented` (an import is never resumed). The banner's sentence for an interrupted import is not fixed here: it is approved with slice I2 (R155 has no key for it yet).
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
- **The open vault stays responsive:** the run holds no lock of another vault. In its own it never copies bytes under the vault lock: a created file is staged outside the lock and the lock is taken for the name check and the rename only (§9.4), so an owner's save waits for one rename at most (FR-UX-07 AC-15: no save delayed by more than 100 ms). The one write made under the lock is the extended type file, a few kilobytes.
- **In the queue** an existing-vault job emits `JobProgress` with `phase: queued` and no `ImportProgress` (§5.1); `ImportRun::cancel` there ends it `cancelled` (§9.1).

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
    InvalidPlan { path: Option<String>, reason: PlanReason },   // §9: Version | Target | Path | Place | TypeKey | Duplicate | Unknown
    TargetChanged { path: String },                    // D-1548
    LeftoverNotTrashed { reason: String },             // D-1559: a dead run's `<name>.tegg-importing` couldn't be moved to the system Trash; nothing removed
    BackupFailed { reason: String },
    FileAppeared { path: String },                     // D-1547 (3)
    Write { path: String, reason: String },            // any other I/O failure after the first write
    Transform { note: Option<String>, reason: TransformReason },   // a code, never the engine's text: Unavailable | Timeout | Engine
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
| A dead run's marked leftover folder can't be moved to the system Trash (not an R153 case; D-1559) | `start` | `LeftoverNotTrashed { reason }`, no job, nothing removed or created |
| The backup fails | the job | `failed`, `BackupFailed` |
| A write fails after the first write | the job | `failed`, `Write`, rolled back |
| Another job runs in the target vault | the job | waits in `queued` |
| A type file changed since the plan | `start`, the job (twice, §9.2, §9.4) | `TargetChanged { path }` |
| A plan that doesn't fit the target or names a path outside the rules (not an R153 case: a caller's bug or a tampered plan) | `start`; a bad new-vault name also in `plan` | `InvalidPlan { path, reason }`, no job, nothing written |
| A file arrives at a planned path | the job's `planning` / `writing` | renamed and reported / `FileAppeared`, rolled back |
| The source changes during the write | the job | `SourceChanged { entry }` / `SourceGone { entry }`, rolled back |

`reason` strings (`BackupFailed`, `Write`, `LeftoverNotTrashed`, `Io`) are for logs and tests; the window's texts are R153's (I2). No error value holds file content, and `Transform.reason` is a code because the engine's message can quote a source line (a YAML error does). `MappingReason` is §4.2's first column; `PlanReason` is §9's.

---

## 12. Changes to other crates

### 12.1 `tegg-jobs`

- `JobKind::Import` (`"import"`), flags of §9.1; `Phase::Queued` in its `cancellable` list and the queue's support for cancelling a waiting job (new, §9.1).
- `TextOp::{ImportScan, ImportNote, ImportNew}` with their JSON shapes (§7.1).
- `Jobs::start_import(job: Arc<dyn ImportJob>) -> Result<JobId, JobError>`: the seam through which `tegg-import` runs inside the engine's queue, phases, backup, cancel and progress. The trait's shape (`prepare`, `needs_backup`, `write`) is the implementer's; what the engine does around it is §9. One thing is fixed: the job gives the backup step its time (`fn backup_time(&self) -> Option<chrono::DateTime<chrono::Utc>>`; the import answers `Some(env.clock at start)`, §9.3), and the step uses `Utc::now()` only for `None`, as every other kind does today. `JobOp` is unchanged (it stays `Eq`).
- `journal`: the `import` journal of §9.6 (`interrupted` with the `from` / `to` / `done` values given there, `resolve` with `Undo` only).
- `Host` gains, with stub defaults (TS-I1): `stage_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> Result<Staged, WriteError>`, `commit_new(&self, staged: Staged) -> Result<FileVersion, WriteError>`, `discard_staged(&self, staged: Staged)`, `file_id(&self, path: &str) -> Option<u64>`, `write_hooked(&self, path: &str, bytes: &[u8], base: &FileVersion, before_rename: &dyn Fn() -> io::Result<()>) -> Result<Wrote, WriteError>` (the extended type file), `discard(&self, path: &str, base: &FileVersion) -> Result<(), WriteError>`, `remove_temp(&self, path: &str, tag: Option<&str>)`, `remove_empty_dir(&self, dir: &str) -> bool`, `local_append(&self, path: &Path, line: &[u8]) -> io::Result<()>` (synced). The core's host maps them onto `Vault` (§12.2); the new-vault run's private host implements the whole trait (§9.1).
- `testing::NodeTransformer::pid(&self) -> u32` (§2.1) and `testing::NodeTransformer::start_quiet(script)`: as `start`, with the child's stderr sent to the null device instead of inherited (§13).

### 12.2 `tegg-vault`

All new file access lives here (AR-04 AC-1), each with an in-memory twin where a test needs one:

- **The staged exclusive create** (§9.4):

```rust
pub struct Staged { pub path: String, pub temp: String, pub version: FileVersion, pub file_id: u64 }
impl Vault {
    /// Takes no vault lock. Streams `src` into `<folder>/.<file name>.<tag>.tegg-tmp` (create-new), syncs it.
    pub fn stage_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> Result<Staged, VaultError>;
    /// Holds the vault lock for the name check of `create_exact` and the no-replace rename only.
    /// `NameTaken` when a file has that name (NFC, case-folded) or the rename answers `AlreadyExists`; the temp file is then removed.
    pub fn commit_new(&self, staged: Staged) -> Result<FileVersion, VaultError>;
    pub fn discard_staged(&self, staged: Staged);
    /// Under the vault lock: removes `.<file name>.tegg-tmp` (`tag` None) or `.<file name>.<tag>.tegg-tmp` next to `path`, whatever its age.
    pub fn remove_temp(&self, path: &str, tag: Option<&str>) -> Result<bool, VaultError>;
    pub fn file_id(&self, path: &str) -> Result<Option<u64>, VaultError>;
    /// `write`, with a per-call hook run after the temp file is written and before the rename; an `Err` from it fails the write and removes the temp file.
    pub fn write_with(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>, before_rename: &dyn Fn() -> io::Result<()>) -> Result<WriteOutcome, VaultError>;
}
```

  Behind them `VaultFs` gains `write_temp_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> io::Result<(String, FileVersion, u64)>`, `file_id(&self, path: &str) -> io::Result<Option<u64>>` (`st_ino` on Unix; `cfg`-gated, AR-03 AC-3) and `replace_with(&self, path, bytes, before_rename)` (default: `replace`). `rename_no_replace` and `remove_file` exist.
- **Per-call hooks, no global.** `write_with`'s closure is the only test hook this slice adds to `tegg-vault`. `local::BEFORE_RENAME` stays as it is for the app's test build and is **not** used by the import: a process-wide `OnceLock` can be set once per process, so it can't serve `ImportEnv.points` of several runs or of parallel tests. The file points of a created file need no hook in `tegg-vault` at all: the engine raises them between its own calls (§2.1).
- `VaultFs::create_dir_new(&self, path: &str) -> io::Result<()>` (fails when it exists) and `pub fn rename_dir_no_replace(from: &Path, to: &Path) -> io::Result<()>`, `pub fn remove_dir_tree(path: &Path) -> io::Result<()>` for §9.5 (the latter refuses a folder without the marker `.tegg-import`; it serves only step 6, the run's own folder after a failure).
- **A dead run's leftover goes to the system Trash (D-1559, §9.5 step 1):** `pub fn trash_import_leftover(dir: &Path, sink: &dyn SystemTrash) -> io::Result<()>` refuses a folder without the marker `.tegg-import` (nothing is moved), calls `sink.trash(dir)` once for the whole folder and answers an error when the sink does or when `dir` still exists afterwards. It unlinks nothing itself. `SystemTrash` is the existing seam of ms6-trash-media §1.1 (`trait SystemTrash { fn trash(&self, abs: &Path) -> io::Result<()>; }`, D-619; the shell implements it with `NSFileManager trashItemAtURL`, the test build with `TEGG_TEST_SYSTEM_TRASH`); the engine receives it as `ImportEnv.trash` (§2), so `tegg-import` stays platform-neutral (AR-03).
- **A synced append** for the write-ahead log: `pub fn append_local_file(path: &Path, line: &[u8]) -> io::Result<()>` opens with append (creating the file, and then syncing its folder), writes the line and a newline, and calls `sync_all` before it returns. `write_local_file` rewrites the whole file and stays for the rename journals.
- **Read-only probes** for the refusals of §5 and §13; none creates, changes or removes anything:
  - `pub fn probe_new_vault(parent: &Path, name: &str) -> io::Result<NewVaultProbe>`, with `pub struct NewVaultProbe { pub parent: PathBuf /* resolved */, pub parent_is_dir: bool, pub writable: bool /* access(W_OK | X_OK) */, pub final_exists: bool, pub temp_exists: bool, pub marker: Option<String> /* the text of `<name>.tegg-importing/.tegg-import` */, pub inside_vault: bool }`;
  - `pub fn resolve_existing(path: &Path) -> io::Result<PathBuf>`: the path with the symbolic links of its nearest existing ancestor resolved and the rest appended;
  - `pub fn has_entry_at_or_above(path: &Path, name: &str) -> io::Result<bool>`: a `.tegg` or `.git` entry (a file or a folder) at `path` or above it, after `resolve_existing`; used by `TargetInsideVault` and by the real-export run's refusals;
  - `pub fn is_inside(path: &Path, dir: &Path) -> io::Result<bool>` (both resolved) for `TargetInsideSource`.
- **Read-only source access:** `pub trait ExternalRead { fn stat(&self, rel: &str) -> io::Result<Option<(u64, i128)>>; fn list(&self) -> io::Result<Vec<(String, u64, i128)>>; fn open(&self, rel: &str) -> io::Result<Box<dyn ReadSeek>>; }`, `pub struct ExternalFolder`, `pub fn open_external_file(path: &Path) -> io::Result<Box<dyn ReadSeek>>`, `pub fn stat_external(path: &Path) -> io::Result<Option<(u64, i128)>>`. None of them can write.
- `pub fn free_space(path: &Path) -> io::Result<u64>`, `pub fn volume_id(path: &Path) -> io::Result<u64>` (`statvfs` / `stat`).
- `pub use new_vault::EMPTY_VAULT`.

### 12.3 `tegg-index` and `@tegg/doc`: the order of a day's notes (D-1546, amends D-319)

D-319's order is implemented today in two places:

- `crates/tegg-index/src/lib.rs`, `fn daily_order(a: &Meta, b: &Meta)` (used when the index sorts the Daily Notes of a date; `Index::daily_note`, the losers list, the Duplicate titles group and date-link resolution all read that order);
- its twin for the fake core, `packages/doc/src/daily.ts`, `export function dailyOrder(a, b)`.

Both gain one leading key: **a note without `import-id` comes before a note with one**; D-319 / D-335's order (newest `created`, newest `modified`, NFC path bytes) decides inside each group. "With `import-id`" means the frontmatter has the key with a non-empty string value. `dailyOrder`'s argument type gains `importId?: unknown`. The rule reads only files (AR-01). Criterion: daily-notes.md FR-DLY-01 AC-12 (marked `[MS7]` like the import criteria, so the MS4 gate doesn't check it before slice I1); the tests are added to `crates/tegg-core/tests/ac_daily.rs` and `app/webkit/daily.ac.test.ts` under `AC-Test-Change: among Daily Notes of one date a note without import-id comes first (D-1546); approved-by: owner`.

### 12.4 `@tegg/doc`

`packages/doc/src/import.ts` (§7.1), `transform` dispatch for the three ops, `dailyOrder` (§12.3). Nothing else changes; `d184Text`, `formatScalar`, `isGenericName` and `mediaObject` are reused.

### 12.5 `ms4-jobs.md`

Applied with this contract: the header's Clients line; §1 gains the `import` row, the rule for a target that isn't the open vault and the note that cancelling a `queued` job is new; §2.2 names the three import ops; §4 names `Jobs::start_import` and the `Host` additions; §8 gains the import journal (`C`, `T`, `K`, `N`, `R`, `D`) and `Undo` only. The ops, `start_import` and the `Host` additions are specified here and only referenced from there.

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
- **Output: counts and indexes only**, on stdout; stderr stays empty. Every line matches `^[a-z0-9_.]+: [0-9]+(,[0-9]+)*$` and passes `./verify counts-only`. Exports and spaces are numbered (`export.0`, `space.1`), never named. Lines: `export.<i>.capacities`, `.spaces`, `.unreadable`, `.files_outside_spaces`; per space `.objects.total|imported|reported`, the same for `attachments` and `links`, `.links.<outcome>` (underscored), `.types`, `.types_new`, `.accounting_errors`, `.accounting.<violation code>`, `.written_files`, `.roundtrip_failures`, `.unresolved_written_links`, `.failing_object_indexes` (indexes into the plan's object list).
- **The prefixes, spelled out.**
  - `<i>` numbers **every** `*.zip` of the exports folder from 0, in the order of their file names (NFC, compared by code point), whether or not it is a Capacities export. `<j>` numbers the spaces of export `<i>` from 0, in `ScanInfo.spaces` order (§3).
  - An **export line** is `export.<i>.<name>: <n>`: `export.<i>.capacities` (1 or 0; for 0 it is the export's only line), `export.<i>.spaces`, `export.<i>.unreadable`, `export.<i>.files_outside_spaces`.
  - A **space line** is `export.<i>.space.<j>.<name>: <n>`, with the names listed above: `export.0.space.1.objects.total: 3`, `export.0.space.1.links.other_space: 2`, `export.0.space.1.accounting.total_mismatch: 1`, `export.0.space.1.failing_object_indexes: 4,17,230`. A count of 0 is printed for the fixed names (`objects.*`, `attachments.*`, `links.total|imported|reported`, `types`, `types_new`, `accounting_errors`, `written_files`, `roundtrip_failures`, `unresolved_written_links`); `links.<outcome>`, `accounting.<code>` and `failing_object_indexes` are printed only when not 0 or not empty. `unknown_cover_values` (the non-null `coverImage` / `previewImage` values that aren't a link into a `Media/` folder, §4.1; the S5 counter) is a fixed name too.
  - Lines of one export come together, the export's own lines first, then each space's in `<j>` order.
  - A failed step is `export.<i>.error.<code>: 1` or `export.<i>.space.<j>.error.<code>: 1`, by where it happened.
  - **Lines with no prefix:** `skipped: 1`; `refused: 1` followed by `refused.inside_repository: 1` or `refused.inside_vault: 1` (then nothing else is printed); `panic: 1` (once per export whose run panicked); `format_violation: 1` (in place of each line that failed the format).
  - The kept vaults' folders use the same numbers: `<dir>/export-<i>-space-<j>/`. `is_counts_only` asserts the format on the run's own output before it is printed; a line that fails is replaced by `format_violation: 1`.
- **`--keep <dir>`:** the written vaults are kept under `<dir>/export-<i>-space-<j>/`. Before anything is read, the run refuses and exits 2 when `<dir>`, or its nearest existing parent after resolving symlinks, lies inside a Git repository or worktree (a `.git` file or folder at or above it; this covers every worktree of this repository and `test exports/`) or inside a vault (a `.tegg/` at or above it). It prints one line, `refused: 1`, and a reason line `refused.inside_repository: 1` or `refused.inside_vault: 1`; never a path.
- **The default temporary directory gets the same refusal.** Without `--keep`, the vaults go under the system temporary directory (`std::env::temp_dir()`, so `TMPDIR` decides). Before anything is read, that directory is checked by the same rule (`tegg_vault::has_entry_at_or_above` for `.git` and `.tegg`, after resolving symbolic links): a temporary directory that lies inside a Git repository or worktree, or inside a vault, refuses the run with exit 2 and the same two lines. So a `TMPDIR` pointed into the repository can't put real notes there.
- **Nothing but the report reaches the terminal (D-62, D-1543).** Three channels could carry content, and each is closed:
  - **The transformer's stderr.** `NodeTransformer::start` inherits the child's stderr (`crates/tegg-jobs/src/testing.rs`), and a YAML or parse error from `@tegg/doc` quotes the source line. The run starts its transformer with `NodeTransformer::start_quiet` (§12.1): the child's stderr goes to the null device. `examples/real_export.rs` builds no other transformer.
  - **Panics.** A panic message can hold a path or a title. `real_export::run` installs, for its own duration, a panic hook that prints nothing but `panic: 1` (no message, no location, no backtrace), runs each export inside `catch_unwind`, restores the previous hook before it returns, and returns 1.
  - **Error values.** The run never prints an `ImportError`, a `Violation.detail`, an `io::Error` or a `reason` string. A failed step is a count line `error.<code>: 1` with the error's serde code in snake case (`error.source_changed: 1`); `Transform.reason` is a code by type (§11), and `Write`, `Io` and `BackupFailed` reasons stay unprinted.
  The format test (`fr_imp_03_ac11_real_export_counts_only`) covers all three on synthetic input: a fixture with broken YAML, a hook that panics with a path in its message, and a `TMPDIR` inside a temporary Git repository; it captures the process's stdout **and** stderr and requires every line of both to pass `is_counts_only`.

---

## 14. IPC

None in I1. The names the criteria start from (`import_scan`, `import_plan`, `import_start`) are thin shell commands over `scan`, `plan` and `start`, specified with I2.

## 15. What I2 will add (named, not specified)

The IPC commands and their DTOs (`ScanInfo`, `Plan`, `Mapping`, `ImportProgress`, `ImportError` are already serde types); a transformer for the app with no vault open; keeping the target `Core` alive across a vault switch (D-1549 (6)); the window's model and steps (R151, R152); `TEGG_TEST_PICK_FILE` in ms3-shell (D-135); `File › Import…` and `import.open` (R154); the status element; the fake core's canned scans, plans and progress; the catalog (R155) and passing `import.report.*` to `ReportStrings`; the `backups.label.import` label in Settings › Backups; the quit question during `writing`; the interrupted-import banner and its string (§9.6: approved with I2).

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
| `ac_import_progress.rs` | FR-IMP-07 AC-3; FR-UX-07 AC-13 (events, cancel also in `queued`, `NotCancellable`), AC-16 (the job part); the two nightly tests below |
| `ac_import_property.rs` | L2: FR-IMP-03 AC-10 on generated exports (300 notes; fixed seed plus one random seed per push; 10 × 1,000 nightly, name prefix `nightly_`) |
| `ac_import_real_export.rs` | FR-IMP-03 AC-11: the output format and the `--keep` refusals, with `c01-spaces` zipped as the input |
| `crates/tegg-core/tests/ac_daily.rs` (existing) | FR-DLY-01 AC-12 |
| `packages/doc/test/import.ac.test.ts` (L1) | the bytes of `importScan` / `importNote` / `importNew`: FR-IMP-10 AC-7, AC-9, AC-12; FR-IMP-15 AC-6; FR-IMP-17 AC-4; FR-IMP-16 AC-1; FR-IMP-19 AC-8 (layout) |
| `packages/doc/test/import.property.ac.test.ts` (L2) | FR-FMT-07 on `importNote` output: open and save changes 0 bytes |

- The `[real-export]` criteria (FR-IMP-03 AC-11's run, FR-IMP-05 AC-4, FR-IMP-07 AC-4, FR-IMP-14 AC-5) have no automated test beyond AC-11's format test; the owner starts the run.
- **The latency sentence of FR-UX-07 AC-13** (`index.switcher` and `note.read` under 100 ms p95 while an import runs) is a latency target: by D-343 it runs as `nfr_perf_fr_ux_07_ac13_open_vault_stays_responsive` in `ac_import_progress.rs`, skipped at push by the name filter and run nightly.
- **D-1541, report-only timings (no pass or fail).** `nfr_perf_d1541_import_120mb_timings_report_only` in `ac_import_progress.rs` generates the 120 MB export of FR-UX-07 AC-13 (`common::generated_export`, fixed seed), then times two things: **scan + plan** (default mapping, new-vault target) and **the write** (from `start` to the final event). It never fails on a time: it asserts only that the import finished and writes `$VERIFY_RESULTS/import-perf.json`, two rows in the shape of `core-perf.json` (`{ "id": "D-1541.scan_plan" | "D-1541.write", "what", "n": 1, "ms", "target_ms": null, "pass": null }`), which is the nightly performance report's input next to `core-perf.json`. Its `nfr_perf_` prefix keeps it out of the push step and puts it into the nightly step `import-nightly` (§16.3). A target is proposed after the first real run (D-1541).
- **Helpers the tests rely on** (`tests/common/mod.rs`): `zip_fixture(name)` builds `<fixture folder name>.zip` in a temp folder (§5.4), `generated_export(bytes, seed)`, `snapshot(root)` (bytes, mtime and file id per file, for "the arrived file keeps bytes, mtime and inode", FR-IMP-03 AC-12). FR-IMP-03 AC-14's clean-up is checked with the tests' own `SystemTrash` implementations in `tests/common/mod.rs` (§2): `Trash { dir }` (the leftover is in `dir`, whole) and `NoTrash` (`LeftoverNotTrashed`, the leftover untouched); FR-IMP-03 AC-7's cross-folder case and FR-IMP-14 AC-8's plain link to a media file are added to the temporary copies at test time (the fixtures have neither).
- **FR-IMP-03 AC-2's "0 parse warnings".** `tegg-core` has no API that reports parse warnings, and this slice adds none. The criterion is checked as: `Core::open` on the written vault succeeds and the first index build ends; `core.objects()` lists exactly the plan's imported objects plus the report Page; and every one of them has an `id` and **one defined type** (`type_single: true` and a `type` that is a type of the vault). A file whose frontmatter didn't parse would have no type and no id, so it fails this check. `importNote` already refuses to return a text that doesn't read back without a frontmatter error (§7.1 step 4).
- No L5 or L6 test in I1: no criterion marked I1 names those layers.

### 16.2 Fixtures

- Inputs: `tests/fixtures/import/capacities/` as they are (read-only; copies in temp folders; zips built at test time, never committed).
- **Expected outputs:** `tests/fixtures/import/capacities-expected/<fixture>/` holds the written vault (every file, byte-exact, with ids `01JB5V000000000000000000nn` and the test clock) and `plan.json` (the normalized plan of §5.4: `to_string_pretty(&plan.normalized())`, no `stamps`, new-vault target, so the file is the same on every machine). One folder per fixture that a criterion compares against (`c02-typed-frontmatter`, `c05-media-objects`, `c09-unresolved-links`, `c10-duplicate-titles`, `c12-task-dates`, `c14-reserved-keys`, `c15-common-attributes`, `c22-link-shapes` at least), plus `README.md`. Written by the test author in their own commit and approved by the owner before the implementation (as D-99). A later change needs `Fixture-Change:`.
- FR-DLY-01 AC-12 needs no committed file: its note is written at test time into the temporary copy of `tests/fixtures/vaults/daily/`.
- **`plan.json` can now be written from the rules:** the effective mapping (§4), `PlannedType.attributes` and `needsLook` (§5.1), the totals (§5.1) and the normalization (§5.4) are fixed. It is still generated from the first implementation and approved by the owner (the expected folder's README says so); the rules are what the approval checks it against.
- **A fixture that is missing: a stored cover (FR-IMP-24 AC-2, FR-IMP-15 AC-4).** No fixture has a non-null `previewImage` or `coverImage`, so the red tests cover only `null`. A new fixture is added **with the implementation** (a new folder, so no existing test's counts change; its row goes into the fixtures' README, and its tests are new tests, not changes to red ones): `tests/fixtures/import/capacities/c23-stored-covers/`, space `PKM`, with exactly these files:

  | File | Content |
  | --- | --- |
  | `PKM/Weblinks/Tegg docs.md` | frontmatter `type: 'Weblink'`, `title: Tegg docs`, `description: null`, `createdAt: '2026-04-20T10:35:19.079Z'`, `tags: []`, `previewImage: '![](./Media/N%C3%A1hled%20webu.png)'`, `url: https://example.com/docs`, `iframeUrl: null`, `domain: example.com`; then an empty line (the body is empty) |
  | `PKM/Weblinks/Media/Náhled webu.png` | a copy of `c05-media-objects/PKM/Images/Media/image (3).png` (a file with **no** note of its own: it gets a made Image object) |
  | `PKM/Weblinks/Bez náhledu.md` | the same keys, `title: Bez náhledu`, `previewImage: '![](./Media/chyb%C3%AD.png)'` (no such file: the missing case, CP-11), `url: https://example.com/none` |
  | `PKM/Pages/Zahrada.md` | `type: 'Page'`, `title: Zahrada`, `tags: []`, `coverImage: '[Obal](../Images/Media/Obal.jpeg)'`; empty body |
  | `PKM/Images/Obal.md` | `type: 'Image'`, `title: Obal`, `description: null`, `tags: []`, `source: upload`, `mimeType: image/jpeg`; body: two empty lines, then `Media: ![Image](./Media/Obal.jpeg)` |
  | `PKM/Images/Media/Obal.jpeg` | a copy of `c05-media-objects/PKM/Images/Media/Mapa řeky.jpeg` |

  Expected by §4.1 (decided parts): `Pages/Tegg docs.md` has `cover: "[[Náhled webu]]"` and no `previewImage` key; `_attachments/Náhled webu.png` and a made `Images/Náhled webu.md` exist (`Náhled webu` is not a generic name, so it keeps its name); `Pages/Zahrada.md` has `cover: "[[Obal]]"`, the link to the Image object `Images/Obal.md`; `Bez náhledu` follows CP-11. Totals: 4 objects, 2 attachments, 4 links (three frontmatter links and the Image note's own), one of them `missing-file`. The link form in these values is the S5 report's ("null or a Markdown link"); the owner's real-export run confirms it with `unknown_cover_values: 0` (§13).

### 16.3 Gate configuration (with the red tests, not now)

None of these edits is a pure addition today, because the crate doesn't exist yet: a step that lists no test file fails `cargo-junit.ts`, and `core-rust-test`'s glob would otherwise pick the new files up. They go in the red-test commit, together with the stub crate:

- `Cargo.toml`: `crates/tegg-import` joins `members`.
- `qa.config.json`: a new push step, and `core-rust-test`'s file list gains `| grep -v '^crates/tegg-import/'`:

```json
{ "id": "import-test", "lane": "cargo",
  "inputs": ["crates","Cargo.toml","Cargo.lock","tests/fixtures","packages/doc","tools/qa/src/cargo-junit.ts"], "dir": ".",
  "run": "npm run --silent --prefix packages/doc build && node tools/qa/src/cargo-junit.ts --junit \"$VERIFY_RESULTS/import-ac.xml\" --threads 2 $(ls crates/tegg-import/tests/ac_*.rs 2>/dev/null) -- --skip nfr_perf_ --skip nightly_",
  "level": "push" }
```

  and a nightly step `import-nightly` running the same files with `-- nfr_perf_ nightly_` (it runs D-1541's timing test and FR-UX-07 AC-13's latency test). The `acRunners` entry for `crates/*/tests/ac_*.rs` already covers the crate. No step runs `examples/real_export.rs`.
- **L0 dependency allow-list (TS-L0, NFR-SEC-01):** one entry per dependency that is new to `Cargo.lock`, each with the note "opens no socket": `zip` (`default-features = false`, feature `deflate`), `flate2`, `miniz_oxide`, `crc32fast`, `adler2` (the deflate back end `zip` pulls in) and `percent-encoding`; plus whatever else `cargo tree -p tegg-import` shows that the lock file didn't have, checked when the stub crate is added. Not only `zip`.
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
12. **Where D-1538 (4)'s count goes.** "Counted in the report" names no section of R150; it is the last row of `Dates` (§5.3).
13. **"Created by the run" is recorded, not inferred** (§9.6): a `K` line after the rename, and the temp file's file id before it for the one window a kill can open. The cost is two more synced appends per file.
14. **Creates are staged outside the vault lock** under a run-unique temp name (§9.4), so an attachment's copy never holds the owner's saves.
15. **A default attribute name always gives a key** (§4.1): `-2`, `-3`… when the key is taken or clashes with a date range, `attr-…` when nothing is left of the name; a name the user typed is refused instead. D-1553 chose "derive, don't refuse" for defaults, and D-1529 (3) "append, never change an existing attribute".
16. **Numbers travel as their source characters and nested values are copied as stored** (§7.1), following ms4-jobs §14.4.
17. **Autolinks, bare URLs and reference-style links are not counted links** (§6.5): they are never rewritten or reported, and counting them would make the independent counter re-implement GFM's autolink rule.
18. **The report's source name has no `.zip`** (§5.3), so a zip and its folder write byte-identical vaults (FR-IMP-07 AC-1).
19. **With the red tests** (§16.3; also the "Still to do" table of import-capacities.md): the workspace member, the two `qa.config.json` steps, architecture.md's crate table and §5.7, and the L0 dependency allow-list entries for every dependency new to `Cargo.lock` (`zip`, `flate2`, `miniz_oxide`, `crc32fast`, `adler2`, `percent-encoding`).

## 18. Points for the owner (CP-1…CP-7 → D-1551…D-1557)

**All accepted** (owner, 2026-11-12: "Accept all seven"; BRD v1.165): every **Recommendation** below is the decision, and the contract above follows it. Each row changes behaviour or data on disk.

| CP-n → D-n | Issue | Recommendation (accepted) | Alternatives (not chosen) | Affects |
| --- | --- | --- | --- | --- |
| CP-1 → D-1551 | **Who reads the links for the plan.** The plan needs every link's outcome before any write; the write rewrites link spans in `@tegg/doc` (ADR 0003: "links taken from the mdast parse"). The spike read them in Rust (regex plus pulldown-cmark). Two readers can disagree (S4 P1/P3/P9, S5 F12), and then the preview isn't what gets written (FR-IMP-05 AC-7). | **One reader:** the plan sends each note to `@tegg/doc` (`import-scan`) and the write uses the same parse, so link `n` is the same link in both. `plan` therefore needs the transformer (Node in tests, the worker in the app); the spike's scanner isn't ported. | (b) Rust reads links at plan time (port `scan.rs`); the write checks the engine's list against the plan and fails the run on a difference, before the first write. (c) As (b) without the check. | §1.2, §5, §7.1; FR-IMP-10 AC-7; FR-IMP-05 AC-7 |
| CP-2 → D-1552 | **Link text that can't be a wikilink alias.** FR-IMP-10 AC-9 expects `[[Cíl|viz [poznámka] zde]]` "in the form `@tegg/doc` escapes". No such form exists: Tegg's wikilink syntax rejects `[` and a single `]` inside `[[…]]`, and the link wouldn't be a link in Tegg or Obsidian. | **Keep that link a Markdown link** and rewrite only its destination: `[viz [poznámka] zde](Cíl.md)`. The text stays byte for byte, it resolves in Tegg and Obsidian, renames follow it, and it isn't a simplified link (AC-9's count of two stays). AC-9's expected text for this one link changes (done with D-1552). | (b) Replace `[` `]` by `(` `)` in the alias and list the link as simplified (three rows in AC-9). (c) Add an escape (`\[`, `\]`) to the dialect: a file-format change in the tokenizer, the Rust extractor and the dialect doc, unverified in Obsidian. | §8 (7); FR-IMP-10 AC-9; `capacities-expected/c22-link-shapes/` |
| CP-3 → D-1553 | **The key of a new attribute.** A Tegg attribute key allows letters, digits, `-`, `_` and must start with a letter; Capacities keys needn't (`Datum konání`, `2nd contact`). R148 says "a new attribute" without the key. | The name as given when it is a valid key (so `peopleInvolved`, `autor`, `přečteno` stay); else `derive_attr_key(name)` (`datum-konání`) with the given name kept as the attribute's `name`, and a row in the report's Attributes section. | (b) Always `derive_attr_key` (`peopleinvolved`: every camelCase key changes). (c) Refuse the plan until the user renames such attributes. | §4.1; FR-IMP-08 AC-2, AC-6, AC-8; type files and frontmatter keys |
| CP-4 → D-1554 | **Does the job stop in `confirm`?** The criteria's "Still to do" table said `needsConfirm` yes (corrected with D-1554); but the preview is shown from `import_plan` before any job exists, and a job waiting in `confirm` holds its vault's queue (ms4-jobs §14.9.2). | **No `confirm` phase:** `start` is the user's `Import`; cancellable in `queued`, `planning`, `backup`. | (b) `start` when the preview opens, the job waits in `confirm`, `Import` is `job_confirm`: the target vault's other jobs wait while the user reads the preview. | §9.1; ms4-jobs §1; R152 step 5 (I2) |
| CP-5 → D-1555 | **Free names: per folder or vault-wide.** FR-IMP-03 AC-7 says names are compared "per folder". Tegg's own creation picks a stem free in the whole vault (D-291 part 2, ms4-links §3.1), so that a bare `[[stem]]` is never ambiguous. | **Per folder, as the criterion says.** Capacities spaces hold many same-titled objects across types; links are written in D-184 form, so they stay right (path form where a stem is shared). | (b) Vault-wide, as Tegg's own creation: more ` (2)` suffixes (`Tasks/Plán (2).md` because `Pages/Plán.md` exists), simpler links; changes AC-7's wording and the expected outputs. | §5.2; FR-IMP-03 AC-7; FR-IMP-11 AC-3. **Amended by D-1558 (§19, O1):** against an existing vault's files the name is free vault-wide |
| CP-6 → D-1556 | **A leftover marker and "running".** D-1549 (1) removes a leftover `<name>.tegg-importing` with a marker "and no running import of that job id". Across a crash the job id means nothing. | The marker holds a run id (`<clock ms>-<process id>`); "running" means a run of this process (Tegg is single-instance). A marker left in a finished vault by a kill between the final rename and its removal is left alone. | (b) Also require the marker to be older than a time limit. (c) Remove a leftover marker from a finished vault when it is next opened (a write on open, against FR-VLT-01 AC-4). | §9.5; FR-IMP-03 AC-14. **Amended by D-1559 (§19, O2):** the leftover goes to the system Trash |
| CP-7 → D-1557 | **A transformer failure on one note.** Not covered by R153. | At plan time the note is `unreadable` (reason `engine`) and reported, like broken YAML. At write time (after a clean plan) the run fails before the first write with `Transform`. | (b) At write time skip the note and report it (the result then differs from the preview). | §5, §7.1, §9.2; FR-IMP-07 AC-7 |

## 19. After the QA review: decided (O1…O3 → D-1558…D-1560) and still open

**O1…O3 are decided** (owner, 2026-11-12: "Accept all three"; BRD v1.166): every **Decision** below is the recommendation the owner accepted, and the sections named follow it.

| O-n → D-n | Question | Decision (accepted) | Affects |
| --- | --- | --- | --- |
| O1 → D-1558 | **D-1555's per-folder free names against the links an existing vault already has.** An imported `Tasks/Plán.md` next to the owner's `Pages/Plán.md` was allowed per folder; the owner's existing bare `[[Plán]]` links could then change their target | In an **existing** vault an imported file's name must be free against every existing file of the vault (vault-wide, compared as Tegg's own creation does, D-291 part 2); among the run's own files names stay free per folder (D-1555). A new vault is unaffected. `Pages/Plán.md` in the vault → the imported Task `Plán` is `Tasks/Plán (2).md` | §5.2 (free name), §9.2 step 3; FR-IMP-03 AC-7 |
| O2 → D-1559 | **A leftover `<name>.tegg-importing` with the engine's marker:** deleted permanently or moved to the system Trash | Moved to the **macOS Trash** through the `SystemTrash` seam (as D-619), never deleted permanently; if the move fails, `start` answers an error and removes nothing. Amends D-1549 (1) and D-1556 | §2 (`ImportEnv.trash`), §9.5 step 1, §11 (`LeftoverNotTrashed`), §12.2 (`trash_import_leftover`); FR-IMP-03 AC-14 |
| O3 → D-1560 | **A plain Markdown link (not an image) to a media file:** an embed `![[file]]` or a link | It stays a link: `[Manual](../PDFs/Media/Manual.pdf)` → `[[Manual.pdf\|Manual]]` (D-184 form; the alias rules of D-1533 / D-1552 apply). Only image syntax `![…](…)` becomes an embed | §8 (4), §7.1 (`LinkEdit`); FR-IMP-14 AC-2, AC-8 |

**Decided after the merge (D-1561, owner, 2026-11-12: "Yes, as a Page"; BRD v1.167).** A `DailyNote` whose day can be read from none of `date:`, `title` and the file name (§4.1) is planned as a **Page**: its `PlannedObject.type` is `page` (its `source_type` stays `DailyNote`, and the `PlannedType` of `DailyNote` still targets `daily-note`), its path is in `Pages/`, no `date` key is written, and the report's Types section has a row for it with the reason key `import.report.type.noDay` (text approved with the other report texts). The row is a `ReportData.no_day` entry (`NoDayRow { note }`, §5.3), written after the type rows as `- <the object> · <type.noDay>`; `TypeRow` is per source type and has no reason. Title, body, the other attributes and `import-id` are as for any object of its source type (D-1561). Links to it resolve as to any Page (import-capacities.md FR-IMP-08 AC-17; red test `fr_imp_08_ac17_a_daily_note_without_a_day_becomes_a_page`).

**Still open.** One point **comes to the owner with the red tests**:

- The wording of the report's own words marked † in §5.3: R150 describes the rows but gives no text for them. They are approved with the expected outputs (§16.2) unless the owner wants them as a separate point.

## 20. After the red tests: gaps closed, and points for the owner (CP-8…CP-11)

The test author wrote the red tests (`1db39a7`) from this contract and reported sixteen gaps. Twelve are closed by rules that follow from the criteria, the decisions D-1517…D-1561 and Tegg's conventions; each agrees with what the red tests assert. Four need the owner.

| # | Gap | Where the rule is |
| --- | --- | --- |
| 1 | `SkippedRow::Ignored`'s field `kind` beside the serde tag `kind` | §5.3: the JSON field is `file` |
| 2 | D-1561 named `ObjectPlan` and a Types row with no field | §19, §5.3: `PlannedObject.type`; `ReportData.no_day` (`NoDayRow`), key `type.noDay` |
| 3 | `ReportStrings` keys with or without the prefix | §2, §7.4: full catalog keys (`import.report.…`); others ignored |
| 4 | `testing::TrashSink`, `testing::FailingTrash` | §2, §16.1: dropped from the contract; the tests use their own `SystemTrash` |
| 5 | A kill before the marker exists | §9.5 step 2: the marker is the first entry; the leftover is removed by the next import (**CP-8**, D-1562) |
| 6 | `totals.objects` against `Plan.objects` | §5.1, §6.2: totals count the space's `.md` objects; a made media object is in no tally |
| 7 | `DuplicateTarget` or `KeyTaken` | §4.2: the order of checks; `DuplicateTarget` wins, on the later attribute |
| 8 | Quoting of `title` and `import-id` | §7.1 step 1: `formatScalar`'s bytes; two criteria examples carry a note |
| 9 | A Task's `date` beside `deadline` | §4.1: `due` is the deadline; the `date` value is kept as `date-text` (**CP-9**, D-1563) |
| 10 | The number in a generic media name | §5.2: Tegg's own rule (R73, D-621): always a number, from 1 |
| 11 | The backup zip's time | §9.3, §12.1: `ImportEnv.clock` at `start` |
| 12 | The counts-only line prefixes | §13: `export.<i>.<name>`, `export.<i>.space.<j>.<name>` |
| 13 | The bytes after the frontmatter; report rows | §7.1 steps 1, 2, 4; §7.4; §5.3 "Rows, to the byte" |
| 14 | A stored `previewImage` / `coverImage` | §4.1 (input form, `cover`); §16.2 (fixture `c23-stored-covers`, to add); other values: **CP-11**, D-1565 |
| 15 | "0 parse warnings" | §16.1: checked as "every object indexed with an id and one defined type" |
| 16 | `plan.json`: consumed keys, `needsLook`, system-type rows | §4 (effective mapping), §5.1 (`PlannedType.attributes`, `needs_look`); media objects' own attributes: **CP-10**, D-1564 |

**Points for the owner: decided** (owner, 2026-11-13: "Approve all"; BRD v1.168). Each changes data on disk and followed from no decision or convention. CP-8, CP-10 and CP-11 are decided as recommended; CP-9 as the rule in its row (the value is kept as text under `<key>-text`). The text above applies them; nothing in this contract is pending any more.

| CP-n | Issue | Decision | Alternatives (not taken) | Affects |
| --- | --- | --- | --- | --- |
| CP-8 | **A leftover `<name>.tegg-importing` with no marker, left by a kill before the marker was at its name.** By D-1549 (1) / D-1559 it is `TargetExists` for ever: the user must remove the folder by hand, and nothing tells them why | **Clean it up:** a leftover that is **completely empty**, or holds only the marker's own temp file (`..tegg-import.i<job>.tegg-tmp`), counts as the dead run's and is removed when a new-vault import of that name starts there (that one temp file, then `remove_empty_dir`, which can't remove a folder that holds anything): it can hold no data of the user's. Anything else without the marker stays `TargetExists`. **D-1562**, amends D-1549 (1) | (b) Leave it for ever, and let I2's window say "remove the folder `<name>.tegg-importing`" in its `TargetExists` text. (c) Move such a folder to the Trash like a marked one | §9.5 steps 1, 2; amends D-1549 (1). The red test changed (D-1566 (CP-8)): `fr_imp_03_ac3_atomic_writes_survive_a_kill`, the block "a kill before the marker exists", expects the clean-up and a successful next import; FR-IMP-03 AC-14's wording |
| CP-9 | **A consumed value that loses its key:** a Task's `date` when `deadline` also has a value (`c12`, `Plan the release`); a Weblink's `previewImage` when `coverImage` has one. D-46 gives a Task only a due date; FR-IMP-15 AC-3 names only the fallback | **Kept as text under `<key>-text`** (`date-text: 2026-02-09`, `previewImage-text`), an undeclared key (not added to the type file) shown under Other properties, at the place of the source key; reported in the Attributes section as `renamed · <key>-text · key already used`: nothing is lost, every such Task carries an extra key. **D-1563** | (a) Not written, and reported: one Attributes row `dropped` per source key with the count of such values (the earlier recommendation). (c) A new date attribute `scheduled` on Task: against D-46, and against the red test `fr_imp_08_ac4_…` (`task.yml` must stay byte-equal) | §4.1; `capacities-expected/c12-task-dates/Tasks/Plan the release.md` (added with the build) |
| CP-10 | **An imported Image or PDF object's own attributes.** Tegg's own media objects carry `media-type`, `size` (and `width`, `height` for images), computed from the file (ms6-trash-media §3.5). D-78 drops the source's `mimeType`, `fileSize`, `width`, `height` | **Not written:** the object has `file` and the mapped source keys only; the engine reads no image. The Image page then shows no size or dimensions for imported images. **D-1564** | (b) Compute `media-type` and `size` (and dimensions) with Tegg's `media_info` and write them as Tegg's own objects have them: imported and added images then look the same; the engine must read every media file's header, and writing `width` / `height` is against the red test `fr_imp_08_ac9_…` (no written file has those keys), which would change | §4.1; `capacities-expected/c05-media-objects/` (not written yet); D-78 |
| CP-11 | **A `coverImage` / `previewImage` value that isn't a stored file:** the file is missing, or the value is an external URL or other text. §8 (10) keeps a missing-file link in a frontmatter value as written; FR-IMP-24 AC-2 says only "a missing one is reported" | **No `cover` key is written;** a missing file is reported as in a body (unresolved `missing file` and a Files row), another value as an Attributes row `dropped`. **D-1565** | (b) By §8 (10): the value is written as it is, as text under `cover` (a dead link in a reserved key Tegg preserves but doesn't use, D-217) | §4.1; fixture `c23-stored-covers` (`Bez náhledu`) |
