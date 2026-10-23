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
    /// Whether a title commit on `path` may rename it (not a Daily Note, D-320; not a file read as non-UTF-8, D-180).
    fn renamable(&self, path: &str) -> bool;
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
