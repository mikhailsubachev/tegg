//! Tegg core façade: opens a vault, owns the index, the watcher, background indexing, events and recency.
//! Interface: docs/contracts/ms2-core.md §3. No Tauri dependency (AR-03); no direct file access (AR-04 AC-1):
//! vault files go through `tegg-vault`, machine-local files through its Application Support helpers.
//!
//! One worker thread applies every change to the index in order: the initial catch-up (architecture §5.1),
//! then batches of changed paths from the watcher or a sync adapter (§5.4). Queries lock the index only
//! briefly, so they keep answering while indexing runs (FR-UX-07 AC-2).

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::NaiveDate;
use tegg_format::{nfc, sanitize_file_stem};
use tegg_index::{is_indexable, prepare, Index, Prepared};
pub use tegg_index::{
    AttrFilter, Backlink, Conflict, TagInfo, ConflictKind, DateRange, IndexError, MatchField, MatchTier, ObjectInfo, QueryTier, SearchPage,
    SearchQuery, SearchResult, Snippet, SwitcherItem, SwitcherKind, DuplicateDetails,
};
pub use tegg_vault::{AppDirs, FileVersion, FolderSync, SyncAdapter, Vault, VaultError, VaultFs, WriteOutcome};
pub use tegg_jobs;
use tegg_vault::{FsChange, WatchGuard};

#[derive(Default, Clone)]
pub struct CoreOptions {
    /// FSEvents watcher (LocalFs only); false in MemFs tests.
    pub watch: bool,
    /// AR-04 AC-3; None = the folder adapter.
    pub sync: Option<Arc<dyn SyncAdapter>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgressState {
    Running,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CoreEvent {
    IndexProgress { done: usize, total: usize, state: ProgressState },
    VaultChanged { paths: Vec<String> },
    NoteConflict { path: String, mine: Vec<u8>, theirs: Vec<u8>, disk: FileVersion },
    Placeholders { count: usize },
    /// ms4-jobs §4: `job:progress` (FR-UX-07 AC-8).
    JobProgress(tegg_jobs::JobProgress),
    /// ms4-jobs §2.2, §9: a file for the UI's `@tegg/doc` worker; `live` when the file is open in an editor (D-386),
    /// whose transaction and autosave then write it.
    JobTransform { request: u64, source: String, text: String, ops: Vec<tegg_jobs::TextOp>, live: bool },
}

#[derive(Debug)]
pub enum CoreError {
    Vault(VaultError),
    Index(IndexError),
    /// D-180: the file's last read wasn't valid UTF-8; it is never written.
    NotUtf8,
    NotImplemented,
    /// ms3-shell §14.2.2 (3D).
    Schema(tegg_schema::SchemaError),
    SystemType,
    HasObjects(usize),
    UnknownType,
    /// ms4-links §3 (FR-LNK-04 AC-11): the Create offer's plan no longer holds; nothing was written.
    PlanChanged { now: LinkCreatePlan },
    /// ms4-links §3 (D-311): the target resolves now, or its file appeared; nothing was written.
    Exists { path: String },
    /// ms4-daily §3 (D-318): a Daily Note is created only by `daily_create`.
    UseDailyNote,
    /// ms4-daily §3: `daily_create` bytes don't have `type: daily-note`, the date and the date as title.
    DailyMismatch,
    /// ms5-tasks §11.6: `note_discard` of a file that isn't a note (`.tegg/`, `_templates/`, `.trash/`, not `.md`).
    Protected,
    /// ms5-capture §3.3 (5B): `capture_create` of Daily Note, Tag, Image, PDF or an unknown type key.
    UnsupportedType,
    /// ms5-capture §3.3 (5B): the bytes lack this type, `review: unreviewed` or a `captured` value.
    NotACapture,
    /// ms5-capture §5.1 (5B): a vault setting D-336 or D-222 rejects; nothing was written.
    Invalid { reason: String },
}

/// D-198: a note as read, with whether its bytes are valid UTF-8 (D-180).
#[derive(Debug, Clone)]
pub struct NoteRead {
    pub bytes: Vec<u8>,
    pub version: FileVersion,
    pub utf8: bool,
}

impl From<VaultError> for CoreError {
    fn from(e: VaultError) -> Self {
        CoreError::Vault(e)
    }
}

impl From<IndexError> for CoreError {
    fn from(e: IndexError) -> Self {
        CoreError::Index(e)
    }
}

/// Files read and parsed per index transaction: small enough that a query never waits long for the lock
/// and progress is reported well within 500 ms (D-110).
const BATCH: usize = 64;
/// How often a running catch-up reports progress (D-110: at least every 500 ms).
const PROGRESS_TICK: Duration = Duration::from_millis(200);
/// Watcher events are collected this long before they are applied (S4).
const SETTLE: Duration = Duration::from_millis(30);
/// Events kept for receivers created later (contract §3).
const EVENT_BUFFER: usize = 10_000;
const INDEX_FILE: &str = "index.sqlite";
const RECENT_FILE: &str = "recent.json";

enum Job {
    /// Offline catch-up or full rebuild, with progress (architecture §5.1); the listing made at open, if any.
    CatchUp(Option<Vec<String>>),
    Paths(Vec<String>),
    Stop,
}

#[derive(Default)]
struct Hub {
    buffer: VecDeque<CoreEvent>,
    subscribers: Vec<Sender<CoreEvent>>,
}

/// FR-VLT-05: where the switcher's Create item puts a new object.
#[derive(Clone)]
struct DefaultType {
    key: String,
    folder: String,
}

struct Shared {
    vault: Vault,
    index: Mutex<Index>,
    hub: Mutex<Hub>,
    pending: Mutex<usize>,
    idle: Condvar,
    cancel: AtomicBool,
    /// Path → last opened (ms since the epoch), machine-local (D-105, FR-STO-07).
    recency: Mutex<(HashMap<String, i64>, bool)>,
    default_type: Mutex<DefaultType>,
    placeholders: Mutex<Vec<String>>,
    jobs: Mutex<Sender<Job>>,
    /// Paths whose last read wasn't valid UTF-8 (D-180).
    not_utf8: Mutex<std::collections::HashSet<String>>,
    /// Type definitions by key for the index queries (rows, counts; 3D): read at open, after own type-file writes
    /// and on watched `.tegg/types/` changes, so a type page reads no file (D-233).
    type_defs: Mutex<std::collections::BTreeMap<String, tegg_schema::TypeFile>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl Shared {
    fn emit(&self, e: CoreEvent) {
        let mut hub = lock(&self.hub);
        if hub.buffer.len() == EVENT_BUFFER {
            hub.buffer.pop_front();
        }
        hub.buffer.push_back(e.clone());
        hub.subscribers.retain(|s| s.send(e.clone()).is_ok());
    }

    fn enqueue(&self, job: Job) {
        *lock(&self.pending) += 1;
        if lock(&self.jobs).send(job).is_err() {
            self.finished(1);
        }
    }

    fn finished(&self, n: usize) {
        let mut p = lock(&self.pending);
        *p = p.saturating_sub(n);
        if *p == 0 {
            self.idle.notify_all();
        }
    }

    fn save_recency(&self) {
        let mut r = lock(&self.recency);
        if !r.1 {
            return;
        }
        let map: serde_json::Map<String, serde_json::Value> = r.0.iter().map(|(k, v)| (k.clone(), (*v).into())).collect();
        let bytes = serde_json::Value::Object(map).to_string();
        if tegg_vault::write_local_file(&self.vault.local_dir().join(RECENT_FILE), bytes.as_bytes()).is_ok() {
            r.1 = false;
        }
    }

    fn load_default_type(&self) {
        let read = |p: &str| self.vault.read(p).ok().map(|(b, _)| String::from_utf8_lossy(&b).into_owned());
        let exists = |k: &str| tegg_schema::builtin(k).is_some() || self.vault.read(&format!(".tegg/types/{k}.yml")).is_ok();
        // D-541: the matched key of `default-type` (D-239), Quick Note when it names no type.
        let key = settings5b::default_type_of(read(".tegg/vault.yml").as_deref(), exists).key;
        let folder = read(&format!(".tegg/types/{key}.yml"))
            .or_else(|| tegg_schema::builtin(&key).map(str::to_string))
            .and_then(|t| yaml_str(&t, "folder"))
            .unwrap_or_else(|| default_folder(&key));
        *lock(&self.default_type) = DefaultType { key, folder };
    }
}

fn yaml_str(text: &str, key: &str) -> Option<String> {
    let docs = yaml_rust2::YamlLoader::load_from_str(text).ok()?;
    docs.first()?[key].as_str().map(str::to_string).filter(|s| !s.trim().is_empty())
}

/// BRD §5.1 default folders for system types; a user type's folder is its name in plural (FR-STO-01).
fn default_folder(type_name: &str) -> String {
    match type_name {
        "Daily Note" => "Daily".into(),
        "Quick Note" => "Quick Notes".into(),
        "PDF" => "PDFs".into(),
        other => format!("{other}s"),
    }
}

pub struct Core {
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
    /// Mutex only so `Core` is `Sync` (the shell shares it between IPC threads).
    watch: Mutex<Option<WatchGuard>>,
    /// ms4-jobs §4: the job engine of this vault (stub until slice 4C is built).
    jobs_engine: tegg_jobs::Jobs,
}

impl Core {
    /// §5.1: opens the vault (zero writes), opens or rebuilds the index in the background, starts the watcher.
    pub fn open(root: &Path, dirs: &AppDirs, opts: CoreOptions) -> Result<Core, CoreError> {
        let vault = Vault::open(root, dirs).map_err(|e| CoreError::Vault(VaultError::Io(std::io::Error::other(format!("{e:?}")))))?;
        Core::start(vault, opts)
    }

    pub fn open_with(fs: Arc<dyn VaultFs>, dirs: &AppDirs, opts: CoreOptions) -> Result<Core, CoreError> {
        let vault = Vault::open_with(Box::new(fs), dirs).map_err(|e| CoreError::Vault(VaultError::Io(std::io::Error::other(format!("{e:?}")))))?;
        Core::start(vault, opts)
    }

    fn start(vault: Vault, opts: CoreOptions) -> Result<Core, CoreError> {
        let local = vault.local_dir();
        let index = Index::open(&local.join(INDEX_FILE))?;
        let recency: HashMap<String, i64> = tegg_vault::read_local_file(&local.join(RECENT_FILE))
            .and_then(|b| serde_json::from_slice::<HashMap<String, i64>>(&b).ok())
            .unwrap_or_default();
        let (tx, rx) = channel();
        let shared = Arc::new(Shared {
            vault,
            index: Mutex::new(index),
            hub: Mutex::new(Hub::default()),
            pending: Mutex::new(0),
            idle: Condvar::new(),
            cancel: AtomicBool::new(false),
            recency: Mutex::new((recency, false)),
            default_type: Mutex::new(DefaultType { key: "quick-note".into(), folder: "Quick Notes".into() }),
            placeholders: Mutex::new(Vec::new()),
            not_utf8: Mutex::new(Default::default()),
            type_defs: Mutex::new(Default::default()),
            jobs: Mutex::new(tx),
        });
        shared.load_default_type();
        shared.refresh_types();

        // FR-VLT-03, D-112: placeholders are listed at open and never read.
        let listing = shared.vault.list_files()?;
        let placeholders: Vec<String> = listing.iter().filter(|p| shared.vault.is_placeholder(p)).cloned().collect();
        if !placeholders.is_empty() {
            shared.emit(CoreEvent::Placeholders { count: placeholders.len() });
        }
        *lock(&shared.placeholders) = placeholders;

        shared.enqueue(Job::CatchUp(Some(listing)));
        let worker = {
            let s = shared.clone();
            std::thread::Builder::new().name("tegg-index".into()).spawn(move || worker(s, rx)).map_err(|e| CoreError::Vault(VaultError::Io(e)))?
        };
        let watch = if opts.watch {
            let s = shared.clone();
            shared
                .vault
                .watch(Box::new(move |c| match c {
                    FsChange::Paths(p) => s.enqueue(Job::Paths(p)),
                    FsChange::Rescan => s.enqueue(Job::CatchUp(None)),
                }))
                .map_err(|e| CoreError::Vault(VaultError::Io(e)))?
        } else {
            None
        };
        // AR-04 AC-3: remote changes enter through the adapter like watcher events.
        let adapter: Arc<dyn SyncAdapter> = opts.sync.unwrap_or_else(|| Arc::new(FolderSync));
        let s = shared.clone();
        adapter.start(Box::new(move |paths| s.enqueue(Job::Paths(paths))));
        let jobs_engine = tegg_jobs::Jobs::with_host(Arc::new(jobs4c::CoreHost { shared: shared.clone() }));
        Ok(Core { shared, worker: Some(worker), watch: Mutex::new(watch), jobs_engine })
    }

    pub fn vault(&self) -> &Vault {
        &self.shared.vault
    }

    /// ms4-jobs §4: the job engine (note rename in 4C).
    pub fn jobs(&self) -> &tegg_jobs::Jobs {
        &self.jobs_engine
    }

    /// Every receiver gets all events since `open` (buffered), then live ones.
    pub fn events(&self) -> Receiver<CoreEvent> {
        let (tx, rx) = channel();
        let mut hub = lock(&self.shared.hub);
        for e in &hub.buffer {
            let _ = tx.send(e.clone());
        }
        hub.subscribers.push(tx);
        rx
    }

    /// Blocks until indexing and pending change processing are done, or the timeout passes (returns false).
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let p = lock(&self.shared.pending);
        let (p, _) = self.shared.idle.wait_timeout_while(p, timeout, |n| *n > 0).unwrap_or_else(|e| e.into_inner());
        *p == 0
    }

    /// FR-UX-07 AC-3: stops the running catch-up; the next open resumes it (D-110).
    pub fn cancel_indexing(&self) {
        self.shared.cancel.store(true, Ordering::SeqCst);
    }

    fn index(&self) -> MutexGuard<'_, Index> {
        lock(&self.shared.index)
    }

    pub fn search(&self, q: &SearchQuery) -> Result<SearchPage, CoreError> {
        Ok(self.index().search(q)?)
    }

    /// FR-NAV-01, D-105, D-106: objects by match tier and recency; a Create item last for a non-empty query.
    pub fn switcher(&self, q: &str, limit: usize) -> Vec<SwitcherItem> {
        let mut items = {
            let recency = lock(&self.shared.recency);
            self.index().switcher(q, &|p| recency.0.get(p).copied(), limit)
        };
        self.add_duplicate_details(&mut items);
        let title = nfc(&q.split_whitespace().collect::<Vec<_>>().join(" "));
        if !title.is_empty() {
            let d = lock(&self.shared.default_type).clone();
            items.push(SwitcherItem { kind: SwitcherKind::Create, path: None, title, r#type: d.key, folder: d.folder, matched_alias: None, tier: None, duplicate: None });
        }
        items
    }

    pub fn object(&self, path: &str) -> Option<ObjectInfo> {
        self.index().object(path)
    }

    pub fn objects(&self) -> Vec<ObjectInfo> {
        self.index().objects()
    }

    pub fn backlinks(&self, path: &str) -> Vec<String> {
        self.index().backlinks(path)
    }

    /// FR-LNK-02 (D-257, ms3-shell §15.4): backlinks with the frontmatter key each link is in.
    pub fn backlinks_detailed(&self, path: &str) -> Vec<Backlink> {
        self.index().backlinks_detailed(path)
    }

    pub fn resolve_link(&self, target: &str) -> Option<String> {
        self.index().resolve_link(target)
    }

    pub fn conflicts(&self) -> Vec<Conflict> {
        self.index().conflicts()
    }

    pub fn daily_note(&self, date: NaiveDate) -> Option<String> {
        self.index().daily_note(date)
    }

    pub fn snapshot(&self) -> String {
        self.index().snapshot()
    }

    /// FR-VLT-03: placeholders found at open (D-112), never read; paths as on disk.
    pub fn placeholders(&self) -> Vec<String> {
        lock(&self.shared.placeholders).clone()
    }

    /// Reads through the vault and records recency in Application Support (D-105). Never writes to the vault.
    pub fn read_note(&self, path: &str, now: SystemTime) -> Result<(Vec<u8>, FileVersion), CoreError> {
        let r = self.read_note_info(path, now)?;
        Ok((r.bytes, r.version))
    }

    /// `read_note` with the UTF-8 flag (D-180, D-198). A non-UTF-8 read makes later writes to the path fail.
    pub fn read_note_info(&self, path: &str, now: SystemTime) -> Result<NoteRead, CoreError> {
        let (bytes, version) = self.shared.vault.read(path)?;
        let utf8 = std::str::from_utf8(&bytes).is_ok();
        {
            let mut bad = lock(&self.shared.not_utf8);
            if utf8 { bad.remove(&nfc(path)) } else { bad.insert(nfc(path)) };
        }
        let ms = now.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let mut rec = lock(&self.shared.recency);
        rec.0.insert(nfc(path), ms);
        rec.1 = true;
        Ok(NoteRead { bytes, version, utf8 })
    }

    /// D-185: tags of indexed objects with their most frequent spelling.
    pub fn tags(&self) -> Vec<TagInfo> {
        self.index().tags()
    }

    /// D-194: a new file at exactly `path` (`Keep both`); `NameTaken` if the name exists.
    pub fn create_exact(&self, path: &str, bytes: &[u8]) -> Result<FileVersion, CoreError> {
        let path = nfc(path);
        let v = self.shared.vault.create_exact(&path, bytes)?;
        self.index().upsert(&path, bytes, &v)?;
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path] });
        Ok(v)
    }

    /// D-195: trash a file only if it is still `base` (Conflicts view). Returns the trash path.
    pub fn trash_note(&self, path: &str, base: &FileVersion) -> Result<String, CoreError> {
        let path = nfc(path);
        let to = self.shared.vault.trash_checked(&path, base)?;
        self.index().remove(&path)?;
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path, to.clone()] });
        Ok(to)
    }

    /// ms5-tasks §11.6 (D-492): deletes `path` (no trash) only when its current version equals `base`; `Conflict`
    /// otherwise, `NotFound` when absent. Only Markdown notes outside `.tegg/`, `_templates/` and `.trash/` (`Protected`).
    pub fn discard_note(&self, path: &str, base: &FileVersion) -> Result<(), CoreError> {
        let path = nfc(path);
        let top = path.split('/').next().unwrap_or("");
        if [".tegg", "_templates", ".trash"].contains(&top) || !path.to_lowercase().ends_with(".md") {
            return Err(CoreError::Protected);
        }
        self.shared.vault.discard_checked(&path, base)?;
        self.index().remove(&path)?;
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path] });
        Ok(())
    }

    /// The one write path (MS1 `Vault::write`), then the index is updated directly (architecture §5.3).
    /// A version mismatch emits `NoteConflict`, writes nothing and returns `Conflict` (FR-SYN-03 AC-7/AC-8).
    pub fn write_note(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>) -> Result<WriteOutcome, CoreError> {
        let path = nfc(path);
        if lock(&self.shared.not_utf8).contains(&path) {
            return Err(CoreError::NotUtf8);
        }
        match self.shared.vault.write(&path, bytes, base) {
            Ok(WriteOutcome::Written(v)) => {
                self.index().upsert(&path, bytes, &v)?;
                self.shared.emit(CoreEvent::VaultChanged { paths: vec![path] });
                Ok(WriteOutcome::Written(v))
            }
            Ok(WriteOutcome::Unchanged) => Ok(WriteOutcome::Unchanged),
            Err(VaultError::Conflict { disk }) => {
                let theirs = self.shared.vault.read(&path).map(|(b, _)| b).unwrap_or_default();
                self.shared.emit(CoreEvent::NoteConflict { path, mine: bytes.to_vec(), theirs, disk: disk.clone() });
                Err(CoreError::Vault(VaultError::Conflict { disk }))
            }
            Err(e) => Err(e.into()),
        }
    }

    /// FR-NAV-01 AC-7: a new note named after `title` in `dir` (a free name, FR-LNK-14); bytes come from
    /// `@tegg/doc` `newNote`. Indexed at once.
    pub fn create_note(&self, dir: &str, title: &str, bytes: &[u8]) -> Result<String, CoreError> {
        let (path, v) = self.shared.vault.create_file(dir, &sanitize_file_stem(title), "md", bytes)?;
        self.index().upsert(&path, bytes, &v)?;
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path.clone()] });
        Ok(path)
    }

    /// AR-04 AC-3: a change reported by a sync adapter (or a test); processed like a watcher event.
    pub fn notify_changed(&self, paths: &[String]) {
        self.shared.enqueue(Job::Paths(paths.to_vec()));
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        *lock(&self.watch) = None;
        self.shared.cancel.store(true, Ordering::SeqCst);
        let _ = lock(&self.shared.jobs).send(Job::Stop);
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
        self.shared.save_recency();
    }
}

// ---------------------------------------------------------------- the worker

fn worker(s: Arc<Shared>, rx: Receiver<Job>) {
    let mut queue: VecDeque<Job> = VecDeque::new();
    loop {
        let job = match queue.pop_front() {
            Some(j) => j,
            None => match rx.recv() {
                Ok(j) => j,
                Err(_) => return,
            },
        };
        match job {
            Job::Stop => return,
            Job::CatchUp(listing) => {
                let first = listing.is_some();
                catch_up(&s, listing);
                if first {
                    // FR-SYN-02 AC-4: crash leftovers (the only deletes an open does, and only of temp files),
                    // after the first catch-up so they don't delay the index (the index never reads them).
                    let _ = s.vault.clean_temp_files(SystemTime::now());
                }
                s.cancel.store(false, Ordering::SeqCst);
                s.finished(1);
            }
            Job::Paths(first) => {
                // Collect what arrives within the settle window into one batch.
                let mut paths = first;
                let mut merged = 1;
                let deadline = Instant::now() + SETTLE;
                loop {
                    let left = deadline.saturating_duration_since(Instant::now());
                    match rx.recv_timeout(left) {
                        Ok(Job::Paths(more)) => {
                            paths.extend(more);
                            merged += 1;
                        }
                        Ok(other) => {
                            queue.push_back(other);
                            break;
                        }
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
                apply_paths(&s, paths);
                s.finished(merged);
            }
        }
    }
}

fn threads() -> usize {
    // Capped at cores − 2 (S4 P8), so indexing never takes the whole machine.
    std::thread::available_parallelism().map(|n| n.get().saturating_sub(2)).unwrap_or(1).max(1)
}

/// Reads and parses `paths` in parallel, outside the index lock.
fn read_batch(s: &Shared, paths: &[String]) -> Vec<Prepared> {
    let n = threads().min(paths.len()).max(1);
    let chunk = paths.len().div_ceil(n);
    std::thread::scope(|scope| {
        let handles: Vec<_> = paths
            .chunks(chunk.max(1))
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .filter_map(|p| match s.vault.read(p) {
                            Ok((bytes, v)) => prepare(p, &bytes, &v),
                            Err(_) => None,
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

/// Architecture §5.1: brings the index up to the files by `(mtime, size)`; a fresh index is a full rebuild.
/// Reports `IndexProgress` per batch and stops on cancel (FR-UX-07, D-110).
fn catch_up(s: &Shared, listing: Option<Vec<String>>) {
    let files = match listing.map(Ok).unwrap_or_else(|| s.vault.list_files()) {
        Ok(f) => f,
        Err(_) => return,
    };
    let placeholders: BTreeSet<String> = lock(&s.placeholders).iter().cloned().collect();
    let on_disk: Vec<String> = files.into_iter().filter(|p| is_indexable(p) && !placeholders.contains(p)).collect();
    let known: HashMap<String, (i128, u64)> = match lock(&s.index).versions() {
        Ok(v) => v.into_iter().map(|(p, m, z)| (p, (m, z))).collect(),
        Err(_) => HashMap::new(),
    };
    let present: BTreeSet<&String> = on_disk.iter().collect();
    let gone: Vec<String> = known.keys().filter(|p| !present.contains(p)).cloned().collect();
    let mut need: Vec<String> = on_disk
        .iter()
        .filter(|p| match known.get(*p) {
            Some(k) => !matches!(s.vault.stat(p), Ok(Some(now)) if now == *k),
            None => true,
        })
        .cloned()
        .collect();
    need.sort();
    {
        let mut idx = lock(&s.index);
        for p in &gone {
            let _ = idx.remove(p);
        }
    }
    let total = need.len();
    s.emit(CoreEvent::IndexProgress { done: 0, total, state: ProgressState::Running });
    // D-110: progress at least every 500 ms, whatever a batch costs on a loaded machine.
    let done = AtomicUsize::new(0);
    let running = AtomicBool::new(true);
    let cancelled = std::thread::scope(|scope| {
        scope.spawn(|| {
            let mut last = 0;
            while running.load(Ordering::SeqCst) {
                std::thread::sleep(PROGRESS_TICK);
                let d = done.load(Ordering::SeqCst);
                if running.load(Ordering::SeqCst) && d < total {
                    s.emit(CoreEvent::IndexProgress { done: d.max(last), total, state: ProgressState::Running });
                    last = d;
                }
            }
        });
        let mut cancelled = false;
        for batch in need.chunks(BATCH) {
            if s.cancel.load(Ordering::SeqCst) {
                cancelled = true;
                break;
            }
            let prepared = read_batch(s, batch);
            let _ = lock(&s.index).apply(prepared);
            done.fetch_add(batch.len(), Ordering::SeqCst);
        }
        running.store(false, Ordering::SeqCst);
        cancelled
    });
    let d = done.load(Ordering::SeqCst);
    if cancelled {
        s.emit(CoreEvent::IndexProgress { done: d, total, state: ProgressState::Cancelled });
    } else {
        s.emit(CoreEvent::IndexProgress { done: total, total, state: ProgressState::Done });
    }
}

/// Architecture §5.4: for each reported path, exists → re-index, gone → remove; event kinds are never
/// trusted, and a folder is reconciled both ways. Emits `VaultChanged` with the note paths that changed.
fn apply_paths(s: &Shared, paths: Vec<String>) {
    let paths: BTreeSet<String> = paths.into_iter().map(|p| nfc(p.trim_matches('/'))).filter(|p| !p.is_empty()).collect();
    let mut changed: BTreeSet<String> = BTreeSet::new();
    if paths.iter().any(|p| p.starts_with(".tegg/")) {
        s.load_default_type();
        // FR-TYP-01 AC-6, FR-TYP-09 AC-9: type-file changes are reported like note changes; notes aren't reindexed.
        let types: Vec<&String> = paths.iter().filter(|p| p.starts_with(".tegg/types")).collect();
        if !types.is_empty() {
            s.refresh_types();
            changed.extend(types.into_iter().cloned());
        }
    }
    let mut read: Vec<String> = Vec::new();
    let mut folders: Vec<String> = Vec::new();
    let known: HashMap<String, (i128, u64)> = match lock(&s.index).versions() {
        Ok(v) => v.into_iter().map(|(p, m, z)| (p, (m, z))).collect(),
        Err(_) => HashMap::new(),
    };
    for p in &paths {
        if p.split('/').any(|c| c.starts_with('.')) && !is_indexable(p) {
            continue; // temp files, `.trash/`, `.tegg/`, `.obsidian/` (FR-SYN-02 AC-2, D-102)
        }
        if is_indexable(p) {
            if s.vault.is_placeholder(p) {
                continue;
            }
            match s.vault.stat(p) {
                Ok(Some(v)) => {
                    if known.get(p) != Some(&v) {
                        read.push(p.clone());
                    }
                }
                Ok(None) => {
                    if known.contains_key(p) {
                        let _ = lock(&s.index).remove(p);
                        changed.insert(p.clone());
                    }
                }
                Err(_) => folders.push(p.clone()),
            }
        } else if !p.ends_with(".md") && s.vault.stat(p).is_err() {
            folders.push(p.clone()); // a folder (created, renamed or removed with its notes)
        } else if !p.ends_with(".md") && matches!(s.vault.stat(p), Ok(None)) && known.keys().any(|k| k.starts_with(&format!("{p}/"))) {
            folders.push(p.clone()); // a folder that is gone
        }
    }
    if !folders.is_empty() {
        let files = s.vault.list_files().unwrap_or_default();
        for f in &folders {
            let prefix = format!("{f}/");
            for p in files.iter().filter(|p| p.starts_with(&prefix) && is_indexable(p) && !s.vault.is_placeholder(p)) {
                if let Ok(Some(v)) = s.vault.stat(p) {
                    if known.get(p) != Some(&v) {
                        read.push(p.clone());
                    }
                }
            }
            let present: BTreeSet<&String> = files.iter().collect();
            let gone: Vec<String> = known.keys().filter(|k| k.starts_with(&prefix) && !present.contains(k)).cloned().collect();
            let mut idx = lock(&s.index);
            for g in gone {
                let _ = idx.remove(&g);
                changed.insert(g);
            }
        }
    }
    read.sort();
    read.dedup();
    for batch in read.chunks(BATCH) {
        let prepared = read_batch(s, batch);
        changed.extend(prepared.iter().map(|p| p.path().to_string()));
        let _ = lock(&s.index).apply(prepared);
    }
    if !changed.is_empty() {
        s.emit(CoreEvent::VaultChanged { paths: changed.into_iter().collect() });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// MS3 slice 3A (docs/contracts/ms3-shell.md §2, §10: `vault_types`, `index_type_counts`, `index_list`).

/// 3A's type definition, now the full 3D `TypeInfo` (ms3-shell §14.2.1, §14.10 item 5).
pub type TypeDef = TypeInfo;

impl Core {
    /// `index_type_counts`: objects per matched type key (FR-TYP-13, D-239); untyped files and `type` values that
    /// aren't one type as `page` (D-103); templates and `.trash/` are not indexed (FR-TPL-07, D-102); types without
    /// objects absent. A key without a definition (D-121) is listed under its most frequent raw spelling (ties by
    /// code point), as D-185 does for tags.
    pub fn type_counts(&self) -> std::collections::BTreeMap<String, usize> {
        let defined: BTreeSet<String> = self.shared.read_types().into_iter().map(|t| t.key).collect();
        let mut by_key: std::collections::BTreeMap<String, (usize, std::collections::BTreeMap<String, usize>)> = Default::default();
        for o in self.index().objects() {
            let e = by_key.entry(o.r#type.clone()).or_default();
            e.0 += 1;
            if let Some(raw) = o.type_raw {
                *e.1.entry(raw).or_default() += 1;
            }
        }
        by_key
            .into_iter()
            .map(|(key, (n, spellings))| {
                if defined.contains(&key) {
                    return (key, n);
                }
                let best = spellings.iter().fold(None::<(&String, usize)>, |b, (s, c)| match b {
                    Some((_, bc)) if bc >= *c => b,
                    _ => Some((s, *c)),
                });
                (best.map(|b| b.0.clone()).unwrap_or(key), n)
            })
            .collect()
    }

    /// `index_list`: the objects of one type (matched key, FR-TYP-13), same exclusions as `type_counts`, unsorted.
    pub fn list_type(&self, r#type: &str) -> Vec<ObjectInfo> {
        let want = tegg_format::type_key(r#type);
        self.index().objects().into_iter().filter(|o| o.r#type == want).collect()
    }

    /// `nav_opened`: records a note shown in the centre pane as opened, for switcher recency (D-105) and the
    /// launch landing (D-132, D-138). Machine-local; never writes to the vault.
    pub fn record_open(&self, path: &str, now: SystemTime) {
        let path = nfc(path);
        let ms = now.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        {
            let mut rec = lock(&self.shared.recency);
            rec.0.insert(path.clone(), ms);
            rec.1 = true;
        }
        let id = self.index().object(&path).and_then(|o| o.id);
        let last = serde_json::json!({ "path": path, "id": id });
        let _ = tegg_vault::write_local_file(&self.shared.vault.local_dir().join(LAST_FILE), last.to_string().as_bytes());
    }

    /// `vault_last`: the last opened note by path if it is still indexed, else the object with the same `id`
    /// (external rename); `None` when neither exists or it was moved to `.trash/` (D-132). Never writes.
    pub fn last_opened(&self) -> Option<(String, Option<String>)> {
        let bytes = tegg_vault::read_local_file(&self.shared.vault.local_dir().join(LAST_FILE))?;
        let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        let path = nfc(v.get("path")?.as_str()?);
        let id = v.get("id").and_then(|i| i.as_str()).map(str::to_string);
        // D-349: a daily route, virtual or not, reopens as that route.
        if path.strip_prefix("daily/").and_then(tegg_format::date::parse_date).is_some() {
            return Some((path, None));
        }
        let index = self.index();
        if let Some(o) = index.object(&path) {
            return Some((o.path, o.id));
        }
        let id = id?;
        index.objects().into_iter().find(|o| o.id.as_deref() == Some(id.as_str())).map(|o| (o.path, o.id))
    }
}

const LAST_FILE: &str = "last-opened.json";

// ---------------------------------------------------------------------------------------------------------------
// MS3 slice 3B (docs/contracts/ms3-shell.md §11.1: `link_resolve` → `Core::resolve_links`).

/// What a link target resolved to (ms3-shell §11.1 `LinkTargetDto.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Note,
    Daily,
    DateMissing,
    Unresolved,
}

/// One resolved link target (ms3-shell §11.1, fields as `LinkTargetDto`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkTarget {
    pub target: String,
    pub kind: LinkKind,
    pub path: Option<String>,
    pub title: Option<String>,
    pub r#type: Option<String>,
}

impl Core {
    /// `link_resolve`: resolves every target of one note in one call, by the rules of ms3-shell §11.1 (dialect §6,
    /// FR-LNK-14, D-141, D-142, D-155, D-162). Read-only, records no recency.
    pub fn resolve_links(&self, from: &str, targets: &[String]) -> Vec<LinkTarget> {
        let objs = self.objects();
        Resolver::new(&objs, &self.shared).resolve(from, targets)
    }
}

/// The link lookup tables of `resolve_links`, built once so a type page resolves every row in one pass (D-233).
pub(crate) struct Resolver<'a> {
    objs: &'a [ObjectInfo],
    shared: &'a Shared,
    by_path: HashMap<String, usize>,
    by_id: HashMap<&'a str, usize>,
    by_stem: HashMap<String, Vec<usize>>,
}

impl<'a> Resolver<'a> {
    pub(crate) fn new(objs: &'a [ObjectInfo], shared: &'a Shared) -> Resolver<'a> {
        let mut by_path: HashMap<String, usize> = HashMap::new();
        let mut by_id: HashMap<&str, usize> = HashMap::new();
        let mut by_stem: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, o) in objs.iter().enumerate() {
            let p = nfc(&o.path).to_lowercase();
            let key = p.strip_suffix(".md").unwrap_or(&p).to_string();
            let stem = key.rsplit('/').next().unwrap_or(&key).to_string();
            by_path.insert(key, i);
            if let Some(id) = &o.id {
                by_id.insert(id.as_str(), i);
            }
            by_stem.entry(stem).or_default().push(i);
        }
        Resolver { objs, shared, by_path, by_id, by_stem }
    }

    pub(crate) fn resolve(&self, from: &str, targets: &[String]) -> Vec<LinkTarget> {
        let objs = self.objs;
        let (by_path, by_id, by_stem) = (&self.by_path, &self.by_id, &self.by_stem);
        if targets.is_empty() {
            return Vec::new();
        }
        let from = nfc(from);
        let from_dir = from.rsplit_once('/').map(|(d, _)| d.to_lowercase()).unwrap_or_default();
        let found = |target: &str, i: usize, kind: LinkKind| LinkTarget {
            target: target.to_string(),
            kind,
            path: Some(objs[i].path.clone()),
            title: Some(objs[i].title.clone()),
            r#type: Some(objs[i].r#type.clone()),
        };
        let none = |target: &str, kind: LinkKind| LinkTarget { target: target.to_string(), kind, path: None, title: None, r#type: None };
        targets
            .iter()
            .map(|target| {
                let mut t = nfc(target.trim());
                if let Some(i) = t.find('|') {
                    t.truncate(i);
                }
                if let Some(i) = t.find('#') {
                    t.truncate(i);
                }
                let t = t.trim().to_string();
                // D-162: a date is a Daily Note link first.
                if t.len() == 10 {
                    if let Ok(date) = NaiveDate::parse_from_str(&t, "%Y-%m-%d") {
                        return match lock(&self.shared.index).daily_note(date).and_then(|p| objs.iter().position(|o| o.path == p)) {
                            Some(i) => found(target, i, LinkKind::Daily),
                            None => none(target, LinkKind::DateMissing),
                        };
                    }
                }
                let lower = t.to_lowercase();
                let key = lower.strip_suffix(".md").unwrap_or(&lower);
                // D-155: relative to the linking note's folder first.
                if !from_dir.is_empty() {
                    if let Some(&i) = by_path.get(&format!("{from_dir}/{key}")) {
                        return found(target, i, LinkKind::Note);
                    }
                }
                if let Some(&i) = by_path.get(key) {
                    return found(target, i, LinkKind::Note);
                }
                if let Some(&i) = by_id.get(t.as_str()) {
                    return found(target, i, LinkKind::Note);
                }
                if !key.contains('/') {
                    if let Some(c) = by_stem.get(key) {
                        let folder = |i: usize| objs[i].path.rsplit_once('/').map(|(d, _)| nfc(d).to_lowercase()).unwrap_or_default();
                        let best = c.iter().copied().find(|&i| folder(i) == from_dir).or_else(|| {
                            c.iter().copied().min_by(|&a, &b| {
                                (objs[a].path.chars().count(), &objs[a].path).cmp(&(objs[b].path.chars().count(), &objs[b].path))
                            })
                        });
                        if let Some(i) = best {
                            return found(target, i, LinkKind::Note);
                        }
                    }
                }
                none(target, LinkKind::Unresolved)
            })
            .collect()
    }
}

// ------------------------------------------------------------------------------------------------ slice 3D
// docs/contracts/ms3-shell.md §14.2: types and attributes (`types3d.rs`).
mod types3d;
pub use types3d::{StarterPlan, StarterSkip, TypeInfo, TypeRow, TypeUsage};

// ------------------------------------------------------------------------------------------------ slice 4A
// docs/contracts/ms4-links.md §3: backlinks panel, broken links, duplicate titles, create from a link (`links4a.rs`).
mod links4a;
mod jobs4c;
pub use links4a::{
    BacklinkEntry, BacklinkGroup, BacklinksPanel, BrokenGroup, BrokenLinks, CreateRefusal, DuplicateGroup,
    DuplicateObject, LinkCreatePlan, LinkCreated, Occurrence, OccurrenceKind,
};
pub use tegg_format::excerpt::{At, Excerpt, LinkTargetInfo, Mark, RSeg, TargetKind};

// ------------------------------------------------------------------------------------------------ slice 4B
// docs/contracts/ms4-daily.md §3: Daily Notes (`daily.rs`).
pub mod daily;

// MS4 slice 4F (docs/contracts/ms4-embeds.md §4).
mod embeds4f;
pub use embeds4f::{EmbedLoadState, EmbedNote};
pub use daily::{ContextRow, DailyContext, DailyContextPage, DailyCreated, DailyDraft, DailyView, DayWindow};

// ------------------------------------------------------------------------------------------------ slice 5A-1
// docs/contracts/ms5-tasks.md §2: the task query and the Daily Note's Tasks due (`tasks5a.rs`).
mod tasks5a;
pub use tasks5a::{DailyTaskRows, StatusOption, TaskDefs, TaskRow, TaskState};

// ------------------------------------------------------------------------------------------------ slice 5B
// docs/contracts/ms5-capture.md §3.3, §5.1, §7.1: capture, vault settings and the Inbox query.
mod capture5b;
mod inbox5b;
mod settings5b;
pub use inbox5b::InboxRow;
pub use settings5b::{DefaultTypeSetting, VaultKey, VaultSettings};
