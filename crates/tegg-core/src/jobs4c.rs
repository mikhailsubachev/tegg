//! ms4-jobs §2–§9: the core's side of the job engine. `CoreHost` gives `tegg-jobs` the vault, the index and the event
//! hub; the engine never edits Markdown (D-82) and the core never plans a job.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tegg_format::{extract, nfc};
use tegg_index::is_indexable;
use tegg_jobs::host::{Host, ReadError, WriteError, Wrote};
use tegg_jobs::{JobProgress, TextOp};
use tegg_vault::{FileVersion, VaultError, WriteOutcome};

use crate::{lock, CoreEvent, Resolver, Shared};

pub(crate) struct CoreHost {
    pub(crate) shared: Arc<Shared>,
}

fn stem_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name).to_string()
}

impl CoreHost {
    fn index_written(&self, path: &str, bytes: &[u8], v: &FileVersion) {
        if is_indexable(path) {
            let _ = lock(&self.shared.index).upsert(path, bytes, v);
        }
    }
}

impl Host for CoreHost {
    fn read(&self, path: &str) -> Result<(Vec<u8>, FileVersion), ReadError> {
        if self.shared.vault.is_placeholder(path) {
            return Err(ReadError::Placeholder);
        }
        match self.shared.vault.read(path) {
            Ok(x) => Ok(x),
            Err(VaultError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(ReadError::Missing)
            }
            Err(e) => match self.shared.vault.version(path) {
                Ok(None) => Err(ReadError::Missing),
                _ => Err(ReadError::Io(format!("{e:?}"))),
            },
        }
    }

    fn version(&self, path: &str) -> Option<FileVersion> {
        self.shared.vault.version(path).ok().flatten()
    }

    fn indexed_version(&self, path: &str) -> Option<FileVersion> {
        lock(&self.shared.index).note_state(path).map(|s| s.version)
    }

    fn is_placeholder(&self, path: &str) -> bool {
        self.shared.vault.is_placeholder(path)
    }

    fn write(&self, path: &str, bytes: &[u8], base: &FileVersion) -> Result<Wrote, WriteError> {
        let path = nfc(path);
        if lock(&self.shared.not_utf8).contains(&path) {
            return Err(WriteError::Io("not UTF-8 (D-180)".into()));
        }
        match self.shared.vault.write(&path, bytes, Some(base)) {
            Ok(WriteOutcome::Written(v)) => {
                self.index_written(&path, bytes, &v);
                self.shared
                    .emit(CoreEvent::VaultChanged { paths: vec![path] });
                Ok(Wrote::Written(v))
            }
            Ok(WriteOutcome::Unchanged) => Ok(Wrote::Unchanged),
            Err(e) => Err(write_error(e)),
        }
    }

    fn rename(
        &self,
        from: &str,
        to: &str,
        bytes: &[u8],
        base: &FileVersion,
    ) -> Result<FileVersion, WriteError> {
        let (from, to) = (nfc(from), nfc(to));
        let v = self
            .shared
            .vault
            .rename_with(&from, &to, bytes, base)
            .map_err(write_error)?;
        {
            let mut index = lock(&self.shared.index);
            let _ = index.remove(&from);
            if is_indexable(&to) {
                let _ = index.upsert(&to, bytes, &v);
            }
        }
        {
            let mut r = lock(&self.shared.recency);
            if let Some(t) = r.0.remove(&from) {
                r.0.insert(to.clone(), t);
                r.1 = true;
            }
        }
        self.shared.emit(CoreEvent::VaultChanged {
            paths: vec![from, to],
        });
        Ok(v)
    }

    fn note_paths(&self) -> Vec<String> {
        self.shared
            .vault
            .list_files()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.ends_with(".md") && !p.split('/').any(|c| c.starts_with('.')))
            .map(|p| nfc(&p))
            .collect()
    }

    fn linking(&self, path: &str) -> Vec<String> {
        let path = nfc(path);
        let mut out: HashSet<String> = lock(&self.shared.index)
            .backlinks(&path)
            .into_iter()
            .collect();
        // Templates aren't indexed, but their links are rewritten too (D-391).
        let templates: Vec<String> = self
            .note_paths()
            .into_iter()
            .filter(|p| p.starts_with("_templates/"))
            .collect();
        if !templates.is_empty() {
            let objs = lock(&self.shared.index).objects();
            let resolver = Resolver::new(&objs, &self.shared);
            for t in templates {
                let Ok((bytes, _)) = self.shared.vault.read(&t) else {
                    continue;
                };
                let targets: Vec<String> = extract(&bytes, &stem_of(&t))
                    .links
                    .into_iter()
                    .map(|l| l.target)
                    .collect();
                if resolver
                    .resolve(&t, &targets)
                    .iter()
                    .any(|r| r.path.as_deref().map(nfc).as_deref() == Some(path.as_str()))
                {
                    out.insert(t);
                }
            }
        }
        out.remove(&path);
        let mut v: Vec<String> = out.into_iter().collect();
        v.sort();
        v
    }

    fn free_stem(&self, folder: &str, stem: &str) -> String {
        crate::links4a::free_stem_in(&self.shared, folder, stem)
    }

    fn renamable(&self, path: &str) -> bool {
        let path = nfc(path);
        if lock(&self.shared.not_utf8).contains(&path) {
            return false;
        }
        lock(&self.shared.index).daily_date_of(&path).is_none()
    }

    fn backup_files(&self) -> Vec<String> {
        self.shared
            .vault
            .list_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| nfc(&p))
            .filter(|p| {
                !p.ends_with(".tegg-tmp") && (p.ends_with(".md") || p.starts_with(".tegg/"))
            })
            .collect()
    }

    fn app_dir(&self) -> PathBuf {
        let local = self.shared.vault.local_dir();
        local
            .parent()
            .and_then(|p| p.parent())
            .map(PathBuf::from)
            .unwrap_or(local)
    }

    fn vault_key(&self) -> String {
        self.shared
            .vault
            .local_dir()
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "vault".into())
    }

    fn now(&self) -> String {
        chrono::Local::now()
            .format("%Y-%m-%dT%H:%M:%S%:z")
            .to_string()
    }

    fn progress(&self, p: JobProgress) {
        self.shared.emit(CoreEvent::JobProgress(p));
    }

    fn transform_request(
        &self,
        request: u64,
        source: &str,
        text: &str,
        ops: &[TextOp],
        live: bool,
    ) {
        self.shared.emit(CoreEvent::JobTransform {
            request,
            source: source.to_string(),
            text: text.to_string(),
            ops: ops.to_vec(),
            live,
        });
    }

    fn local_write(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        tegg_vault::write_local_file(path, bytes)
    }

    fn local_read(&self, path: &Path) -> Option<Vec<u8>> {
        tegg_vault::read_local_file(path)
    }

    fn local_remove(&self, path: &Path) {
        let _ = tegg_vault::remove_local_path(path);
    }

    fn local_list(&self, dir: &Path) -> Vec<PathBuf> {
        tegg_vault::list_local_dir(dir)
    }
}

fn write_error(e: VaultError) -> WriteError {
    match e {
        VaultError::Conflict { .. } => WriteError::Changed,
        VaultError::Gone => WriteError::Missing,
        VaultError::NameTaken => WriteError::NameTaken,
        VaultError::NotFound => WriteError::Missing,
        other => WriteError::Io(format!("{other:?}")),
    }
}
