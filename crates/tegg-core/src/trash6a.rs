//! MS6 slice 6A (docs/contracts/ms6-trash-media.md §1): the trash in the core. Listing `.trash/` from the file system
//! only (AR-01, FR-HIS-01 AC-10), moving objects and their unshared pairs into `.trash/` and back (renames only), and
//! removing trash entries through the platform's `SystemTrash` (D-615: never an unlink).
//! 6A stub (ms6-trash-media §1): every function returns a deliberately wrong result (TS-I1).

use tegg_vault::SystemTrash;

use crate::{Core, CoreError, FileVersion};

/// What a trash row is (ms6-trash-media §1.2, R70 `data-kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrashKind {
    Object,
    File,
    Folder,
}

/// One row of the Trash page (ms6-trash-media §1.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashEntry {
    /// The row's main entry under `.trash/` (object file, bare file or folder), NFC.
    pub path: String,
    pub kind: TrashKind,
    /// `path` without the `.trash/` prefix.
    pub original: String,
    /// The original's parent folder (`Pages`, `_attachments`, `` for the root), or the folder itself for a folder row.
    pub folder: String,
    /// Object title (title, else stem); file name for a file; folder name for a folder.
    pub title: String,
    /// The object's type key; `None` for a file or folder row.
    pub type_key: Option<String>,
    /// Every vault path the row moves (the object and its paired file; all files of a folder).
    pub files: Vec<String>,
    /// Folder: number of `.md` files inside; else 1.
    pub count: u32,
    /// `changed_ns` of `path` (R71).
    pub trashed_ns: i128,
}

/// One rename done by a trash operation (ms6-trash-media §1.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Moved {
    pub from: String,
    pub to: String,
}

/// The outcome of `trash_delete` / `trash_empty` (ms6-trash-media §1.4).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrashRemoval {
    pub removed: Vec<String>,
    /// (path, reason)
    pub failed: Vec<(String, String)>,
}

impl Core {
    /// §1.2: the rows of the Trash page, newest first (R71). 6A stub (ms6-trash-media §1.2): empty.
    pub fn trash_list(&self) -> Vec<TrashEntry> {
        Vec::new()
    }

    /// §1.3 (D-612): the vault path of the file an Image or PDF object's `file:` links to.
    /// 6A stub (ms6-trash-media §1.3): `None`.
    pub fn pair_of(&self, _object_path: &str) -> Option<String> {
        None
    }

    /// §1.4: the version check of `trash_checked`, the object's rename, then its unshared pair's rename.
    /// 6A stub (ms6-trash-media §1.4): `NotImplemented`.
    pub fn trash_object(&self, _path: &str, _base: &FileVersion) -> Result<Vec<Moved>, CoreError> {
        Err(CoreError::NotImplemented)
    }

    /// §1.4: restores a row (object with its pair, file, or folder). 6A stub (ms6-trash-media §1.4): `NotImplemented`.
    pub fn trash_restore(&self, _path: &str) -> Result<Vec<Moved>, CoreError> {
        Err(CoreError::NotImplemented)
    }

    /// §1.4 (D-615): every file of each row through `sink`. 6A stub (ms6-trash-media §1.4): removes nothing.
    pub fn trash_delete(&self, _paths: &[String], _sink: &dyn SystemTrash) -> TrashRemoval {
        TrashRemoval::default()
    }

    /// §1.4 (D-615): every top-level entry of `.trash/` through `sink`; `.trash/` itself stays.
    /// 6A stub (ms6-trash-media §1.4): removes nothing.
    pub fn trash_empty(&self, _sink: &dyn SystemTrash) -> TrashRemoval {
        TrashRemoval::default()
    }
}
