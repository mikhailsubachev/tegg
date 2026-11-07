//! Slice PIN (docs/contracts/v1-pinned.md §1): compile-only red-test stubs, no behaviour (TS-I1). The build replaces them.
use crate::{Core, CoreError, FileVersion};

pub const PINNED_YML: &str = ".tegg/pinned.yml";
pub const PINS_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinTarget {
    Object { id: Option<String>, path: Option<String> },
    Tag { key: String },
    Type { key: String },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinItem {
    pub target: PinTarget,
    pub lines: std::ops::Range<usize>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsFileState {
    Missing,
    Ok,
    Newer { version: u64 },
    Unreadable { line: Option<u32>, reason: String },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinsFile {
    pub state: PinsFileState,
    pub items: Vec<PinItem>,
    pub patchable: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinState { Ok, Pending, Trashed, Missing, NoObjects }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinRow {
    pub index: usize,
    pub target: PinTarget,
    pub state: PinState,
    pub path: Option<String>,
    pub title: Option<String>,
    pub r#type: Option<String>,
    pub date: Option<String>,
}
#[derive(Debug, Clone)]
pub struct Pins {
    pub version: Option<FileVersion>,
    pub state: PinsFileState,
    pub patchable: bool,
    pub index_ready: bool,
    pub rows: Vec<PinRow>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinOp {
    Pin { target: PinRequest, at: Option<usize> },
    Unpin { index: usize },
    Move { from: usize, to: usize },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinRequest { Object { path: String }, Tag { key: String }, Type { key: String } }
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinError { NewerVersion, Unreadable, NotPinnable, NoSuchPin }
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinEdit { Insert { target: PinTarget, at: Option<usize> }, Remove { index: usize }, Move { from: usize, to: usize } }

pub fn read(_bytes: &[u8]) -> PinsFile {
    PinsFile { state: PinsFileState::Unreadable { line: None, reason: "NotImplemented".into() }, items: vec![], patchable: false }
}
pub fn apply_text(_text: Option<&str>, _file: &PinsFile, _edit: &PinEdit) -> Result<Option<String>, PinError> {
    Err(PinError::Unreadable)
}

impl Core {
    pub fn pins(&self) -> Pins {
        Pins { version: None, state: PinsFileState::Unreadable { line: None, reason: "NotImplemented".into() }, patchable: false, index_ready: false, rows: vec![] }
    }
    pub fn pins_apply(&self, _base: Option<FileVersion>, _op: PinOp) -> Result<Pins, CoreError> {
        Err(CoreError::Pin(PinError::Unreadable))
    }
}
