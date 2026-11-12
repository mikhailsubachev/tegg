//! §9: `start`, the job and the write phase. The run is an `ImportJob` of a `tegg-jobs` engine (§12.1). What differs
//! between the two targets is behind two seams: `TargetSink` (the checks, the order of the write, the end) and
//! `FileSink` (one created file: folder, journal, staged create). The new-vault target is `newvault.rs`; the
//! existing-vault target (journal, roll-back, backup, re-check) plugs into the same seams.

use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tegg_jobs::{ImportCtx, ImportJob, JobId, Phase, Staged, TextOp, Transformed};

use crate::note::folder_of;
use crate::planner::{self, Paths};
use crate::render::{self, TypeWrite};
use crate::source::{Entry, ReadFail, Source};
use crate::*;

#[derive(Clone, Debug)]
pub struct ImportReport {
    pub job: JobId,
    pub phase: Phase,
    pub error: Option<ImportError>,
    pub vault: Option<PathBuf>,
    pub vault_name: String,
    pub written: Vec<String>,
    pub report_path: Option<String>,
    pub renamed: Vec<(String, String)>,
    pub backup: Option<String>,
    pub kept: Vec<String>,
    pub totals: Totals,
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

type ProgressSink = Arc<dyn Fn(&ImportProgress) + Send + Sync>;

/// What the caller's `ImportRun` and the job share.
#[derive(Default)]
pub(crate) struct Shared {
    report: Mutex<Option<ImportReport>>,
    done: Condvar,
    sinks: Mutex<Vec<ProgressSink>>,
    job: Mutex<JobId>,
}

/// The engine a run is a job of.
pub(crate) enum Engine {
    /// A new vault: a private engine over the temporary folder (§9.1).
    Private(tegg_jobs::Jobs),
}
impl Engine {
    fn cancel(&self, job: JobId) -> Result<(), tegg_jobs::JobError> {
        match self {
            Engine::Private(jobs) => jobs.cancel(job),
        }
    }
}

pub struct ImportRun {
    job: JobId,
    shared: Arc<Shared>,
    engine: Engine,
}
impl ImportRun {
    pub(crate) fn new(job: JobId, shared: Arc<Shared>, engine: Engine) -> ImportRun {
        *lock(&shared.job) = job;
        ImportRun { job, shared, engine }
    }
    pub fn job(&self) -> JobId {
        self.job
    }
    /// `NotCancellable` once `writing` began (or the run ended).
    pub fn cancel(&self) -> Result<(), ImportError> {
        self.engine.cancel(self.job).map_err(|e| match e {
            tegg_jobs::JobError::NotCancellable | tegg_jobs::JobError::NotFound => ImportError::NotCancellable,
            other => ImportError::Io { reason: format!("{other:?}") },
        })
    }
    pub fn wait(&self, timeout: Duration) -> Option<ImportReport> {
        let until = Instant::now() + timeout;
        let mut report = lock(&self.shared.report);
        while report.is_none() {
            let left = until.checked_duration_since(Instant::now())?;
            report = self.shared.done.wait_timeout(report, left).unwrap_or_else(|e| e.into_inner()).0;
        }
        report.clone()
    }
    pub fn report(&self) -> Option<ImportReport> {
        lock(&self.shared.report).clone()
    }
    pub fn on_progress(&self, sink: Arc<dyn Fn(&ImportProgress) + Send + Sync>) {
        lock(&self.shared.sinks).push(sink);
    }
}

// ------------------------------------------------------------------------------------------------ the seams

/// A file's bytes: rendered text, or a source entry streamed with its stamp check (§9.4).
pub(crate) enum Src<'a> {
    Bytes(&'a [u8]),
    Entry { entry: &'a Entry, inner: &'a str },
}

/// One created file on a target (§9.4). The existing-vault sink writes the journal lines of §9.6 in `intent`,
/// `staged`, `committed` and `not_created`; the new-vault sink has no journal.
pub(crate) trait FileSink {
    /// The folder exists, created (and logged) when it doesn't.
    fn ensure_dir(&self, dir: &str) -> Result<(), ImportError>;
    /// Before `BeforeTemp`: the write-ahead line of a created file.
    fn intent(&self, _path: &str, _src: &Src<'_>) -> Result<(), ImportError> {
        Ok(())
    }
    /// The staged exclusive create, step 1: the bytes in the run's own temp file, synced.
    fn stage(&self, path: &str, src: &mut dyn Read) -> io::Result<Staged>;
    /// After the temp file is complete, before `TempWritten`.
    fn staged(&self, _staged: &Staged) -> Result<(), ImportError> {
        Ok(())
    }
    /// Step 2: the no-replace rename. `AlreadyExists`: a file arrived at the path.
    fn commit(&self, staged: Staged) -> io::Result<()>;
    fn discard(&self, staged: Staged);
    /// After `Renamed`: the run created `path`.
    fn committed(&self, _path: &str) -> Result<(), ImportError> {
        Ok(())
    }
    /// A create failed and its temp file is gone: nothing at `path` is the run's.
    fn not_created(&self, _path: &str) {}
}

/// A target of a run: what `prepare`, `write` and the end do beyond the shared steps.
pub(crate) trait TargetSink: Send + Sync {
    /// The target's existing files, for D-184 (a new vault has none).
    fn existing_files(&self, _ctx: &ImportCtx<'_>) -> Vec<String> {
        Vec::new()
    }
    /// §9.2 steps 2 to 4: type-file stamps, the planned paths again, the backup decision.
    fn recheck(&self, _job: &Job, _ctx: &ImportCtx<'_>) -> Result<(), ImportError> {
        Ok(())
    }
    /// The text of an existing type file that gains attributes.
    fn type_file(&self, key: &str) -> Option<String>;
    fn needs_backup(&self, _job: &Job, _ctx: &ImportCtx<'_>) -> bool {
        false
    }
    /// `writing`, in §9.4's order, each file through `Job::create_file`. On `Err` the sink has undone its files.
    fn write(&self, job: &Job, ctx: &ImportCtx<'_>) -> Result<(), ImportError>;
    /// The run reached a final phase, or its thread unwinds (`unwinding`): only in-memory state is released.
    fn release(&self, _unwinding: bool) {}
}

/// A rendered file, in write order.
pub(crate) struct Rendered {
    pub path: String,
    pub kind: FileKind,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
pub(crate) struct State {
    pub types: Vec<TypeWrite>,
    pub objects: Vec<Rendered>,
    pub report: Option<Rendered>,
    pub error: Option<ImportError>,
    pub written: Vec<String>,
    pub vault: Option<PathBuf>,
    pub vault_name: String,
    pub renamed: Vec<(String, String)>,
    pub backup: Option<String>,
    pub kept: Vec<String>,
    pub done: u64,
    pub total: u64,
    pub last_event: Option<Instant>,
}

pub(crate) struct Job {
    pub plan: Plan,
    pub source: Arc<Source>,
    pub env: ImportEnv,
    /// `env.clock`, read once at `start` (§2).
    pub now: DateTime<Utc>,
    pub shared: Arc<Shared>,
    pub state: Mutex<State>,
    pub target: Box<dyn TargetSink>,
}

/// Releases the run's in-memory state when its thread unwinds (a panicking hook, the tests' kill; §2.1).
struct Unwind<'a>(&'a dyn TargetSink);
impl Drop for Unwind<'_> {
    fn drop(&mut self) {
        if std::thread::panicking() {
            self.0.release(true);
        }
    }
}

impl Job {
    /// The import time with the zone's offset, seconds precision (D-1538 (4)).
    pub fn now_local(&self) -> String {
        dates::local(self.now, self.env.zone)
    }

    /// Raises a point of §2.1.
    pub fn point(&self, p: ImportPoint) -> PointAction {
        match &self.env.points {
            Some(hook) => hook(&p),
            None => PointAction::Continue,
        }
    }

    pub fn emit(&self, phase: ImportPhase, step: Option<WriteStep>, done: u64, total: u64, last: bool) {
        {
            let mut s = lock(&self.state);
            if !last && done != total && s.last_event.is_some_and(|t| t.elapsed() < Duration::from_millis(100)) {
                return;
            }
            s.last_event = Some(Instant::now());
        }
        let sinks: Vec<ProgressSink> = lock(&self.shared.sinks).clone();
        let event = ImportProgress { phase, step, done, total, step_done: 0, step_total: 0, counts: last.then(|| self.plan.totals.clone()), job: Some(*lock(&self.shared.job)) };
        for sink in sinks {
            sink(&event);
        }
    }

    fn entry(&self, inner: &str) -> Option<&Entry> {
        self.source.space_entries(&self.plan.space).find(|(p, _)| *p == inner).map(|(_, e)| e)
    }

    fn transform(&self, source: &str, text: &str, op: TextOp, note: &str) -> Result<Vec<u8>, ImportError> {
        let fail = |reason| ImportError::Transform { note: Some(note.to_string()), reason };
        match self.env.transformer.transform(source, text.as_bytes(), &[op]) {
            Ok(Transformed::Bytes(bytes, _)) => Ok(bytes),
            Ok(Transformed::Unchanged) => Err(fail(TransformReason::Engine)),
            Err(tegg_jobs::TransformError::Unavailable) => Err(fail(TransformReason::Unavailable)),
            Err(tegg_jobs::TransformError::Timeout) => Err(fail(TransformReason::Timeout)),
            Err(tegg_jobs::TransformError::Engine(_)) => Err(fail(TransformReason::Engine)),
        }
    }

    /// §9.2 step 5: every object's text and the report's, ids in write order. Nothing is written.
    fn render(&self, ctx: &ImportCtx<'_>) -> Result<(), ImportError> {
        let plan = &self.plan;
        let paths: Paths = render::plan_paths(plan, &self.target.existing_files(ctx));
        let now = self.now_local();
        let types = render::type_files(plan, &|key| self.target.type_file(key)).map_err(|reason| ImportError::Io { reason })?;
        let imported: Vec<&PlannedObject> = plan.objects.iter().filter(|o| o.outcome == ObjectOutcome::Imported && o.path.is_some()).collect();
        let total = imported.len() as u64;
        let mut objects = Vec::new();
        for (i, o) in imported.iter().enumerate() {
            if ctx.cancelled() {
                return Err(ImportError::Cancelled);
            }
            self.emit(ImportPhase::Planning, None, i as u64, total, false);
            let path = o.path.clone().unwrap_or_default();
            let id = (self.env.ids)();
            let bytes = if o.kind == ObjectKind::OrphanMedia {
                self.transform(&path, "", TextOp::ImportNew { spec: Arc::new(render::media_spec(o, &id, &now)) }, &o.source)?
            } else {
                let changed = || ImportError::SourceChanged { entry: Some(o.source.clone()) };
                let entry = self.entry(&o.source).ok_or_else(changed)?;
                let raw = self.source.read(entry).map_err(|e| read_error(e, &o.source))?;
                let text = String::from_utf8(raw).map_err(|_| changed())?;
                let scan = planner::import_scan(&self.env, &o.source, &text).map_err(|_| ImportError::Transform { note: Some(o.source.clone()), reason: TransformReason::Engine })?;
                let spec = render::note_spec(plan, o, &scan, &id, &now, &paths, &self.env.strings).map_err(|_| changed())?;
                self.transform(&path, &text, TextOp::ImportNote { spec: Arc::new(spec) }, &o.source)?
            };
            objects.push(Rendered { path, kind: FileKind::Object, bytes });
        }
        let id = (self.env.ids)();
        let mut data = plan.report.clone();
        data.summary.backup = lock(&self.state).backup.clone();
        let spec = render::report_spec(plan, &data, &id, &now, &paths, &self.env.strings);
        let bytes = self.transform(&plan.report_path, "", TextOp::ImportNew { spec: Arc::new(spec) }, &plan.report_path)?;
        let mut s = lock(&self.state);
        s.types = types;
        s.objects = objects;
        s.report = Some(Rendered { path: plan.report_path.clone(), kind: FileKind::Report, bytes });
        Ok(())
    }

    /// §9.4: the sequence for one created file, with its points; the same for a journal or none.
    pub fn create_file(&self, sink: &dyn FileSink, path: &str, kind: FileKind, src: Src<'_>) -> Result<(), ImportError> {
        let write_error = |e: &io::Error| ImportError::Write { path: path.to_string(), reason: e.to_string() };
        sink.ensure_dir(folder_of(path))?;
        sink.intent(path, &src)?;
        if let PointAction::Fail(k) = self.point(ImportPoint::BeforeTemp { path: path.to_string(), kind }) {
            sink.not_created(path);
            return Err(write_error(&io::Error::from(k)));
        }
        let staged = match &src {
            Src::Bytes(bytes) => sink.stage(path, &mut &bytes[..]),
            Src::Entry { entry, inner } => match self.source.with_reader(entry, &mut |r| sink.stage(path, r)) {
                Ok(staged) => staged,
                Err(fail) => {
                    sink.not_created(path);
                    return Err(read_error(fail, inner));
                }
            },
        };
        let staged = staged.map_err(|e| {
            sink.not_created(path);
            write_error(&e)
        })?;
        if let Err(e) = sink.staged(&staged) {
            sink.discard(staged);
            sink.not_created(path);
            return Err(e);
        }
        if let PointAction::Fail(k) = self.point(ImportPoint::TempWritten { path: path.to_string(), kind }) {
            sink.discard(staged);
            sink.not_created(path);
            return Err(write_error(&io::Error::from(k)));
        }
        if let Err(e) = sink.commit(staged) {
            sink.not_created(path);
            return Err(if e.kind() == io::ErrorKind::AlreadyExists { ImportError::FileAppeared { path: path.to_string() } } else { write_error(&e) });
        }
        let _ = self.point(ImportPoint::Renamed { path: path.to_string(), kind });
        sink.committed(path)?;
        if kind != FileKind::Marker {
            let (done, total) = {
                let mut s = lock(&self.state);
                s.written.push(path.to_string());
                s.done += 1;
                (s.done, s.total)
            };
            let step = match kind {
                FileKind::Marker | FileKind::VaultFile => WriteStep::Vault,
                FileKind::TypeFile => WriteStep::Types,
                FileKind::Attachment => WriteStep::Attachments,
                FileKind::Object => WriteStep::Objects,
                FileKind::Report => WriteStep::Report,
            };
            self.emit(ImportPhase::Writing, Some(step), done, total, false);
        }
        Ok(())
    }

    /// §9.4's order after the vault's own files: new type files, attachments, objects, the report.
    pub fn write_content(&self, sink: &dyn FileSink, ctx: &ImportCtx<'_>, type_files: &[TypeWrite]) -> Result<(), ImportError> {
        for t in type_files {
            self.create_file(sink, &t.path, FileKind::TypeFile, Src::Bytes(t.text.as_bytes()))?;
        }
        for a in self.plan.attachments.iter().filter(|a| a.outcome == AttachmentOutcome::Imported) {
            let Some(path) = &a.path else { continue };
            let entry = self.entry(&a.source).ok_or_else(|| ImportError::SourceGone { entry: Some(a.source.clone()) })?;
            self.create_file(sink, path, FileKind::Attachment, Src::Entry { entry, inner: &a.source })?;
        }
        let (objects, report) = {
            let mut s = lock(&self.state);
            (std::mem::take(&mut s.objects), s.report.take())
        };
        for r in objects.iter().chain(report.iter()) {
            self.create_file(sink, &r.path, r.kind, Src::Bytes(&r.bytes))?;
            ctx.step(lock(&self.state).done as usize);
        }
        Ok(())
    }

    fn fail(&self, e: ImportError) -> String {
        let text = format!("{e:?}");
        lock(&self.state).error = Some(e);
        text
    }
}

pub(crate) fn read_error(fail: ReadFail, inner: &str) -> ImportError {
    let entry = Some(inner.to_string());
    match fail {
        ReadFail::Gone => ImportError::SourceGone { entry },
        _ => ImportError::SourceChanged { entry },
    }
}

impl ImportJob for Job {
    fn title(&self) -> String {
        self.plan.space.clone()
    }
    fn source(&self) -> String {
        self.plan.source.name.clone()
    }
    fn prepare(&self, ctx: &ImportCtx<'_>) -> Result<usize, String> {
        let _unwind = Unwind(&*self.target);
        let _ = self.point(ImportPoint::BeforeChecks);
        self.source.check_space(&self.plan.space).map_err(|e| self.fail(e))?;
        if self.source.stamp(&self.plan.space) != self.plan.stamps.source {
            return Err(self.fail(ImportError::SourceChanged { entry: None }));
        }
        self.target.recheck(self, ctx).map_err(|e| self.fail(e))?;
        self.render(ctx).map_err(|e| self.fail(e))?;
        let _ = self.point(ImportPoint::Rendered);
        let total = {
            let mut s = lock(&self.state);
            let attachments = self.plan.attachments.iter().filter(|a| a.outcome == AttachmentOutcome::Imported).count();
            s.total = (s.types.len() + s.objects.len() + attachments + 1) as u64;
            s.total
        };
        Ok(total as usize)
    }
    fn needs_backup(&self, ctx: &ImportCtx<'_>) -> bool {
        self.target.needs_backup(self, ctx)
    }
    fn backup_time(&self) -> Option<DateTime<Utc>> {
        Some(self.now)
    }
    fn before_backup(&self, _ctx: &ImportCtx<'_>) -> Result<(), String> {
        let _unwind = Unwind(&*self.target);
        let _ = self.point(ImportPoint::BeforeBackup);
        Ok(())
    }
    fn after_backup(&self, _ctx: &ImportCtx<'_>, zip: &str) -> Result<(), String> {
        let _unwind = Unwind(&*self.target);
        lock(&self.state).backup = Some(zip.to_string());
        let _ = self.point(ImportPoint::AfterBackup);
        Ok(())
    }
    fn write(&self, ctx: &ImportCtx<'_>) -> Result<(), String> {
        let _unwind = Unwind(&*self.target);
        self.target.write(self, ctx).map_err(|e| self.fail(e))
    }
    fn finished(&self, phase: Phase, error: Option<&str>) {
        self.target.release(false);
        let mut s = lock(&self.state);
        let done = phase == Phase::Done;
        let report = ImportReport {
            job: *lock(&self.shared.job),
            phase,
            error: match phase {
                Phase::Done => None,
                Phase::Cancelled => None,
                _ => s.error.take().or_else(|| Some(ImportError::Io { reason: error.unwrap_or("failed").to_string() })),
            },
            vault: s.vault.clone().filter(|_| done),
            vault_name: s.vault_name.clone(),
            written: if done { std::mem::take(&mut s.written) } else { Vec::new() },
            report_path: done.then(|| self.plan.report_path.clone()),
            renamed: std::mem::take(&mut s.renamed),
            backup: s.backup.clone(),
            kept: std::mem::take(&mut s.kept),
            totals: self.plan.totals.clone(),
        };
        let (d, t) = (s.done, s.total);
        drop(s);
        let last = match phase {
            Phase::Done => ImportPhase::Done,
            Phase::Cancelled => ImportPhase::Cancelled,
            _ => ImportPhase::Failed,
        };
        self.emit(last, None, if done { t } else { d }, t, true);
        *lock(&self.shared.report) = Some(report);
        self.shared.done.notify_all();
    }
}

/// §9: validates the plan, runs the cheap checks, and queues the job. `Err`: no job was created, nothing written.
pub fn start(plan: Plan, scan: &Scan, target: &Target<'_>, env: &ImportEnv) -> Result<ImportRun, ImportError> {
    let folder_of_type = |key: &str| -> Option<String> {
        match target {
            Target::NewVault { .. } => planner::empty_vault_types().into_iter().find(|t| t.key == key).map(|t| t.folder),
            Target::Existing(core) => core.types().into_iter().find(|t| t.key == key).map(|t| t.def.folder),
        }
    };
    render::validate(&plan, scan, target, &folder_of_type)?;
    let now = (env.clock)();
    scan.source.check_space(&plan.space)?;
    if scan.source.stamp(&plan.space) != plan.stamps.source {
        return Err(ImportError::SourceChanged { entry: None });
    }
    match target {
        Target::NewVault { parent, name } => newvault::start(plan, scan, parent, name, env, now),
        // todo: Owner C — the existing-vault target: a `TargetSink` + `FileSink` over `core.jobs()` and the journal.
        Target::Existing(_) => Err(ImportError::Io { reason: "existing vault: not implemented yet".to_string() }),
    }
}
