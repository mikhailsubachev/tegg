//! Slice I2, the Import window's shell side (docs/contracts/v1-import-window.md §1, §2, §4.1, §8): one import
//! session (scan, plans, the run), the ten `import_*` commands and their events, the transformer over the main
//! window's worker (`import:transform`), the forwarding gates of `Core`s the session keeps alive across a vault
//! switch (§1.2), the process-wide ids of forwarded `job:transform` requests, and the test hooks.
//!
//! Nothing here writes before `import_start` (FR-SYN-06 AC-45): the session is memory only (D-1528).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tegg_core::tegg_jobs::{self, JobProgress, TextOp, TransformError, Transformed, Transformer};
use tegg_core::{AppDirs, Core, Vault};
use tegg_import::{
    CancelToken, Control, Disk, ImportEnv, ImportError, ImportPoint, ImportProgress, ImportReport, ImportRun, Mapping, Plan, PlanTarget, PointAction,
    ReportStrings, Scan, ScanInfo, SystemDisk, Target,
};

use crate::dto::{IpcError, TransformedDto};
use crate::{err, mark_repeat, test_var, AppState};

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

// ------------------------------------------------------------------------------------------------ the session (§1.1)

pub(crate) enum StoredTarget {
    NewVault { parent: PathBuf, name: String },
    Existing(Arc<Core>),
    /// A final run's existing vault: its canonical root, no `Core` held (§1.2).
    Released(PathBuf),
}
impl StoredTarget {
    fn kind(&self) -> &'static str {
        match self {
            StoredTarget::NewVault { .. } => "newVault",
            _ => "existing",
        }
    }
}

struct StoredPlan {
    plan: Plan,
    target: StoredTarget,
    space: String,
    no_space: Option<(u64, u64)>,
    /// The plan `import_where` made against the open vault with `Mapping::default()` (§2.3).
    from_where: bool,
}

struct Work {
    id: u64,
    kind: &'static str,
    cancel: CancelToken,
}

struct RunState {
    run: Arc<ImportRun>,
    plan: Plan,
    target: StoredTarget,
    space: String,
    files: u64,
    last: Option<Value>,
    result: Option<Value>,
}

#[derive(Default)]
pub(crate) struct ImportSession {
    source_path: Option<PathBuf>,
    scan: Option<Arc<Scan>>,
    /// Bumped with every new scan, so a plan made from an older one is answered `Cancelled`.
    scan_gen: u64,
    plans: BTreeMap<u64, StoredPlan>,
    latest: Option<u64>,
    work: Option<Work>,
    starting: bool,
    /// The started plan's `Core` between `import_start` taking it out of `plans` and storing the run, so `held_core`
    /// sees it all along and a switch away and back reattaches it instead of opening a second `Core` (§1.2).
    start_core: Option<Arc<Core>>,
    run: Option<RunState>,
    memo: Arc<ScanMemo>,
}
impl ImportSession {
    fn run_live(&self) -> bool {
        self.starting || self.run.as_ref().is_some_and(|r| r.result.is_none())
    }
    fn drop_scan(&mut self) {
        self.scan = None;
        self.plans.clear();
        self.latest = None;
        self.memo = Arc::default();
    }
}

#[derive(Default)]
pub(crate) struct ImportShared {
    session: Mutex<ImportSession>,
}

pub(crate) fn new_shared() -> Arc<ImportShared> {
    Arc::default()
}

static NEXT: AtomicU64 = AtomicU64::new(1);
fn next_id() -> u64 {
    NEXT.fetch_add(1, Ordering::SeqCst)
}

// ------------------------------------------------------------------------------------------------ errors (§2)

fn import_err(e: ImportError) -> IpcError {
    let value = serde_json::to_value(&e).unwrap_or(Value::Null);
    let code = value.get("code").and_then(Value::as_str).unwrap_or("io").to_string();
    let mut kind = code.clone();
    if let Some(first) = kind.get(..1) {
        kind = format!("{}{}", first.to_uppercase(), &kind[1..]);
    }
    IpcError { import: Some(value), ..err(&kind, format!("{e:?}")) }
}

// ------------------------------------------------------------------------------------------------ the transformer (§1.3)

/// `tegg_jobs::Transformer` over the main window's transform worker, independent of any `Core`.
pub(crate) struct ImportBridge {
    app: AppHandle,
    /// Requests waiting for an answer (`None`) and answers not yet taken; an id is here only while its request waits,
    /// so an answer after the 30 s timeout is dropped, not kept.
    replies: Mutex<HashMap<u64, Option<Result<Transformed, TransformError>>>>,
    replied: Condvar,
}

static BRIDGE: OnceLock<Arc<ImportBridge>> = OnceLock::new();
fn bridge(app: &AppHandle) -> Arc<ImportBridge> {
    BRIDGE.get_or_init(|| Arc::new(ImportBridge { app: app.clone(), replies: Mutex::default(), replied: Condvar::new() })).clone()
}

impl Transformer for ImportBridge {
    fn transform(&self, source: &str, bytes: &[u8], ops: &[TextOp]) -> Result<Transformed, TransformError> {
        let id = next_id();
        let ops: Vec<Value> = ops.iter().map(tegg_jobs::op_json).collect();
        let text = String::from_utf8_lossy(bytes).into_owned();
        lock(&self.replies).insert(id, None);
        if self.app.emit_to("main", "import:transform", json!({ "requestId": id, "source": source, "text": text, "ops": ops })).is_err() {
            lock(&self.replies).remove(&id);
            return Err(TransformError::Unavailable);
        }
        let until = Instant::now() + Duration::from_secs(30);
        let mut replies = lock(&self.replies);
        loop {
            if let Some(Some(_)) = replies.get(&id) {
                if let Some(Some(r)) = replies.remove(&id) {
                    return r;
                }
            }
            let Some(left) = until.checked_duration_since(Instant::now()) else {
                replies.remove(&id);
                return Err(TransformError::Timeout);
            };
            replies = self.replied.wait_timeout(replies, left).unwrap_or_else(|p| p.into_inner()).0;
        }
    }
}

/// `import-scan` answers of one scan, by (source path, BLAKE3 of the text) (§1.3, contract choice §12 (3)).
#[derive(Default)]
pub(crate) struct ScanMemo(Mutex<HashMap<(String, [u8; 32]), Result<Transformed, TransformError>>>);

struct MemoTransformer {
    inner: Arc<ImportBridge>,
    memo: Arc<ScanMemo>,
}
impl Transformer for MemoTransformer {
    fn transform(&self, source: &str, bytes: &[u8], ops: &[TextOp]) -> Result<Transformed, TransformError> {
        let scan_only = matches!(ops, [TextOp::ImportScan]);
        if !scan_only {
            return self.inner.transform(source, bytes, ops);
        }
        let key = (source.to_string(), *blake3::hash(bytes).as_bytes());
        if let Some(r) = lock(&self.memo.0).get(&key) {
            return r.clone();
        }
        let r = self.inner.transform(source, bytes, ops);
        if r.is_ok() {
            lock(&self.memo.0).insert(key, r.clone());
        }
        r
    }
}

pub(crate) fn transformed_from(result: TransformedDto) -> Result<Transformed, TransformError> {
    match (result.error, result.kind.as_deref()) {
        (Some(e), _) => Err(TransformError::Engine(e)),
        (None, Some("unchanged")) => Ok(Transformed::Unchanged),
        (None, Some("bytes")) => Ok(Transformed::Bytes(
            result.text.unwrap_or_default().into_bytes(),
            result.edits.unwrap_or_default().into_iter().map(|e| tegg_jobs::Edit { start: e.start as usize, end: e.end as usize }).collect(),
        )),
        _ => Err(TransformError::Engine("unknown answer".into())),
    }
}

#[tauri::command]
pub(crate) async fn import_transform_result(app: AppHandle, request_id: u64, result: TransformedDto) -> Result<(), IpcError> {
    let b = bridge(&app);
    // Only a request still waiting takes an answer; a late one (after the timeout) or an unknown id is dropped.
    if let Some(slot) = lock(&b.replies).get_mut(&request_id) {
        *slot = Some(transformed_from(result));
    }
    b.replied.notify_all();
    Ok(())
}

// ------------------------------------------------------------------------------------------------ forwarding gates (§1.2)

/// The gate of one `Core`'s forwarding thread: open while the `Core` is `AppState.core`; while closed, the thread
/// drops the vault's events and holds back its `job:transform` requests.
#[derive(Default)]
pub(crate) struct Gate {
    inner: Mutex<(bool, Vec<Value>)>,
}
impl Gate {
    pub(crate) fn is_open(&self) -> bool {
        lock(&self.inner).0
    }
    /// A `job:transform` request: emitted now, or held while the gate is closed.
    pub(crate) fn transform(&self, app: &AppHandle, payload: Value) {
        let mut g = lock(&self.inner);
        if g.0 {
            let _ = app.emit_to("main", "job:transform", payload);
        } else {
            g.1.push(payload);
        }
    }
    pub(crate) fn close(&self) {
        lock(&self.inner).0 = false;
    }
    pub(crate) fn reopen(&self, app: &AppHandle) {
        let mut g = lock(&self.inner);
        g.0 = true;
        for p in std::mem::take(&mut g.1) {
            let _ = app.emit_to("main", "job:transform", p);
        }
    }
}

static GATES: Mutex<Vec<(Weak<Core>, Arc<Gate>)>> = Mutex::new(Vec::new());

/// Called once per `Core`, when it is opened: its forwarding thread's gate, open.
pub(crate) fn register_core(core: &Arc<Core>) -> Arc<Gate> {
    let gate = Arc::new(Gate { inner: Mutex::new((true, Vec::new())) });
    let mut gates = lock(&GATES);
    gates.retain(|(w, _)| w.strong_count() > 0);
    gates.push((Arc::downgrade(core), gate.clone()));
    gate
}
pub(crate) fn gate_of(core: &Arc<Core>) -> Option<Arc<Gate>> {
    lock(&GATES).iter().find(|(w, _)| w.upgrade().is_some_and(|c| Arc::ptr_eq(&c, core))).map(|(_, g)| g.clone())
}

/// Forwarded `job:transform` requests: process-wide id → (the `Core` that asked, its own request id, when it asked).
static TRANSFORMS: Mutex<Option<HashMap<u64, (Weak<Core>, u64, Instant)>>> = Mutex::new(None);
/// How long a forwarded request is kept unanswered: past the jobs' own timeouts (10 s, a live file 30 s), the `Core`
/// stopped waiting, so the entry is dropped (a held request behind a closed gate as well).
const TRANSFORM_KEEP: Duration = Duration::from_secs(60);

fn prune_transforms(m: &mut HashMap<u64, (Weak<Core>, u64, Instant)>) {
    m.retain(|_, (w, _, at)| w.strong_count() > 0 && at.elapsed() < TRANSFORM_KEEP);
}

pub(crate) fn route_transform(core: Weak<Core>, own: u64) -> u64 {
    let id = next_id();
    let mut g = lock(&TRANSFORMS);
    let m = g.get_or_insert_with(HashMap::new);
    prune_transforms(m);
    m.insert(id, (core, own, Instant::now()));
    id
}
/// `job_transform_result`: the answer goes to the `Core` that asked; a released one, a timed-out or an unknown id:
/// dropped.
pub(crate) fn answer_transform(id: u64, result: Result<Transformed, TransformError>) {
    let entry = {
        let mut g = lock(&TRANSFORMS);
        g.as_mut().and_then(|m| {
            let e = m.remove(&id);
            prune_transforms(m);
            e
        })
    };
    if let Some((weak, own, _)) = entry.filter(|(_, _, at)| at.elapsed() < TRANSFORM_KEEP) {
        if let Some(core) = weak.upgrade() {
            core.jobs().transform_result(own, result);
        }
    }
}

// ------------------------------------------------------------------------------------------------ queued (§2.4)

/// The running existing-vault import's job id, and `queued` events seen before `import_start` returned it.
#[derive(Default)]
struct RunJob {
    job: Option<u64>,
    held: Vec<u64>,
}
static RUN_JOB: Mutex<RunJob> = Mutex::new(RunJob { job: None, held: Vec::new() });

fn queued_event(app: &AppHandle) {
    let _ = app.emit_to(
        "main",
        "import:progress",
        json!({ "phase": "planning", "step": null, "done": 0, "total": 0, "stepDone": 0, "stepTotal": 0, "counts": null, "job": lock(&RUN_JOB).job, "queued": true }),
    );
}

/// Called by every `Core`'s forwarding thread for each `JobProgress`, before its gate.
pub(crate) fn job_progress(app: &AppHandle, p: &JobProgress) {
    if p.kind != tegg_jobs::JobKind::Import || p.phase != tegg_jobs::Phase::Queued {
        return;
    }
    let mut r = lock(&RUN_JOB);
    match r.job {
        Some(j) if j == p.job => {
            drop(r);
            queued_event(app);
        }
        Some(_) => {}
        None => r.held.push(p.job),
    }
}

// ------------------------------------------------------------------------------------------------ the environment (§1.1, §8)

fn pace_ms() -> Option<u64> {
    test_var("TEGG_TEST_IMPORT_PACE").and_then(|v| v.parse().ok()).filter(|ms| *ms > 0)
}

static LAUNCH: OnceLock<Instant> = OnceLock::new();
pub(crate) fn note_launch() {
    let _ = LAUNCH.get_or_init(Instant::now);
}

fn clock() -> Arc<dyn Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync> {
    let fixed = test_var("TEGG_NOW").and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()).map(|t| t.with_timezone(&chrono::Utc));
    let launch = *LAUNCH.get_or_init(Instant::now);
    match fixed {
        Some(t) => Arc::new(move || t + chrono::Duration::from_std(launch.elapsed()).unwrap_or_default()),
        None => Arc::new(chrono::Utc::now),
    }
}

fn zone() -> chrono_tz::Tz {
    test_var("TZ").and_then(|z| z.parse().ok()).unwrap_or_else(crate::local_tz)
}

/// A ULID (Crockford base 32): 48 bits of milliseconds, 80 random bits.
fn ulid() -> String {
    use std::hash::{BuildHasher, Hasher};
    const A: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let ms = now.as_millis() & ((1 << 48) - 1);
    let rnd = |k: u64| {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(k);
        h.write_u128(now.as_nanos());
        h.finish()
    };
    let r = (((rnd(1) as u128) << 16) ^ rnd(2) as u128) & ((1u128 << 80) - 1);
    let v = (ms << 80) | r;
    (0..26).rev().map(|i| A[((v >> (i * 5)) & 31) as usize] as char).collect()
}

/// `TEGG_TEST_IMPORT_FREE=<bytes>`: the free space the engine sees (R153 `NoSpace`).
struct FixedFree(u64);
impl Disk for FixedFree {
    fn free(&self, _: &Path) -> std::io::Result<u64> {
        Ok(self.0)
    }
    fn volume(&self, path: &Path) -> std::io::Result<u64> {
        SystemDisk.volume(path)
    }
}
/// The second plan of a `NoSpace` answer (§2.3): unlimited space.
struct Unlimited;
impl Disk for Unlimited {
    fn free(&self, _: &Path) -> std::io::Result<u64> {
        Ok(u64::MAX)
    }
    fn volume(&self, path: &Path) -> std::io::Result<u64> {
        SystemDisk.volume(path)
    }
}

/// `TEGG_TEST_IMPORT_PACE` (writing, the run's planning and backup) and `TEGG_TEST_IMPORT_FAIL=<kind>:<n>:<errno>`.
fn points() -> Option<tegg_import::PointHook> {
    let pace = pace_ms();
    let fail = test_var("TEGG_TEST_IMPORT_FAIL").and_then(|v| {
        let mut it = v.splitn(3, ':');
        let kind = match it.next()? {
            "object" => tegg_import::FileKind::Object,
            "attachment" => tegg_import::FileKind::Attachment,
            "typeFile" => tegg_import::FileKind::TypeFile,
            "report" => tegg_import::FileKind::Report,
            _ => return None,
        };
        let n: usize = it.next()?.parse().ok()?;
        let errno = match it.next()? {
            "StorageFull" => std::io::ErrorKind::StorageFull,
            "PermissionDenied" => std::io::ErrorKind::PermissionDenied,
            _ => return None,
        };
        Some((kind, n, errno))
    });
    if pace.is_none() && fail.is_none() {
        return None;
    }
    let seen = Arc::new(Mutex::new(0usize));
    Some(Arc::new(move |p: &ImportPoint| {
        match p {
            ImportPoint::BeforeChecks | ImportPoint::BeforeBackup => {
                if let Some(ms) = pace {
                    std::thread::sleep(Duration::from_millis(ms));
                }
            }
            ImportPoint::BeforeTemp { kind, .. } => {
                if let Some(ms) = pace {
                    std::thread::sleep(Duration::from_millis(ms));
                }
                if let Some((k, n, errno)) = &fail {
                    if kind == k {
                        let mut s = lock(&seen);
                        *s += 1;
                        if *s == *n {
                            return PointAction::Fail(*errno);
                        }
                    }
                }
            }
            _ => {}
        }
        PointAction::Continue
    }))
}

fn env(app: &AppHandle, memo: &Arc<ScanMemo>, strings: ReportStrings) -> ImportEnv {
    let dirs: AppDirs = app.state::<AppState>().dirs.clone();
    let disk: Arc<dyn Disk> = match test_var("TEGG_TEST_IMPORT_FREE").and_then(|v| v.parse::<u64>().ok()) {
        Some(n) => Arc::new(FixedFree(n)),
        None => Arc::new(SystemDisk),
    };
    ImportEnv {
        clock: clock(),
        zone: zone(),
        ids: Arc::new(ulid),
        transformer: Arc::new(MemoTransformer { inner: bridge(app), memo: memo.clone() }),
        dirs,
        disk,
        trash: Arc::new(crate::shell6a::MacTrash),
        strings,
        points: points(),
    }
}

/// `Control` of a scan or a plan: its cancel token, and a sink forwarding `import:progress` (paced by
/// `TEGG_TEST_IMPORT_PACE`: the sink sleeps before it forwards, so the scanning thread waits, §8).
fn control(app: &AppHandle, cancel: &CancelToken) -> Control {
    let app = app.clone();
    let pace = pace_ms();
    Control {
        cancel: cancel.clone(),
        progress: Some(Arc::new(move |p: &ImportProgress| {
            if let Some(ms) = pace {
                std::thread::sleep(Duration::from_millis(ms));
            }
            let _ = app.emit_to("main", "import:progress", progress_dto(p, false));
        })),
    }
}

fn progress_dto(p: &ImportProgress, queued: bool) -> Value {
    let mut v = serde_json::to_value(p).unwrap_or(Value::Null);
    if let Some(o) = v.as_object_mut() {
        o.insert("queued".into(), Value::Bool(queued));
    }
    v
}

// ------------------------------------------------------------------------------------------------ helpers

fn shared(state: &State<'_, AppState>) -> Arc<ImportShared> {
    state.import.clone()
}

fn open_core(state: &State<'_, AppState>) -> Option<Arc<Core>> {
    lock(&state.core).clone()
}

fn busy() -> IpcError {
    err("Busy", "an import is running")
}
fn no_session() -> IpcError {
    err("NoSession", "no export was read")
}

fn home() -> Option<PathBuf> {
    std::env::var("HOME").ok().filter(|h| !h.is_empty()).map(PathBuf::from)
}
fn display(path: &Path) -> String {
    let s = path.to_string_lossy().into_owned();
    match home() {
        Some(h) => {
            let h = h.to_string_lossy().into_owned();
            match s.strip_prefix(&h) {
                Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("~{rest}"),
                _ => s,
            }
        }
        None => s,
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewVaultDto {
    parent: String,
    name: String,
    path: String,
    display: String,
    problem: Option<&'static str>,
}

/// The read-only target check of a new vault (§2.3), with D-1581's one missing level.
fn check_target(parent: &Path, raw_name: &str, source: Option<&Path>) -> NewVaultDto {
    let name = tegg_format::nfc(&tegg_format::sanitize_file_stem(raw_name));
    let parent_s = tegg_format::nfc(&parent.to_string_lossy());
    let path = Path::new(&parent_s).join(&name);
    let problem = (|| {
        if name.is_empty() {
            return Some("invalidName");
        }
        let Ok(p) = tegg_vault::probe_new_vault(parent, &name) else { return Some("targetNotWritable") };
        if !(p.parent_is_dir || p.parent_creatable) || !p.writable {
            return Some("targetNotWritable");
        }
        if p.inside_vault {
            return Some("targetInsideVault");
        }
        if let Some(src) = source.filter(|s| s.is_dir()) {
            if tegg_vault::is_inside(&p.parent, src).unwrap_or(false) {
                return Some("targetInsideSource");
            }
        }
        if p.final_exists || (p.temp_exists && p.marker.is_none()) {
            return Some("targetExists");
        }
        None
    })();
    NewVaultDto { display: display(&path), path: path.to_string_lossy().into_owned(), parent: parent_s, name, problem }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TargetAttrDto {
    key: String,
    name: String,
    r#type: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusDto {
    label: String,
    state: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TargetTypeDto {
    key: String,
    name: String,
    plural: String,
    system: bool,
    attributes: Vec<TargetAttrDto>,
    statuses: Option<Vec<StatusDto>>,
}

fn target_type(t: &tegg_schema::TypeFile) -> TargetTypeDto {
    let statuses = (t.key == "task").then(|| {
        t.attributes
            .iter()
            .find(|a| a.key == "status")
            .map(|a| {
                a.options
                    .iter()
                    .map(|o| StatusDto { label: o.label.clone(), state: tegg_schema::option_state(o).unwrap_or("open").replace('-', " ") })
                    .collect()
            })
            .unwrap_or_default()
    });
    TargetTypeDto {
        key: t.key.clone(),
        name: t.name.clone(),
        plural: t.plural.clone(),
        system: t.system,
        attributes: t.attributes.iter().map(|a| TargetAttrDto { key: a.key.clone(), name: a.name.clone(), r#type: a.r#type.as_str().to_string() }).collect(),
        statuses,
    }
}

fn target_types(target: &StoredTarget) -> Vec<TargetTypeDto> {
    match target {
        StoredTarget::Existing(core) => core.types().into_iter().filter(|t| !t.invalid).map(|t| target_type(&t.def)).collect(),
        _ => tegg_vault::EMPTY_VAULT
            .iter()
            .filter_map(|(path, text)| path.strip_prefix(".tegg/types/").and_then(|f| f.strip_suffix(".yml")).map(|key| tegg_schema::parse(key, text).def))
            .map(|d| target_type(&d))
            .collect(),
    }
}

fn plan_result(token: u64, sp: &StoredPlan) -> Value {
    json!({
        "token": token,
        "plan": serde_json::to_value(&sp.plan).unwrap_or(Value::Null),
        "noSpace": sp.no_space.map(|(needed, free)| json!({ "needed": needed, "free": free })),
        "targetTypes": target_types(&sp.target),
    })
}

/// `tegg_import::plan`, and on `NoSpace` the same plan with unlimited space and the flag (§2.3).
fn plan_with_space(scan: &Scan, space: &str, target: &Target<'_>, mapping: &Mapping, env: &ImportEnv, ctl: &Control) -> Result<(Plan, Option<(u64, u64)>), ImportError> {
    match tegg_import::plan(scan, space, target, mapping, env, ctl) {
        Ok(p) => Ok((p, None)),
        Err(ImportError::NoSpace { needed, free }) => {
            let mut e = env.clone();
            e.disk = Arc::new(Unlimited);
            tegg_import::plan(scan, space, target, mapping, &e, ctl).map(|p| (p, Some((needed, free))))
        }
        Err(e) => Err(e),
    }
}

/// Waits for the open vault's first index build (up to 60 s), as `import_where` does (§2.3).
fn plan_waiting(scan: &Scan, space: &str, target: &Target<'_>, mapping: &Mapping, env: &ImportEnv, ctl: &Control) -> Result<(Plan, Option<(u64, u64)>), ImportError> {
    let until = Instant::now() + Duration::from_secs(60);
    loop {
        match plan_with_space(scan, space, target, mapping, env, ctl) {
            Err(ImportError::IndexNotReady) if Instant::now() < until && !ctl.cancel.is_cancelled() => std::thread::sleep(Duration::from_millis(200)),
            other => return other,
        }
    }
}

// ------------------------------------------------------------------------------------------------ commands (§2.1)

#[tauri::command]
pub(crate) async fn import_pick_source(app: AppHandle, kind: String) -> Option<String> {
    if std::env::var("TEGG_TEST").as_deref() == Ok("1") {
        if kind == "zip" {
            if let Ok(f) = std::env::var("TEGG_TEST_PICK_FILE") {
                return if f.is_empty() { None } else { Some(f) };
            }
        } else {
            for var in ["TEGG_TEST_PICK_SOURCE_DIR", "TEGG_TEST_PICK_DIR"] {
                if let Ok(d) = std::env::var(var) {
                    return if d.is_empty() { None } else { Some(d) };
                }
            }
        }
    }
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = std::sync::mpsc::channel();
    let send = move |p: Option<tauri_plugin_dialog::FilePath>| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()));
    };
    if kind == "zip" {
        app.dialog().file().add_filter("Zip", &["zip"]).pick_file(send);
    } else {
        app.dialog().file().pick_folder(send);
    }
    rx.recv().ok().flatten()
}

#[tauri::command]
pub(crate) async fn import_scan(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<ScanInfo, IpcError> {
    let p = PathBuf::from(tegg_format::nfc(&path));
    let is_zip = p.file_name().is_some_and(|n| n.to_string_lossy().to_ascii_lowercase().ends_with(".zip")) && !p.is_dir();
    if !p.is_dir() && !is_zip {
        return Err(err("NotASource", "neither a folder nor a .zip file"));
    }
    let sh = shared(&state);
    let (id, cancel, memo) = {
        let mut s = lock(&sh.session);
        if s.run_live() {
            return Err(busy());
        }
        if let Some(w) = s.work.take() {
            w.cancel.cancel();
        }
        s.drop_scan();
        s.scan_gen += 1;
        s.source_path = Some(p.clone());
        let id = next_id();
        let cancel = CancelToken::new();
        s.work = Some(Work { id, kind: "scan", cancel: cancel.clone() });
        (id, cancel, s.memo.clone())
    };
    let e = env(&app, &memo, ReportStrings::english());
    let ctl = control(&app, &cancel);
    let path2 = p.clone();
    let r = tauri::async_runtime::spawn_blocking(move || tegg_import::scan(&path2, &e, &ctl)).await.map_err(|e| err("Io", e))?;
    let mut s = lock(&sh.session);
    let mine = s.work.as_ref().is_some_and(|w| w.id == id);
    if mine {
        s.work = None;
    }
    match r {
        Ok(scan) if mine => {
            let info = scan.info.clone();
            s.scan = Some(Arc::new(scan));
            Ok(info)
        }
        Ok(_) => Err(import_err(ImportError::Cancelled)),
        Err(e) => Err(import_err(e)),
    }
}

#[derive(Serialize)]
pub(crate) struct Stopped {
    stopped: &'static str,
}

#[tauri::command]
pub(crate) async fn import_cancel(state: State<'_, AppState>) -> Result<Stopped, IpcError> {
    let sh = shared(&state);
    let mut s = lock(&sh.session);
    if let Some(w) = s.work.take() {
        w.cancel.cancel();
        return Ok(Stopped { stopped: w.kind });
    }
    if let Some(r) = s.run.as_ref().filter(|r| r.result.is_none()) {
        r.run.cancel().map_err(import_err)?;
        return Ok(Stopped { stopped: "run" });
    }
    Ok(Stopped { stopped: "nothing" })
}

/// D-1537, D-1575, D-1581: the new vault's proposed place.
fn proposed_parent(state: &State<'_, AppState>) -> PathBuf {
    if let Some(core) = open_core(state) {
        if let Some(p) = core.vault().root().parent() {
            return p.to_path_buf();
        }
    }
    if let Some(r) = Vault::recent(&state.dirs).into_iter().find(|r| r.exists) {
        if let Some(p) = r.path.parent() {
            return p.to_path_buf();
        }
    }
    home().unwrap_or_default().join("Documents").join("Tegg")
}

#[tauri::command]
pub(crate) async fn import_where(app: AppHandle, state: State<'_, AppState>, space: String) -> Result<Value, IpcError> {
    let sh = shared(&state);
    let (scan, source, memo) = {
        let s = lock(&sh.session);
        // QA: no `import_where` while a run is live (its plan would be stored next to the run's).
        if s.run_live() {
            return Err(busy());
        }
        (s.scan.clone().ok_or_else(no_session)?, s.source_path.clone(), s.memo.clone())
    };
    // The name: a fixed Rust string, never the catalog's (§2.3), with ` (2)`, ` (3)`… when taken now.
    let parent = proposed_parent(&state);
    let base = tegg_format::nfc(&tegg_format::sanitize_file_stem(&format!("Capacities · {space}")));
    let mut name = base.clone();
    let mut n = 2;
    while parent.join(&name).exists() || parent.join(format!("{name}.tegg-importing")).exists() {
        name = format!("{base} ({n})");
        n += 1;
    }
    let new_vault = check_target(&parent, &name, source.as_deref());
    // The open vault's plan; a vault switch while it was made plans the newly open vault instead (a plan for a
    // detached `Core` is never stored, §1.2).
    let mut tries = 0;
    let current = loop {
        tries += 1;
        let Some(core) = open_core(&state) else { break Value::Null };
        // The plan is the session's work: `import_cancel` stops it, a newer scan or plan supersedes it.
        let (id, cancel) = {
            let mut s = lock(&sh.session);
            if s.run_live() {
                return Err(busy());
            }
            if let Some(w) = s.work.take() {
                w.cancel.cancel();
            }
            let id = next_id();
            let cancel = CancelToken::new();
            s.work = Some(Work { id, kind: "plan", cancel: cancel.clone() });
            (id, cancel)
        };
        let e = env(&app, &memo, ReportStrings::english());
        let ctl = control(&app, &cancel);
        let (scan2, space2, core2) = (scan.clone(), space.clone(), core.clone());
        let r = tauri::async_runtime::spawn_blocking(move || plan_waiting(&scan2, &space2, &Target::Existing(&core2), &Mapping::default(), &e, &ctl))
            .await
            .map_err(|e| err("Io", e));
        let mut s = lock(&sh.session);
        let mine = s.work.as_ref().is_some_and(|w| w.id == id);
        if mine {
            s.work = None;
        }
        let (plan, no_space) = r?.map_err(import_err)?;
        if !mine || !s.scan.as_ref().is_some_and(|x| Arc::ptr_eq(x, &scan)) {
            return Err(import_err(ImportError::Cancelled));
        }
        // Still the open vault? (`open_vault` takes `AppState.core` before `vault_switched` drops `Existing` plans
        // under this lock, so a plan stored now is either current or dropped by that switch.)
        if !open_core(&state).is_some_and(|c| Arc::ptr_eq(&c, &core)) {
            drop(s);
            drop(plan);
            if tries < 3 {
                continue;
            }
            return Err(import_err(ImportError::Cancelled));
        }
        let notes = match &plan.target {
            PlanTarget::Existing { notes, .. } => *notes,
            _ => 0,
        };
        let root = core.vault().root().to_path_buf();
        let out = json!({
            "name": root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": root.to_string_lossy(),
            "notes": notes,
            "alreadyImported": plan.already_imported,
        });
        let token = next_id();
        let old: Vec<StoredPlan> = take_plans(&mut s, |p| p.from_where);
        s.plans.insert(token, StoredPlan { plan, target: StoredTarget::Existing(core), space: space.clone(), no_space, from_where: true });
        drop(s);
        drop(old);
        break out;
    };
    Ok(json!({ "newVault": new_vault, "current": current }))
}

/// Takes the stored plans `drop_if` matches out of the session, so their `Arc<Core>`s are dropped by the caller after
/// it lets go of the session's lock (a last `Arc<Core>` joins the `Core`'s worker, §1.2).
fn take_plans(s: &mut ImportSession, drop_if: impl Fn(&StoredPlan) -> bool) -> Vec<StoredPlan> {
    let (gone, keep): (BTreeMap<u64, StoredPlan>, BTreeMap<u64, StoredPlan>) = std::mem::take(&mut s.plans).into_iter().partition(|(_, p)| drop_if(p));
    s.plans = keep;
    if s.latest.is_some_and(|t| !s.plans.contains_key(&t)) {
        s.latest = None;
    }
    gone.into_values().collect()
}

#[tauri::command]
pub(crate) async fn import_check_target(state: State<'_, AppState>, parent: String, name: String) -> Result<NewVaultDto, IpcError> {
    let source = lock(&shared(&state).session).source_path.clone();
    Ok(check_target(Path::new(&parent), &name, source.as_deref()))
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum TargetArg {
    NewVault { parent: String, name: String },
    Existing,
}

#[tauri::command]
pub(crate) async fn import_plan(app: AppHandle, state: State<'_, AppState>, space: String, target: TargetArg, mapping: Mapping) -> Result<Value, IpcError> {
    let sh = shared(&state);
    let stored_target = match &target {
        TargetArg::NewVault { parent, name } => StoredTarget::NewVault { parent: PathBuf::from(tegg_format::nfc(parent)), name: tegg_format::nfc(name) },
        TargetArg::Existing => StoredTarget::Existing(open_core(&state).ok_or_else(|| err("NoVault", "no vault is open"))?),
    };
    let (scan, gen, id, cancel, memo) = {
        let mut s = lock(&sh.session);
        if s.run_live() {
            return Err(busy());
        }
        let scan = s.scan.clone().ok_or_else(no_session)?;
        // §2.3: the plan `import_where` made is the first `existing` plan with an empty mapping.
        if let StoredTarget::Existing(core) = &stored_target {
            if mapping == Mapping::default() {
                let hit = s.plans.iter().find(|(_, p)| p.from_where && p.space == space && matches!(&p.target, StoredTarget::Existing(c) if Arc::ptr_eq(c, core))).map(|(t, _)| *t);
                if let Some(token) = hit {
                    if let Some(w) = s.work.take() {
                        w.cancel.cancel();
                    }
                    s.latest = Some(token);
                    return Ok(plan_result(token, &s.plans[&token]));
                }
            }
        }
        // The latest call wins: an older plan answers `Cancelled`.
        if let Some(w) = s.work.take() {
            w.cancel.cancel();
        }
        let id = next_id();
        let cancel = CancelToken::new();
        s.work = Some(Work { id, kind: "plan", cancel: cancel.clone() });
        (scan, s.scan_gen, id, cancel, s.memo.clone())
    };
    let e = env(&app, &memo, ReportStrings::english());
    let ctl = control(&app, &cancel);
    let (scan2, space2) = (scan.clone(), space.clone());
    let core = match &stored_target {
        StoredTarget::Existing(c) => Some(c.clone()),
        _ => None,
    };
    let tgt = match &stored_target {
        StoredTarget::NewVault { parent, name } => Some((parent.clone(), name.clone())),
        _ => None,
    };
    let r = tauri::async_runtime::spawn_blocking(move || {
        let target = match (&tgt, &core) {
            (Some((parent, name)), _) => Target::NewVault { parent: parent.clone(), name: name.clone() },
            (None, Some(c)) => Target::Existing(c),
            _ => return Err(ImportError::Cancelled),
        };
        plan_with_space(&scan2, &space2, &target, &mapping, &e, &ctl)
    })
    .await
    .map_err(|e| err("Io", e))?;
    let mut s = lock(&sh.session);
    let mine = s.work.as_ref().is_some_and(|w| w.id == id) && s.scan_gen == gen;
    if s.work.as_ref().is_some_and(|w| w.id == id) {
        s.work = None;
    }
    match r {
        Ok((plan, no_space)) if mine => {
            let token = next_id();
            s.plans.retain(|_, p| p.from_where);
            s.plans.insert(token, StoredPlan { plan, target: stored_target, space, no_space, from_where: false });
            s.latest = Some(token);
            Ok(plan_result(token, &s.plans[&token]))
        }
        Ok(_) => Err(import_err(ImportError::Cancelled)),
        Err(e) => Err(import_err(e)),
    }
}

#[derive(Serialize)]
pub(crate) struct JobDto {
    job: u64,
}

#[tauri::command]
pub(crate) async fn import_start(app: AppHandle, state: State<'_, AppState>, token: u64, report_strings: BTreeMap<String, String>) -> Result<JobDto, IpcError> {
    let sh = shared(&state);
    let (sp, scan, memo, rest) = {
        let mut s = lock(&sh.session);
        if s.run_live() {
            return Err(busy());
        }
        if s.latest != Some(token) || !s.plans.contains_key(&token) {
            return Err(err("UnknownPlan", "no such plan"));
        }
        let scan = s.scan.clone().ok_or_else(no_session)?;
        if let Some((needed, free)) = s.plans[&token].no_space {
            return Err(import_err(ImportError::NoSpace { needed, free }));
        }
        // §1.2: `import_start` drops every stored plan; the started one moves into the run.
        let sp = s.plans.remove(&token).expect("checked");
        let rest = std::mem::take(&mut s.plans);
        s.latest = None;
        s.starting = true;
        s.start_core = match &sp.target {
            StoredTarget::Existing(c) => Some(c.clone()),
            _ => None,
        };
        (sp, scan, s.memo.clone(), rest)
    };
    drop(rest);
    {
        let mut r = lock(&RUN_JOB);
        r.job = None;
        r.held.clear();
    }
    let e = env(&app, &memo, ReportStrings(report_strings));
    let plan = sp.plan.clone();
    let (core, tgt) = match &sp.target {
        StoredTarget::Existing(c) => (Some(c.clone()), None),
        StoredTarget::NewVault { parent, name } => (None, Some((parent.clone(), name.clone()))),
        StoredTarget::Released(_) => (None, None),
    };
    let scan2 = scan.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        let target = match (&tgt, &core) {
            (Some((parent, name)), _) => Target::NewVault { parent: parent.clone(), name: name.clone() },
            (None, Some(c)) => Target::Existing(c),
            _ => return Err(ImportError::InvalidPlan { path: None, reason: tegg_import::PlanReason::Target }),
        };
        tegg_import::start(plan, &scan2, &target, &e)
    })
    .await;
    let run = match r {
        Ok(Ok(run)) => Arc::new(run),
        Ok(Err(e)) => {
            let held = end_start(&sh);
            drop(held);
            return Err(import_err(e));
        }
        Err(e) => {
            let held = end_start(&sh);
            drop(held);
            return Err(err("Io", e));
        }
    };
    let job = run.job();
    {
        let mut s = lock(&sh.session);
        s.starting = false;
        // The run's target holds the `Core` from here on (`sp.target`), so this clone is never the last one.
        s.start_core = None;
        s.run = Some(RunState { run: run.clone(), plan: sp.plan, target: sp.target, space: sp.space, files: scan.info.files as u64, last: None, result: None });
    }
    // Progress → `import:progress` (the sink never sleeps, §8).
    {
        let (app2, sh2) = (app.clone(), sh.clone());
        run.on_progress(Arc::new(move |p: &ImportProgress| {
            let v = progress_dto(p, false);
            if let Some(r) = lock(&sh2.session).run.as_mut() {
                r.last = Some(v.clone());
            }
            let _ = app2.emit_to("main", "import:progress", v);
        }));
    }
    // A `queued` event that arrived before the id was known (§2.4).
    let held = {
        let mut r = lock(&RUN_JOB);
        r.job = Some(job);
        let held = r.held.contains(&job);
        r.held.clear();
        held
    };
    if held && run.report().is_none() {
        queued_event(&app);
    }
    // The watcher: `import:done`, then the `Core` is released (§1.2).
    {
        let (app2, sh2) = (app.clone(), sh.clone());
        std::thread::spawn(move || {
            let report = loop {
                if let Some(r) = run.wait(Duration::from_secs(3600)) {
                    break r;
                }
            };
            // `held_core` (`open_vault`) waits on `RELEASE` until the `Core` is gone, so it never opens a second one
            // beside a `Core` still shutting down; the last `Arc` is dropped outside the session's lock, which the
            // run's `on_progress` sink takes (a `Core`'s drop joins its worker).
            let release = lock(&RELEASE);
            let mut s = lock(&sh2.session);
            let mut released = None;
            if let Some(rs) = s.run.as_mut().filter(|rs| Arc::ptr_eq(&rs.run, &run)) {
                let result = result_dto(&report, rs);
                rs.result = Some(result.clone());
                let _ = app2.emit_to("main", "import:done", result);
                mark_repeat("import-done");
                if let StoredTarget::Existing(core) = &rs.target {
                    let root = core.vault().root().to_path_buf();
                    released = Some(std::mem::replace(&mut rs.target, StoredTarget::Released(root)));
                }
            }
            drop(s);
            drop(released);
            drop(release);
            let mut r = lock(&RUN_JOB);
            if r.job == Some(job) {
                r.job = None;
            }
        });
    }
    Ok(JobDto { job })
}

/// A refused start: the session is no longer starting; the `Core` it held is returned, to be dropped outside the lock.
fn end_start(sh: &ImportShared) -> Option<Arc<Core>> {
    let mut s = lock(&sh.session);
    s.starting = false;
    s.start_core.take()
}

fn target_root(t: &StoredTarget) -> Option<PathBuf> {
    match t {
        StoredTarget::Existing(c) => Some(c.vault().root().to_path_buf()),
        StoredTarget::Released(p) => Some(p.clone()),
        StoredTarget::NewVault { .. } => None,
    }
}

fn vault_name(rs: &RunState) -> String {
    match &rs.target {
        StoredTarget::NewVault { name, .. } => name.clone(),
        t => target_root(t).and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned())).unwrap_or_default(),
    }
}

fn result_dto(report: &ImportReport, rs: &RunState) -> Value {
    let vault = match &rs.target {
        StoredTarget::NewVault { .. } => report.vault.clone(),
        t => report.vault.clone().or_else(|| target_root(t)),
    };
    let name = match &rs.target {
        StoredTarget::NewVault { .. } if !report.vault_name.is_empty() => report.vault_name.clone(),
        _ => vault_name(rs),
    };
    json!({
        "job": report.job,
        "phase": report.phase.as_str(),
        "error": report.error.as_ref().map(|e| serde_json::to_value(e).unwrap_or(Value::Null)),
        "target": rs.target.kind(),
        "vault": vault.map(|p| p.to_string_lossy().into_owned()),
        "vaultName": name,
        "reportPath": report.report_path,
        "renamed": report.renamed,
        "backup": report.backup,
        "kept": report.kept,
        "totals": report.totals,
    })
}

fn status_dto(rs: &RunState) -> Value {
    let plan = &rs.plan;
    let objects = plan.objects.iter().filter(|o| o.outcome == tegg_import::ObjectOutcome::Imported && o.path.is_some()).count();
    let links = plan
        .links
        .iter()
        .filter(|l| matches!(l.outcome, tegg_import::LinkOutcome::Resolved | tegg_import::LinkOutcome::DateMention | tegg_import::LinkOutcome::Attachment))
        .count();
    let r = &plan.report;
    let dropped = r.files.iter().filter(|f| matches!(f.change, tegg_import::FileChange::DroppedReference { .. })).count();
    let merged_example = r.merged.first().and_then(|m| m.variants.first().map(|v| json!([v, m.kept])));
    json!({
        "job": rs.run.job(),
        "space": rs.space,
        "target": rs.target.kind(),
        "vaultName": vault_name(rs),
        "vault": target_root(&rs.target).map(|p| p.to_string_lossy().into_owned()),
        "files": rs.files,
        "backup": plan.backup.is_some(),
        "objects": objects,
        "links": links,
        "card": {
            "unresolved": r.unresolved.len(),
            "stubs": r.stubs.len(),
            "ambiguous": r.ambiguous.len(),
            "merged": r.merged.len(),
            "mergedExample": merged_example,
            "dropped": dropped,
        },
        "reportDate": r.summary.date,
        "progress": rs.last,
        "result": rs.result,
    })
}

#[tauri::command]
pub(crate) async fn import_status(state: State<'_, AppState>) -> Result<Option<Value>, IpcError> {
    let sh = shared(&state);
    let s = lock(&sh.session);
    Ok(s.run.as_ref().map(status_dto))
}

#[tauri::command]
pub(crate) async fn import_discard(state: State<'_, AppState>) -> Result<(), IpcError> {
    let sh = shared(&state);
    let mut s = lock(&sh.session);
    if s.run_live() {
        return Err(busy());
    }
    if let Some(w) = s.work.take() {
        w.cancel.cancel();
    }
    s.drop_scan();
    s.source_path = None;
    s.run = None;
    Ok(())
}

// ------------------------------------------------------------------------------------------------ one `Core` per vault (§1.2)

/// The identity of a vault: the key its machine-local data is filed under; or the same `(st_dev, st_ino)` root.
pub(crate) fn same_vault(core: &Core, key: &Path, root: &Path) -> bool {
    if core.vault().local_dir() == key {
        return true;
    }
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(core.vault().root()), std::fs::metadata(root)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// The `Arc<Core>` the session holds for this vault (a run not final), if any. Waits on the session's lock, under
/// which a final run's `Core` is released.
pub(crate) fn held_core(app: &AppHandle, key: &Path, root: &Path) -> Option<Arc<Core>> {
    let state = app.state::<AppState>();
    let _release = lock(&RELEASE);
    let s = lock(&state.import.session);
    if let Some(c) = s.start_core.as_ref().filter(|c| same_vault(c, key, root)) {
        return Some(c.clone());
    }
    let mut held = s.plans.values().map(|p| &p.target).chain(s.run.as_ref().map(|r| &r.target));
    held.find_map(|t| match t {
        StoredTarget::Existing(c) if same_vault(c, key, root) => Some(c.clone()),
        _ => None,
    })
}

/// Held while a final run's `Core` is released (taken before the session's lock, never after it).
static RELEASE: Mutex<()> = Mutex::new(());

/// `open_vault` of another vault drops every stored plan whose target is `Existing` (§1.2).
pub(crate) fn vault_switched(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut s = lock(&state.import.session);
    let gone = take_plans(&mut s, |p| matches!(p.target, StoredTarget::Existing(_)));
    drop(s);
    drop(gone);
}

// ------------------------------------------------------------------------------------------------ the app menu (§4.1)

pub(crate) const MENU_ID: &str = "tegg-import";

pub(crate) fn menu_import(app: &AppHandle) {
    crate::shell5b::show_main(app);
    let _ = app.emit_to("main", "import:open", ());
}
