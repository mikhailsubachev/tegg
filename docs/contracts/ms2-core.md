# MS2 Core Interface Contract

- **Status:** draft for MS2 (2026-10-12). The public interfaces of the MS2 core that the acceptance tests use (D-61: tests are written from the ACs and this contract only).
- **Scope:** BRD §11.2 MS2: index, watcher, search, switcher. ACs: `docs/acceptance/search-navigation.md`, the MS2 parts of `data-safety.md`, `file-format.md`, `architecture-rules.md`, `performance.md`. Architecture: `docs/architecture.md` §3.1, §5.1, §5.4, §5.8, §6.
- **Builds on** `docs/contracts/ms1-core.md` (conventions §1 apply unchanged: vault-relative NFC paths, bytes for content, injected time and time zones, injected ids).
- **New crates:** `tegg-index` (SQLite + FTS5 database, search, switcher, conflicts; no threads, no watcher) and `tegg-core` (the façade: opens a vault, owns the index, the watcher, background indexing, events, recency). Tests use `tegg-core` unless they test the index alone.

Until a function is implemented it exists as a stub that compiles and returns a deliberately wrong result (empty value or `Err(CoreError::NotImplemented)`), so a test fails on its **assertion**, never on a build error (TS-I1). Tests must not depend on stub behaviour.

---

## 1. Conventions added in MS2

- **Folding** (FR-SRC-04, FR-FMT-12, D-101): text and queries are compared after NFC → lower case → removal of combining marks (`Čtení` ≡ `cteni`). `tegg_index::fold(&str) -> String` is public so tests can state expectations.
- **What is indexed** (D-102, D-103, FR-TPL-07): every `*.md` file in the vault except under `.tegg/`, `.trash/`, `_templates/`, dot-folders, and temp files `.*.tegg-tmp` (FR-SYN-02 AC-2). Untyped files are type `page`; their title is the file stem.
- **Type keys**: as written in `type:` (D-96: `page`, `quick-note`, `task`, …), lower case. Untyped → `page`.
- **Waiting in tests:** the core is asynchronous (watcher, background indexing). Tests wait with `Core::wait_idle(timeout)` or by polling a query; a timing AC (e.g. "within 2 s") measures from the external write to the moment the query returns the new state.
- **Zero writes**: nothing in this contract writes to the vault except `Core::create_note` (FR-NAV-01 AC-7). Machine-local state (index, recency) goes to `Vault::local_dir()` (FR-STO-07).

## 2. `tegg-index` (Rust)

```rust
pub fn fold(s: &str) -> String;

/// Schema-versioned SQLite database at `<local_dir>/index.sqlite`. A version mismatch or a corrupt file → rebuild.
pub struct Index { /* … */ }
impl Index {
    pub fn open(db_path: &Path) -> Result<Index, IndexError>;
    /// Indexes or re-indexes one file from its bytes (uses `tegg_format::extract`).
    /// Excluded paths (§1) are ignored and return Ok.
    pub fn upsert(&mut self, path: &str, bytes: &[u8], version: &FileVersion) -> Result<(), IndexError>;
    /// Removes the path, or every path under it when `path` is a folder.
    pub fn remove(&mut self, path: &str) -> Result<(), IndexError>;
    /// Paths and versions currently indexed (for offline catch-up by mtime + size).
    pub fn versions(&self) -> Result<Vec<(String, i128, u64)>, IndexError>;

    pub fn search(&self, q: &SearchQuery) -> Result<SearchPage, IndexError>;
    pub fn switcher(&self, q: &str, recency: &dyn Fn(&str) -> Option<i64>, limit: usize) -> Vec<SwitcherItem>; // Object items only; Core adds Create
    pub fn object(&self, path: &str) -> Option<ObjectInfo>;
    pub fn objects(&self) -> Vec<ObjectInfo>;                 // sorted by path
    pub fn backlinks(&self, path: &str) -> Vec<String>;       // sorted paths of notes linking to `path`
    pub fn resolve_link(&self, target: &str) -> Option<String>; // FR-LNK-14: by file path/stem or `id`, never by title alone
    pub fn conflicts(&self) -> Vec<Conflict>;
    pub fn daily_note(&self, date: NaiveDate) -> Option<String>; // FR-FMT-09 AC-2: by the `date` attribute
    /// Deterministic dump of everything derivable (objects, attributes, links, backlinks, tags) for AR-01 snapshots.
    pub fn snapshot(&self) -> String;
}

pub struct ObjectInfo {
    pub path: String, pub id: Option<String>, pub r#type: String, pub title: String,
    pub aliases: Vec<String>, pub tags: Vec<String>,        // tag keys (NFC, lower case)
    pub attributes: serde_json::Value,                    // frontmatter mapping, or {} 
    pub folder: String,                                   // `Tasks`, "" for the vault root
}
pub enum IndexError { Sqlite(String), Io(String), NotImplemented }
```

### 2.1 Search (FR-SRC-01…04, D-101…D-109)

```rust
pub struct SearchQuery {
    pub text: String,                       // syntax D-108: "phrase" / „phrase“, -exclude at term start, else literal
    pub types: Vec<String>,                 // type keys; empty = any
    pub tags: Vec<String>,                  // all of (AND); NFC + case-insensitive (FR-SRC-02 AC-9)
    pub created: Option<DateRange>, pub modified: Option<DateRange>, // inclusive days in `tz` (D-104)
    pub attributes: Vec<AttrFilter>,        // D-109
    pub review: Option<String>,             // `review:` value, e.g. "unreviewed"
    pub tz: chrono_tz::Tz,                  // the machine's zone, passed in (contract §1 of MS1)
    pub offset: usize, pub limit: usize,    // page; default limit 50 (D-107)
}
impl SearchQuery { pub fn text(text: &str, tz: chrono_tz::Tz) -> SearchQuery } // no filters, offset 0, limit 50
pub struct DateRange { pub from: NaiveDate, pub to: NaiveDate }   // one day: from == to
pub enum AttrFilter {
    Equals { key: String, value: String },                     // select/text/checkbox, folded compare
    Range { key: String, from: Option<String>, to: Option<String> }, // dates (YYYY-MM-DD) and numbers
}
pub struct SearchPage { pub results: Vec<SearchResult>, pub total: usize }
pub struct SearchResult {
    pub path: String, pub r#type: String, pub title: String,
    pub matched_in: MatchField,             // Title | Alias | Body | Attribute
    pub typo: bool,                         // matched only with one edit (D-101); ranked after exact ones
    pub snippet: Option<Snippet>,           // body match only
}
pub enum MatchField { Title, Alias, Body, Attribute }
pub struct Snippet {
    pub text: String,                       // ≤ 160 chars of body text, no frontmatter, no block markers (D-107)
    pub highlights: Vec<(usize, usize)>,    // byte ranges into `text`, on the original (unfolded) text
    pub line: usize,                        // 1-based line in the file of the first body match
    pub byte_in_line: usize,                // byte offset of the match in that line
}
```

Ranking: exact before typo matches; title, then alias, then attribute/body matches; within those, FTS rank. An empty `text` with filters is a valid search (FR-SRC-02 AC-2); empty text and no filters → empty page. A malformed query never errors (FR-SRC-04 AC-6, AC-7).

### 2.2 Switcher (FR-NAV-01, D-105, D-106)

```rust
pub struct SwitcherItem {
    pub kind: SwitcherKind,                 // Object | Create
    pub path: Option<String>,               // None for Create
    pub title: String,                      // for Create: the query, trimmed, NFC
    pub r#type: String, pub folder: String, // for Create: the default type and its folder (FR-VLT-05)
    pub matched_alias: Option<String>,
    pub tier: Option<MatchTier>,
}
pub enum SwitcherKind { Object, Create }
pub enum MatchTier { Exact, Prefix, WordPrefix, Substring, InOrder } // best first
```

Matches folded titles, aliases and file stems; never body text. Order: tier, then recency (opened objects first, most recent first; never-opened ones after them by `modified`, newest first), then title. An empty query lists objects by recency. `Core::switcher` appends a `Create` item for every non-empty query: last when something matches, the only item when nothing does.

### 2.3 Conflicts (FR-SYN-04, FR-SYN-05, FR-FMT-12 AC-3)

```rust
pub struct Conflict { pub kind: ConflictKind, pub primary: String, pub others: Vec<String> }
pub enum ConflictKind {
    DuplicateId,        // same `id`; `primary` is the object for links (AC-1 rule); a conflict-copy name is an `others` entry
    PossibleCopy,       // conflict-copy name pattern + ≥ 90 % equal lines (D-111), different or no id
    NameNormalization,  // two paths equal under NFC (FR-FMT-12 AC-3)
}
```

For `DuplicateId` without a conflict-copy name (FR-SYN-04 AC-4), `others` holds the newer file (by `created`, else mtime); the UI re-ids it through `@tegg/doc` after confirmation.

## 3. `tegg-core` (Rust)

```rust
pub struct CoreOptions {
    pub watch: bool,                        // FSEvents watcher (LocalFs only); false in MemFs tests
    pub sync: Option<Arc<dyn SyncAdapter>>, // AR-04 AC-3; None = FolderSync
}
pub struct Core { /* … */ }
impl Core {
    /// §5.1: opens the vault (zero writes), opens or rebuilds the index in the background, starts the watcher.
    /// Returns at once; indexing progress arrives as events.
    pub fn open(root: &Path, dirs: &AppDirs, opts: CoreOptions) -> Result<Core, CoreError>;
    pub fn open_with(fs: Arc<dyn VaultFs>, dirs: &AppDirs, opts: CoreOptions) -> Result<Core, CoreError>;
    pub fn vault(&self) -> &Vault;
    /// Every receiver gets all events since `open` (buffered), then live ones, so events sent during open
    /// (early `IndexProgress`, `Placeholders`) are never lost.
    pub fn events(&self) -> Receiver<CoreEvent>;

    /// Blocks until indexing and pending change processing are done, or the timeout passes (returns false).
    pub fn wait_idle(&self, timeout: Duration) -> bool;
    pub fn cancel_indexing(&self);          // FR-UX-07 AC-3; resumes on the next open (D-110)

    // index.* commands, answered from the current index state (partial while indexing, FR-UX-07 AC-2)
    pub fn search(&self, q: &SearchQuery) -> Result<SearchPage, CoreError>;
    pub fn switcher(&self, q: &str, limit: usize) -> Vec<SwitcherItem>;
    pub fn object(&self, path: &str) -> Option<ObjectInfo>;
    pub fn objects(&self) -> Vec<ObjectInfo>;
    pub fn backlinks(&self, path: &str) -> Vec<String>;
    pub fn resolve_link(&self, target: &str) -> Option<String>;
    pub fn conflicts(&self) -> Vec<Conflict>;
    pub fn daily_note(&self, date: NaiveDate) -> Option<String>;
    pub fn snapshot(&self) -> String;
    /// FR-VLT-03: placeholders found at open (D-112), never read; paths as on disk (an iCloud stub is listed as `Folder/.Name.md.icloud`).
    pub fn placeholders(&self) -> Vec<String>;

    // note.* commands
    /// Reads through the vault and records recency in local_dir (D-105). Never writes to the vault.
    pub fn read_note(&self, path: &str, now: SystemTime) -> Result<(Vec<u8>, FileVersion), CoreError>;
    /// The one write path (MS1 `Vault::write`) + direct index update + own-write echo suppression.
    /// A version mismatch emits `CoreEvent::NoteConflict`, writes nothing and returns
    /// `Err(CoreError::Vault(VaultError::Conflict { disk }))` (FR-SYN-03 AC-7/AC-8).
    pub fn write_note(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>) -> Result<WriteOutcome, CoreError>;
    /// FR-NAV-01 AC-7: `Vault::create_file(dir, sanitize_file_stem(title), "md", bytes)`; bytes come from
    /// `@tegg/doc` `newNote`. Indexed at once. Returns the new path.
    pub fn create_note(&self, dir: &str, title: &str, bytes: &[u8]) -> Result<String, CoreError>;

    /// AR-04 AC-3: a change reported by a sync adapter (or a test) for a path; processed like a watcher event.
    pub fn notify_changed(&self, paths: &[String]);
}

pub enum CoreEvent {
    IndexProgress { done: usize, total: usize, state: ProgressState }, // ≥ 1 per 500 ms while running (D-110)
    VaultChanged { paths: Vec<String> },                               // after the index reflects them
    NoteConflict { path: String, mine: Vec<u8>, theirs: Vec<u8>, disk: FileVersion },
    Placeholders { count: usize },                                     // at open when > 0 (FR-VLT-03 AC-3)
}
pub enum ProgressState { Running, Done, Cancelled }
pub enum CoreError { Vault(VaultError), Index(IndexError), NotImplemented }

/// AR-04 AC-3: extended in MS2. The adapter calls `sink(paths)` for changes it applied to the VaultFs.
pub trait SyncAdapter: Send + Sync {          // in tegg-vault
    fn name(&self) -> &str;
    fn start(&self, sink: Box<dyn Fn(Vec<String>) + Send + Sync>) {}
}
```

**`tegg-vault` additions for MS2:**
- `impl<T: VaultFs + ?Sized> VaultFs for Arc<T>`, so a test keeps a handle on the `MemFs` the core uses.
- `VaultFs::is_placeholder(&self, path: &str) -> io::Result<bool>` (default `false`): `SF_DATALESS` on APFS (`LocalFs`); `MemFs::set_placeholder(path, bool)` injects it (D-112). iCloud `.<name>.icloud` stubs are recognized by name.
- `VaultFs::stat(path) -> io::Result<Option<(i128, u64)>>` (mtime, size without reading; offline catch-up) and `VaultFs::watch(sink) -> io::Result<Option<WatchGuard>>` (FSEvents via `notify` in `LocalFs`; `None` for `MemFs`), with read-only `Vault::list_files`, `version`, `stat`, `is_placeholder`, `watch`.
- Machine-local file helpers `write_local_file`, `read_local_file`, `remove_local_path`, `create_local_dir` (Application Support only), so `tegg-index`/`tegg-core` never touch the file system directly (AR-04 AC-1).
- `MemFs::write_external(path, bytes)` / `remove_external(path)` / `rename_external(from, to)`: changes "by another program" for sync-simulator tests (AR-04 AC-4).

## 4. Performance (NFR-PERF-02, -03, -04, -08)

The trend run is `tools/core-perf` (`cargo run --release -- --vault <dir> --runs 20 [--out results.json]`): p95 per metric for NFR-PERF-02, -02 AC-2, -03, -04 and -08 on a temporary copy of a gen-vault vault, against the D-59 reference targets, run by `./verify nightly` (step `core-perf`, test-strategy §9). It lives in `tools/` because it edits files from outside the core, which `crates/*/src` may not do (AR-04 AC-1).

Core-level latency ACs (FR-SRC-01 AC-11, FR-NAV-01 AC-9, FR-UX-07 AC-1/AC-2, FR-STO-07 AC-2) run in `cargo test` on a reference vault produced by `gen-vault` (dev-dependency, `--seed 1`, small images), generated once per `target/` directory and reused; `TEGG_REF_VAULT=<dir>` overrides it. They assert the D-59 reference targets (75 % of the BRD target) only when built with `--release`; in debug builds they assert the BRD target × 10 and log the measured value, so they still catch gross regressions.
