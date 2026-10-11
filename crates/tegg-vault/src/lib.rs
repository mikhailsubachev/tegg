//! Tegg core: all vault I/O. Interface: docs/contracts/ms1-core.md §3.
//! MS1 skeleton: every operation is a stub returning `NotImplemented` until it is implemented.

use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn not_implemented() -> io::Error { io::Error::other("not implemented") }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileVersion { pub mtime_ns: i128, pub size: u64, pub hash: [u8; 32] }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsEntry { File { path: String }, Dir { path: String } }

/// AR-04 AC-1: all vault file access goes through this trait.
pub trait VaultFs: Send + Sync {
    fn list(&self) -> io::Result<Vec<FsEntry>>;
    fn read(&self, path: &str) -> io::Result<(Vec<u8>, FileVersion)>;
    fn version(&self, path: &str) -> io::Result<Option<FileVersion>>;
    fn replace(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    fn create_new(&self, path: &str, bytes: &[u8]) -> io::Result<FileVersion>;
    fn rename_no_replace(&self, from: &str, to: &str) -> io::Result<()>;
    fn create_dir_all(&self, path: &str) -> io::Result<()>;
}

macro_rules! stub_fs {
    ($t:ty) => {
        impl VaultFs for $t {
            fn list(&self) -> io::Result<Vec<FsEntry>> { Err(not_implemented()) }
            fn read(&self, _: &str) -> io::Result<(Vec<u8>, FileVersion)> { Err(not_implemented()) }
            fn version(&self, _: &str) -> io::Result<Option<FileVersion>> { Err(not_implemented()) }
            fn replace(&self, _: &str, _: &[u8]) -> io::Result<FileVersion> { Err(not_implemented()) }
            fn create_new(&self, _: &str, _: &[u8]) -> io::Result<FileVersion> { Err(not_implemented()) }
            fn rename_no_replace(&self, _: &str, _: &str) -> io::Result<()> { Err(not_implemented()) }
            fn create_dir_all(&self, _: &str) -> io::Result<()> { Err(not_implemented()) }
        }
    };
}

pub struct LocalFs;
impl LocalFs { pub fn new(_root: &Path) -> LocalFs { LocalFs } }
stub_fs!(LocalFs);

/// In-memory file system for tests (AR-04 AC-2).
pub struct MemFs;
impl MemFs { pub fn new() -> MemFs { MemFs } }
impl Default for MemFs { fn default() -> Self { Self::new() } }
stub_fs!(MemFs);

/// AR-04 AC-3.
pub trait SyncAdapter: Send + Sync { fn name(&self) -> &str; }
pub struct FolderSync;
impl SyncAdapter for FolderSync { fn name(&self) -> &str { "" } }

#[derive(Debug, Clone)]
pub struct AppDirs { pub root: PathBuf }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKind { Empty }

#[derive(Debug)]
pub enum OpenError { NotATeggVault, Missing, Io(io::Error), NotImplemented }

#[derive(Debug)]
pub enum CreateError { NotEmpty, Io(io::Error), NotImplemented }

#[derive(Debug)]
pub enum VaultError { Conflict { disk: FileVersion }, Gone, NotFound, NameTaken, Io(io::Error), NotImplemented }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome { Unchanged, Written(FileVersion) }

/// D-89.
pub const SYSTEM_TYPES: &[&str] = &[];

pub struct Vault { _private: () }

impl Vault {
    pub fn create(_parent: &Path, _name: &str, _kind: VaultKind, _dirs: &AppDirs) -> Result<Vault, CreateError> { Err(CreateError::NotImplemented) }
    pub fn open(_root: &Path, _dirs: &AppDirs) -> Result<Vault, OpenError> { Err(OpenError::NotImplemented) }
    pub fn open_with(_fs: Box<dyn VaultFs>, _dirs: &AppDirs) -> Result<Vault, OpenError> { Err(OpenError::NotImplemented) }
    pub fn root(&self) -> &Path { Path::new("") }
    pub fn last_opened(_dirs: &AppDirs) -> Option<(PathBuf, bool)> { None }
    pub fn read(&self, _path: &str) -> Result<(Vec<u8>, FileVersion), VaultError> { Err(VaultError::NotImplemented) }
    pub fn write(&self, _path: &str, _bytes: &[u8], _base: Option<&FileVersion>) -> Result<WriteOutcome, VaultError> { Err(VaultError::NotImplemented) }
    pub fn create_file(&self, _dir: &str, _stem: &str, _ext: &str, _bytes: &[u8]) -> Result<(String, FileVersion), VaultError> { Err(VaultError::NotImplemented) }
    pub fn trash(&self, _path: &str) -> Result<String, VaultError> { Err(VaultError::NotImplemented) }
    pub fn restore(&self, _trashed: &str) -> Result<String, VaultError> { Err(VaultError::NotImplemented) }
    pub fn clean_temp_files(&self, _now: SystemTime) -> Result<usize, VaultError> { Err(VaultError::NotImplemented) }
    pub fn managed_files(&self) -> Result<Vec<String>, VaultError> { Err(VaultError::NotImplemented) }
    pub fn local_dir(&self) -> PathBuf { PathBuf::new() }
}
