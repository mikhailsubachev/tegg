//! Tegg type definitions (AR-07): read, check and line-patch `.tegg/types/*.yml` (docs/contracts/ms3-shell.md §14.1).
//!
//! RED-PHASE STUB (D-61): the public surface of the contract with placeholder bodies that return wrong values, so the
//! AC tests (`tests/ac_schema.rs`, `crates/tegg-core/tests/ac_types.rs`) compile and fail on assertions. Never panics.
//! The slice 3D implementation replaces every body.

use serde_json::{Map, Value};

pub const CURRENT_VERSION: u32 = 0; // stub: the contract says 1 (AR-07 AC-1)
pub const TYPES_DIR: &str = ".tegg/types";
/// The first line of every type file Tegg writes (as new-empty, D-99).
pub const HEADER: &str = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttrType {
    Text,
    LongText,
    Number,
    Checkbox,
    Date,
    DateTime,
    DateRange,
    Select,
    MultiSelect,
    Url,
    Email,
    Relation,
    File,
    Color,
    Recurrence,
    Other(String),
}

impl AttrType {
    /// R10 order (FR-TYP-02 AC-1). Stub: wrong list.
    pub const OFFERED: [AttrType; 12] = [
        AttrType::Text, AttrType::Text, AttrType::Text, AttrType::Text, AttrType::Text, AttrType::Text,
        AttrType::Text, AttrType::Text, AttrType::Text, AttrType::Text, AttrType::Text, AttrType::Text,
    ];
    pub fn parse(s: &str) -> AttrType {
        AttrType::Other(s.to_string())
    }
    pub fn as_str(&self) -> &str {
        ""
    }
    pub fn editable(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OptionDef {
    pub label: String,
    pub color: Option<String>,
    pub extra: Vec<(String, Value)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AttrDef {
    pub key: String,
    pub name: String,
    pub r#type: AttrType,
    pub default: Option<Value>,
    pub required: bool,
    pub options: Vec<OptionDef>,
    pub to: Option<Vec<String>>,
    pub multiple: bool,
    pub description: Option<String>,
    pub built_in: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Review {
    Off,
    On,
    Locked,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeFile {
    pub key: String,
    pub declared_version: Option<i64>,
    pub name: String,
    pub plural: String,
    pub system: bool,
    pub folder: String,
    pub icon: String,
    pub color: String,
    pub description: Option<String>,
    pub review: Review,
    pub preview: Vec<String>,
    pub template: Option<String>,
    pub attributes: Vec<AttrDef>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Readability {
    Ok,
    Newer(i64),
    Invalid { message: String, line: usize },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub def: TypeFile,
    pub readability: Readability,
    pub preview_ignored: Vec<String>,
}

fn empty_def(key: &str) -> TypeFile {
    TypeFile {
        key: key.to_string(),
        declared_version: None,
        name: String::new(),
        plural: String::new(),
        system: false,
        folder: String::new(),
        icon: String::new(),
        color: String::new(),
        description: None,
        review: Review::Off,
        preview: Vec::new(),
        template: None,
        attributes: Vec::new(),
    }
}

/// Never fails and never writes (NFR-REL-03). Stub: an empty definition, invalid at line 0.
pub fn parse(key: &str, _text: &str) -> Parsed {
    Parsed {
        def: empty_def(key),
        readability: Readability::Invalid { message: "not implemented".into(), line: 0 },
        preview_ignored: Vec::new(),
    }
}

/// The built-in default file of a system type (D-90). Stub: none.
pub fn builtin(_key: &str) -> Option<&'static str> {
    None
}

pub const SYSTEM_KEYS: [&str; 7] = [""; 7];

/// R11 (D-238). Stub: empty.
pub const STARTER_FILES: &[(&str, &[u8])] = &[];

// ------------------------------------------------------------------------------------------------ keys and rules

/// D-96 / D-239. Stub: empty. (The contract re-exports `tegg_format::type_key`.)
pub fn type_key(_name: &str) -> String {
    String::new()
}

/// D-223. Stub: empty.
pub fn derive_attr_key(_name: &str) -> String {
    String::new()
}

pub struct TypeNames<'a> {
    pub key: &'a str,
    pub name: &'a str,
    pub folder: &'a str,
    pub is_self: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Field {
    Name,
    Plural,
    Folder,
    AttrKey,
    AttrName,
    OptionLabel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleError {
    Empty { field: Field },
    ForbiddenChar { field: Field },
    KeyTaken,
    KeyTooLong,
    FolderTaken,
    FolderInvalid,
    ReservedKey { key: String },
    AttrKeyTaken,
    AttrKeyInvalid,
    RangeCollision,
    OptionEmpty,
    OptionDuplicate,
    OptionUsed { label: String },
    PreviewFull,
    /// Stub only: not in the contract.
    NotImplemented,
}

pub fn check_type_name(_name: &str, _plural: &str, _others: &[TypeNames], _undefined_ok: bool) -> Result<String, RuleError> {
    Err(RuleError::NotImplemented)
}

pub fn check_folder(_folder: &str, _others: &[TypeNames]) -> Result<String, RuleError> {
    Err(RuleError::NotImplemented)
}

pub fn check_attr_key(_key: &str, _def: &TypeFile, _new_type: &AttrType) -> Result<(), RuleError> {
    Err(RuleError::NotImplemented)
}

// ------------------------------------------------------------------------------------------------ value validity

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Validity {
    Empty,
    Valid,
    Invalid { items: Vec<usize> },
}

/// §14.1.3. Stub: always `Invalid` of the whole value.
pub fn validate(_attr: &AttrDef, _fm: &Map<String, Value>) -> Validity {
    Validity::Invalid { items: vec![usize::MAX] }
}

// ------------------------------------------------------------------------------------------------ writing

/// Stub: empty.
pub fn new_type_file(_name: &str, _plural: &str) -> String {
    String::new()
}

/// Stub: empty.
pub fn serialize(_def: &TypeFile) -> String {
    String::new()
}

#[derive(Debug, Clone)]
pub enum TypeOp {
    SetName(String),
    SetPlural(String),
    SetFolder(String),
    SetIcon(String),
    SetColor(String),
    SetDescription(Option<String>),
    SetReview(bool),
    SetPreview(Vec<String>),
    AddAttribute(AttrDef),
    UpdateAttribute { key: String, change: AttrChange },
    RemoveAttribute(String),
    MoveAttribute { key: String, to: usize },
}

#[derive(Debug, Clone, Default)]
pub struct AttrChange {
    pub name: Option<String>,
    pub r#type: Option<AttrType>,
    pub default: Option<Option<Value>>,
    pub required: Option<bool>,
    pub options: Option<Vec<OptionDef>>,
    pub to: Option<Option<Vec<String>>>,
    pub multiple: Option<bool>,
    pub description: Option<Option<String>>,
}

pub struct PatchContext<'a> {
    pub others: &'a [TypeNames<'a>],
}

#[derive(Debug, Clone, PartialEq)]
pub enum SchemaError {
    NewerVersion,
    Invalid,
    BuiltInChanged,
    ReviewLocked,
    SystemTypeName,
    Rule(RuleError),
    /// Stub only: not in the contract.
    NotImplemented,
}

/// Stub: refuses every patch.
pub fn patch(_key: &str, _text: &str, _ops: &[TypeOp], _ctx: &PatchContext) -> Result<Option<String>, SchemaError> {
    Err(SchemaError::NotImplemented)
}
