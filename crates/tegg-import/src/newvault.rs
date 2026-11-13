//! §9.5: the new-vault target. The run writes into `<parent>/<name>.tegg-importing`, whose first file is the marker
//! `.tegg-import`, and renames the folder to its final name after the report is written, replacing nothing. It is a
//! job of a private engine over that folder (§9.1): no `Core`, no index, no journal, nothing outside `<parent>`.

use std::collections::HashSet;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use tegg_jobs::host::{Host, ReadError, WriteError, Wrote};
use tegg_jobs::{FileVersion, ImportCtx, JobProgress, Staged};
use tegg_vault::{LocalFs, VaultFs};

use crate::planner;
use crate::run::{lock, Engine, FileSink, Job, Shared, Src, State, TargetSink};
use crate::*;

const MARKER: &str = ".tegg-import";

/// The private engine's host: a `LocalFs` of the temporary folder. An import calls none of the vault operations of
/// other job kinds, and nothing machine-local is read or written.
struct PrivateHost {
    root: PathBuf,
    app: PathBuf,
}
impl Host for PrivateHost {
    fn read(&self, path: &str) -> Result<(Vec<u8>, FileVersion), ReadError> {
        LocalFs::new(&self.root).read(path).map_err(|e| if e.kind() == io::ErrorKind::NotFound { ReadError::Missing } else { ReadError::Io(e.to_string()) })
    }
    fn version(&self, path: &str) -> Option<FileVersion> {
        LocalFs::new(&self.root).version(path).ok().flatten()
    }
    fn is_placeholder(&self, _path: &str) -> bool {
        false
    }
    fn write(&self, _path: &str, _bytes: &[u8], _base: &FileVersion) -> Result<Wrote, WriteError> {
        Err(WriteError::Io("an import never replaces a file of a new vault".into()))
    }
    fn rename(&self, _from: &str, _to: &str, _bytes: &[u8], _base: &FileVersion) -> Result<FileVersion, WriteError> {
        Err(WriteError::Io("an import never renames a file".into()))
    }
    fn note_paths(&self) -> Vec<String> {
        Vec::new()
    }
    fn linking(&self, _path: &str) -> Vec<String> {
        Vec::new()
    }
    fn free_stem(&self, _folder: &str, stem: &str) -> String {
        stem.to_string()
    }
    fn renamable(&self, _path: &str) -> bool {
        false
    }
    fn backup_files(&self) -> Vec<String> {
        Vec::new()
    }
    fn app_dir(&self) -> PathBuf {
        self.app.clone()
    }
    fn vault_key(&self) -> String {
        "import-new-vault".to_string()
    }
    fn now(&self) -> String {
        String::new()
    }
    fn progress(&self, _p: JobProgress) {}
    fn transform_request(&self, _request: u64, _source: &str, _text: &str, _ops: &[tegg_jobs::TextOp], _live: bool) {}
    fn local_write(&self, _path: &Path, _bytes: &[u8]) -> io::Result<()> {
        Ok(())
    }
    fn local_read(&self, _path: &Path) -> Option<Vec<u8>> {
        None
    }
    fn local_remove(&self, _path: &Path) {}
    fn local_list(&self, _dir: &Path) -> Vec<PathBuf> {
        Vec::new()
    }
}

struct NewVault {
    /// `<parent>`, resolved.
    parent: PathBuf,
    name: String,
    temp: PathBuf,
    run_id: String,
}

/// The files of the temporary folder: staged creates on its `LocalFs`.
struct Files {
    fs: LocalFs,
    tag: String,
    dirs: Mutex<HashSet<String>>,
}
impl FileSink for Files {
    fn ensure_dir(&self, dir: &str) -> Result<(), ImportError> {
        if dir.is_empty() || !lock(&self.dirs).insert(dir.to_string()) {
            return Ok(());
        }
        self.fs.create_dir_all(dir).map_err(|e| ImportError::Write { path: dir.to_string(), reason: e.to_string() })
    }
    fn stage(&self, path: &str, src: &mut dyn Read) -> io::Result<Staged> {
        tegg_vault::stage_new_on(&self.fs, path, &self.tag, src)
    }
    fn commit(&self, staged: Staged) -> io::Result<()> {
        tegg_vault::commit_new_on(&self.fs, staged).map(|_| ())
    }
    fn discard(&self, staged: Staged) {
        tegg_vault::discard_staged_on(&self.fs, staged);
    }
}

impl NewVault {
    fn write_all(&self, job: &Job, ctx: &ImportCtx<'_>) -> Result<(), ImportError> {
        let files = Files { fs: LocalFs::new(&self.temp), tag: format!("i{}", ctx.job), dirs: Mutex::default() };
        // The marker is the first entry the run makes in the folder.
        let marker = format!("{{\"version\":1,\"run\":\"{}\",\"started\":\"{}\"}}\n", self.run_id, job.now_local());
        job.create_file(ctx, &files, MARKER, FileKind::Marker, Src::Bytes(marker.as_bytes()))?;
        let types = std::mem::take(&mut lock(&job.state).types);
        let created = types.iter().filter(|t| t.new).count();
        job.set_steps(ctx, tegg_vault::EMPTY_VAULT.len(), created);
        // `.tegg/vault.yml` and the seven system type files; one that gains attributes is written extended.
        for (path, text) in tegg_vault::EMPTY_VAULT {
            let text = types.iter().find(|t| !t.new && t.path == *path).map(|t| t.text.as_str()).unwrap_or(text);
            job.create_file(ctx, &files, path, FileKind::VaultFile, Src::Bytes(text.as_bytes()))?;
        }
        for t in types.iter().filter(|t| t.new) {
            job.create_file(ctx, &files, &t.path, FileKind::TypeFile, Src::Bytes(t.text.as_bytes()))?;
        }
        job.write_content(&files, ctx)
    }

    /// §9.5 step 4: the no-replace rename to the final name, or the next free ` (n)`.
    fn final_rename(&self) -> Result<(PathBuf, String), ImportError> {
        for n in 1..10_000 {
            let name = if n == 1 { self.name.clone() } else { format!("{} ({n})", self.name) };
            let to = self.parent.join(&name);
            match tegg_vault::rename_dir_no_replace(&self.temp, &to) {
                Ok(()) => return Ok((to, name)),
                Err(e) if matches!(e.kind(), io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty | io::ErrorKind::NotADirectory) => continue,
                Err(e) => return Err(ImportError::Write { path: name, reason: e.to_string() }),
            }
        }
        Err(ImportError::TargetExists)
    }

    /// §9.5 step 6: the run's own folder goes whole. Before the marker is at its name the folder holds nothing.
    fn remove_temp(&self) {
        if tegg_vault::remove_dir_tree(&self.temp).is_err() {
            if let Some(name) = self.temp.file_name().map(|n| n.to_string_lossy().into_owned()) {
                let _ = LocalFs::new(&self.parent).remove_empty_dir(&name);
            }
        }
    }
}

impl TargetSink for NewVault {
    fn type_file(&self, key: &str) -> Option<String> {
        let path = format!(".tegg/types/{key}.yml");
        tegg_vault::EMPTY_VAULT.iter().find(|(p, _)| *p == path).map(|(_, text)| text.to_string())
    }

    fn write(&self, job: &Job, ctx: &ImportCtx<'_>) -> Result<(), ImportError> {
        // D-1581: a missing parent (one level, accepted by `probe_new`) is created now, after the checks, just before
        // the temporary folder; it goes again when the run fails and it is still empty.
        let made_parent = match tegg_vault::create_external_dir_new(&self.parent) {
            Ok(()) => true,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => false,
            Err(e) => return Err(ImportError::Write { path: String::new(), reason: e.to_string() }),
        };
        let remove_parent = || {
            if made_parent {
                if let (Some(up), Some(name)) = (self.parent.parent(), self.parent.file_name()) {
                    let _ = LocalFs::new(up).remove_empty_dir(&name.to_string_lossy());
                }
            }
        };
        tegg_vault::create_external_dir_new(&self.temp).inspect_err(|_| remove_parent()).map_err(|e| if e.kind() == io::ErrorKind::AlreadyExists { ImportError::TargetExists } else { ImportError::Write { path: String::new(), reason: e.to_string() } })?;
        let done = self.write_all(job, ctx).and_then(|()| {
            let _ = job.point(ImportPoint::BeforeFinalRename);
            self.final_rename()
        });
        match done {
            Ok((vault, name)) => {
                let _ = job.point(ImportPoint::AfterFinalRename);
                let _ = LocalFs::new(&vault).remove_file(MARKER);
                let mut s = lock(&job.state);
                s.vault = Some(vault);
                s.vault_name = name;
                Ok(())
            }
            Err(e) => {
                self.remove_temp();
                remove_parent();
                Err(e)
            }
        }
    }

    fn release(&self, _unwinding: bool) {
        let mut runs = lock(planner::running());
        if runs.get(&self.temp) == Some(&self.run_id) {
            runs.remove(&self.temp);
        }
    }
}

/// CP-8 (D-1562): a dead run's folder without the marker (killed before the marker was at its name): the marker's
/// temp file, when there, then the empty folder. Something put into it meanwhile makes the folder's removal fail:
/// `TargetExists`, and what is in it stays.
fn remove_dead_unmarked(parent: &Path, temp: &Path, file: Option<&str>) -> Result<(), ImportError> {
    if let Some(f) = file {
        match LocalFs::new(temp).remove_file(f) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(ImportError::Io { reason: e.to_string() }),
        }
    }
    let name = temp.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    LocalFs::new(parent).remove_empty_dir(&name).map_err(|e| match e.kind() {
        io::ErrorKind::DirectoryNotEmpty | io::ErrorKind::NotADirectory => ImportError::TargetExists,
        _ => ImportError::Io { reason: e.to_string() },
    })
}

/// `start` for a new vault: the target refusals and `NoSpace` again, the dead run's leftover to the Trash, then the
/// job of a private engine.
pub(crate) fn start(plan: Plan, scan: &Scan, parent: &Path, name: &str, env: &ImportEnv, now: DateTime<Utc>) -> Result<ImportRun, ImportError> {
    let leftover = planner::probe_new(parent, name, &scan.source)?;
    let free = env.disk.free(parent).map_err(|e| ImportError::Io { reason: e.to_string() })?;
    if plan.needed_bytes > free {
        return Err(ImportError::NoSpace { needed: plan.needed_bytes, free });
    }
    let resolved = tegg_vault::resolve_existing(parent).map_err(|_| ImportError::TargetNotWritable)?;
    let temp = resolved.join(format!("{name}.tegg-importing"));
    let run_id = format!("{}-{}", now.timestamp_millis(), std::process::id());
    {
        // A run enters the registry before it creates its folder; a second run of that place is refused meanwhile.
        let mut runs = lock(planner::running());
        if runs.contains_key(&temp) {
            return Err(ImportError::TargetExists);
        }
        match &leftover {
            planner::Leftover::None => {}
            planner::Leftover::Marked => {
                tegg_vault::trash_import_leftover(&temp, &*env.trash).map_err(|e| ImportError::LeftoverNotTrashed { reason: e.to_string() })?;
            }
            planner::Leftover::Unmarked(file) => remove_dead_unmarked(&resolved, &temp, file.as_deref())?,
        }
        runs.insert(temp.clone(), run_id.clone());
    }
    let sink = NewVault { parent: resolved, name: name.to_string(), temp: temp.clone(), run_id: run_id.clone() };
    let shared = Arc::new(Shared::default());
    let job = Arc::new(Job { state: Mutex::new(State { vault_name: name.to_string(), ..Default::default() }), planned: plan, checked: Default::default(), source: scan.source.clone(), env: env.clone(), now, shared: shared.clone(), target: Box::new(sink) });
    let jobs = tegg_jobs::Jobs::with_host(Arc::new(PrivateHost { root: temp.clone(), app: env.dirs.root.clone() }));
    match jobs.start_import(job) {
        Ok(id) => Ok(ImportRun::new(id, shared, Engine::Private(jobs))),
        Err(e) => {
            let mut runs = lock(planner::running());
            if runs.get(&temp) == Some(&run_id) {
                runs.remove(&temp);
            }
            Err(ImportError::Io { reason: format!("{e:?}") })
        }
    }
}
