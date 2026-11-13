//! Tegg core: all vault I/O. Interface: docs/contracts/ms1-core.md §3.
//! Vault logic works only through `VaultFs` (AR-04); `local.rs` holds the only file-writing code.

mod external;
mod local;
mod mem;
mod new_vault;
mod types;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tegg_format::{nfc, sanitize_file_stem, unique_file_name};

pub use external::{
    free_space, has_entry_at_or_above, is_inside, list_external_dir, missing_creatable_parent, open_external_file, probe_new_vault, resolve_existing, stat_external, volume_id, ExternalFolder, ExternalRead,
    NewVaultProbe, ReadSeek,
};
pub use local::{
    append_local_file, create_external_dir_new, create_local_dir, list_local_dir, read_local_file, remove_dir_tree, remove_local_path, rename_dir_no_replace, trash_import_leftover,
    write_local_file, LocalFs, BEFORE_RENAME,
};
pub use mem::MemFs;
pub use new_vault::EMPTY_VAULT;
pub use types::TypeDef;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileVersion {
    pub mtime_ns: i128,
    pub size: u64,
    /// BLAKE3 of the bytes.
    pub hash: [u8; 32],
}

impl FileVersion {
    /// D-175: two versions are the same when size and content hash match; the mtime only decides re-hashing.
    pub fn same_content(&self, other: &FileVersion) -> bool {
        self.size == other.size && self.hash == other.hash
    }

    /// The content version of `bytes` (size and BLAKE3; `mtime_ns` 0): what a write-ahead log records before a file
    /// exists (v1-import §9.6) and what `same_content` compares.
    pub fn of(bytes: &[u8]) -> FileVersion {
        version_of(bytes, 0)
    }

    /// `of` over a stream, without holding the bytes: the write-ahead `C` line of an attachment, whose size and hash
    /// are known before its copy (v1-import §9.4, §9.6).
    pub fn of_reader(src: &mut dyn io::Read) -> io::Result<FileVersion> {
        let mut hasher = blake3::Hasher::new();
        let mut buf = vec![0u8; 64 * 1024];
        let mut size = 0u64;
        loop {
            let n = match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            };
            hasher.update(&buf[..n]);
            size += n as u64;
        }
        Ok(FileVersion { mtime_ns: 0, size, hash: *hasher.finalize().as_bytes() })
    }
}

pub(crate) fn version_of(bytes: &[u8], mtime_ns: i128) -> FileVersion {
    FileVersion { mtime_ns, size: bytes.len() as u64, hash: *blake3::hash(bytes).as_bytes() }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsEntry {
    File { path: String },
    Dir { path: String },
}

/// AR-04 AC-1: all vault file access goes through this trait. Paths are vault-relative, `/`-separated, NFC.
pub trait VaultFs: Send + Sync {
    /// Recursive listing, including hidden files.
    fn list(&self) -> io::Result<Vec<FsEntry>>;
    /// Slice Q (v1-queries §1.5): the entries directly in `dir` (vault-relative paths); a missing folder has none.
    /// Default: `list` filtered; a file system that can list one folder overrides it.
    fn list_dir(&self, dir: &str) -> io::Result<Vec<FsEntry>> {
        let prefix = format!("{}/", dir.trim_matches('/'));
        Ok(self
            .list()?
            .into_iter()
            .filter(|e| match e {
                FsEntry::File { path } | FsEntry::Dir { path } => nfc(path).strip_prefix(&prefix).is_some_and(|r| !r.is_empty() && !r.contains('/')),
            })
            .collect())
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)>;
    /// None when the file doesn't exist.
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>>;
    /// Atomic replace or create: `.<name>.tegg-tmp` in the same folder → fsync → rename (FR-SYN-02).
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    /// Atomic create that fails with `AlreadyExists` instead of replacing.
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()>;
    /// Changes only the letter case of a file's name (`from` and `to` equal case-folded). Default: as
    /// `rename_no_replace`; a case-insensitive file system overrides it (4C, FR-FMT-08 AC-8).
    fn rename_case(&self, from: &str, to: &str) -> io::Result<()> {
        self.rename_no_replace(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()>;
    /// Only for leftover temporary files (FR-SYN-02 AC-4); notes are never deleted, they go to `.trash/`.
    fn remove_file(&self, path: &str) -> io::Result<()>;
    /// Removes the folder `path` only when it is empty (never its contents); an error otherwise. Default: keeps it.
    fn remove_empty_dir(&self, _path: &str) -> io::Result<()> {
        Ok(())
    }
    /// FR-VLT-03, D-112: an online-only placeholder whose content isn't on this Mac (APFS `SF_DATALESS`).
    /// iCloud `.<name>.icloud` stubs are recognized by name, not here. Reading a placeholder would download it.
    fn is_placeholder(&self, _path: &str) -> io::Result<bool> {
        Ok(false)
    }
    /// `(mtime_ns, size)` without reading the content, `None` when missing; an error for a folder.
    /// Used for the index's offline catch-up (architecture §5.1).
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        Ok(self.version(path)?.map(|v| (v.mtime_ns, v.size)))
    }
    /// Reports changes made by other programs (architecture §5.4). `None` when this file system has no
    /// watcher (e.g. `MemFs`: tests report changes through a `SyncAdapter`). Dropping the guard stops it.
    fn watch(&self, _sink: ChangeSink) -> io::Result<Option<WatchGuard>> {
        Ok(None)
    }
    /// ms6-trash-media §1.1 (D-618): the entry's status-change time (`st_ctime` on Unix, the last write time
    /// elsewhere), `None` when missing; a rename into `.trash/` sets it (R71). `MemFs` keeps a counter set on every
    /// rename.
    fn changed_ns(&self, _path: &str) -> io::Result<Option<i128>> {
        Ok(None)
    }
    /// v1-import §12.2 (slice I1): streams `src` into `<folder>/.<file name>.<tag>.tegg-tmp` next to `path`, opened
    /// create-new (an existing file of that name is an `AlreadyExists` error and is left as it is: never truncated),
    /// and syncs it. Returns the temp file's vault path, the version of the bytes written and the file id. The folder
    /// must exist. Default: a file system without staged creates.
    fn write_temp_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> io::Result<(String, FileVersion, u64)> {
        let _ = (path, tag, src);
        Err(io::Error::new(io::ErrorKind::Unsupported, "this file system has no staged create"))
    }
    /// v1-import §12.2: the file's id on its volume (`st_ino` on Unix), `None` when missing. A rename keeps it, so it
    /// tells whether the file at a path is the temp file a run wrote. Default: no ids.
    fn file_id(&self, _path: &str) -> io::Result<Option<u64>> {
        Ok(None)
    }
    /// v1-import §12.2: `replace`, with `before_rename` run after the temp file is written and before the rename; an
    /// `Err` from it fails the write and removes the temp file. Default (no temp file): the hook, then `replace`.
    fn replace_with(&self, path: &str, bytes: &[u8], before_rename: &dyn Fn() -> io::Result<()>) -> io::Result<FileVersion> {
        before_rename()?;
        self.replace(path, bytes)
    }
    /// v1-import §12.2: creates the one folder `path`; `AlreadyExists` when an entry has that name. Its parent must exist.
    fn create_dir_new(&self, path: &str) -> io::Result<()> {
        if self.is_dir(path)? || self.version(path).is_ok_and(|v| v.is_some()) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, path.to_string()));
        }
        self.create_dir_all(path)
    }
    /// Whether `path` is a folder. Default: `list` searched.
    fn is_dir(&self, path: &str) -> io::Result<bool> {
        let want = fold(path.trim_matches('/'));
        Ok(self.list()?.into_iter().any(|e| matches!(e, FsEntry::Dir { path } if fold(&path) == want)))
    }
}

/// What a watcher reports: vault-relative NFC paths that may have changed (event kinds are never trusted,
/// a path can be a file, a folder or gone), or "rescan everything" when events were lost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsChange {
    Paths(Vec<String>),
    Rescan,
}
pub type ChangeSink = Box<dyn Fn(FsChange) + Send + Sync>;
/// Keeps a watcher alive.
pub type WatchGuard = Box<dyn std::any::Any + Send>;

/// So a test keeps a handle on the `MemFs` a vault uses (docs/contracts/ms2-core.md §3).
impl<T: VaultFs + ?Sized> VaultFs for std::sync::Arc<T> {
    fn list(&self) -> io::Result<Vec<FsEntry>> {
        (**self).list()
    }
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)> {
        (**self).read(path)
    }
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>> {
        (**self).version(path)
    }
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        (**self).replace(path, bytes)
    }
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion> {
        (**self).create_new(path, bytes)
    }
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()> {
        (**self).rename_no_replace(from, to)
    }
    fn rename_case(&self, from: &str, to: &str) -> io::Result<()> {
        (**self).rename_case(from, to)
    }
    fn create_dir_all(&self, path: &str) -> io::Result<()> {
        (**self).create_dir_all(path)
    }
    fn remove_file(&self, path: &str) -> io::Result<()> {
        (**self).remove_file(path)
    }
    fn is_placeholder(&self, path: &str) -> io::Result<bool> {
        (**self).is_placeholder(path)
    }
    fn stat(&self, path: &str) -> io::Result<Option<(i128, u64)>> {
        (**self).stat(path)
    }
    fn watch(&self, sink: ChangeSink) -> io::Result<Option<WatchGuard>> {
        (**self).watch(sink)
    }
    fn changed_ns(&self, path: &str) -> io::Result<Option<i128>> {
        (**self).changed_ns(path)
    }
    fn list_dir(&self, dir: &str) -> io::Result<Vec<FsEntry>> {
        (**self).list_dir(dir)
    }
    fn remove_empty_dir(&self, path: &str) -> io::Result<()> {
        (**self).remove_empty_dir(path)
    }
    fn write_temp_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> io::Result<(String, FileVersion, u64)> {
        (**self).write_temp_new(path, tag, src)
    }
    fn file_id(&self, path: &str) -> io::Result<Option<u64>> {
        (**self).file_id(path)
    }
    fn replace_with(&self, path: &str, bytes: &[u8], before_rename: &dyn Fn() -> io::Result<()>) -> io::Result<FileVersion> {
        (**self).replace_with(path, bytes, before_rename)
    }
    fn create_dir_new(&self, path: &str) -> io::Result<()> {
        (**self).create_dir_new(path)
    }
    fn is_dir(&self, path: &str) -> io::Result<bool> {
        (**self).is_dir(path)
    }
}

// ---------------------------------------------------------------- the staged exclusive create (v1-import §9.4, §12.2)

/// The marker a new-vault import writes first into its temporary folder (v1-import §9.5); `remove_dir_tree` and
/// `trash_import_leftover` refuse a folder without it.
pub const IMPORT_MARKER: &str = ".tegg-import";

/// A file staged by `stage_new`: its bytes are complete and synced in `temp`, next to `path`; nothing is at `path` yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Staged {
    /// The vault path the file will get (NFC).
    pub path: String,
    /// The temp file's vault path: `<folder>/.<file name>.<tag>.tegg-tmp`.
    pub temp: String,
    /// Size and BLAKE3 of the bytes staged (and the temp file's mtime).
    pub version: FileVersion,
    /// The temp file's file id (inode); a rename keeps it.
    pub file_id: u64,
}

/// `<folder>/.<file name>.tegg-tmp` (`tag` None) or `<folder>/.<file name>.<tag>.tegg-tmp` for the vault path `path`.
/// A tag is letters, digits, `-` and `_` only, so the name can never leave the folder.
pub(crate) fn temp_path(path: &str, tag: Option<&str>) -> io::Result<String> {
    let path = nfc(path.trim_matches('/'));
    let (dir, name) = path.rsplit_once('/').unwrap_or(("", &path));
    if name.is_empty() || name == "." || name == ".." {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "no file name"));
    }
    let temp = match tag {
        None => format!(".{name}.tegg-tmp"),
        Some(t) if !t.is_empty() && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') => format!(".{name}.{t}.tegg-tmp"),
        Some(_) => return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid temp tag")),
    };
    Ok(join(dir, &temp))
}

/// Folded names of the entries directly in `dir`, read from that folder only where the file system can.
fn names_in_fs(fs: &dyn VaultFs, dir: &str) -> io::Result<Vec<String>> {
    let entries = if dir.is_empty() {
        fs.list()?.into_iter().filter(|e| matches!(e, FsEntry::File { path } | FsEntry::Dir { path } if !path.trim_matches('/').contains('/'))).collect()
    } else {
        fs.list_dir(dir)?
    };
    Ok(entries
        .into_iter()
        .map(|e| match e {
            FsEntry::File { path } | FsEntry::Dir { path } => fold(path.trim_matches('/').rsplit('/').next().unwrap_or_default()),
        })
        .collect())
}

/// v1-import §9.4 step 1 on any `VaultFs` (the new-vault run's private `LocalFs` has no `Vault`): streams `src` into
/// the run's own temp file next to `path` (create-new, synced). Takes no lock; creates no folder.
pub fn stage_new_on(fs: &dyn VaultFs, path: &str, tag: &str, src: &mut dyn io::Read) -> io::Result<Staged> {
    let path = nfc(path.trim_matches('/'));
    temp_path(&path, Some(tag))?;
    let (temp, version, file_id) = fs.write_temp_new(&path, tag, src)?;
    Ok(Staged { path, temp, version, file_id })
}

/// v1-import §9.4 step 2 on any `VaultFs`: the name check (no entry of the folder has that name, NFC and case-folded)
/// and the no-replace rename of the temp file onto `path`. `AlreadyExists` when the name is taken or the rename says
/// so; on every failure the temp file is removed and nothing at `path` is touched.
pub fn commit_new_on(fs: &dyn VaultFs, staged: Staged) -> io::Result<FileVersion> {
    let commit = || -> io::Result<()> {
        let (dir, name) = staged.path.rsplit_once('/').unwrap_or(("", &staged.path));
        if names_in_fs(fs, dir)?.contains(&fold(name)) {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, staged.path.clone()));
        }
        fs.rename_no_replace(&staged.temp, &staged.path)
    };
    match commit() {
        Ok(()) => Ok(staged.version),
        Err(e) => {
            let _ = fs.remove_file(&staged.temp);
            Err(e)
        }
    }
}

/// Removes a staged file's temp file (a create given up before its rename).
pub fn discard_staged_on(fs: &dyn VaultFs, staged: Staged) {
    let _ = fs.remove_file(&staged.temp);
}

/// ms6-trash-media §1.1 (D-619): moves a file or folder out of the vault into the system's trash (macOS: Finder's
/// Trash through `NSFileManager trashItemAtURL`). The core stays platform-neutral (AR-03): the shell implements it;
/// tests use a recording implementation. `abs` is an absolute path.
pub trait SystemTrash: Send + Sync {
    fn trash(&self, abs: &Path) -> io::Result<()>;
}

/// AR-04 AC-3: remote changes will enter through this trait (Phase 2); Phase 1 relies on the watcher.
pub trait SyncAdapter: Send + Sync {
    fn name(&self) -> &str;
    /// AR-04 AC-3 (MS2): the adapter calls `sink(paths)` for changes it applied through the `VaultFs`;
    /// the core processes them like watcher events. The folder adapter reports nothing (the watcher does).
    fn start(&self, _sink: Box<dyn Fn(Vec<String>) + Send + Sync>) {}
}

/// Phase 1: a vault in a folder that Dropbox, Google Drive or iCloud syncs (FR-SYN-01).
pub struct FolderSync;
impl SyncAdapter for FolderSync {
    fn name(&self) -> &str {
        "folder"
    }
}

/// `~/Library/Application Support/Tegg` (FR-STO-07), injected.
#[derive(Debug, Clone)]
pub struct AppDirs {
    pub root: PathBuf,
}

impl AppDirs {
    fn last_vault_file(&self) -> PathBuf {
        self.root.join("last-vault")
    }

    fn recent_vaults_file(&self) -> PathBuf {
        self.root.join("recent-vaults")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKind {
    Empty,
    /// FR-VLT-02 AC-6/AC-7 (ms3-shell §14.2.5): `EMPTY_VAULT` plus these (vault path, bytes) files.
    Starter(&'static [(&'static str, &'static [u8])]),
}

#[derive(Debug)]
pub enum OpenError {
    NotATeggVault,
    Missing,
    Io(io::Error),
    NotImplemented,
}

#[derive(Debug)]
pub enum CreateError {
    NotEmpty,
    Io(io::Error),
    NotImplemented,
}

#[derive(Debug)]
pub enum VaultError {
    Conflict { disk: FileVersion },
    Gone,
    NotFound,
    NameTaken,
    Io(io::Error),
    NotImplemented,
}

impl From<io::Error> for VaultError {
    fn from(e: io::Error) -> Self {
        if e.kind() == io::ErrorKind::NotFound { VaultError::NotFound } else { VaultError::Io(e) }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    Unchanged,
    Written(FileVersion),
}

/// D-89.
pub const SYSTEM_TYPES: &[&str] = &["Page", "Task", "Quick Note", "Daily Note", "Tag", "Image", "PDF"];

const VAULT_YML: &str = ".tegg/vault.yml";
const TRASH: &str = ".trash";
const TEMP_MAX_AGE_NS: i128 = 60 * 1_000_000_000;
/// Attachments the app manages (FR-STO-05, FR-ATT-07); other non-Markdown files are left alone (FR-STO-09).
const ATTACHMENTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "heif", "tif", "tiff", "bmp", "avif", "pdf"];

pub struct Vault {
    fs: Box<dyn VaultFs>,
    root: PathBuf,
    local: PathBuf,
    /// Serializes changes in this vault, so two writes of the same file never share its temporary
    /// file (`.<name>.tegg-tmp`, FR-SYN-02 AC-2). Other processes: the app is single-instance (D-71).
    lock: Mutex<()>,
}

const RECENT_MAX: usize = 9;

/// The recent-vaults file: one NFC path per line, most recent first (D-219).
fn recent_paths(dirs: &AppDirs) -> Vec<String> {
    let Some(bytes) = local::read_local_file(&dirs.recent_vaults_file()) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for line in String::from_utf8_lossy(&bytes).lines() {
        let p = nfc(line.trim_end());
        if !p.is_empty() && !out.contains(&p) && out.len() < RECENT_MAX {
            out.push(p);
        }
    }
    out
}

/// One entry of the recent-vaults list (D-219).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentVault {
    pub name: String,
    pub path: PathBuf,
    pub exists: bool,
}

impl Vault {
    /// FR-VLT-01 AC-2, FR-VLT-02 AC-1: `<parent>/<sanitized name>/` with `.tegg/vault.yml` and one type
    /// definition per system type (D-89, D-90). A starter vault adds the given files (FR-VLT-02 AC-7, D-238;
    /// the shell passes `tegg_schema::STARTER_FILES`). Nothing else.
    pub fn create(parent: &Path, name: &str, kind: VaultKind, dirs: &AppDirs) -> Result<Vault, CreateError> {
        let root = parent.join(sanitize_file_stem(name));
        if root.exists() {
            let empty = root.read_dir().map(|mut d| d.next().is_none()).unwrap_or(false);
            if !empty {
                return Err(CreateError::NotEmpty); // FR-VLT-01 AC-3: touch nothing
            }
        }
        let fs = LocalFs::new(&root);
        fs.create_dir_all(".tegg/types").map_err(CreateError::Io)?;
        for (path, text) in new_vault::EMPTY_VAULT {
            fs.create_new(path, text.as_bytes()).map_err(CreateError::Io)?;
        }
        if let VaultKind::Starter(files) = kind {
            for (path, bytes) in files {
                if let Some((dir, _)) = path.rsplit_once('/') {
                    fs.create_dir_all(dir).map_err(CreateError::Io)?;
                }
                fs.create_new(path, bytes).map_err(CreateError::Io)?;
            }
        }
        Vault::open(&root, dirs).map_err(|e| match e {
            OpenError::Io(e) => CreateError::Io(e),
            other => CreateError::Io(io::Error::other(format!("created vault doesn't open: {other:?}"))),
        })
    }

    /// FR-VLT-01 AC-4/AC-5: zero writes to the vault. A folder without `.tegg/vault.yml` → `NotATeggVault` (D-91).
    pub fn open(root: &Path, dirs: &AppDirs) -> Result<Vault, OpenError> {
        if !root.is_dir() {
            return Err(OpenError::Missing);
        }
        let root = root.canonicalize().map_err(OpenError::Io)?;
        if !root.join(VAULT_YML).is_file() {
            return Err(OpenError::NotATeggVault);
        }
        // FR-VLT-01 AC-7, D-98: remember it in Application Support, never in the vault.
        local::write_local_file(&dirs.last_vault_file(), root.to_string_lossy().as_bytes()).map_err(OpenError::Io)?;
        // D-219, FR-VLT-01 AC-17: most recent first, NFC paths, no duplicates, at most 9. A failure only loses the list.
        let me = nfc(&root.to_string_lossy());
        let mut list: Vec<String> = vec![me.clone()];
        list.extend(recent_paths(dirs).into_iter().filter(|p| *p != me).take(RECENT_MAX - 1));
        let _ = local::write_local_file(&dirs.recent_vaults_file(), list.join("\n").as_bytes());
        Ok(Vault { fs: Box::new(LocalFs::new(&root)), local: local_dir_for(dirs, &root.to_string_lossy()), root, lock: Mutex::new(()) })
    }

    /// Any `VaultFs` (AR-04 AC-2); such a vault has no folder on disk and isn't remembered.
    pub fn open_with(fs: Box<dyn VaultFs>, dirs: &AppDirs) -> Result<Vault, OpenError> {
        match fs.version(VAULT_YML) {
            Ok(Some(_)) => Ok(Vault { fs, root: PathBuf::new(), local: local_dir_for(dirs, "memory"), lock: Mutex::new(()) }),
            Ok(None) => Err(OpenError::NotATeggVault),
            Err(e) => Err(OpenError::Io(e)),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// FR-VLT-01 AC-7, D-98: the remembered vault path and whether the folder still exists.
    pub fn last_opened(dirs: &AppDirs) -> Option<(PathBuf, bool)> {
        let bytes = local::read_local_file(&dirs.last_vault_file())?;
        let path = PathBuf::from(String::from_utf8(bytes).ok()?.trim_end_matches('\n'));
        let exists = path.is_dir();
        Some((path, exists))
    }

    /// D-219, FR-VLT-01 AC-17: the recently opened vaults, most recent first (at most 9).
    pub fn recent(dirs: &AppDirs) -> Vec<RecentVault> {
        recent_paths(dirs)
            .into_iter()
            .map(|p| {
                let path = PathBuf::from(&p);
                let name = path.file_name().map(|n| nfc(&n.to_string_lossy())).unwrap_or_default();
                let exists = path.is_dir();
                RecentVault { name, path, exists }
            })
            .collect()
    }

    pub fn read(&self, path: &str) -> Result<(Vec<u8>, FileVersion), VaultError> {
        Ok(self.fs.read(&nfc(path))?)
    }

    /// The one write function (architecture §5.3). Unchanged bytes → nothing written (FR-SYN-06);
    /// disk content (size + hash, D-175) differs from `base` → `Conflict` (FR-SYN-03 AC-7); an mtime-only
    /// change is not a conflict; file gone while `base` is Some → `Gone`.
    pub fn write(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>) -> Result<WriteOutcome, VaultError> {
        self.write_inner(path, bytes, base, None)
    }

    fn write_inner(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>, hook: Option<&dyn Fn() -> io::Result<()>>) -> Result<WriteOutcome, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path);
        match self.fs.read(&path) {
            Ok((current, disk)) => {
                if current == bytes {
                    return Ok(WriteOutcome::Unchanged);
                }
                // No base means "I have no version": an existing file with other bytes is never
                // overwritten (NFR-REL-02, bug_ms1_nfr_rel_02); with a base, it must still be on disk.
                if !base.is_some_and(|b| b.same_content(&disk)) {
                    return Err(VaultError::Conflict { disk });
                }
                Ok(WriteOutcome::Written(match hook {
                    Some(h) => self.fs.replace_with(&path, bytes, h).map_err(VaultError::Io)?,
                    None => self.fs.replace(&path, bytes)?,
                }))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                if base.is_some() {
                    return Err(VaultError::Gone);
                }
                if let Some((dir, _)) = path.rsplit_once('/') {
                    self.fs.create_dir_all(dir)?;
                }
                if let Some(h) = hook {
                    h().map_err(VaultError::Io)?;
                }
                match self.fs.create_new(&path, bytes) {
                    Ok(v) => Ok(WriteOutcome::Written(v)),
                    // Someone created it in the meantime: never replace it (NFR-REL-02).
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => match self.fs.version(&path)? {
                        Some(disk) => Err(VaultError::Conflict { disk }),
                        None => Err(VaultError::Io(e)),
                    },
                    Err(e) => Err(VaultError::Io(e)),
                }
            }
            Err(e) => Err(VaultError::Io(e)),
        }
    }

    /// A new file with a free name in `dir` (FR-LNK-14, FR-STO-05 AC-3). Names compare in NFC and
    /// case-insensitively (APFS), so `Photo.png` next to `photo.png` becomes `Photo (2).png` (FR-FMT-12 AC-3).
    pub fn create_file(&self, dir: &str, stem: &str, ext: &str, bytes: &[u8]) -> Result<(String, FileVersion), VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let dir = nfc(dir.trim_matches('/'));
        if !dir.is_empty() {
            self.fs.create_dir_all(&dir)?;
        }
        let mut taken: Vec<String> = self.names_in(&dir)?;
        loop {
            let name = unique_file_name(stem, ext, &|n: &str| taken.contains(&fold(n)));
            let path = join(&dir, &name);
            match self.fs.create_new(&path, bytes) {
                Ok(v) => return Ok((path, v)),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => taken.push(fold(&name)),
                Err(e) => return Err(VaultError::Io(e)),
            }
        }
    }

    /// A new file at exactly `path`; `NameTaken` if any file has that name (NFC, case-insensitive). D-194.
    pub fn create_exact(&self, path: &str, bytes: &[u8]) -> Result<FileVersion, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path.trim_matches('/'));
        let (dir, name) = path.rsplit_once('/').unwrap_or(("", &path));
        if !dir.is_empty() {
            self.fs.create_dir_all(dir)?;
        }
        if self.names_in(dir)?.contains(&fold(name)) {
            return Err(VaultError::NameTaken);
        }
        match self.fs.create_new(&path, bytes) {
            Ok(v) => Ok(v),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(VaultError::NameTaken),
            Err(e) => Err(VaultError::Io(e)),
        }
    }

    /// v1-import §9.4 step 1 (D-1547 (1)): **takes no vault lock.** Streams `src` into
    /// `<folder>/.<file name>.<tag>.tegg-tmp` (create-new, never truncating) and syncs it. The folder must exist.
    pub fn stage_new(&self, path: &str, tag: &str, src: &mut dyn io::Read) -> Result<Staged, VaultError> {
        stage_new_on(self.fs.as_ref(), path, tag, src).map_err(VaultError::Io)
    }

    /// v1-import §9.4 step 2: holds the vault lock for the name check of `create_exact` and the no-replace rename only.
    /// `NameTaken` when an entry has that name (NFC, case-folded) or the rename answers `AlreadyExists`; the temp file
    /// is then removed. Whatever is at `path` is never touched.
    pub fn commit_new(&self, staged: Staged) -> Result<FileVersion, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        match commit_new_on(self.fs.as_ref(), staged) {
            Ok(v) => Ok(v),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Err(VaultError::NameTaken),
            Err(e) => Err(VaultError::Io(e)),
        }
    }

    pub fn discard_staged(&self, staged: Staged) {
        discard_staged_on(self.fs.as_ref(), staged);
    }

    /// v1-import §9.6: under the vault lock (no write can be in flight), removes `.<file name>.tegg-tmp` (`tag` None)
    /// or `.<file name>.<tag>.tegg-tmp` next to `path`, whatever its age. `false` when there is none.
    pub fn remove_temp(&self, path: &str, tag: Option<&str>) -> Result<bool, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let temp = temp_path(path, tag).map_err(VaultError::Io)?;
        match self.fs.remove_file(&temp) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(VaultError::Io(e)),
        }
    }

    /// v1-import §12.2: the file id (inode) of the file at `path`, `None` when missing.
    pub fn file_id(&self, path: &str) -> Result<Option<u64>, VaultError> {
        self.fs.file_id(&nfc(path)).map_err(VaultError::Io)
    }

    /// v1-import §12.2: `write`, with a per-call hook run after the temp file is written and before the rename; an
    /// `Err` from it fails the write and removes the temp file (for a file that doesn't exist yet the hook runs before
    /// the exclusive create).
    pub fn write_with(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>, before_rename: &dyn Fn() -> io::Result<()>) -> Result<WriteOutcome, VaultError> {
        self.write_inner(path, bytes, base, Some(before_rename))
    }

    /// Whether the vault has the folder `dir`.
    pub fn dir_exists(&self, dir: &str) -> bool {
        self.fs.is_dir(&nfc(dir.trim_matches('/'))).unwrap_or(false)
    }

    /// Creates the folder `dir` with its missing parents.
    pub fn create_dir(&self, dir: &str) -> Result<(), VaultError> {
        self.fs.create_dir_all(&nfc(dir.trim_matches('/'))).map_err(VaultError::Io)
    }

    /// v1-import §9.6 (`D` lines): removes the folder `dir` only when it exists and is empty; `true` when it is gone.
    pub fn remove_empty_dir(&self, dir: &str) -> bool {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let dir = nfc(dir.trim_matches('/'));
        if dir.is_empty() || !self.fs.is_dir(&dir).unwrap_or(false) {
            return false;
        }
        self.fs.remove_empty_dir(&dir).is_ok() && !self.fs.is_dir(&dir).unwrap_or(true)
    }

    /// ms4-jobs §3 (D-389, FR-SYN-06 AC-11): a note rename as one atomic step: `bytes` go to a temp file in `to`'s
    /// folder, which is renamed onto `to` without replacing (`RENAME_EXCL`), then `from` is removed after a base check.
    /// A case-only rename (same name folded) replaces the bytes in place, then renames only the letter case. Errors: `NameTaken` (`to` exists), `Conflict { disk }` (`from`
    /// changed since `base`), `Gone`.
    pub fn rename_with(&self, from: &str, to: &str, bytes: &[u8], base: &FileVersion) -> Result<FileVersion, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let (from, to) = (nfc(from), nfc(to));
        let check = |fs: &dyn VaultFs| -> Result<(), VaultError> {
            match fs.version(&from)? {
                None => Err(VaultError::Gone),
                Some(disk) if !disk.same_content(base) => Err(VaultError::Conflict { disk }),
                Some(_) => Ok(()),
            }
        };
        check(self.fs.as_ref())?;
        let same_name = fold(&from) == fold(&to);
        let (dir, name) = to.rsplit_once('/').unwrap_or(("", &to));
        if !same_name && self.names_in(dir)?.contains(&fold(name)) {
            return Err(VaultError::NameTaken);
        }
        if !dir.is_empty() {
            self.fs.create_dir_all(dir)?;
        }
        if same_name {
            // A case-only change: the new bytes replace the file atomically under its old spelling, then only the
            // case of the name changes. The note always exists under one of its two names (PR #45 review).
            self.fs.replace(&from, bytes)?;
            if from != to {
                self.fs.rename_case(&from, &to)?;
            }
            return self.fs.version(&to)?.ok_or_else(|| VaultError::Io(io::Error::other("renamed file vanished")));
        }
        let tmp = join(dir, &format!(".{name}.rename.tegg-tmp"));
        if self.fs.version(&tmp)?.is_some() {
            self.fs.remove_file(&tmp)?;
        }
        self.fs.create_new(&tmp, bytes)?;
        let undo_tmp = |e: VaultError| {
            let _ = self.fs.remove_file(&tmp);
            e
        };
        check(self.fs.as_ref()).map_err(undo_tmp)?;
        match self.fs.rename_no_replace(&tmp, &to) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(undo_tmp(VaultError::NameTaken)),
            Err(e) => return Err(undo_tmp(VaultError::Io(e))),
        }
        self.fs.remove_file(&from)?;
        self.fs.version(&to)?.ok_or_else(|| VaultError::Io(io::Error::other("renamed file vanished")))
    }

    /// Trash only if the file is still `base` (D-195); else `Conflict`.
    pub fn trash_checked(&self, path: &str, base: &FileVersion) -> Result<String, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path);
        match self.fs.version(&path)? {
            None => Err(VaultError::Gone),
            Some(disk) if !disk.same_content(base) => Err(VaultError::Conflict { disk }),
            Some(_) => self.move_free(&path, &join(TRASH, &path)),
        }
    }

    /// ms5-tasks §11.6 (D-492): deletes `path` (no trash) only while it is still `base`; `Conflict` otherwise,
    /// `NotFound` when absent. Used only to undo a conversion that created the file.
    pub fn discard_checked(&self, path: &str, base: &FileVersion) -> Result<(), VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path);
        match self.fs.version(&path)? {
            None => Err(VaultError::NotFound),
            Some(disk) if !disk.same_content(base) => Err(VaultError::Conflict { disk }),
            Some(_) => Ok(self.fs.remove_file(&path)?),
        }
    }

    /// FR-STO-08, FR-STO-01 AC-5: move to `.trash/<same relative path>`, with a suffix if that is taken.
    pub fn trash(&self, path: &str) -> Result<String, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path);
        if self.fs.version(&path)?.is_none() {
            return Err(VaultError::NotFound);
        }
        self.move_free(&path, &join(TRASH, &path))
    }

    /// FR-TYP-05 AC-1 (D-225): moves the folder `dir` with everything in it to `.trash/<same relative path>` in one
    /// rename, with a ` (2)` suffix if that is taken; `NotFound` when there is no such folder. Where the file system
    /// can't rename folders, each file is trashed on its own.
    pub fn trash_dir(&self, dir: &str) -> Result<Vec<String>, VaultError> {
        let dir = nfc(dir.trim_matches('/'));
        let prefix = format!("{dir}/");
        let files: Vec<String> = self.files()?.into_iter().filter(|p| p.starts_with(&prefix)).collect();
        let is_dir = self.fs.list()?.into_iter().any(|e| matches!(e, FsEntry::Dir { path } if nfc(&path) == dir));
        if !is_dir && files.is_empty() {
            return Err(VaultError::NotFound);
        }
        {
            let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(to) = self.move_free(&dir, &join(TRASH, &dir)) {
                return Ok(files.iter().map(|f| format!("{to}/{}", &f[prefix.len()..])).collect());
            }
        }
        files.iter().map(|f| self.trash(f)).collect()
    }

    /// Back to the original path, or with a suffix if that is taken.
    pub fn restore(&self, trashed: &str) -> Result<String, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let trashed = nfc(trashed);
        let original = trashed.strip_prefix(&format!("{TRASH}/")).ok_or(VaultError::NotFound)?.to_string();
        self.move_free(&trashed, &original)
    }

    /// ms6-trash-media §1.1 (FR-HIS-01 AC-5, D-225): moves a trashed folder (`.trash/<dir>`) back to `<dir>` in one
    /// rename, with a ` (2)` suffix if that is taken; returns the folder's new vault path.
    pub fn restore_dir(&self, trashed_dir: &str) -> Result<String, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let trashed = nfc(trashed_dir.trim_matches('/'));
        let original = trashed.strip_prefix(&format!("{TRASH}/")).ok_or(VaultError::NotFound)?.to_string();
        let is_dir = self.fs.list()?.into_iter().any(|e| matches!(e, FsEntry::Dir { path } if nfc(&path) == trashed));
        if !is_dir {
            return Err(VaultError::NotFound);
        }
        self.move_dir_free(&trashed, &original)
    }

    /// ms6-trash-media §1.1, §1.4 (FR-HIS-01 AC-7, AC-8, D-619): moves the file or folder `path` (vault-relative)
    /// out of the vault through `sink`; Tegg never unlinks a vault file itself.
    pub fn remove_to(&self, path: &str, sink: &dyn SystemTrash) -> Result<(), VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path.trim_matches('/'));
        let exists = self.fs.list()?.into_iter().any(|e| match e {
            FsEntry::File { path: p } | FsEntry::Dir { path: p } => fold(&p) == fold(&path),
        });
        if !exists {
            return Err(VaultError::NotFound);
        }
        sink.trash(&self.root.join(&path))?;
        Ok(())
    }

    /// Every file and folder of the vault, hidden ones included (ms6-trash-media §1.2 lists `.trash/` from it).
    pub fn entries(&self) -> Result<Vec<FsEntry>, VaultError> {
        Ok(self.fs.list()?)
    }

    /// `Fs::changed_ns` of a vault path (R71).
    pub fn changed_ns(&self, path: &str) -> Result<Option<i128>, VaultError> {
        Ok(self.fs.changed_ns(&nfc(path))?)
    }

    /// Renames `path` (a file, ` (2)` if taken) back to `to` exactly: undoing the first rename of a pair.
    pub fn move_back(&self, from: &str, to: &str) -> Result<(), VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        Ok(self.fs.rename_no_replace(&nfc(from), &nfc(to))?)
    }

    /// 4E-2 (ms4-jobs §14.9.4): after a job moved `trashed` back out of `.trash/`, the folders it leaves empty there,
    /// up to `.trash/` itself, go too (a cancelled or undone type delete leaves no trace in the trash).
    pub fn prune_trash(&self, trashed: &str) {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let mut dir = nfc(trashed);
        while let Some((parent, _)) = dir.rsplit_once('/') {
            if !(parent == TRASH || parent.starts_with(&format!("{TRASH}/"))) || self.fs.remove_empty_dir(parent).is_err() {
                return;
            }
            dir = parent.to_string();
        }
    }

    /// FR-SYN-02 AC-4: deletes `.<name>.tegg-tmp` files older than 1 minute; returns how many.
    pub fn clean_temp_files(&self, now: SystemTime) -> Result<usize, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let now_ns = now.duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as i128).unwrap_or(0);
        let mut removed = 0;
        for path in self.files()? {
            let name = path.rsplit('/').next().unwrap_or(&path);
            if !(name.starts_with('.') && name.ends_with(".tegg-tmp")) {
                continue;
            }
            if let Some(v) = self.fs.version(&path)? {
                if now_ns - v.mtime_ns > TEMP_MAX_AGE_NS {
                    self.fs.remove_file(&path)?;
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    /// FR-STO-09, FR-STO-01 AC-6: Markdown, recognized attachments and `.tegg/`; never hidden files,
    /// temporary files, `.trash/`, `.obsidian/`, `.git/` or other files (`.docx`, `.txt`).
    pub fn managed_files(&self) -> Result<Vec<String>, VaultError> {
        Ok(self.files()?.into_iter().filter(|p| is_managed(p)).collect())
    }

    /// Slice Q (v1-queries §1.5): the files directly in `dir` (vault-relative, NFC), without walking the vault.
    pub fn list_dir(&self, dir: &str) -> Result<Vec<String>, VaultError> {
        Ok(self.fs.list_dir(&nfc(dir))?.into_iter().filter_map(|e| if let FsEntry::File { path } = e { Some(nfc(&path)) } else { None }).collect())
    }

    /// All files in the vault (vault-relative, NFC), for the index (read-only).
    pub fn list_files(&self) -> Result<Vec<String>, VaultError> {
        self.files()
    }

    /// The file's current version, `None` when missing; an error for a folder.
    pub fn version(&self, path: &str) -> Result<Option<FileVersion>, VaultError> {
        Ok(self.fs.version(&nfc(path))?)
    }

    /// `(mtime_ns, size)` without reading the file; `None` when missing.
    pub fn stat(&self, path: &str) -> Result<Option<(i128, u64)>, VaultError> {
        Ok(self.fs.stat(&nfc(path))?)
    }

    /// FR-VLT-03, D-112: online-only placeholder (never read it: that would download it).
    pub fn is_placeholder(&self, path: &str) -> bool {
        let name = path.rsplit('/').next().unwrap_or(path);
        (name.starts_with('.') && name.ends_with(".icloud")) || self.fs.is_placeholder(&nfc(path)).unwrap_or(false)
    }

    /// Starts the file system's watcher, if it has one (architecture §5.4).
    pub fn watch(&self, sink: ChangeSink) -> io::Result<Option<WatchGuard>> {
        self.fs.watch(sink)
    }

    /// FR-STO-07: `<Application Support>/vaults/<vault key>/`, the key derived from the vault's path.
    pub fn local_dir(&self) -> PathBuf {
        self.local.clone()
    }

    fn files(&self) -> Result<Vec<String>, VaultError> {
        Ok(self.fs.list()?.into_iter().filter_map(|e| if let FsEntry::File { path } = e { Some(path) } else { None }).collect())
    }

    /// Folded names of the entries directly in `dir`.
    fn names_in(&self, dir: &str) -> Result<Vec<String>, VaultError> {
        let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
        Ok(self
            .fs
            .list()?
            .into_iter()
            .map(|e| match e {
                FsEntry::File { path } | FsEntry::Dir { path } => path,
            })
            .filter_map(|p| p.strip_prefix(&prefix).map(str::to_string))
            .filter(|rest| !rest.contains('/'))
            .map(|n| fold(&n))
            .collect())
    }

    /// A folder to `to`, or `to (2)`, … when taken (no extension split).
    fn move_dir_free(&self, from: &str, to: &str) -> Result<String, VaultError> {
        let (dir, name) = to.rsplit_once('/').unwrap_or(("", to));
        if !dir.is_empty() {
            self.fs.create_dir_all(dir)?;
        }
        let mut taken: Vec<String> = self.names_in(dir)?;
        loop {
            let candidate = join(dir, &unique_file_name(name, "", &|n: &str| taken.contains(&fold(n))));
            match self.fs.rename_no_replace(from, &candidate) {
                Ok(()) => return Ok(candidate),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => taken.push(fold(candidate.rsplit('/').next().unwrap_or(&candidate))),
                Err(e) => return Err(e.into()),
            }
        }
    }

    /// Renames `from` to `to`, or to `to` with ` (2)`, ` (3)`, … when taken; never replaces a file.
    fn move_free(&self, from: &str, to: &str) -> Result<String, VaultError> {
        let (dir, name) = to.rsplit_once('/').unwrap_or(("", to));
        if !dir.is_empty() {
            self.fs.create_dir_all(dir)?;
        }
        let (stem, ext) = match name.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s, e),
            _ => (name, ""),
        };
        let mut taken: Vec<String> = self.names_in(dir)?;
        loop {
            let candidate = join(dir, &unique_file_name(stem, ext, &|n: &str| taken.contains(&fold(n))));
            match self.fs.rename_no_replace(from, &candidate) {
                Ok(()) => return Ok(candidate),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => taken.push(fold(candidate.rsplit('/').next().unwrap_or(&candidate))),
                Err(e) => return Err(e.into()),
            }
        }
    }
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

/// Name comparison as APFS does it by default: normalization- and case-insensitive.
fn fold(name: &str) -> String {
    nfc(name).to_lowercase()
}

fn is_managed(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let hidden = parts.iter().enumerate().any(|(i, p)| p.starts_with('.') && !(i == 0 && *p == ".tegg" && parts.len() > 1));
    if hidden {
        return false;
    }
    if parts[0] == ".tegg" {
        return true;
    }
    let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    ext == "md" || ATTACHMENTS.contains(&ext.as_str())
}

fn local_dir_for(dirs: &AppDirs, identity: &str) -> PathBuf {
    let key = blake3::hash(identity.as_bytes()).to_hex();
    dirs.root.join("vaults").join(&key.as_str()[..16])
}
