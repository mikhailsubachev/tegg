//! The job engine (ms4-jobs §1–§9): one job thread per vault runs a FIFO queue (D-393); each job is
//! plan → (confirm) → (backup) → write → report. Note rename is the only client in 4C.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use tegg_format::{extract, nfc, sanitize_file_stem};

#[path = "tagjobs.rs"]
mod tagjobs;
#[path = "movejobs.rs"]
mod movejobs;
#[path = "deletejobs.rs"]
mod deletejobs;

use crate::host::{Host, PinPatch, QueryPatch, QueryRenamePlan, ReadError, WriteError, Wrote, PINS_PATH};
use crate::{
    InboxJobChange,
    Counts, FileVersion, Interrupted, JobError, JobId, JobKind, JobOp, JobPlan, JobPoint,
    JobProgress, JobReport, Phase, PlanCounts, PlannedFile, PointHook, ResolveChoice, RetryOutcome,
    SkipReason, Skipped, TextOp, TransformError, Transformed, Transformer,
};

/// How long a `job:transform` request may wait for the UI's worker (§2.2).
const TRANSFORM_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a live (open in an editor) file may wait for the editor's save (§9, D-386).
const LIVE_TIMEOUT: Duration = Duration::from_secs(30);
/// Progress is re-sent at least this often while a job runs (FR-UX-07 AC-8: at least every 500 ms).
const HEARTBEAT: Duration = Duration::from_millis(200);
/// Backups kept per vault (D-57, data-safety AC-3).
const KEEP_BACKUPS: usize = 10;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn stem_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name).to_string()
}
fn folder_of(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_default()
}
fn join(folder: &str, stem: &str) -> String {
    if folder.is_empty() {
        format!("{stem}.md")
    } else {
        format!("{folder}/{stem}.md")
    }
}
fn key(s: &str) -> String {
    nfc(s.trim()).to_lowercase()
}

/// One file a job wrote: what it was before and after, for undo and redo (§7).
#[derive(Debug, Clone)]
struct Written {
    /// Path before and after the job (different only for the renamed note).
    before: String,
    after: String,
    pre: Vec<u8>,
    pre_v: FileVersion,
    post: Vec<u8>,
    post_v: FileVersion,
    /// Written through its editor (D-386): undo and redo apply the link op to its current text, never bytes.
    via_op: bool,
    /// A type change written in place, never through an editor (QA 4E-1 M1): undo and redo write its bytes the same way
    /// (QA 4 M1′); the link op holds no type change. An open page takes them as an external change (FR-SYN-03).
    direct: bool,
    /// A type delete's trash move (§14.9.4): the trashed path; undo moves it back to `before`, redo trashes again.
    trashed: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct UndoRecord {
    files: Vec<Written>,
    /// D-840: undoing this job exempts its notes from later tidy runs (a tidy job; not a folder save).
    exempt: bool,
    /// The final forward retarget op: notes open in an editor are undone and redone through it (D-386).
    op: Option<TextOp>,
    /// `op` reversed, built once when the job ends and shared by every file of an undo (QA 4E-1 5 P1).
    rev: Option<TextOp>,
}

struct JobState {
    kind: JobKind,
    phase: Phase,
    plan: Option<JobPlan>,
    report: Option<JobReport>,
    cancel: bool,
    undo: Option<UndoRecord>,
    /// An undo of this rename has run (and no redo since): its rows can't be retried (D-433).
    undone: bool,
    /// The user confirmed the plan (kinds with `needs_confirm`, ms4-tags §4.4).
    confirmed: bool,
    progress: JobProgress,
}

#[derive(Default)]
struct State {
    next: JobId,
    jobs: HashMap<JobId, JobState>,
    queue: VecDeque<(JobId, JobOp, Option<String>)>,
    last_undoable: Option<JobId>,
    running: bool,
}

pub(crate) struct Inner {
    host: Option<Arc<dyn Host>>,
    state: Mutex<State>,
    changed: Condvar,
    transformer: Mutex<Option<Arc<dyn Transformer>>>,
    /// QA 4 N5: the normalised names of the running relink's lists, built once per list.
    slim: Mutex<Option<Arc<SlimIndex>>>,
    hook: Mutex<Option<PointHook>>,
    editors: Mutex<HashSet<String>>,
    replies: Mutex<HashMap<u64, Result<Transformed, TransformError>>>,
    replied: Condvar,
    next_request: Mutex<u64>,
    stop: AtomicBool,
    /// D-819: the UI's worker answers `job:transform`.
    ui_ready: AtomicBool,
}

/// The job engine of one open vault. Owned by `tegg_core::Core` (`Core::jobs()`).
pub struct Jobs {
    inner: Arc<Inner>,
}

impl Default for Jobs {
    fn default() -> Self {
        Jobs::new()
    }
}

impl Drop for Jobs {
    fn drop(&mut self) {
        self.inner.stop.store(true, Ordering::SeqCst);
        self.inner.changed.notify_all();
    }
}

impl Jobs {
    /// An engine without a vault: every job fails (`NotImplemented`). The core builds its engine with `with_host`.
    pub fn new() -> Jobs {
        Jobs::make(None)
    }

    pub fn with_host(host: Arc<dyn Host>) -> Jobs {
        // Ids are never reused while a journal of an earlier run is on disk (D-387).
        let first = crate::journal::max_id(host.as_ref()) + 1;
        let j = Jobs::make(Some(host));
        lock(&j.inner.state).next = first;
        j
    }

    fn make(host: Option<Arc<dyn Host>>) -> Jobs {
        Jobs {
            inner: Arc::new(Inner {
                host,
                state: Mutex::new(State {
                    next: 1,
                    ..State::default()
                }),
                changed: Condvar::new(),
                transformer: Mutex::new(None),
                slim: Mutex::new(None),
                hook: Mutex::new(None),
                editors: Mutex::new(HashSet::new()),
                replies: Mutex::new(HashMap::new()),
                replied: Condvar::new(),
                next_request: Mutex::new(1),
                stop: AtomicBool::new(false),
                ui_ready: AtomicBool::new(false),
            }),
        }
    }

    pub fn set_transformer(&self, t: Arc<dyn Transformer>) {
        *lock(&self.inner.transformer) = Some(t);
    }

    /// Queued; planning starts when the FIFO queue reaches it (D-393).
    pub fn start(&self, op: JobOp) -> Result<JobId, JobError> {
        self.enqueue(op, None)
    }

    /// The IPC path: `from_title` is the title when the edit started (D-394); `JobOp::NoteRename` uses the stored title.
    pub fn start_note_rename(
        &self,
        path: &str,
        title: &str,
        from_title: &str,
    ) -> Result<JobId, JobError> {
        self.enqueue(
            JobOp::NoteRename {
                path: path.into(),
                title: title.into(),
            },
            Some(from_title.to_string()),
        )
    }

    fn enqueue(&self, op: JobOp, from_title: Option<String>) -> Result<JobId, JobError> {
        enqueue_in(&self.inner, op, from_title)
    }

    /// D-819: a handle for the core's tidy scheduler; it never keeps the engine alive.
    pub fn handle(&self) -> JobsRef {
        JobsRef(Arc::downgrade(&self.inner))
    }

    /// D-819: the app's UI worker answers `job:transform` from now on (the tests set a transformer instead).
    pub fn set_ui_ready(&self) {
        self.inner.ui_ready.store(true, Ordering::SeqCst);
        self.inner.changed.notify_all();
    }

    /// Whether a job can transform text now: a transformer is set or the UI's worker is ready (D-819).
    pub fn transformer_ready(&self) -> bool {
        self.inner.ready()
    }

    pub fn plan(&self, job: JobId) -> Option<JobPlan> {
        lock(&self.inner.state)
            .jobs
            .get(&job)
            .and_then(|j| j.plan.clone())
    }

    /// Kinds with `needs_confirm` wait in `confirm` for this (ms4-tags §4.4); `Busy` before they get there.
    pub fn confirm(&self, job: JobId) -> Result<(), JobError> {
        let mut s = lock(&self.inner.state);
        let j = s.jobs.get_mut(&job).ok_or(JobError::NotFound)?;
        if !j.kind.flags().needs_confirm {
            return Err(JobError::NotImplemented);
        }
        if j.phase != Phase::Confirm {
            return Err(JobError::Busy);
        }
        j.confirmed = true;
        drop(s);
        self.inner.changed.notify_all();
        Ok(())
    }

    /// `NotCancellable` outside the kind's cancellable phases.
    pub fn cancel(&self, job: JobId) -> Result<(), JobError> {
        let mut s = lock(&self.inner.state);
        let j = s.jobs.get_mut(&job).ok_or(JobError::NotFound)?;
        if j.phase == Phase::Queued || j.kind.flags().cancellable.contains(&j.phase) {
            j.cancel = true;
            drop(s);
            self.inner.changed.notify_all();
            Ok(())
        } else {
            Err(JobError::NotCancellable)
        }
    }

    pub fn wait(&self, job: JobId, timeout: Duration) -> Option<JobReport> {
        let end = Instant::now() + timeout;
        let mut s = lock(&self.inner.state);
        loop {
            match s.jobs.get(&job) {
                None => return None,
                Some(j) if j.report.is_some() => return j.report.clone(),
                _ => {}
            }
            let left = end.checked_duration_since(Instant::now())?;
            s = self
                .inner
                .changed
                .wait_timeout(s, left.min(Duration::from_millis(100)))
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
    }

    pub fn report(&self, job: JobId) -> Option<JobReport> {
        lock(&self.inner.state)
            .jobs
            .get(&job)
            .and_then(|j| j.report.clone())
    }

    /// Re-reads the file's current bytes and version and transforms them (D-398); never uses the job's old base.
    pub fn retry(&self, job: JobId, path: &str) -> Result<RetryOutcome, JobError> {
        let host = self.inner.host.clone().ok_or(JobError::NotImplemented)?;
        let path = nfc(path);
        let ops = {
            let s = lock(&self.inner.state);
            let j = s.jobs.get(&job).ok_or(JobError::NotFound)?;
            let plan = j.plan.as_ref().ok_or(JobError::NotFound)?;
            // D-433: only a row the job skipped, of a job not undone since, whose note is still where it moved.
            let skipped = j.report.as_ref().is_some_and(|r| r.skipped.iter().any(|k| nfc(&k.path) == path));
            if !skipped {
                return Err(JobError::NotFound);
            }
            if j.undone || plan.renames.iter().any(|(_, to)| host.version(to).is_none()) {
                return Ok(RetryOutcome::Skipped(SkipReason::Changed));
            }
            // The renamed note itself is never retried in place: that would give the old file the new title and a
            // self-link to a name that doesn't exist (PR #45 review). Its row is answered "changed".
            if plan.renames.iter().any(|(a, b)| nfc(a) == path || nfc(b) == path) {
                return Ok(RetryOutcome::Skipped(SkipReason::Changed));
            }
            plan.files
                .iter()
                .find(|f| nfc(&f.path) == path)
                .map(|f| f.ops.clone())
                .ok_or(JobError::NotFound)?
        };
        if host.is_placeholder(&path) {
            return Ok(RetryOutcome::Skipped(SkipReason::Placeholder));
        }
        let (bytes, v) = match host.read(&path) {
            Ok(x) => x,
            Err(e) => return Ok(RetryOutcome::Skipped(read_reason(&e))),
        };
        if std::str::from_utf8(&bytes).is_err() {
            return Ok(RetryOutcome::Skipped(SkipReason::ReadOnly));
        }
        let out = match self.inner.transform(&path, &bytes, &ops) {
            Ok(Transformed::Bytes(b, _)) => b,
            Ok(Transformed::Unchanged) => return Ok(RetryOutcome::Unchanged),
            Err(_) => return Ok(RetryOutcome::Skipped(SkipReason::Io)),
        };
        let r = match host.write(&path, &out, &v) {
            Ok(Wrote::Written(_)) => RetryOutcome::Written,
            Ok(Wrote::Unchanged) => RetryOutcome::Unchanged,
            Err(e) => RetryOutcome::Skipped(write_reason(&e)),
        };
        if r == RetryOutcome::Written {
            let mut s = lock(&self.inner.state);
            if let Some(rep) = s.jobs.get_mut(&job).and_then(|j| j.report.as_mut()) {
                rep.skipped.retain(|k| nfc(&k.path) != path);
                rep.written.push(path);
            }
        }
        Ok(r)
    }

    /// ms4-tags §5.2 (D-733): the open vault's zips, newest first, with their manifest labels.
    pub fn backups(&self) -> Vec<crate::BackupInfo> {
        match &self.inner.host {
            Some(h) => tagjobs::backups(h.as_ref()),
            None => Vec::new(),
        }
    }

    /// The open vault's backup folder (`<Application Support>/Tegg/backups/<vault key>`).
    pub fn backup_dir(&self) -> Option<PathBuf> {
        self.inner.host.as_ref().map(|h| h.app_dir().join("backups").join(h.vault_key()))
    }

    pub fn last_undoable(&self) -> Option<JobId> {
        lock(&self.inner.state).last_undoable
    }

    pub fn interrupted(&self) -> Vec<Interrupted> {
        match &self.inner.host {
            Some(h) => crate::journal::interrupted(h.as_ref()),
            None => Vec::new(),
        }
    }

    pub fn resolve_interrupted(
        &self,
        job: JobId,
        choice: ResolveChoice,
    ) -> Result<JobId, JobError> {
        let host = self.inner.host.clone().ok_or(JobError::NotImplemented)?;
        crate::journal::resolve(host.as_ref(), &InnerTransformer(&self.inner), job, choice)?;
        Ok(job)
    }

    /// §9 (D-386): the UI has `path` open in an editor; the job sends its transformation there instead of writing.
    pub fn editor_open(&self, path: &str) {
        lock(&self.inner.editors).insert(nfc(path));
    }
    pub fn editor_close(&self, path: &str) {
        lock(&self.inner.editors).remove(&nfc(path));
        self.inner.changed.notify_all();
    }

    /// Answer to a `JobTransform` event that isn't `live` (`job_transform_result`).
    pub fn transform_result(&self, request: u64, result: Result<Transformed, TransformError>) {
        lock(&self.inner.replies).insert(request, result);
        self.inner.replied.notify_all();
    }

    /// Test-only (L4 sync simulator): called at every [`JobPoint`] of every job, on the job's thread.
    #[doc(hidden)]
    pub fn set_point_hook(&self, hook: Option<PointHook>) {
        *lock(&self.inner.hook) = hook;
    }
}

fn enqueue_in(inner: &Arc<Inner>, op: JobOp, from_title: Option<String>) -> Result<JobId, JobError> {
        let host = inner.host.clone().ok_or(JobError::NotImplemented)?;
        let kind = match &op {
            JobOp::NoteRename { path, .. } => {
                let p = nfc(path);
                if p.starts_with("_templates/") || p.starts_with(".trash/") || !host.renamable(&p) {
                    return Err(JobError::NotRenamable);
                }
                JobKind::NoteRename
            }
            JobOp::Undo { job } | JobOp::Redo { job } => {
                let s = lock(&inner.state);
                match s.jobs.get(job) {
                    Some(j) if j.undo.is_some() => j.kind,
                    _ => return Err(JobError::NotFound),
                }
            }
            JobOp::TypeMove { paths, to_type, .. } => movejobs::check_type_move(host.as_ref(), paths, to_type)?,
            JobOp::FolderMove { .. } => JobKind::FolderMove,
            JobOp::ValueRemove { r#type, key } => deletejobs::check_value_remove(host.as_ref(), r#type, key)?,
            JobOp::TypeDelete { r#type } => deletejobs::check_type_delete(host.as_ref(), r#type)?,
            JobOp::TestBackup { .. } => JobKind::TestBackup,
            JobOp::Inbox { .. } => JobKind::Inbox,
            JobOp::TagRename { from, to } => tagjobs::check_rename(host.as_ref(), from, to)?,
            JobOp::TagDelete { tag, .. } => tagjobs::check_delete(host.as_ref(), tag)?,
            JobOp::Merge { keep, others } => tagjobs::check_merge(host.as_ref(), keep, others)?,
            JobOp::Restore { name } => tagjobs::check_restore(host.as_ref(), name)?,
            // v1-queries §1.8: every refusal before the job (FR-SYN-03 AC-29).
            JobOp::QueryRename { name, title } => {
                host.query_rename_plan(name, title)?;
                JobKind::QueryRename
            }
            _ => return Err(JobError::NotImplemented),
        };
        let mut s = lock(&inner.state);
        let id = s.next;
        s.next += 1;
        let progress = JobProgress {
            job: id,
            kind,
            phase: Phase::Queued,
            done: 0,
            total: 0,
            counts: None,
        };
        s.jobs.insert(
            id,
            JobState {
                kind,
                phase: Phase::Queued,
                plan: None,
                report: None,
                cancel: false,
                undo: None,
                undone: false,
                confirmed: false,
                progress,
            },
        );
        s.queue.push_back((id, op, from_title));
        if !s.running {
            s.running = true;
            let weak = Arc::downgrade(&inner);
            std::thread::Builder::new()
                .name("tegg-jobs".into())
                .spawn(move || worker(weak))
                .map_err(|e| JobError::Core(e.to_string()))?;
        }
        inner.changed.notify_all();
        Ok(id)
    }

/// D-819: a weak handle on a vault's engine (the core's tidy scheduler starts jobs through it).
#[derive(Clone)]
pub struct JobsRef(Weak<Inner>);

impl JobsRef {
    pub fn start(&self, op: JobOp) -> Result<JobId, JobError> {
        let inner = self.0.upgrade().ok_or(JobError::NotFound)?;
        enqueue_in(&inner, op, None)
    }
    pub fn wait(&self, job: JobId, timeout: Duration) -> Option<JobReport> {
        let inner = self.0.upgrade()?;
        let end = Instant::now() + timeout;
        let mut s = lock(&inner.state);
        loop {
            if let Some(r) = s.jobs.get(&job).and_then(|j| j.report.clone()) {
                return Some(r);
            }
            let left = end.checked_duration_since(Instant::now())?;
            s = inner.changed.wait_timeout(s, left.min(Duration::from_millis(100))).unwrap_or_else(|p| p.into_inner()).0;
        }
    }
    /// The engine still exists and can transform text.
    pub fn ready(&self) -> bool {
        self.0.upgrade().is_some_and(|i| i.ready())
    }
    pub fn alive(&self) -> bool {
        self.0.strong_count() > 0
    }
    /// A job is queued or running.
    pub fn busy(&self) -> bool {
        self.0.upgrade().is_some_and(|i| {
            let s = lock(&i.state);
            !s.queue.is_empty() || s.jobs.values().any(|j| !j.phase.is_final())
        })
    }
}

fn read_reason(e: &ReadError) -> SkipReason {
    match e {
        ReadError::Missing => SkipReason::Missing,
        ReadError::Placeholder => SkipReason::Placeholder,
        ReadError::Io(_) => SkipReason::Io,
    }
}
fn write_reason(e: &WriteError) -> SkipReason {
    match e {
        WriteError::Changed | WriteError::NameTaken => SkipReason::Changed,
        WriteError::Missing => SkipReason::Missing,
        WriteError::Placeholder => SkipReason::Placeholder,
        WriteError::Io(_) => SkipReason::Io,
    }
}

// ------------------------------------------------------------------------------------------------ the job thread

fn worker(weak: Weak<Inner>) {
    loop {
        let Some(inner) = weak.upgrade() else { return };
        let next = {
            let mut s = lock(&inner.state);
            loop {
                if inner.stop.load(Ordering::SeqCst) {
                    s.running = false;
                    return;
                }
                if let Some(n) = s.queue.pop_front() {
                    break Some(n);
                }
                let (g, t) = inner
                    .changed
                    .wait_timeout(s, Duration::from_millis(250))
                    .unwrap_or_else(|p| p.into_inner());
                s = g;
                if t.timed_out() && Arc::weak_count(&inner) == 0 {
                    s.running = false;
                    return;
                }
                if t.timed_out() {
                    break None;
                }
            }
        };
        if let Some((id, op, from_title)) = next {
            inner.run(id, op, from_title);
        }
    }
}

/// What a running job tracks while it writes.
struct Run {
    id: JobId,
    kind: JobKind,
    written: Vec<String>,
    unchanged: Vec<String>,
    skipped: Vec<Skipped>,
    renamed: Option<(String, String)>,
    undo: UndoRecord,
    /// ms4-tags §5.1: the backup zip and what the job really moved, for the manifest's `done`.
    zip: Option<(PathBuf, serde_json::Value)>,
    moved: tagjobs::Moved,
    /// §14.9.2: the type file of a `value-remove` and its version at planning (its write's base, last).
    type_base: Option<(String, FileVersion)>,
    /// §14.9.3 (D-815): a type delete skipped an object, so the definition and templates stayed.
    kept_type: bool,
    /// v1-queries §1.8: the `query-rename` plan's query file (before and after).
    query: Option<QueryRenamePlan>,
}

impl Run {
    /// The pins file's row (v1-pinned §1.6) is listed in the report but not counted (FR-UX-07 AC-8).
    fn counts(&self) -> Counts {
        Counts {
            written: self.written.iter().filter(|p| !self.side_row(p)).count(),
            unchanged: self.unchanged.len(),
            skipped: self.skipped.iter().filter(|s| !self.side_row(&s.path)).count(),
        }
    }
    /// The pins file's row and the query files' link patch rows (v1-queries §1.8) are listed but not counted; a
    /// `query-rename`'s own file counts.
    fn side_row(&self, p: &str) -> bool {
        p == PINS_PATH || (self.kind != JobKind::QueryRename && p.starts_with(".tegg/queries/"))
    }
    fn skip(&mut self, path: &str, reason: SkipReason) {
        self.skipped.push(Skipped {
            path: path.to_string(),
            reason,
        });
    }
}

impl Inner {
    fn host(&self) -> &Arc<dyn Host> {
        self.host.as_ref().expect("a job runs only with a host")
    }

    fn ready(&self) -> bool {
        self.ui_ready.load(Ordering::SeqCst) || lock(&self.transformer).is_some()
    }

    fn point(&self, id: JobId, p: JobPoint) {
        let hook = lock(&self.hook).clone();
        if let Some(h) = hook {
            h(id, &p);
        }
    }

    fn set_phase(&self, id: JobId, phase: Phase, done: usize, total: usize) {
        let p = {
            let mut s = lock(&self.state);
            let Some(j) = s.jobs.get_mut(&id) else { return };
            j.phase = phase;
            j.progress.phase = phase;
            j.progress.done = j.progress.done.max(done);
            j.progress.total = total;
            j.progress.clone()
        };
        self.host().progress(p);
        self.changed.notify_all();
    }

    fn step(&self, id: JobId, done: usize) {
        let mut s = lock(&self.state);
        if let Some(j) = s.jobs.get_mut(&id) {
            j.progress.done = j.progress.done.max(done);
        }
    }

    fn cancelled(&self, id: JobId) -> bool {
        lock(&self.state).jobs.get(&id).is_some_and(|j| j.cancel)
    }

    fn run(self: &Arc<Self>, id: JobId, op: JobOp, from_title: Option<String>) {
        let stop = Arc::new(AtomicBool::new(false));
        let beat = {
            let (me, stop) = (Arc::downgrade(self), stop.clone());
            std::thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    std::thread::park_timeout(HEARTBEAT); // woken by the job's end, so the report never waits a beat
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let Some(me) = me.upgrade() else { break };
                    let p = lock(&me.state).jobs.get(&id).map(|j| j.progress.clone());
                    if let Some(p) = p.filter(|p| !p.phase.is_final() && p.phase != Phase::Queued) {
                        me.host().progress(p);
                    }
                }
            })
        };
        let kind = lock(&self.state)
            .jobs
            .get(&id)
            .map(|j| j.kind)
            .unwrap_or(JobKind::NoteRename);
        let mut run = Run {
            id,
            kind,
            written: Vec::new(),
            unchanged: Vec::new(),
            skipped: Vec::new(),
            renamed: None,
            undo: UndoRecord::default(),
            zip: None,
            moved: tagjobs::Moved::default(),
            type_base: None,
            kept_type: false,
            query: None,
        };
        let result = self.execute(&mut run, &op, from_title);
        if result.is_ok() {
            self.finish_manifest(&run);
        }
        stop.store(true, Ordering::SeqCst);
        beat.thread().unpark();
        let _ = beat.join();
        let (phase, error) = match result {
            Ok(Phase::Cancelled) => (Phase::Cancelled, None),
            Ok(_) => (Phase::Done, None),
            Err(e) => (Phase::Failed, Some(e)),
        };
        let counts = run.counts();
        let report = JobReport {
            job: id,
            kind,
            phase,
            renamed: run.renamed.clone(),
            written: run.written.clone(),
            unchanged: run.unchanged.clone(),
            skipped: run.skipped.clone(),
            error,
            moved: run.moved.renames.iter().map(|(a, b, _)| (a.clone(), b.clone())).collect(),
            kept_type: run.kept_type,
        };
        // D-812: notes a folder move put back stay where they are at later tidy runs (written before the report is out).
        if let (Phase::Done, JobOp::Undo { job }) = (phase, &op) {
            let files = lock(&self.state).jobs.get(job).filter(|o| o.kind == JobKind::FolderMove).and_then(|o| o.undo.clone()).filter(|r| r.exempt).map(|r| r.files);
            if let Some(files) = files {
                self.exempt_undone(&files);
            }
        }
        let progress = {
            let mut s = lock(&self.state);
            // Every finished rename has an undo record, an empty one for a commit that wrote nothing (undo is then a
            // no-op); only one that wrote something is offered as `Undo rename`.
            if phase == Phase::Done {
                if let JobOp::Undo { job } | JobOp::Redo { job } = &op {
                    let undone = matches!(op, JobOp::Undo { .. });
                    if let Some(o) = s.jobs.get_mut(job) {
                        o.undone = undone;
                    }
                }
            }
            let undoable = phase == Phase::Done && matches!(op, JobOp::NoteRename { .. } | JobOp::TypeMove { .. } | JobOp::FolderMove { .. } | JobOp::ValueRemove { .. } | JobOp::TypeDelete { .. } | JobOp::QueryRename { .. });
            if undoable && !run.undo.files.is_empty() {
                s.last_undoable = Some(id);
            }
            let j = s.jobs.get_mut(&id).expect("job state");
            j.phase = phase;
            // QA 4E-1 6 F2: the slimming cache doesn't keep a finished job's lists alive.
            *lock(&self.slim) = None;
            if undoable {
                let mut u = run.undo.clone();
                u.rev = u.op.as_ref().map(reversed);
                j.undo = Some(u);
            }
            j.report = Some(report);
            let total = j
                .progress
                .total
                .max(counts.written + counts.unchanged + counts.skipped);
            j.progress = JobProgress {
                job: id,
                kind,
                phase,
                done: total,
                total,
                counts: Some(counts),
            };
            j.progress.clone()
        };
        crate::journal::finish(self.host().as_ref(), id);
        self.host().progress(progress);
        self.changed.notify_all();
    }

    /// Plan, back up, write. `Ok(Cancelled)` when cancelled before writing; `Err(message)` for a failed job.
    fn execute(
        &self,
        run: &mut Run,
        op: &JobOp,
        from_title: Option<String>,
    ) -> Result<Phase, String> {
        let id = run.id;
        self.set_phase(id, Phase::Planning, 0, 0);
        let plan = match op {
            JobOp::NoteRename { path, title } => self.plan_rename(id, path, title, from_title)?,
            JobOp::Undo { job } | JobOp::Redo { job } => {
                self.plan_undo(id, *job, matches!(op, JobOp::Undo { .. }))?
            }
            JobOp::TestBackup { paths } => JobPlan {
                job: id,
                kind: JobKind::TestBackup,
                files: Vec::new(),
                renames: Vec::new(),
                creates: Vec::new(),
                trashes: Vec::new(),
                counts: PlanCounts {
                    files: paths.len(),
                    links: 0,
                    ..Default::default()
                },
                warnings: Vec::new(),
            },
            JobOp::Inbox { paths, change } => self.plan_inbox(id, run, paths, change),
            JobOp::TagRename { from, to } => self.plan_tag_rename(id, from, to)?,
            JobOp::TagDelete { tag, .. } => self.plan_tag_delete(id, tag)?,
            JobOp::Merge { keep, others } => self.plan_merge(id, keep, others)?,
            JobOp::Restore { name } => self.plan_restore(id, name)?,
            JobOp::TypeMove { paths, to_type, mapping, review, .. } => self.plan_type_move(id, run, paths, to_type, mapping, *review),
            JobOp::FolderMove { r#type, to_folder } => self.plan_folder_move(id, run, r#type.as_deref(), to_folder.as_deref()),
            JobOp::ValueRemove { r#type, key } => self.plan_value_remove(id, run, r#type, key),
            JobOp::TypeDelete { r#type } => self.plan_type_delete(id, r#type),
            JobOp::QueryRename { name, title } => self.plan_query_rename(id, run, name, title)?,
            _ => return Err("NotImplemented".into()),
        };
        let mut plan = plan;
        // A folder move counts the notes it moves (`Moving <plural> · <done> of <n>`, R99); its linking notes follow.
        let total = if matches!(op, JobOp::FolderMove { .. }) { plan.renames.len() } else { plan.files.len() };
        if let Some(j) = lock(&self.state).jobs.get_mut(&id) {
            j.plan = Some(plan.clone());
            j.progress.total = total;
        }
        self.point(id, JobPoint::AfterPlanning);
        if self.cancelled(id) {
            return Ok(Phase::Cancelled);
        }
        let undo_op = matches!(op, JobOp::Undo { .. } | JobOp::Redo { .. });
        // D-811: a tidy run with nothing to move writes nothing, makes no zip and shows nothing after planning.
        if matches!(op, JobOp::FolderMove { r#type: None, .. }) && plan.files.is_empty() {
            return Ok(Phase::Done);
        }
        if run.kind.flags().needs_confirm && !undo_op {
            self.set_phase(id, Phase::Confirm, 0, total);
            loop {
                let s = lock(&self.state);
                match s.jobs.get(&id) {
                    Some(j) if j.cancel => return Ok(Phase::Cancelled),
                    Some(j) if j.confirmed => break,
                    None => return Ok(Phase::Cancelled),
                    _ => {}
                }
                if self.stop.load(Ordering::SeqCst) {
                    return Ok(Phase::Cancelled);
                }
                let _ = self.changed.wait_timeout(s, Duration::from_millis(100));
            }
        }
        // D-561: of the Inbox actions only a bulk convert makes a backup zip first.
        let inbox_backup = matches!(op, JobOp::Inbox { change: InboxJobChange::SetType { .. }, .. });
        // ms4-jobs §14.1: a bulk type move zips like a bulk convert; a folder move only when it moves something.
        let move_backup = match op {
            // D-837: every group of a bulk convert makes its zip, a group of one too.
            JobOp::TypeMove { paths, bulk, .. } => paths.len() > 1 || *bulk,
            JobOp::FolderMove { .. } => !plan.renames.is_empty(),
            // §14.9.2: a property no object has a value of changes only the type file, without a zip.
            JobOp::ValueRemove { .. } => !plan.files.is_empty(),
            _ => true,
        };
        let bulk_move = matches!(op, JobOp::TypeMove { paths, bulk, .. } if paths.len() > 1 || *bulk);
        if (run.kind.flags().backup || inbox_backup || bulk_move) && move_backup && !undo_op {
            self.point(id, JobPoint::BeforeBackup);
            if self.cancelled(id) {
                return Ok(Phase::Cancelled);
            }
            self.set_phase(id, Phase::Backup, 0, total);
            let (manifest, keep) = self.manifest_for(run, op, &plan);
            let zip = self.backup(run.kind, manifest.as_ref(), keep.as_deref())
                .map_err(|e| format!("BackupFailed: {e}"))?;
            if let Some(m) = manifest {
                run.zip = Some((zip, m));
            }
            if self.cancelled(id) {
                return Ok(Phase::Cancelled);
            }
        }
        self.set_phase(id, Phase::Writing, 0, total);
        match op {
            JobOp::NoteRename { .. } => self.write_rename(run, plan),
            JobOp::Undo { job } => self.write_undo(run, *job, true),
            JobOp::Redo { job } => self.write_undo(run, *job, false),
            JobOp::Inbox { .. } => {
                for (i, f) in plan.files.iter().enumerate() {
                    self.write_one(run, f);
                    self.step(id, i + 1);
                }
            }
            JobOp::TagRename { from, to } => {
                self.write_tag_job(run, &plan);
                // v1-pinned §1.6 (FR-HOM-02 AC-21): a pinned tag follows its new key; a pinned Tag file its new path.
                let mut patches = vec![PinPatch::TagRenamed { from: from.clone(), to: to.clone() }];
                patches.extend(self.moved_patches(run.renamed.iter().cloned()));
                self.write_pins(run, &patches, false);
            }
            JobOp::TagDelete { .. } => self.write_tag_job(run, &plan),
            JobOp::Merge { .. } => {
                self.write_merge(run, &plan)?;
                self.pin_merge(run, &plan);
            }
            JobOp::Restore { name } => self.write_restore(run, name, &plan),
            JobOp::TypeMove { .. } | JobOp::FolderMove { .. } => self.write_moves(run, &mut plan, op)?,
            // §14.9.4: `false` is a cancel while writing, after its rows were reversed.
            JobOp::ValueRemove { r#type, key } if !self.write_value_remove(run, &plan, r#type, key)? => return Ok(Phase::Cancelled),
            JobOp::TypeDelete { r#type } if !self.write_type_delete(run, &plan, r#type)? => return Ok(Phase::Cancelled),
            JobOp::QueryRename { .. } => self.write_query_rename(run, &plan)?,
            _ => {}
        }
        Ok(Phase::Done)
    }

    // -------------------------------------------------------------------------------------------- inbox (5B)

    /// ms5-capture §7.3: the given paths at their index versions, each with the change's text op; a path the index
    /// doesn't know is skipped as missing.
    fn plan_inbox(&self, id: JobId, run: &mut Run, paths: &[String], change: &InboxJobChange) -> JobPlan {
        let host = self.host();
        let op = match change.clone() {
            InboxJobChange::SetReview { value, now } => TextOp::SetReview { value, now },
            InboxJobChange::SetType { r#type, now } => TextOp::SetType { r#type, now },
            InboxJobChange::AddTags { tags, now } => TextOp::AddTags { tags, now },
            InboxJobChange::AppendLink { target, now } => TextOp::AppendLink { target, now },
            InboxJobChange::AppendLinkTo { path, title, now } => TextOp::AppendLinkTo { to_path: nfc(&path), to_title: nfc(&title), paths: host.note_paths(), now },
        };
        let mut files = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for p in paths.iter().map(|p| nfc(p)) {
            if !seen.insert(p.clone()) {
                continue;
            }
            match host.indexed_version(&p) {
                Some(version) => files.push(PlannedFile { path: p, version, ops: vec![op.clone()] }),
                None => run.skip(&p, SkipReason::Missing),
            }
        }
        let n = files.len();
        JobPlan { job: id, kind: JobKind::Inbox, files, renames: Vec::new(), creates: Vec::new(), trashes: Vec::new(), counts: PlanCounts { files: n, links: 0, ..Default::default() }, warnings: Vec::new() }
    }

    // -------------------------------------------------------------------------------------------- note rename

    fn plan_rename(
        &self,
        id: JobId,
        path: &str,
        title: &str,
        from_title: Option<String>,
    ) -> Result<JobPlan, String> {
        let host = self.host();
        let path = nfc(path);
        let (bytes, version) = host.read(&path).map_err(|e| format!("{e:?}"))?;
        let stem = stem_of(&path);
        let folder = folder_of(&path);
        let stored = extract(&bytes, &stem).title;
        let title = nfc(title.trim());
        let empty = |files| JobPlan {
            job: id,
            kind: JobKind::NoteRename,
            files,
            renames: Vec::new(),
            creates: Vec::new(),
            trashes: Vec::new(),
            counts: PlanCounts::default(),
            warnings: Vec::new(),
        };
        let from_title = from_title
            .map(|t| nfc(t.trim()))
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| nfc(stored.trim()));
        // FR-FMT-08 AC-7: equal after NFC and trim, or only spaces: nothing to do. The autosave may have written the
        // new title already while typing (D-394), so "equal" means equal to the title when the edit started too.
        if title.is_empty() || (title == nfc(stored.trim()) && title == from_title) {
            return Ok(empty(Vec::new()));
        }
        let wanted = nfc(&sanitize_file_stem(&title));
        // D-402: a stem with the note's own stem key is never a collision.
        let to_stem = if key(&wanted) == key(&stem) {
            wanted.clone()
        } else {
            host.free_stem(&folder, &wanted)
        };
        let to_path = join(&folder, &to_stem);
        let paths = host.note_paths();
        let retarget = TextOp::RetargetLinks {
            from_path: path.clone(),
            from_stem: stem.clone(),
            from_title,
            to_path: to_path.clone(),
            to_stem,
            to_title: title.clone(),
            paths,
        };
        let mut files = vec![PlannedFile {
            path: path.clone(),
            version,
            ops: vec![
                TextOp::SetTitle {
                    title,
                    now: host.now(),
                },
                retarget.clone(),
            ],
        }];
        let mut linking = host.linking(&path);
        linking.sort();
        for p in linking {
            if let Some(v) = host.version(&p) {
                files.push(PlannedFile {
                    path: p,
                    version: v,
                    ops: vec![retarget.clone()],
                });
            }
        }
        let renames = if to_path != path {
            vec![(path.clone(), to_path)]
        } else {
            Vec::new()
        };
        let n = files.len();
        Ok(JobPlan {
            job: id,
            kind: JobKind::NoteRename,
            files,
            renames,
            creates: Vec::new(),
            trashes: Vec::new(),
            counts: PlanCounts { files: n, links: 0, ..Default::default() },
            warnings: Vec::new(),
        })
    }

    fn write_rename(&self, run: &mut Run, mut plan: JobPlan) {
        let host = self.host().clone();
        if plan.files.is_empty() {
            return;
        }
        let id = run.id;
        let note = plan.files[0].clone();
        let mut ops = note.ops.clone();
        crate::journal::begin(host.as_ref(), id, &plan);
        // The note first: the final stem is known only after its rename (FR-FMT-08 AC-10).
        self.point(
            id,
            JobPoint::AfterRead {
                path: note.path.clone(),
            },
        );
        let (pre, pre_v) = match host.read(&note.path) {
            Ok(x) => x,
            Err(e) => {
                run.skip(&note.path, read_reason(&e));
                return;
            }
        };
        if std::str::from_utf8(&pre).is_err() {
            run.skip(&note.path, SkipReason::ReadOnly); // D-180: never written
            return;
        }
        let mut to = plan.renames.first().map(|(_, t)| t.clone());
        let mut tries = 0;
        let outcome = loop {
            let out = match self.transform(&note.path, &pre, &ops) {
                Ok(Transformed::Bytes(b, _)) => b,
                Ok(Transformed::Unchanged) => pre.clone(),
                Err(_) => break Err(SkipReason::Io),
            };
            let r = match &to {
                Some(t) => host
                    .rename(&note.path, t, &out, &pre_v)
                    .map(|v| (t.clone(), v, out)),
                None => match host.write(&note.path, &out, &pre_v) {
                    Ok(Wrote::Written(v)) => Ok((note.path.clone(), v, out)),
                    Ok(Wrote::Unchanged) => break Ok(None),
                    Err(e) => Err(e),
                },
            };
            match r {
                Ok(x) => break Ok(Some(x)),
                Err(WriteError::NameTaken) if tries < 50 => {
                    tries += 1;
                    // Taken since planning: the next free stem, and every op follows it.
                    let TextOp::RetargetLinks { to_title, .. } = &ops[1] else {
                        break Err(SkipReason::Io);
                    };
                    let wanted = nfc(&sanitize_file_stem(to_title));
                    let stem = host.free_stem(&folder_of(&note.path), &wanted);
                    let path = join(&folder_of(&note.path), &stem);
                    ops = ops
                        .into_iter()
                        .map(|o| retarget_to(o, &stem, &path))
                        .collect();
                    to = Some(path);
                }
                Err(e) => break Err(write_reason(&e)),
            }
        };
        match outcome {
            Ok(Some((path, post_v, post))) => {
                if path != note.path {
                    run.renamed = Some((note.path.clone(), path.clone()));
                }
                run.written.push(path.clone());
                crate::journal::progress(host.as_ref(), id, &note.path, &path, &post_v);
                run.undo.files.push(Written {
                    before: note.path.clone(),
                    after: path,
                    pre,
                    pre_v,
                    post,
                    post_v,
                    via_op: false,
                    direct: false, trashed: None,
                });
            }
            Ok(None) => run.unchanged.push(note.path.clone()),
            Err(reason) => {
                // The renamed note itself couldn't be written: no link may move to a name that doesn't exist.
                run.skip(&note.path, reason);
                return;
            }
        }
        // The plan records the final target for every file (and for Retry).
        let (stem, path) = match &ops[1] {
            TextOp::RetargetLinks {
                to_stem, to_path, ..
            } => (to_stem.clone(), to_path.clone()),
            _ => unreachable!("rename ops"),
        };
        for f in plan.files.iter_mut() {
            f.ops = std::mem::take(&mut f.ops)
                .into_iter()
                .map(|o| retarget_to(o, &stem, &path))
                .collect();
        }
        if let Some(r) = plan.renames.first_mut() {
            r.1 = path.clone();
        }
        run.undo.op = Some(ops[1].clone());
        // D-433: a crash from here on finishes with the stem the rename really took, not the planned one.
        crate::journal::retarget(host.as_ref(), id, &ops[1], &note.path, &path);
        if let Some(j) = lock(&self.state).jobs.get_mut(&id) {
            j.plan = Some(plan.clone());
        }
        self.step(id, 1);
        for (i, f) in plan.files.iter().enumerate().skip(1) {
            let n = run.undo.files.len();
            self.write_one(run, f);
            match run.undo.files.get(n) {
                Some(w) => crate::journal::progress(host.as_ref(), id, &w.before, &w.after, &w.post_v),
                None => crate::journal::progress_none(host.as_ref(), id, &f.path),
            }
            self.step(id, i + 1);
        }
        // v1-queries §1.8 (FR-LNK-03 AC-23): query files' link values follow the note, before its pins.
        if let (Some((from, to)), TextOp::RetargetLinks { paths, .. }) = (run.renamed.clone(), &ops[1]) {
            self.write_queries(run, &[QueryPatch::ObjectMoved { from, to, paths: Arc::new(paths.clone()) }], true);
        }
        // v1-pinned §1.6 (FR-LNK-03 AC-22): last, the pin of the renamed note follows its final path and `id`.
        let patches = self.moved_patches(run.renamed.iter().cloned());
        self.write_pins(run, &patches, true);
    }

    // -------------------------------------------------------------------------------------------- query rename (slice Q)

    /// v1-queries §1.8: the plan of `query-rename`: the usages at their scan versions, the file rename.
    fn plan_query_rename(&self, id: JobId, run: &mut Run, name: &str, title: &str) -> Result<JobPlan, String> {
        let q = self.host().query_rename_plan(name, title).map_err(|e| format!("{e:?}"))?;
        let op = TextOp::RenameSavedQuery { from: q.from_name.clone(), to: q.to_name.clone() };
        let files: Vec<PlannedFile> = q.usages.iter().map(|(p, v)| PlannedFile { path: p.clone(), version: v.clone(), ops: vec![op.clone()] }).collect();
        let n = files.len() + 1;
        let renames = vec![(q.from.clone(), q.to.clone())];
        run.query = Some(q);
        Ok(JobPlan { job: id, kind: JobKind::QueryRename, files, renames, creates: Vec::new(), trashes: Vec::new(), counts: PlanCounts { files: n, links: n - 1, ..Default::default() }, warnings: Vec::new() })
    }

    /// D-1496: nothing is written when the query file or a usage changed since the scan; then the file rename (only its
    /// `title:` line changed), every usage's `saved:` lines through the transformer, and last the pins.
    fn write_query_rename(&self, run: &mut Run, plan: &JobPlan) -> Result<(), String> {
        let host = self.host().clone();
        let Some(q) = run.query.take() else { return Err("NotFound".into()) };
        let unchanged = |p: &str, v: &crate::FileVersion| host.version(p).is_some_and(|now| now.same_content(v));
        if !unchanged(&q.from, &q.pre_v) {
            run.skip(&q.from, SkipReason::Changed);
            return Err(format!("Changed: {}", q.from));
        }
        if let Some(f) = plan.files.iter().find(|f| !unchanged(&f.path, &f.version)) {
            run.skip(&f.path, SkipReason::Changed);
            return Err(format!("Changed: {}", f.path));
        }
        self.point(run.id, JobPoint::AfterRead { path: q.from.clone() });
        let post_v = host.rename(&q.from, &q.to, &q.post, &q.pre_v).map_err(|e| format!("{e:?}"))?;
        run.renamed = Some((q.from.clone(), q.to.clone()));
        run.written.push(q.to.clone());
        run.undo.files.push(Written { before: q.from.clone(), after: q.to.clone(), pre: q.pre.clone(), pre_v: q.pre_v.clone(), post: q.post.clone(), post_v, via_op: false, direct: true, trashed: None });
        run.undo.op = Some(TextOp::RenameSavedQuery { from: q.from_name.clone(), to: q.to_name.clone() });
        self.step(run.id, 1);
        for (i, f) in plan.files.iter().enumerate() {
            self.write_one(run, f);
            self.step(run.id, i + 2);
        }
        self.write_pins(run, &[PinPatch::QueryRenamed { from: q.from_name, to: q.to_name }], false);
        Ok(())
    }

    /// v1-queries §1.8 (FR-LNK-03 AC-23): the query files' link patch, as the pins row: listed in `written`, byte rows of
    /// the undo record, journal entries of a single-note job, a conflict skipped, never a job failure.
    fn write_queries(&self, run: &mut Run, patches: &[QueryPatch], journal: bool) {
        if patches.is_empty() {
            return;
        }
        let host = self.host().clone();
        for (path, r) in host.patch_queries(patches) {
            match r {
                Ok(Some(w)) => {
                    if journal {
                        let entry = crate::journal::Entry { at: w.path.clone(), to: w.path.clone(), pre: w.pre.clone(), target: Some(w.post.clone()) };
                        crate::journal::add_entry(host.as_ref(), run.id, &entry);
                        crate::journal::progress(host.as_ref(), run.id, &w.path, &w.path, &w.post_v);
                    }
                    run.written.push(w.path.clone());
                    run.undo.files.push(Written { before: w.path.clone(), after: w.path, pre: w.pre, pre_v: w.pre_v, post: w.post, post_v: w.post_v, via_op: false, direct: true, trashed: None });
                }
                Ok(None) => {}
                Err(e) => run.skip(&path, write_reason(&e)),
            }
        }
    }

    // -------------------------------------------------------------------------------------------- pins (v1-pinned §1.6)

    /// `Moved` patches for the moves that really happened, each with the moved file's `id` as it is now.
    fn moved_patches(&self, moves: impl IntoIterator<Item = (String, String)>) -> Vec<PinPatch> {
        let host = self.host();
        moves
            .into_iter()
            .map(|(from, to)| {
                let id = host.read(&to).ok().and_then(|(b, _)| extract(&b, &stem_of(&to)).id).map(|i| nfc(i.trim()));
                PinPatch::Moved { from, to, id }
            })
            .collect()
    }

    /// D-1402: a pin of an object merged away now pins the kept object (its path and `id`).
    fn pin_merge(&self, run: &mut Run, plan: &JobPlan) {
        let Some(keep) = plan.files.first() else { return };
        let Some(TextOp::MergeInto { others, .. }) = keep.ops.first() else { return };
        let host = self.host();
        let id = host.read(&keep.path).ok().and_then(|(b, _)| extract(&b, &stem_of(&keep.path)).id).map(|i| nfc(i.trim()));
        let patches: Vec<PinPatch> = others
            .iter()
            .filter(|o| run.moved.trashes.iter().any(|(p, _)| *p == o.path))
            .map(|o| PinPatch::Merged {
                from: o.path.clone(),
                from_id: extract(o.text.as_bytes(), &stem_of(&o.path)).id.map(|i| nfc(i.trim())),
                to: keep.path.clone(),
                id: id.clone(),
            })
            .collect();
        self.write_pins(run, &patches, false);
    }

    /// The pins file's write step, last in the job (v1-pinned §1.6, D-1373): a row of the job like any other file
    /// (listed in `written`, a byte row of the undo record, a journal entry of a single-note job), a conflict skipped
    /// and listed, never a job failure.
    fn write_pins(&self, run: &mut Run, patches: &[PinPatch], journal: bool) {
        if patches.is_empty() {
            return;
        }
        let host = self.host().clone();
        match host.patch_pins(patches) {
            Ok(Some(w)) => {
                if journal {
                    let entry = crate::journal::Entry { at: PINS_PATH.into(), to: PINS_PATH.into(), pre: w.pre.clone(), target: Some(w.post.clone()) };
                    crate::journal::add_entry(host.as_ref(), run.id, &entry);
                    crate::journal::progress(host.as_ref(), run.id, PINS_PATH, PINS_PATH, &w.post_v);
                }
                run.written.push(PINS_PATH.to_string());
                run.undo.files.push(Written {
                    before: PINS_PATH.to_string(),
                    after: PINS_PATH.to_string(),
                    pre: w.pre,
                    pre_v: w.pre_v,
                    post: w.post,
                    post_v: w.post_v,
                    via_op: false,
                    direct: true,
                    trashed: None,
                });
            }
            Ok(None) => {}
            Err(e) => run.skip(PINS_PATH, write_reason(&e)),
        }
    }

    /// As `write_one`, never through an open editor (4E-1, QA M1: the note a page is changing the type of).
    fn write_direct(&self, run: &mut Run, f: &PlannedFile) {
        self.write_file(run, f, false)
    }

    /// One linking file (§5): never written unless it is still the planned version.
    fn write_one(&self, run: &mut Run, f: &PlannedFile) {
        self.write_file(run, f, true)
    }

    fn write_file(&self, run: &mut Run, f: &PlannedFile, live: bool) {
        let host = self.host();
        let path = &f.path;
        if host.is_placeholder(path) {
            return run.skip(path, SkipReason::Placeholder);
        }
        let (bytes, v) = match host.read(path) {
            Ok(x) => x,
            Err(e) => return run.skip(path, read_reason(&e)),
        };
        if !v.same_content(&f.version) {
            return run.skip(path, SkipReason::Changed);
        }
        // D-180, NFR-REL-03: a file that isn't valid UTF-8 is read-only; a lossy round trip would replace its bytes.
        if std::str::from_utf8(&bytes).is_err() {
            return run.skip(path, SkipReason::ReadOnly);
        }
        self.point(run.id, JobPoint::AfterRead { path: path.clone() });
        // §14.9.4: a 4E-2 job cancelled while writing stops before this file's write.
        if run.kind.flags().cancellable.contains(&Phase::Writing) && self.cancelled(run.id) {
            return;
        }
        if live && lock(&self.editors).contains(&nfc(path)) {
            return self.write_live(run, path, &bytes, &v, &f.ops);
        }
        let out = match self.transform(path, &bytes, &f.ops) {
            Ok(Transformed::Bytes(b, _)) => b,
            Ok(Transformed::Unchanged) => return run.unchanged.push(path.clone()),
            Err(_) => return run.skip(path, SkipReason::Io),
        };
        if out == bytes {
            return run.unchanged.push(path.clone());
        }
        self.point(run.id, JobPoint::TempWritten { path: path.clone() });
        if host.is_placeholder(path) {
            return run.skip(path, SkipReason::Placeholder);
        }
        match host.write(path, &out, &v) {
            Ok(Wrote::Written(post_v)) => {
                run.written.push(path.clone());
                run.undo.files.push(Written {
                    before: path.clone(),
                    after: path.clone(),
                    pre: bytes,
                    pre_v: v,
                    post: out,
                    post_v,
                    via_op: false,
                    direct: !live, trashed: None,
                });
            }
            Ok(Wrote::Unchanged) => run.unchanged.push(path.clone()),
            Err(e) => run.skip(path, write_reason(&e)),
        }
    }

    /// D-386: the open note's editor applies the change to its live document and saves it; the job waits for that save.
    fn write_live(&self, run: &mut Run, path: &str, bytes: &[u8], v: &FileVersion, ops: &[TextOp]) {
        let host = self.host();
        if std::str::from_utf8(bytes).is_err() {
            return run.skip(path, SkipReason::ReadOnly);
        }
        let request = self.request_id();
        host.transform_request(request, path, &String::from_utf8_lossy(bytes), ops, true);
        let end = Instant::now() + LIVE_TIMEOUT;
        loop {
            if let Some(now) = host.version(path) {
                if !now.same_content(v) {
                    run.written.push(path.to_string());
                    // Undo and redo go through the link op: the saved text also holds the user's own edits.
                    let post = host.read(path).map(|(b, _)| b).unwrap_or_default();
                    run.undo.files.push(Written {
                        before: path.to_string(),
                        after: path.to_string(),
                        pre: bytes.to_vec(),
                        pre_v: v.clone(),
                        post,
                        post_v: now,
                        via_op: true,
                        direct: false, trashed: None,
                    });
                    return;
                }
            } else {
                return run.skip(path, SkipReason::Missing);
            }
            if !lock(&self.editors).contains(&nfc(path))
                || Instant::now() > end
                || self.stop.load(Ordering::SeqCst)
            {
                return run.skip(path, SkipReason::Changed);
            }
            let s = lock(&self.state);
            let _ = self.changed.wait_timeout(s, Duration::from_millis(50));
        }
    }

    // -------------------------------------------------------------------------------------------- undo and redo

    fn plan_undo(&self, id: JobId, job: JobId, undo: bool) -> Result<JobPlan, String> {
        let rec = lock(&self.state)
            .jobs
            .get(&job)
            .and_then(|j| j.undo.clone())
            .ok_or("NotFound")?;
        let files = rec
            .files
            .iter()
            .map(|w| PlannedFile {
                path: if undo {
                    w.after.clone()
                } else {
                    w.before.clone()
                },
                version: if undo {
                    w.post_v.clone()
                } else {
                    w.pre_v.clone()
                },
                // Retry of a skipped row reverses (undo) or re-applies (redo) only the link (D-385).
                ops: if undo { &rec.rev } else { &rec.op }.iter().cloned().collect(),
            })
            .collect::<Vec<_>>();
        let renames = rec
            .files
            .iter()
            .filter(|w| w.before != w.after)
            .map(|w| {
                if undo {
                    (w.after.clone(), w.before.clone())
                } else {
                    (w.before.clone(), w.after.clone())
                }
            })
            .collect();
        let n = files.len();
        let kind = lock(&self.state).jobs.get(&job).map(|j| j.kind).unwrap_or(JobKind::NoteRename);
        Ok(JobPlan {
            job: id,
            kind,
            files,
            renames,
            creates: Vec::new(),
            trashes: Vec::new(),
            counts: PlanCounts { files: n, links: 0, ..Default::default() },
            warnings: Vec::new(),
        })
    }

    /// Undo writes each file's pre-job bytes where the file is still what the job wrote; redo the reverse (§7).
    /// Files written through an editor get the link op instead (D-386). Journaled like the rename (D-387).
    fn write_undo(&self, run: &mut Run, job: JobId, undo: bool) {
        let host = self.host();
        let Some(rec) = lock(&self.state).jobs.get(&job).and_then(|j| j.undo.clone()) else {
            return;
        };
        // §14.9.4: a type delete's trash rows are moved back (or trashed again), not written.
        if rec.files.iter().any(|w| w.trashed.is_some()) {
            return self.write_trash_rows(run, &rec.files, undo);
        }
        let op = if undo { rec.rev.clone() } else { rec.op.clone() };
        let entries: Vec<crate::journal::Entry> = rec
            .files
            .iter()
            .map(|w| {
                let (at, to, bytes) = if undo { (&w.after, &w.before, &w.pre) } else { (&w.before, &w.after, &w.post) };
                let current = host.read(at).map(|(b, _)| b).unwrap_or_default();
                crate::journal::Entry { at: at.clone(), to: to.clone(), pre: current, target: if w.via_op { None } else { Some(bytes.clone()) } }
            })
            .collect();
        crate::journal::begin_entries(host.as_ref(), run.id, if undo { "undo" } else { "redo" }, op.as_ref(), &entries);
        // D-433: the note moves first; if it can't, no link moves (they would point where the note isn't).
        let mut note_stuck = false;
        for (i, w) in rec.files.iter().enumerate() {
            let (at, to, bytes, base) = if undo { (&w.after, &w.before, &w.pre, &w.post_v) } else { (&w.before, &w.after, &w.post, &w.pre_v) };
            if note_stuck {
                run.skip(at, SkipReason::Changed);
                crate::journal::progress_none(host.as_ref(), run.id, at);
                self.step(run.id, i + 1);
                continue;
            }
            self.point(run.id, JobPoint::AfterRead { path: at.clone() });
            if host.is_placeholder(at) {
                run.skip(at, SkipReason::Placeholder);
                crate::journal::progress_none(host.as_ref(), run.id, at);
                continue;
            }
            let before = run.undo.files.len();
            if !w.direct && (w.via_op || (at == to && lock(&self.editors).contains(&nfc(at)))) {
                // Through the link op: the editor if the note is open, else the current text on disk.
                match (op.as_ref(), host.read(at)) {
                    (Some(op), Ok((cur, v))) if lock(&self.editors).contains(&nfc(at)) => self.write_live(run, at, &cur, &v, std::slice::from_ref(op)),
                    (Some(op), Ok((cur, v))) => self.write_op(run, at, &cur, &v, op),
                    (_, Err(e)) => run.skip(at, read_reason(&e)),
                    (None, _) => run.skip(at, SkipReason::Io),
                }
            } else {
                let r = if at != to {
                    // Another note took the old name: the links can't follow the note back to it (D-433).
                    if host.version(to).is_some() && key(to) != key(at) {
                        Err(WriteError::NameTaken)
                    } else {
                        host.rename(at, to, bytes, base).map(|v| (to.clone(), Some(v)))
                    }
                } else {
                    host.write(at, bytes, base).map(|w| match w {
                        Wrote::Written(v) => (at.clone(), Some(v)),
                        Wrote::Unchanged => (at.clone(), None),
                    })
                };
                match r {
                    Ok((path, Some(v))) => {
                        if path != *at {
                            run.renamed = Some((at.clone(), path.clone()));
                        }
                        run.written.push(path.clone());
                        run.undo.files.push(Written { before: at.clone(), after: path, pre: Vec::new(), pre_v: base.clone(), post: bytes.clone(), post_v: v, via_op: false, direct: w.direct, trashed: None });
                    }
                    Ok((path, None)) => run.unchanged.push(path),
                    Err(e) => {
                        run.skip(at, write_reason(&e));
                        // D-433: one renamed note holds its links back; a multi-note move undoes the others.
                        note_stuck = at != to && rec.files.iter().filter(|x| x.before != x.after).count() == 1;
                    }
                }
            }
            match run.undo.files.get(before) {
                Some(x) => crate::journal::progress(host.as_ref(), run.id, at, &x.after, &x.post_v),
                None => crate::journal::progress_none(host.as_ref(), run.id, at),
            }
            self.step(run.id, i + 1);
        }
    }

    /// A link op on a file's current text, written with that text's version as base (undo / redo of a file that was
    /// written through its editor).
    fn write_op(&self, run: &mut Run, path: &str, bytes: &[u8], v: &FileVersion, op: &TextOp) {
        let host = self.host();
        if std::str::from_utf8(bytes).is_err() {
            return run.skip(path, SkipReason::ReadOnly);
        }
        let out = match self.transform(path, bytes, std::slice::from_ref(op)) {
            Ok(Transformed::Bytes(b, _)) => b,
            Ok(Transformed::Unchanged) => return run.unchanged.push(path.to_string()),
            Err(_) => return run.skip(path, SkipReason::Io),
        };
        match host.write(path, &out, v) {
            Ok(Wrote::Written(post_v)) => {
                run.written.push(path.to_string());
                run.undo.files.push(Written { before: path.to_string(), after: path.to_string(), pre: bytes.to_vec(), pre_v: v.clone(), post: out, post_v, via_op: true, direct: false, trashed: None });
            }
            Ok(Wrote::Unchanged) => run.unchanged.push(path.to_string()),
            Err(e) => run.skip(path, write_reason(&e)),
        }
    }

    // -------------------------------------------------------------------------------------------- transform

    fn request_id(&self) -> u64 {
        let mut n = lock(&self.next_request);
        *n += 1;
        *n
    }

    pub(crate) fn transform(
        &self,
        source: &str,
        bytes: &[u8],
        ops: &[TextOp],
    ) -> Result<Transformed, TransformError> {
        // QA M7: a relink needs only the paths its file's links can name, not the whole vault.
        let slim: Vec<TextOp> = ops.iter().map(|o| self.slim_relink(o, bytes)).collect();
        let ops = &slim[..];
        if let Some(t) = lock(&self.transformer).clone() {
            return t.transform(source, bytes, ops);
        }
        // The app: the UI's worker answers `job:transform` through `job_transform_result` (§2.2).
        let request = self.request_id();
        self.host()
            .transform_request(request, source, &String::from_utf8_lossy(bytes), ops, false);
        let end = Instant::now() + TRANSFORM_TIMEOUT;
        let mut r = lock(&self.replies);
        loop {
            if let Some(x) = r.remove(&request) {
                return x;
            }
            let left = end
                .checked_duration_since(Instant::now())
                .ok_or(TransformError::Timeout)?;
            r = self
                .replied
                .wait_timeout(r, left)
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
    }

    // -------------------------------------------------------------------------------------------- backup (§6)

    fn backup(&self, kind: JobKind, manifest: Option<&serde_json::Value>, keep: Option<&std::path::Path>) -> Result<PathBuf, String> {
        let host = self.host();
        let dir = host.app_dir().join("backups").join(host.vault_key());
        let mut entries = Vec::new();
        // ms4-tags §5.1 (D-724): the manifest is the first entry.
        if let Some(m) = manifest {
            entries.push((tagjobs::MANIFEST.to_string(), serde_json::to_vec_pretty(m).map_err(|e| e.to_string())?));
        }
        for p in host.backup_files() {
            match host.read(&p) {
                Ok((b, _)) => entries.push((nfc(&p), b)),
                Err(ReadError::Placeholder) => {}
                Err(e) => return Err(format!("{p}: {e:?}")),
            }
        }
        let mut zip = Vec::new();
        crate::zip::write_zip(&mut zip, &entries).map_err(|e| e.to_string())?;
        // Two jobs in one UTC second would share a name: the later one takes the next free second.
        // Any zip of that second, whatever its kind, moves this one on (names sort newest last, ms4-tags §5.2).
        let taken: HashSet<String> = host
            .local_list(&dir)
            .into_iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().chars().take(15).collect()))
            .collect();
        let mut t = chrono::Utc::now();
        while taken.contains(&t.format("%Y%m%d-%H%M%S").to_string()) {
            t += chrono::Duration::seconds(1);
        }
        let path = dir.join(format!("{}-{}.zip", t.format("%Y%m%d-%H%M%S"), kind.as_str()));
        // Atomic, through tegg-vault (AR-04 AC-1); a read-only backups folder fails here and nothing is written.
        host.local_write(&path, &zip).map_err(|e| e.to_string())?;
        // Keep the newest ten (names start with the UTC time).
        // D-725: the zip being restored is exempt from the rotation its pre-restore backup triggers.
        let mut zips: Vec<PathBuf> = host.local_list(&dir).into_iter().filter(|p| p.extension().is_some_and(|x| x == "zip") && Some(p.as_path()) != keep).collect();
        zips.sort();
        while zips.len() > KEEP_BACKUPS {
            host.local_remove(&zips.remove(0));
        }
        Ok(path)
    }
}

/// QA 4 N5: a relink's lists as the slimming compares them (NFC, lower case), built once per job.
type Moves = Arc<Vec<(String, String)>>;

pub(crate) struct SlimIndex {
    /// The lists it was built from, held so their addresses can't be reused by another op's (QA 4E-1 5 P2).
    of: (Moves, Arc<Vec<String>>, Arc<Vec<String>>),
    moved: HashSet<String>,
    /// Each note path's key and stem.
    paths: Vec<(String, String)>,
    /// Each other file's name.
    files: Vec<String>,
}

impl Inner {
    /// QA M7: the paths of a relink that the file's text can reach: a note whose stem occurs in the text, or in its
    /// percent-decoded copy (`[x](Bez%20autora.md)`, QA 4 N1), case-insensitively, plus every path of the move set; and
    /// the other files whose name occurs there.
    fn slim_relink(&self, op: &TextOp, bytes: &[u8]) -> TextOp {
        let TextOp::Relink { moves, paths, files } = op else { return op.clone() };
        let same = |i: &SlimIndex| Arc::ptr_eq(&i.of.0, moves) && Arc::ptr_eq(&i.of.1, paths) && Arc::ptr_eq(&i.of.2, files);
        let index = {
            let mut cache = lock(&self.slim);
            match cache.as_ref() {
                Some(i) if same(i) => i.clone(),
                _ => {
                    let i = Arc::new(SlimIndex {
                        of: (moves.clone(), paths.clone(), files.clone()),
                        moved: moves.iter().flat_map(|(a, b)| [key(a), key(b)]).collect(),
                        paths: paths
                            .iter()
                            .map(|p| {
                                let k = key(p);
                                let no_ext = k.strip_suffix(".md").unwrap_or(&k);
                                let stem = no_ext.rsplit('/').next().unwrap_or(no_ext).to_string();
                                (k, stem)
                            })
                            .collect(),
                        files: files.iter().map(|p| { let k = key(p); k.rsplit('/').next().unwrap_or(&k).to_string() }).collect(),
                    });
                    *cache = Some(i.clone());
                    i
                }
            }
        };
        let raw = String::from_utf8_lossy(bytes);
        let text = nfc(&raw).to_lowercase();
        let decoded = if raw.contains(['%', '&', '\\']) { nfc(&unescaped(&raw)).to_lowercase() } else { String::new() };
        let has = |s: &str| text.contains(s) || (!decoded.is_empty() && decoded.contains(s));
        let keep: Vec<String> = paths.iter().zip(&index.paths).filter(|(_, (k, stem))| index.moved.contains(k) || has(stem)).map(|(p, _)| p.clone()).collect();
        let keep_files: Vec<String> = files.iter().zip(&index.files).filter(|(_, name)| has(name)).map(|(p, _)| p.clone()).collect();
        TextOp::Relink { moves: moves.clone(), paths: Arc::new(keep), files: Arc::new(keep_files) }
    }
}

/// The text as `markdownLinks` reads a link destination, for matching only (never written): `%XX` sequences, backslash
/// escapes (`Tom\&Jerry`) and numeric or basic named character references (`&#269;`, `&amp;`) decoded; invalid UTF-8
/// replaced (QA 4E-1 4 N1, 5 P3). Other named references stay as written (ms4-jobs §14.3a).
fn unescaped(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let (Some(h), Some(l)) = ((b[i + 1] as char).to_digit(16), (b[i + 2] as char).to_digit(16)) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
            }
            b'\\' if i + 1 < b.len() && b[i + 1].is_ascii_punctuation() => {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            b'&' => {
                if let Some(end) = b[i + 1..].iter().take(10).position(|&c| c == b';') {
                    let name = &s[i + 1..i + 1 + end];
                    let ch = match name {
                        "amp" => Some('&'),
                        "lt" => Some('<'),
                        "gt" => Some('>'),
                        "quot" => Some('"'),
                        "apos" => Some('\''),
                        n if n.starts_with("#x") || n.starts_with("#X") => u32::from_str_radix(&n[2..], 16).ok().and_then(char::from_u32),
                        n if n.starts_with('#') => n[1..].parse::<u32>().ok().and_then(char::from_u32),
                        _ => None,
                    };
                    if let Some(c) = ch {
                        out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                        i += end + 2;
                        continue;
                    }
                }
            }
            _ => {}
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The retarget op of an undo: from the new name back to the old one.
fn reversed(op: &TextOp) -> TextOp {
    match op {
        TextOp::RetargetLinks { from_path, from_stem, from_title, to_path, to_stem, to_title, paths } => TextOp::RetargetLinks {
            from_path: to_path.clone(),
            from_stem: to_stem.clone(),
            from_title: to_title.clone(),
            to_path: from_path.clone(),
            to_stem: from_stem.clone(),
            to_title: from_title.clone(),
            paths: paths.iter().map(|p| if nfc(p) == nfc(from_path) { to_path.clone() } else { p.clone() }).collect(),
        },
        TextOp::Relink { moves, paths, files } => {
            let back: HashMap<String, &String> = moves.iter().map(|(f, t)| (nfc(f), t)).collect();
            let to = |p: &String| back.get(&nfc(p)).map(|t| (*t).clone()).unwrap_or_else(|| p.clone());
            TextOp::Relink { moves: Arc::new(moves.iter().map(|(f, t)| (t.clone(), f.clone())).collect()), paths: Arc::new(paths.iter().map(to).collect()), files: files.clone() }
        }
        TextOp::HoldTargets { from_path, to_path, paths } => TextOp::HoldTargets {
            from_path: to_path.clone(),
            to_path: from_path.clone(),
            paths: paths.iter().map(|p| if nfc(p) == nfc(from_path) { to_path.clone() } else { p.clone() }).collect(),
        },
        TextOp::RenameSavedQuery { from, to } => TextOp::RenameSavedQuery { from: to.clone(), to: from.clone() },
        other => other.clone(),
    }
}

/// The op with its target moved to `stem` / `path` (a rename that had to take the next free stem).
fn retarget_to(op: TextOp, stem: &str, path: &str) -> TextOp {
    match op {
        TextOp::RetargetLinks {
            from_path,
            from_stem,
            from_title,
            to_title,
            paths,
            ..
        } => TextOp::RetargetLinks {
            from_path,
            from_stem,
            from_title,
            to_path: path.to_string(),
            to_stem: stem.to_string(),
            to_title,
            paths,
        },
        other => other,
    }
}

/// The engine's own transform path (test transformer or the UI's worker) as a `Transformer`.
struct InnerTransformer<'a>(&'a Inner);

impl Transformer for InnerTransformer<'_> {
    fn transform(
        &self,
        source: &str,
        bytes: &[u8],
        ops: &[TextOp],
    ) -> Result<Transformed, TransformError> {
        self.0.transform(source, bytes, ops)
    }
}
