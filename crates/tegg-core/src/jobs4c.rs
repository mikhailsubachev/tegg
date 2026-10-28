//! ms4-jobs §2–§9: the core's side of the job engine. `CoreHost` gives `tegg-jobs` the vault, the index and the event
//! hub; the engine never edits Markdown (D-82) and the core never plans a job.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tegg_format::{extract, nfc, type_key};
use tegg_index::is_indexable;
use tegg_jobs::host::{Host, HostProperty, ReadError, WriteError, Wrote};
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

    fn free_stem_avoiding(&self, folder: &str, stem: &str, reserved: &std::collections::BTreeSet<String>) -> String {
        crate::links4a::free_stem_avoiding(&self.shared, folder, stem, reserved)
    }

    fn renamable(&self, path: &str) -> bool {
        let path = nfc(path);
        if lock(&self.shared.not_utf8).contains(&path) {
            return false;
        }
        lock(&self.shared.index).daily_date_of(&path).is_none()
    }

    fn vault_files(&self) -> Vec<String> {
        self.shared
            .vault
            .list_files()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| !p.ends_with(".md") && !p.ends_with(".tegg-tmp") && !p.split('/').any(|c| c.starts_with('.')))
            .map(|p| nfc(&p))
            .collect()
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

    // ---------------------------------------------------------------- 4D-lite (ms4-tags §4.3)

    fn template_paths(&self) -> Vec<String> {
        self.note_paths().into_iter().filter(|p| p.starts_with("_templates/")).collect()
    }

    fn trash(&self, path: &str, base: &FileVersion) -> Result<String, WriteError> {
        let path = nfc(path);
        let to = self.shared.vault.trash_checked(&path, base).map_err(write_error)?;
        let _ = lock(&self.shared.index).remove(&path);
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path, to.clone()] });
        Ok(to)
    }

    fn untrash(&self, trashed: &str, to: &str) -> Result<(), WriteError> {
        let (trashed, to) = (nfc(trashed), nfc(to));
        if self.version(&to).is_some() {
            return Err(WriteError::NameTaken);
        }
        self.shared.vault.move_back(&trashed, &to).map_err(write_error)?;
        if let Ok((bytes, v)) = self.shared.vault.read(&to) {
            self.index_written(&to, &bytes, &v);
        }
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![trashed, to] });
        Ok(())
    }

    fn create(&self, path: &str, bytes: &[u8]) -> Result<FileVersion, WriteError> {
        let path = nfc(path);
        let v = self.shared.vault.create_exact(&path, bytes).map_err(write_error)?;
        self.index_written(&path, bytes, &v);
        self.shared.emit(CoreEvent::VaultChanged { paths: vec![path] });
        Ok(v)
    }

    fn tag_folder(&self) -> String {
        crate::tags4d::tag_folder_of(&self.shared)
    }

    fn tags(&self) -> Vec<tegg_jobs::host::HostTag> {
        crate::tags4d::host_tags(&self.shared)
    }

    fn vault_name(&self) -> String {
        self.shared.vault.root().file_name().map(|n| nfc(&n.to_string_lossy())).unwrap_or_default()
    }

    // ---------------------------------------------------------------- 4E-1 (ms4-jobs §14.5)

    fn type_folder(&self, r#type: &str) -> Option<String> {
        let k = type_key(r#type);
        self.shared.read_types().into_iter().find(|t| t.key == k && !t.invalid).map(|t| nfc(t.folder.trim_matches('/')))
    }

    fn defined_types(&self) -> Vec<String> {
        self.shared.read_types().into_iter().filter(|t| !t.invalid).map(|t| t.key).collect()
    }

    fn objects_of(&self, r#type: &str) -> Vec<String> {
        // D-811: only objects whose `type` is written (an untyped file is Page by FR-TYP-10 and never moved).
        let k = type_key(r#type);
        lock(&self.shared.index).objects().into_iter().filter(|o| o.r#type == k && o.type_raw.is_some()).map(|o| nfc(&o.path)).collect()
    }

    fn schema(&self, r#type: &str) -> Vec<HostProperty> {
        let k = type_key(r#type);
        let defs = self.shared.type_defs();
        defs.get(&k)
            .map(|d| {
                d.attributes
                    .iter()
                    .map(|a| HostProperty { key: a.key.clone(), name: a.name.clone(), kind: a.r#type.as_str().to_string(), to: a.to.clone().unwrap_or_default() })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn has_conflict(&self, path: &str) -> bool {
        let path = nfc(path);
        lock(&self.shared.index).conflicts().iter().any(|c| nfc(&c.primary) == path || c.others.iter().any(|o| nfc(o) == path))
    }

    fn local_exempt(&self) -> Vec<String> {
        self.exempt_list("ids")
    }

    fn set_local_exempt(&self, ids: &[String]) {
        self.set_exempt_list("ids", ids);
    }

    fn local_exempt_paths(&self) -> Vec<String> {
        self.exempt_list("paths")
    }

    fn set_local_exempt_paths(&self, paths: &[String]) {
        self.set_exempt_list("paths", paths);
    }

    fn type_names(&self, r#type: &str) -> Option<(String, String)> {
        let k = type_key(r#type);
        self.shared.read_types().into_iter().find(|t| t.key == k).map(|t| (t.name, t.plural))
    }

    fn new_id(&self) -> String {
        crate::media6a::ulid(std::time::SystemTime::now())
    }

    fn type_of(&self, path: &str) -> Option<String> {
        let o = lock(&self.shared.index).object(&nfc(path))?;
        o.type_raw.is_some().then_some(o.r#type)
    }

    fn write_type_folder(&self, r#type: &str, folder: &str) -> Result<Option<String>, String> {
        crate::types3d::write_folder(&self.shared, r#type, folder).map_err(|e| format!("{e:?}"))
    }
}

impl CoreHost {
    /// ms4-jobs §14.6: `<Application Support>/Tegg/jobs/<vault-key>/tidy-exempt.json`.
    fn exempt_path(&self) -> PathBuf {
        self.app_dir().join("jobs").join(self.vault_key()).join("tidy-exempt.json")
    }

    fn exempt_file(&self) -> serde_json::Value {
        tegg_vault::read_local_file(&self.exempt_path()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(serde_json::Value::Null)
    }

    /// `ids` (D-812) or `paths` (D-839) of the exemption file.
    fn exempt_list(&self, field: &str) -> Vec<String> {
        self.exempt_file()[field].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
    }

    fn set_exempt_list(&self, field: &str, items: &[String]) {
        let cur = self.exempt_file();
        if items.is_empty() && cur.is_null() {
            return;
        }
        let other = if field == "ids" { "paths" } else { "ids" };
        let mut v = serde_json::json!({ "version": 1, "ids": [], "paths": [] });
        v[other] = cur[other].clone();
        if v[other].is_null() {
            v[other] = serde_json::json!([]);
        }
        v[field] = serde_json::json!(items);
        let _ = tegg_vault::write_local_file(&self.exempt_path(), v.to_string().as_bytes());
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
