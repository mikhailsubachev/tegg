//! Tegg core: all vault I/O. Interface: docs/contracts/ms1-core.md §3.
//! Vault logic works only through `VaultFs` (AR-04); `local.rs` holds the only file-writing code.

mod local;
mod mem;
mod new_vault;

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tegg_format::{nfc, sanitize_file_stem, unique_file_name};

pub use local::{create_local_dir, read_local_file, remove_local_path, write_local_file, LocalFs};
pub use mem::MemFs;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileVersion {
    pub mtime_ns: i128,
    pub size: u64,
    /// BLAKE3 of the bytes.
    pub hash: [u8; 32],
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
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)>;
    /// None when the file doesn't exist.
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>>;
    /// Atomic replace or create: `.<name>.tegg-tmp` in the same folder → fsync → rename (FR-SYN-02).
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    /// Atomic create that fails with `AlreadyExists` instead of replacing.
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()>;
    fn create_dir_all(&self, path: &str) -> io::Result<()>;
    /// Only for leftover temporary files (FR-SYN-02 AC-4); notes are never deleted, they go to `.trash/`.
    fn remove_file(&self, path: &str) -> io::Result<()>;
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKind {
    Empty,
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

impl Vault {
    /// FR-VLT-01 AC-2, FR-VLT-02 AC-1: `<parent>/<sanitized name>/` with `.tegg/vault.yml` and one type
    /// definition per system type (D-89, D-90). Nothing else.
    pub fn create(parent: &Path, name: &str, kind: VaultKind, dirs: &AppDirs) -> Result<Vault, CreateError> {
        let VaultKind::Empty = kind;
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

    pub fn read(&self, path: &str) -> Result<(Vec<u8>, FileVersion), VaultError> {
        Ok(self.fs.read(&nfc(path))?)
    }

    /// The one write function (architecture §5.3). Unchanged bytes → nothing written (FR-SYN-06);
    /// disk differs from `base` → `Conflict` (FR-SYN-03 AC-7); file gone while `base` is Some → `Gone`.
    pub fn write(&self, path: &str, bytes: &[u8], base: Option<&FileVersion>) -> Result<WriteOutcome, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path);
        match self.fs.read(&path) {
            Ok((current, disk)) => {
                if current == bytes {
                    return Ok(WriteOutcome::Unchanged);
                }
                // No base means "I have no version": an existing file with other bytes is never
                // overwritten (NFR-REL-02, bug_ms1_nfr_rel_02); with a base, it must still be on disk.
                if base != Some(&disk) {
                    return Err(VaultError::Conflict { disk });
                }
                Ok(WriteOutcome::Written(self.fs.replace(&path, bytes)?))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                if base.is_some() {
                    return Err(VaultError::Gone);
                }
                if let Some((dir, _)) = path.rsplit_once('/') {
                    self.fs.create_dir_all(dir)?;
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

    /// FR-STO-08, FR-STO-01 AC-5: move to `.trash/<same relative path>`, with a suffix if that is taken.
    pub fn trash(&self, path: &str) -> Result<String, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let path = nfc(path);
        if self.fs.version(&path)?.is_none() {
            return Err(VaultError::NotFound);
        }
        self.move_free(&path, &join(TRASH, &path))
    }

    /// Back to the original path, or with a suffix if that is taken.
    pub fn restore(&self, trashed: &str) -> Result<String, VaultError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        let trashed = nfc(trashed);
        let original = trashed.strip_prefix(&format!("{TRASH}/")).ok_or(VaultError::NotFound)?.to_string();
        self.move_free(&trashed, &original)
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
