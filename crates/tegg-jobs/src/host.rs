//! What the engine needs from the vault it runs on (ms4-jobs §2–§5). `tegg-core` implements it over its vault, index
//! and event hub, so this crate stays below the core (AR-03) and never edits Markdown itself (D-82).

use std::path::{Path, PathBuf};

use crate::{FileVersion, JobProgress, TextOp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    Missing,
    Placeholder,
    Io(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteError {
    /// The file is no longer `base` (another program, or the user, changed it).
    Changed,
    Missing,
    Placeholder,
    /// A rename target exists.
    NameTaken,
    Io(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wrote {
    Written(FileVersion),
    Unchanged,
}

pub trait Host: Send + Sync {
    /// The file's bytes and version; a placeholder is never read (ms2-core).
    fn read(&self, path: &str) -> Result<(Vec<u8>, FileVersion), ReadError>;
    fn version(&self, path: &str) -> Option<FileVersion>;
    /// The version the index last read (5B `inbox` plans against it, ms5-capture §7.3): a change on disk that the
    /// index hasn't seen yet makes the file `changed`. Defaults to the disk version.
    fn indexed_version(&self, path: &str) -> Option<FileVersion> {
        self.version(path)
    }
    fn is_placeholder(&self, path: &str) -> bool;
    /// Writes only if the file is still `base` (content), then updates the index and reports `vault:changed`. Never
    /// emits a conflict to the editor: a job skips the file instead (§5).
    fn write(&self, path: &str, bytes: &[u8], base: &FileVersion) -> Result<Wrote, WriteError>;
    /// The atomic note rename of §3 (`Vault::rename_with`), then the index moves the note.
    fn rename(
        &self,
        from: &str,
        to: &str,
        bytes: &[u8],
        base: &FileVersion,
    ) -> Result<FileVersion, WriteError>;
    /// Every note path of the vault (NFC), templates included; `.trash/` excluded.
    fn note_paths(&self) -> Vec<String>;
    /// Notes with a link that resolves to `path` from the note itself (D-291): indexed notes and `_templates/`, never
    /// `.trash/`, never `path` itself.
    fn linking(&self, path: &str) -> Vec<String>;
    /// A free stem for a new name in `folder` (vault-wide, D-291 part 2, D-384).
    fn free_stem(&self, folder: &str, stem: &str) -> String;
    /// As `free_stem`, also avoiding `reserved` (NFC, lower-case vault paths a job has already given out, QA B1).
    fn free_stem_avoiding(&self, folder: &str, stem: &str, reserved: &std::collections::BTreeSet<String>) -> String {
        let _ = reserved;
        self.free_stem(folder, stem)
    }
    /// Whether a title commit on `path` may rename it (not a Daily Note, D-320; not a file read as non-UTF-8, D-180).
    fn renamable(&self, path: &str) -> bool;
    /// Every vault file that isn't a note (attachments), outside hidden folders: the files a moved note's relative links
    /// may name (4E-1, QA 4 N2). Empty: no such link is rewritten.
    fn vault_files(&self) -> Vec<String> {
        Vec::new()
    }
    /// Every `.md` file and every file under `.tegg/` (the backup set, §6).
    fn backup_files(&self) -> Vec<String>;
    /// `<Application Support>/Tegg`.
    fn app_dir(&self) -> PathBuf;
    /// A stable key of this vault for machine-local folders (backups, journals).
    fn vault_key(&self) -> String;
    /// Now as an ISO date-time with offset (`modified`, FR-FMT-11).
    fn now(&self) -> String;
    fn progress(&self, p: JobProgress);
    fn transform_request(&self, request: u64, source: &str, text: &str, ops: &[TextOp], live: bool);
    /// Machine-local files (Application Support: backups, journals), through `tegg-vault` (AR-04 AC-1).
    fn local_write(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()>;
    fn local_read(&self, path: &Path) -> Option<Vec<u8>>;
    fn local_remove(&self, path: &Path);
    fn local_list(&self, dir: &Path) -> Vec<PathBuf>;

    // -------------------------------------------------------------------------------- 4D-lite (ms4-tags §4.3)
    // Default bodies are the 4D-lite stubs (TS-I1): nothing is found, every write is refused.

    /// `_templates/**/*.md` (tag jobs rewrite templates, D-714).
    fn template_paths(&self) -> Vec<String> {
        Vec::new()
    }
    /// ms6-trash-media §1.4: renames `path` into `.trash/` if it is still `base`; returns the new path.
    fn trash(&self, path: &str, base: &FileVersion) -> Result<String, WriteError> {
        let _ = (path, base);
        Err(WriteError::Io("4D-lite stub: Host::trash".into()))
    }
    /// Restore (§5.3): moves `trashed` back to `to`; `NameTaken` when `to` exists.
    fn untrash(&self, trashed: &str, to: &str) -> Result<(), WriteError> {
        let _ = (trashed, to);
        Err(WriteError::Io("4D-lite stub: Host::untrash".into()))
    }
    /// Create-exclusive (restore of a file the job renamed away).
    fn create(&self, path: &str, bytes: &[u8]) -> Result<FileVersion, WriteError> {
        let _ = (path, bytes);
        Err(WriteError::Io("4D-lite stub: Host::create".into()))
    }
    /// The Tag type's folder (D-719).
    fn tag_folder(&self) -> String {
        String::new()
    }
    /// Every tag of the index (ms4-tags §1.2) with the objects carrying it.
    fn tags(&self) -> Vec<HostTag> {
        Vec::new()
    }
    /// The vault's name (the backup manifest, D-724).
    fn vault_name(&self) -> String {
        String::new()
    }

    // -------------------------------------------------------------------------------- 4E-1 (ms4-jobs §14.5)
    // Default bodies are the 4E-1 stubs (TS-I1): no type, no object, no schema, no conflict, no exemption.

    /// The type file's folder (NFC).
    fn type_folder(&self, r#type: &str) -> Option<String> {
        let _ = r#type;
        None
    }
    /// Keys with a valid definition.
    fn defined_types(&self) -> Vec<String> {
        Vec::new()
    }
    /// Indexed objects whose `type` matches (D-239), no templates, no `.trash/`.
    fn objects_of(&self, r#type: &str) -> Vec<String> {
        let _ = r#type;
        Vec::new()
    }
    /// Key, name, value type and relation targets of each schema property, in schema order.
    fn schema(&self, r#type: &str) -> Vec<HostProperty> {
        let _ = r#type;
        Vec::new()
    }
    /// A pending FR-SYN-04 conflict on `path`.
    fn has_conflict(&self, path: &str) -> bool {
        let _ = path;
        false
    }
    /// §14.6: ids the tidy job leaves alone (`tidy-exempt.json`).
    fn local_exempt(&self) -> Vec<String> {
        Vec::new()
    }
    fn set_local_exempt(&self, ids: &[String]) {
        let _ = ids;
    }
    /// D-839: NFC paths of exempt notes without an `id` (`paths` in `tidy-exempt.json`).
    fn local_exempt_paths(&self) -> Vec<String> {
        Vec::new()
    }
    fn set_local_exempt_paths(&self, paths: &[String]) {
        let _ = paths;
    }
    /// The type's Name and plural name (backup labels, R99).
    fn type_names(&self, r#type: &str) -> Option<(String, String)> {
        let _ = r#type;
        None
    }
    /// A new object id (ULID), for a file without one that gets a type (D-174).
    fn new_id(&self) -> String {
        String::new()
    }
    /// The matched type key of the note at `path` (D-239); `None` for a file without `type` (FR-TYP-10).
    fn type_of(&self, path: &str) -> Option<String> {
        let _ = path;
        None
    }
    /// D-822: writes `folder: <folder>` into the type file of `r#type` (a base-checked line patch, D-235). Returns the
    /// type file's path when it was written, `None` when it already had that folder.
    fn write_type_folder(&self, r#type: &str, folder: &str) -> Result<Option<String>, String> {
        let _ = (r#type, folder);
        Err("4E-1 stub: Host::write_type_folder".into())
    }

    // -------------------------------------------------------------------------------- 4E-2 (ms4-jobs §14.9.2)

    /// §14.9.3: moves the folder `dir` (a type's templates) to `.trash/` with its relative path; `Some((dir, trashed))`,
    /// `None` when there is no such folder. Undo moves it back with `untrash`.
    fn trash_dir(&self, dir: &str) -> Result<Option<String>, WriteError> {
        let _ = dir;
        Ok(None)
    }
    /// The type definitions changed on disk (a type file trashed or restored by a job): the core re-reads them.
    fn types_changed(&self) {}
    /// Removes the item `key` and its `preview` entry from the type file of `r#type` (as `type_patch` does), checked
    /// against `base` (the version read at planning). Returns the type file's new version. Stub until 4E-2 (TS-I1).
    fn remove_property(&self, r#type: &str, key: &str, base: &FileVersion) -> Result<FileVersion, WriteError> {
        let _ = (r#type, key, base);
        Err(WriteError::Io("4E-2 stub: Host::remove_property".into()))
    }
}

/// ms4-jobs §14.5: one schema property as the 4E planners see it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HostProperty {
    pub key: String,
    pub name: String,
    /// The R10 type key (`text`, `date`, `select`, `relation`, …).
    pub kind: String,
    /// Relation targets (type keys).
    pub to: Vec<String>,
    /// A system type's built-in attribute (FR-TYP-06 AC-2): never removed by a job.
    pub built_in: bool,
}

/// One tag as the tag planners see it (ms4-tags §1.2, §4.1).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HostTag {
    pub key: String,
    /// The display name (D-711).
    pub name: String,
    /// The winning Tag file and the losers (D-694, D-718).
    pub file: Option<String>,
    pub losers: Vec<String>,
    /// Indexed objects with an occurrence (no templates, no `.trash/`), in path order.
    pub holders: Vec<String>,
}
