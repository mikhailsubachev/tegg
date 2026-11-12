//! §9.2…§9.4, §9.6: the existing-vault target. The run is a job of the target `Core`'s own engine (`core.jobs()`):
//! it waits behind that vault's other jobs (R153), re-checks the type files, the planned names (D-1558 vault-wide,
//! D-1547 (2)) and the backup decision (D-1549 (5)) after the queue, and writes every file through the core's host
//! with the write-ahead journal of §9.6, so a failure is rolled back in-process and a kill by `Undo`, from the log
//! alone. Only files the log proves the run created are ever removed (T1).

use std::collections::{HashMap, HashSet};
use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use tegg_jobs::host::{Host, ReadError, WriteError, Wrote};
use tegg_jobs::{import_journal, ImportCtx, JobId, Staged};
use tegg_vault::FileVersion;

use crate::note::{base_name, fold, folder_of, split_ext};
use crate::planner::{self, Paths};
use crate::render::{self, TypeWrite};
use crate::run::{self, lock, Engine, FileSink, Job, Shared, State, TargetSink};
use crate::*;

fn write_error(path: &str, e: impl std::fmt::Display) -> ImportError {
    ImportError::Write { path: path.to_string(), reason: e.to_string() }
}

// ------------------------------------------------------------------------------------------------ §9.2 step 2

/// A type file's bytes, `None` when it is missing; `Err` when it can't be read.
type ReadTypeFile<'a> = &'a dyn Fn(&str) -> Result<Option<Vec<u8>>, String>;

/// D-1548: every type file the plan stamped has the same **content** now (a changed modification time is no change);
/// one the plan found absent is still absent. `read`: `Ok(None)` for a missing file. Returns the texts read, by key.
fn check_type_files(plan: &Plan, read: ReadTypeFile<'_>) -> Result<HashMap<String, String>, ImportError> {
    let mut texts = HashMap::new();
    for stamp in &plan.stamps.type_files {
        let changed = || ImportError::TargetChanged { path: stamp.path.clone() };
        let now = read(&stamp.path).map_err(|reason| ImportError::Io { reason })?;
        match (&stamp.version, now) {
            (None, None) => {}
            (Some(want), Some(bytes)) if *want == planner::content_stamp(&FileVersion::of(&bytes)) => {
                if let Some(key) = stamp.path.strip_prefix(".tegg/types/").and_then(|f| f.strip_suffix(".yml")) {
                    texts.insert(key.to_string(), String::from_utf8_lossy(&bytes).into_owned());
                }
            }
            _ => return Err(changed()),
        }
    }
    Ok(texts)
}

// ------------------------------------------------------------------------------------------------ §9.2 step 3

/// A trailing ` (n)` (n ≥ 2) of a stem: the part before it.
fn without_suffix(stem: &str) -> Option<&str> {
    let inner = stem.strip_suffix(')')?;
    let at = inner.rfind(" (")?;
    let digits = &inner[at + 2..];
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) && digits.parse::<u64>().is_ok_and(|n| n >= 2)).then_some(&inner[..at])
}

/// The `[[…]]` spans of a string value, each passed (without the brackets) to `f`; `None` from `f` keeps the span.
fn relink_spans(s: &str, f: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(open) = rest.find("[[") {
        let Some(close) = rest[open + 2..].find("]]") else { break };
        let inner = &rest[open + 2..open + 2 + close];
        out.push_str(&rest[..open]);
        match f(inner) {
            Some(new) => out.push_str(&format!("[[{new}]]")),
            None => out.push_str(&rest[open..open + 4 + close]),
        }
        rest = &rest[open + 4 + close..];
    }
    out.push_str(rest);
    out
}

enum Item {
    Object(usize),
    Attachment(usize),
    Report,
}

/// §9.2 step 3 (D-1547 (2), D-1558): every planned path is looked up again, in planning order (objects in source-path
/// order, then attachments, then the report). A name is taken when **any file now in the vault** (outside `_templates/`
/// and `.trash/`, in whatever folder) has it, NFC and case-folded; a taken one gets the next free ` (n)`, free of those
/// files and of every other planned name of the run in its folder, replacing a suffix the planner gave. The links,
/// frontmatter link values and Files rows follow. `None`: nothing was taken.
pub(crate) fn recheck_paths(plan: &Plan, existing: &[String]) -> Option<(Plan, Vec<(String, String)>)> {
    let taken: HashSet<String> = existing.iter().map(|p| fold(base_name(p))).collect();
    let suffixed = |source: &str| plan.report.files.iter().any(|r| r.source == source && matches!(&r.change, FileChange::NameChanged { reasons, .. } if reasons.contains(&NameChange::Suffix)));
    let mut items: Vec<(Item, String)> = Vec::new();
    for (i, o) in plan.objects.iter().enumerate() {
        if let (ObjectOutcome::Imported, Some(p)) = (&o.outcome, &o.path) {
            items.push((Item::Object(i), p.clone()));
        }
    }
    for (i, a) in plan.attachments.iter().enumerate() {
        if let (AttachmentOutcome::Imported, Some(p)) = (&a.outcome, &a.path) {
            items.push((Item::Attachment(i), p.clone()));
        }
    }
    items.push((Item::Report, plan.report_path.clone()));

    let mut renamed: Vec<(String, String)> = Vec::new();
    for i in 0..items.len() {
        let path = items[i].1.clone();
        let (folder, name) = (folder_of(&path).to_string(), base_name(&path).to_string());
        if !taken.contains(&fold(&name)) {
            continue;
        }
        let (stem, ext) = split_ext(&name);
        let planner_suffix = match &items[i].0 {
            Item::Object(k) => plan.objects[*k].name_changes.contains(&NameChange::Suffix) || suffixed(&plan.objects[*k].source),
            Item::Attachment(k) => suffixed(&plan.attachments[*k].source),
            Item::Report => true,
        };
        let base = if planner_suffix { without_suffix(stem).unwrap_or(stem) } else { stem };
        let others: HashSet<String> = items.iter().enumerate().filter(|(j, (_, p))| *j != i && fold(folder_of(p)) == fold(&folder)).map(|(_, (_, p))| fold(base_name(p))).collect();
        let new_name = tegg_format::unique_file_name(base, ext, &|n: &str| taken.contains(&fold(n)) || others.contains(&fold(n)));
        let new_path = if folder.is_empty() { new_name } else { format!("{folder}/{new_name}") };
        items[i].1 = new_path.clone();
        renamed.push((path, new_path));
    }
    if renamed.is_empty() {
        return None;
    }

    // The D-184 texts as the plan wrote them (without the files that arrived under a planned name) and as they are now.
    let arrived: HashSet<String> = renamed.iter().map(|(old, _)| fold(base_name(old))).collect();
    let before: Vec<String> = existing.iter().filter(|p| !arrived.contains(&fold(base_name(p)))).cloned().collect();
    let old_paths: Paths = render::plan_paths(plan, &before);
    let mut out = plan.clone();
    for (item, path) in &items {
        match item {
            Item::Object(k) => out.objects[*k].path = Some(path.clone()),
            Item::Attachment(k) => out.attachments[*k].path = Some(path.clone()),
            Item::Report => out.report_path = path.clone(),
        }
    }
    let new_paths: Paths = render::plan_paths(&out, existing);
    let moved: HashMap<&str, &str> = renamed.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();

    // Body links follow through `to` (rendered from it, §7.1).
    for l in out.links.iter_mut() {
        if let Some(to) = l.to.as_deref().and_then(|t| moved.get(t)) {
            l.to = Some(to.to_string());
        }
    }
    // Frontmatter values hold D-184 text made at plan time: the spans naming a moved file are written again.
    for o in out.objects.iter_mut() {
        let Some(from) = o.path.clone() else { continue };
        let relink = |inner: &str, shown_default: &str| -> Option<String> {
            let (target, alias) = match inner.split_once('|') {
                Some((t, a)) => (t, Some(a)),
                None => (inner, None),
            };
            renamed.iter().find(|(old, _)| fold(target.trim()) == fold(&old_paths.d184(&from, old, ""))).map(|(_, new)| {
                let shown = alias.map(str::to_string).unwrap_or_else(|| if shown_default.is_empty() { String::new() } else { target.to_string() });
                new_paths.d184(&from, new, &shown)
            })
        };
        for (key, value) in o.frontmatter.iter_mut() {
            match value {
                // An Image or PDF object's own file (D-77, FR-ATT-07): its plain name.
                FmValue::Link { link } if key == "file" => {
                    if let Some((_, new)) = renamed.iter().find(|(old, _)| fold(base_name(old)) == fold(link)) {
                        *link = base_name(new).to_string();
                    }
                }
                FmValue::Link { link } => {
                    let shown_default = if key == "cover" { "" } else { "shown" };
                    if let Some(new) = relink(link, shown_default) {
                        *link = new;
                    }
                }
                FmValue::Links { links } => links.iter_mut().for_each(|l| {
                    if let Some(new) = relink(l, "shown") {
                        *l = new;
                    }
                }),
                FmValue::List(items) => items.iter_mut().for_each(|s| *s = relink_spans(s, &|inner| relink(inner, "shown"))),
                FmValue::Text(s) => *s = relink_spans(s, &|inner| relink(inner, "shown")),
                _ => {}
            }
        }
    }
    // The Files rows (§5.3): `NameChanged` with `suffix`, added or updated.
    let order = |r: &NameChange| match r {
        NameChange::Reserved => 0,
        NameChange::Empty => 1,
        NameChange::Cut => 2,
        NameChange::Suffix => 3,
        NameChange::Characters => 4,
    };
    for (item, path) in &items {
        let source = match item {
            Item::Object(k) => out.objects[*k].source.clone(),
            Item::Attachment(k) => out.attachments[*k].source.clone(),
            Item::Report => continue,
        };
        let planned = match item {
            Item::Object(k) => plan.objects[*k].path.clone(),
            Item::Attachment(k) => plan.attachments[*k].path.clone(),
            Item::Report => None,
        };
        if planned.as_deref() == Some(path.as_str()) {
            continue;
        }
        let name = base_name(path).to_string();
        if let Item::Object(k) = item {
            let changes = &mut out.objects[*k].name_changes;
            if !changes.contains(&NameChange::Suffix) {
                changes.push(NameChange::Suffix);
                changes.sort_by_key(order);
            }
        }
        match out.report.files.iter_mut().find(|r| r.source == source && matches!(r.change, FileChange::NameChanged { .. } | FileChange::GenericName { .. })) {
            Some(FileRow { change: FileChange::NameChanged { name: n, reasons }, .. }) => {
                *n = name;
                if !reasons.contains(&NameChange::Suffix) {
                    reasons.push(NameChange::Suffix);
                    reasons.sort_by_key(order);
                }
            }
            Some(FileRow { change: FileChange::GenericName { name: n }, .. }) => *n = name,
            _ => out.report.files.push(FileRow { source, change: FileChange::NameChanged { name, reasons: vec![NameChange::Suffix] } }),
        }
    }
    Some((out, renamed))
}

// ------------------------------------------------------------------------------------------------ the sink

struct ExistingVault {
    /// The vault's folder (free space, the backup's size).
    root: PathBuf,
    /// The type files' texts the re-check read (§9.2 step 2), by key: what an extended file is patched from.
    texts: Mutex<HashMap<String, String>>,
}

/// One created file of the run in the vault: the core's staged create with the journal lines of §9.6.
struct Files<'a> {
    host: &'a dyn Host,
    job: JobId,
    tag: String,
    dirs: Mutex<HashSet<String>>,
}

impl FileSink for Files<'_> {
    fn journaled(&self) -> bool {
        true
    }

    /// Every missing level gets its `D` line first; then the folder is created with its missing parents.
    fn ensure_dir(&self, dir: &str) -> Result<(), ImportError> {
        if dir.is_empty() || lock(&self.dirs).contains(dir) {
            return Ok(());
        }
        let mut missing: Vec<String> = Vec::new();
        let mut prefix = String::new();
        for part in dir.split('/') {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if !missing.is_empty() || !self.host.dir_exists(&prefix) {
                missing.push(prefix.clone());
            }
        }
        for m in &missing {
            import_journal::dir(self.host, self.job, m).map_err(|e| write_error(m, e))?;
        }
        if !missing.is_empty() {
            self.host.create_dir(dir).map_err(|e| write_error(dir, format!("{e:?}")))?;
        }
        lock(&self.dirs).insert(dir.to_string());
        Ok(())
    }

    fn intent(&self, path: &str, version: &FileVersion) -> Result<(), ImportError> {
        import_journal::intent(self.host, self.job, path, version.size, &version.hash).map_err(|e| write_error(path, e))
    }

    fn stage(&self, path: &str, src: &mut dyn Read) -> io::Result<Staged> {
        self.host.stage_new(path, &self.tag, src).map_err(|e| io::Error::other(format!("{e:?}")))
    }

    fn staged(&self, staged: &Staged) -> Result<(), ImportError> {
        import_journal::temp(self.host, self.job, &staged.path, staged.file_id).map_err(|e| write_error(&staged.path, e))
    }

    fn commit(&self, staged: Staged) -> io::Result<()> {
        match self.host.commit_new(staged) {
            Ok(_) => Ok(()),
            Err(WriteError::NameTaken) => Err(io::Error::from(io::ErrorKind::AlreadyExists)),
            Err(e) => Err(io::Error::other(format!("{e:?}"))),
        }
    }

    fn discard(&self, staged: Staged) {
        self.host.discard_staged(staged);
    }

    fn committed(&self, path: &str) -> Result<(), ImportError> {
        import_journal::created(self.host, self.job, path).map_err(|e| write_error(path, e))
    }

    /// The run's temp file goes (if any), then the `N` line.
    fn not_created(&self, path: &str) {
        self.host.remove_temp(path, Some(&self.tag));
        let _ = import_journal::not_created(self.host, self.job, path);
    }
}

impl ExistingVault {
    /// §9.4: the one replace of the run. Re-read and compared with the plan's stamp immediately before (D-1548), its
    /// `R` line written ahead, then the base-checked write (D-84's window is the accepted one).
    fn extend_type(&self, job: &Job, ctx: &ImportCtx<'_>, t: &TypeWrite) -> Result<(), ImportError> {
        let (host, path) = (ctx.host, t.path.as_str());
        let changed = || ImportError::TargetChanged { path: path.to_string() };
        let stamp = job.planned.stamps.type_files.iter().find(|s| s.path == path).and_then(|s| s.version.clone());
        let (pre, base) = match host.read(path) {
            Ok(x) => x,
            Err(ReadError::Missing) => return Err(changed()),
            Err(e) => return Err(write_error(path, format!("{e:?}"))),
        };
        if stamp.as_ref() != Some(&planner::content_stamp(&FileVersion::of(&pre))) {
            return Err(changed());
        }
        let post = FileVersion::of(t.text.as_bytes());
        import_journal::replace_intent(host, ctx.job, path, &post, &base, &pre).map_err(|e| write_error(path, e))?;
        if let PointAction::Fail(k) = job.point(ImportPoint::BeforeTemp { path: path.to_string(), kind: FileKind::TypeFile }) {
            return Err(write_error(path, io::Error::from(k)));
        }
        let hook = || match job.point(ImportPoint::TempWritten { path: path.to_string(), kind: FileKind::TypeFile }) {
            PointAction::Fail(k) => Err(io::Error::from(k)),
            PointAction::Continue => Ok(()),
        };
        match host.write_hooked(path, t.text.as_bytes(), &base, &hook) {
            Ok(Wrote::Written(_)) | Ok(Wrote::Unchanged) => {}
            Err(WriteError::Changed) | Err(WriteError::Missing) => return Err(changed()),
            Err(WriteError::Io(reason)) => return Err(write_error(path, reason)),
            Err(e) => return Err(write_error(path, format!("{e:?}"))),
        }
        let _ = job.point(ImportPoint::Renamed { path: path.to_string(), kind: FileKind::TypeFile });
        job.file_done(ctx, path, FileKind::TypeFile);
        Ok(())
    }

    fn write_all(&self, job: &Job, ctx: &ImportCtx<'_>, files: &Files<'_>, types: &[TypeWrite]) -> Result<(), ImportError> {
        for t in types {
            if t.new {
                job.create_file(ctx, files, &t.path, FileKind::TypeFile, run::Src::Bytes(t.text.as_bytes()))?;
            } else {
                self.extend_type(job, ctx, t)?;
            }
        }
        job.write_content(files, ctx)
    }

    /// The size of the zip's files (§9.3), for `NoSpace` with the job's own answer.
    fn backup_bytes(&self, host: &dyn Host) -> u64 {
        host.backup_files().iter().filter_map(|p| tegg_vault::stat_external(&self.root.join(p)).ok().flatten()).map(|(size, _)| size).sum()
    }
}

impl TargetSink for ExistingVault {
    fn existing_files(&self, ctx: &ImportCtx<'_>) -> Vec<String> {
        ctx.host.all_files().into_iter().filter(|p| !planner::outside_objects(p)).collect()
    }

    fn recheck(&self, job: &Job, ctx: &ImportCtx<'_>) -> Result<(), ImportError> {
        let host = ctx.host;
        // Step 2: the type files (D-1548).
        let texts = check_type_files(&job.planned, &|path| match host.read(path) {
            Ok((bytes, _)) => Ok(Some(bytes)),
            Err(ReadError::Missing) => Ok(None),
            Err(e) => Err(format!("{e:?}")),
        })?;
        *lock(&self.texts) = texts;
        // Step 3: the planned paths, vault-wide (D-1558).
        if let Some((plan, renamed)) = recheck_paths(&job.planned, &self.existing_files(ctx)) {
            lock(&job.state).renamed = renamed;
            let _ = job.checked.set(plan);
        }
        // Step 4: the backup, decided now (D-1549 (5)): any `.md` outside `.tegg/` (live, in `.trash/`, a template), or
        // an existing type file the run extends.
        let plan = job.plan();
        let has_notes = host.all_files().iter().any(|p| p.ends_with(".md") && !p.starts_with(".tegg/"));
        let extends = plan.types.iter().any(|t| !t.new && t.key.is_some() && t.attributes.iter().any(|a| a.action == AttrAction::New));
        let backup = has_notes || extends;
        let files = if backup { host.backup_files().len() as u64 } else { 0 };
        {
            let mut s = lock(&job.state);
            s.backup_needed = backup;
            s.backup_files = files;
        }
        // `NoSpace` again, with the job's answer (§9.2 step 4).
        let disk = &job.env.disk;
        let free = |p: &std::path::Path| disk.free(p).map_err(|e| ImportError::Io { reason: e.to_string() });
        let mut needed = (plan.space_bytes * 11).div_ceil(10);
        if backup {
            let bytes = self.backup_bytes(host);
            let dir = job.env.dirs.root.join("backups");
            if disk.volume(&dir).ok() == disk.volume(&self.root).ok() {
                needed += bytes;
            } else {
                let f = free(&dir)?;
                if bytes > f {
                    return Err(ImportError::NoSpace { needed: bytes, free: f });
                }
            }
        }
        let f = free(&self.root)?;
        if needed > f {
            return Err(ImportError::NoSpace { needed, free: f });
        }
        Ok(())
    }

    fn type_file(&self, key: &str) -> Option<String> {
        lock(&self.texts).get(key).cloned()
    }

    fn needs_backup(&self, job: &Job, _ctx: &ImportCtx<'_>) -> bool {
        let s = lock(&job.state);
        s.backup_needed || s.types.iter().any(|t| !t.new)
    }

    /// `writing`: the journal's header, then §9.4's order. On any failure the roll-back of §9.6 (from the log alone,
    /// as `Undo` does) and the journal goes; what the roll-back kept is listed.
    fn write(&self, job: &Job, ctx: &ImportCtx<'_>) -> Result<(), ImportError> {
        let (host, id) = (ctx.host, ctx.job);
        let (types, total, backup) = {
            let mut s = lock(&job.state);
            (std::mem::take(&mut s.types), s.total, s.backup.clone())
        };
        let plan = job.plan();
        let files = Files { host, job: id, tag: import_journal::temp_tag(id), dirs: Mutex::default() };
        let result = import_journal::begin(host, id, &plan.space, &plan.source.name, total as usize, backup.as_deref())
            .map_err(|e| write_error("", e))
            .and_then(|()| self.write_all(job, ctx, &files, &types));
        match result {
            Ok(()) => {
                lock(&job.state).vault = Some(self.root.clone());
                Ok(())
            }
            Err(e) => {
                let kept = import_journal::roll_back(host, id);
                import_journal::finish(host, id);
                lock(&job.state).kept = kept;
                Err(e)
            }
        }
    }
}

/// `start` for an existing vault: the index, the type files (D-1548) and `NoSpace` again, then the job in the target
/// vault's own queue.
pub(crate) fn start(plan: Plan, scan: &Scan, core: &tegg_core::Core, env: &ImportEnv, now: DateTime<Utc>) -> Result<ImportRun, ImportError> {
    if !core.index_ready() {
        return Err(ImportError::IndexNotReady);
    }
    let vault = core.vault();
    check_type_files(&plan, &|path| match vault.read(path) {
        Ok((bytes, _)) => Ok(Some(bytes)),
        Err(_) => match vault.version(path) {
            Ok(None) => Ok(None),
            Ok(Some(_)) => Err("the type file can't be read".to_string()),
            Err(e) => Err(format!("{e:?}")),
        },
    })?;
    let root = vault.root().to_path_buf();
    let free = env.disk.free(&root).map_err(|e| ImportError::Io { reason: e.to_string() })?;
    if plan.needed_bytes > free {
        return Err(ImportError::NoSpace { needed: plan.needed_bytes, free });
    }
    let vault_name = match &plan.target {
        PlanTarget::Existing { name, .. } => name.clone(),
        PlanTarget::NewVault { name, .. } => name.clone(),
    };
    let sink = ExistingVault { root, texts: Mutex::default() };
    let shared = Arc::new(Shared::default());
    let job = Arc::new(Job { state: Mutex::new(State { vault_name, ..Default::default() }), planned: plan, checked: Default::default(), source: scan.source.clone(), env: env.clone(), now, shared: shared.clone(), target: Box::new(sink) });
    let jobs = core.jobs();
    match jobs.start_import(job) {
        Ok(id) => Ok(ImportRun::new(id, shared, Engine::Existing(jobs.handle()))),
        Err(e) => Err(ImportError::Io { reason: format!("{e:?}") }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_suffix_is_only_a_trailing_number_from_two() {
        assert_eq!(without_suffix("PKM home (2)"), Some("PKM home"));
        assert_eq!(without_suffix("PKM home (12)"), Some("PKM home"));
        assert_eq!(without_suffix("Tomáš  Eva (1)"), None, "(1) is never a suffix Tegg gives");
        assert_eq!(without_suffix("Plán (x)"), None);
        assert_eq!(without_suffix("Plán ()"), None);
        assert_eq!(without_suffix("Plán"), None);
        assert_eq!(without_suffix("(2)"), None);
    }

    #[test]
    fn relink_spans_rewrites_only_the_spans_it_is_asked_to() {
        let f = |inner: &str| (inner == "A").then(|| "A (2)|A".to_string());
        assert_eq!(relink_spans("[[A]] a [[B]] and [[A|x]]", &f), "[[A (2)|A]] a [[B]] and [[A|x]]");
        assert_eq!(relink_spans("no links [[ open", &f), "no links [[ open");
        assert_eq!(relink_spans("", &f), "");
    }
}
