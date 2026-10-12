//! Tegg core façade: opens a vault, owns the index, the watcher, background indexing, events and recency.
//! Interface: docs/contracts/ms2-core.md §3. No Tauri dependency (AR-03).
//! MS2 scaffold: stubs return wrong values until implemented (TS-I1).

use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::NaiveDate;
pub use tegg_index::{
    AttrFilter, Conflict, ConflictKind, DateRange, IndexError, MatchField, MatchTier, ObjectInfo, SearchPage,
    SearchQuery, SearchResult, Snippet, SwitcherItem, SwitcherKind,
};
pub use tegg_vault::{AppDirs, FileVersion, SyncAdapter, Vault, VaultError, VaultFs, WriteOutcome};

#[derive(Default, Clone)]
pub struct CoreOptions {
    /// FSEvents watcher (LocalFs only); false in MemFs tests.
    pub watch: bool,
    /// AR-04 AC-3; None = the folder adapter.
    pub sync: Option<Arc<dyn SyncAdapter>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgressState {
    Running,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CoreEvent {
    IndexProgress { done: usize, total: usize, state: ProgressState },
    VaultChanged { paths: Vec<String> },
    NoteConflict { path: String, mine: Vec<u8>, theirs: Vec<u8>, disk: FileVersion },
    Placeholders { count: usize },
}

#[derive(Debug)]
pub enum CoreError {
    Vault(VaultError),
    Index(IndexError),
    NotImplemented,
}

pub struct Core {
    vault: Vault,
}

impl Core {
    pub fn open(root: &Path, dirs: &AppDirs, _opts: CoreOptions) -> Result<Core, CoreError> {
        let vault = Vault::open(root, dirs).map_err(|_| CoreError::NotImplemented)?;
        Ok(Core { vault })
    }
    pub fn open_with(fs: Arc<dyn VaultFs>, dirs: &AppDirs, _opts: CoreOptions) -> Result<Core, CoreError> {
        let vault = Vault::open_with(Box::new(fs), dirs).map_err(|_| CoreError::NotImplemented)?;
        Ok(Core { vault })
    }
    pub fn vault(&self) -> &Vault {
        &self.vault
    }
    pub fn events(&self) -> Receiver<CoreEvent> {
        channel().1
    }
    pub fn wait_idle(&self, _timeout: Duration) -> bool {
        false
    }
    pub fn cancel_indexing(&self) {}

    pub fn search(&self, _q: &SearchQuery) -> Result<SearchPage, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn switcher(&self, _q: &str, _limit: usize) -> Vec<SwitcherItem> {
        vec![]
    }
    pub fn object(&self, _path: &str) -> Option<ObjectInfo> {
        None
    }
    pub fn objects(&self) -> Vec<ObjectInfo> {
        vec![]
    }
    pub fn backlinks(&self, _path: &str) -> Vec<String> {
        vec![]
    }
    pub fn resolve_link(&self, _target: &str) -> Option<String> {
        None
    }
    pub fn conflicts(&self) -> Vec<Conflict> {
        vec![]
    }
    pub fn daily_note(&self, _date: NaiveDate) -> Option<String> {
        None
    }
    pub fn snapshot(&self) -> String {
        String::new()
    }
    pub fn placeholders(&self) -> Vec<String> {
        vec![]
    }

    pub fn read_note(&self, _path: &str, _now: SystemTime) -> Result<(Vec<u8>, FileVersion), CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn write_note(&self, _path: &str, _bytes: &[u8], _base: Option<&FileVersion>) -> Result<WriteOutcome, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn create_note(&self, _dir: &str, _title: &str, _bytes: &[u8]) -> Result<String, CoreError> {
        Err(CoreError::NotImplemented)
    }
    pub fn notify_changed(&self, _paths: &[String]) {}
}
