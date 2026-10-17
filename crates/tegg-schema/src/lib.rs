//! Tegg type definitions (AR-07): read, check and line-patch `.tegg/types/*.yml` (docs/contracts/ms3-shell.md §14.1).
//!
//! Pure functions over text: no file system, no index (AR-03). The core reads and writes the files (§14.2). Note
//! bytes are never produced here (D-82, D-245). Reading follows the frontmatter reader of `tegg-format` (YAML 1.2
//! core schema, duplicate keys refused), so a type file and a note read the same way. Writing is line-based like
//! frontmatter edits (dialect §3): a change replaces only the lines of the changed entry; comments, unknown keys,
//! blank lines, quoting and order of untouched lines stay byte-identical (AR-07 AC-5, FR-SYN-06).

use chrono::{DateTime, NaiveDate};
use serde_json::{Map, Value};
use tegg_format::nfc;

/// D-96 / D-239: NFC, trim, lower case, each whitespace run as `-` (`Quick Note` → `quick-note`).
pub use tegg_format::type_key;

pub const CURRENT_VERSION: u32 = 1; // AR-07 AC-1
pub const TYPES_DIR: &str = ".tegg/types";
/// The first line of every type file Tegg writes (as new-empty, D-99).
pub const HEADER: &str = "# Tegg type definition (FR-TYP-01, FR-STO-06, D-90). Edit it in Tegg's type settings.\n";

// ------------------------------------------------------------------------------------------------ model

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
    /// System-only, read-only in the panel (FR-TYP-02 AC-4).
    File,
    Color,
    Recurrence,
    /// Any other `type` string (e.g. `rating`): kept byte for byte, shown read-only (FR-TYP-02 AC-5).
    Other(String),
}

impl AttrType {
    /// R10 order: the `Type` control's list (FR-TYP-02 AC-1).
    pub const OFFERED: [AttrType; 12] = [
        AttrType::Text,
        AttrType::LongText,
        AttrType::Number,
        AttrType::Checkbox,
        AttrType::Date,
        AttrType::DateTime,
        AttrType::DateRange,
        AttrType::Select,
        AttrType::MultiSelect,
        AttrType::Url,
        AttrType::Email,
        AttrType::Relation,
    ];

    /// R10 `type` strings; anything else is `Other` (kept as written).
    pub fn parse(s: &str) -> AttrType {
        match s {
            "text" => AttrType::Text,
            "long-text" => AttrType::LongText,
            "number" => AttrType::Number,
            "checkbox" => AttrType::Checkbox,
            "date" => AttrType::Date,
            "date-time" => AttrType::DateTime,
            "date-range" => AttrType::DateRange,
            "select" => AttrType::Select,
            "multi-select" => AttrType::MultiSelect,
            "url" => AttrType::Url,
            "email" => AttrType::Email,
            "relation" => AttrType::Relation,
            "file" => AttrType::File,
            "color" => AttrType::Color,
            "recurrence" => AttrType::Recurrence,
            other => AttrType::Other(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            AttrType::Text => "text",
            AttrType::LongText => "long-text",
            AttrType::Number => "number",
            AttrType::Checkbox => "checkbox",
            AttrType::Date => "date",
            AttrType::DateTime => "date-time",
            AttrType::DateRange => "date-range",
            AttrType::Select => "select",
            AttrType::MultiSelect => "multi-select",
            AttrType::Url => "url",
            AttrType::Email => "email",
            AttrType::Relation => "relation",
            AttrType::File => "file",
            AttrType::Color => "color",
            AttrType::Recurrence => "recurrence",
            AttrType::Other(s) => s,
        }
    }

    /// The 12 R10 types (FR-TYP-02 AC-1, AC-4, AC-5).
    pub fn editable(&self) -> bool {
        !matches!(self, AttrType::File | AttrType::Color | AttrType::Recurrence | AttrType::Other(_))
    }

    /// Select and Multi-select keep `options` (FR-TYP-03 AC-11).
    pub fn has_options(&self) -> bool {
        matches!(self, AttrType::Select | AttrType::MultiSelect)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OptionDef {
    pub label: String,
    pub color: Option<String>,
    /// Other fields of the option (e.g. Task's `state`), kept in file order.
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
    /// Relation: allowed type keys; None = any type.
    pub to: Option<Vec<String>>,
    pub multiple: bool,
    pub description: Option<String>,
    /// A system type's attribute present in its built-in default (FR-TYP-06 AC-2).
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
    /// File stem, NFC (D-221: fixed at creation).
    pub key: String,
    /// None = missing (read as 1, D-235).
    pub declared_version: Option<i64>,
    pub name: String,
    pub plural: String,
    pub system: bool,
    pub folder: String,
    /// As written; the display fallback is the UI's (R14).
    pub icon: String,
    pub color: String,
    pub description: Option<String>,
    pub review: Review,
    pub preview: Vec<String>,
    /// Properties not shown among the attribute panel's rows on this type's objects (FR-TYP-17, D-316).
    pub hidden: Vec<String>,
    /// Vault path of the default template (D-232).
    pub template: Option<String>,
    pub attributes: Vec<AttrDef>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Readability {
    Ok,
    /// version > CURRENT_VERSION: read, never written (AR-07 AC-3).
    Newer(i64),
    /// 1-based file line (AR-07 AC-4).
    Invalid { message: String, line: usize },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    /// For Invalid: defaults with name = plural = key.
    pub def: TypeFile,
    pub readability: Readability,
    /// Preview keys that are neither attributes nor universal (FR-TYP-11 AC-2).
    pub preview_ignored: Vec<String>,
}

pub const SYSTEM_KEYS: [&str; 7] = ["page", "task", "quick-note", "daily-note", "tag", "image", "pdf"];

/// Keys every object has besides its type's attributes; they may be previewed (FR-TYP-11, ms3-shell §14.7).
pub const UNIVERSAL_KEYS: [&str; 6] = ["tags", "aliases", "source", "review", "created", "modified"];

/// The built-in default file of a system type, byte-equal to `new-empty/.tegg/types/<key>.yml` (D-90, D-99).
pub fn builtin(key: &str) -> Option<&'static str> {
    Some(match key {
        "page" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/page.yml"),
        "task" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/task.yml"),
        "quick-note" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/quick-note.yml"),
        "daily-note" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/daily-note.yml"),
        "tag" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/tag.yml"),
        "image" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/image.yml"),
        "pdf" => include_str!("../../../tests/fixtures/vaults/new-empty/.tegg/types/pdf.yml"),
        _ => return None,
    })
}

/// R11 (D-238), byte-equal to `tests/fixtures/vaults/new-starter/`: (vault path, bytes), type files in R11 order,
/// then their templates in the same order (ms3-shell §14.10 item 10).
pub const STARTER_FILES: &[(&str, &[u8])] = &[
    (".tegg/types/book.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/book.yml")),
    (".tegg/types/reading-note.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/reading-note.yml")),
    (".tegg/types/idea.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/idea.yml")),
    (".tegg/types/meeting.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/meeting.yml")),
    (".tegg/types/person.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/person.yml")),
    (".tegg/types/project.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/project.yml")),
    (".tegg/types/trip.yml", include_bytes!("../../../tests/fixtures/vaults/new-starter/.tegg/types/trip.yml")),
    ("_templates/Book/Book.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Book/Book.md")),
    ("_templates/Reading Note/Reading Note.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Reading Note/Reading Note.md")),
    ("_templates/Idea/Idea.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Idea/Idea.md")),
    ("_templates/Meeting/Meeting.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Meeting/Meeting.md")),
    ("_templates/Person/Person.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Person/Person.md")),
    ("_templates/Project/Project.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Project/Project.md")),
    ("_templates/Trip/Trip.md", include_bytes!("../../../tests/fixtures/vaults/new-starter/_templates/Trip/Trip.md")),
];

// ------------------------------------------------------------------------------------------------ reading

fn fallback_def(key: &str) -> TypeFile {
    TypeFile {
        key: key.to_string(),
        declared_version: None,
        name: key.to_string(),
        plural: key.to_string(),
        system: SYSTEM_KEYS.contains(&key),
        folder: key.to_string(),
        icon: "file-text".into(),
        color: "gray".into(),
        description: None,
        review: Review::Off,
        preview: Vec::new(),
        hidden: Vec::new(),
        template: None,
        attributes: Vec::new(),
    }
}

/// A scalar as text (NFC); None for lists, maps and null.
fn scalar_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(nfc(s)),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Strings of a JSON value NFC (FR-FMT-12), recursively.
fn nfc_value(v: &Value) -> Value {
    match v {
        Value::String(s) => Value::String(nfc(s)),
        Value::Array(a) => Value::Array(a.iter().map(nfc_value).collect()),
        Value::Object(m) => Value::Object(m.iter().map(|(k, v)| (nfc(k), nfc_value(v))).collect()),
        other => other.clone(),
    }
}

/// Never fails and never writes (NFR-REL-03). Validity rules of ms3-shell §14.1.1 (AR-07 AC-4).
pub fn parse(key: &str, text: &str) -> Parsed {
    let key = nfc(key);
    match read_def(&key, text) {
        Ok((def, readability)) => {
            let preview_ignored = def
                .preview
                .iter()
                .filter(|p| !def.attributes.iter().any(|a| &a.key == *p) && !UNIVERSAL_KEYS.contains(&p.as_str()))
                .cloned()
                .collect();
            Parsed { def, readability, preview_ignored }
        }
        Err((message, line)) => Parsed { def: fallback_def(&key), readability: Readability::Invalid { message, line: line.max(1) }, preview_ignored: Vec::new() },
    }
}

/// 1-based line of the first `key: "…` / `- '…` value whose quote doesn't close on its line.
fn unclosed_quote_line(lines: &[String]) -> Option<usize> {
    lines.iter().position(|l| {
        if is_blank_or_comment(l) {
            return false;
        }
        let t = l.trim_start().trim_start_matches("- ");
        let v = match map_key(t) {
            Some(_) => t.split_once(':').map(|(_, v)| v.trim_start()).unwrap_or(""),
            None => t,
        };
        match v.chars().next() {
            Some('"') => {
                let rest = v[1..].replace("\\\\", "").replace("\\\"", "");
                !rest.contains('"')
            }
            Some('\'') => !v[1..].replace("''", "").contains('\''),
            _ => false,
        }
    }).map(|i| i + 1)
}

/// 1-based line of a top-level key, else 1.
fn key_line(lines: &[String], key: &str) -> usize {
    lines.iter().position(|l| top_key(l).as_deref() == Some(key)).map(|i| i + 1).unwrap_or(1)
}

fn read_def(key: &str, text: &str) -> Result<(TypeFile, Readability), (String, usize)> {
    let (lines, _) = split_lines(text);
    let root = tegg_format::parse_yaml_value(text).map_err(|(msg, line)| {
        // An unclosed quote is found where the scalar runs out; point at the line that opens it (as @tegg/doc).
        let line = if msg.contains("quote") { unclosed_quote_line(&lines).unwrap_or(line) } else { line };
        (msg, line)
    })?;
    let first_content = lines.iter().position(|l| !is_blank_or_comment(l)).map(|i| i + 1).unwrap_or(1);
    let Some(Value::Object(top)) = root else {
        return Err(("A type definition must be a mapping of settings (`name: …`).".into(), first_content));
    };
    let declared = match top.get("version") {
        None => None,
        Some(v) => match v.as_i64() {
            Some(n) if n >= 1 && v.is_i64() => Some(n),
            _ => return Err(("`version` must be a whole number, 1 or higher.".into(), key_line(&lines, "version"))),
        },
    };
    let items: Vec<Value> = match top.get("attributes") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(("`attributes` must be a list.".into(), key_line(&lines, "attributes"))),
    };
    let item_lines: Vec<usize> = match top_span(&lines, "attributes") {
        Some(span) => item_spans(&lines, span).1.iter().map(|(s, _)| s + 1).collect(),
        None => Vec::new(),
    };
    let builtin_keys: Vec<String> = if SYSTEM_KEYS.contains(&key) { builtin(key).map(builtin_attr_keys).unwrap_or_default() } else { Vec::new() };
    let mut attributes: Vec<AttrDef> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let line = item_lines.get(i).copied().unwrap_or_else(|| key_line(&lines, "attributes"));
        let Value::Object(m) = item else { return Err(("A property must be a mapping with `key` and `type`.".into(), line)) };
        let k = match m.get("key") {
            Some(Value::String(s)) if !s.trim().is_empty() => nfc(s),
            _ => return Err(("A property has no `key`.".into(), line)),
        };
        let t = match m.get("type") {
            Some(Value::String(s)) if !s.trim().is_empty() => nfc(s),
            _ => return Err((format!("The property `{k}` has no `type`."), line)),
        };
        if attributes.iter().any(|a| a.key == k) {
            return Err((format!("Two properties have the key `{k}`."), line));
        }
        let text_of = |f: &str| m.get(f).and_then(scalar_text).filter(|s| !s.trim().is_empty());
        let options = match m.get("options") {
            Some(Value::Array(a)) => a.iter().filter_map(read_option).collect(),
            _ => Vec::new(),
        };
        let to = match m.get("to") {
            Some(Value::Array(a)) => Some(a.iter().filter_map(scalar_text).collect()),
            Some(v) => scalar_text(v).map(|s| vec![s]),
            None => None,
        };
        attributes.push(AttrDef {
            name: text_of("name").unwrap_or_else(|| k.clone()),
            r#type: AttrType::parse(&t),
            default: m.get("default").filter(|v| !v.is_null()).map(nfc_value),
            required: m.get("required") == Some(&Value::Bool(true)),
            options,
            to,
            multiple: m.get("multiple") == Some(&Value::Bool(true)),
            description: text_of("description"),
            built_in: builtin_keys.contains(&k),
            key: k,
        });
    }
    let text_of = |f: &str| top.get(f).and_then(scalar_text).filter(|s| !s.trim().is_empty());
    let name = text_of("name").unwrap_or_else(|| key.to_string());
    let plural = text_of("plural").unwrap_or_else(|| name.clone());
    let folder = text_of("folder").unwrap_or_else(|| plural.clone());
    let def = TypeFile {
        key: key.to_string(),
        declared_version: declared,
        system: match top.get("system") {
            Some(Value::Bool(b)) => *b,
            _ => SYSTEM_KEYS.contains(&key),
        },
        icon: text_of("icon").unwrap_or_else(|| "file-text".into()),
        color: text_of("color").unwrap_or_else(|| "gray".into()),
        description: text_of("description"),
        review: match top.get("review") {
            Some(Value::Bool(true)) => Review::On,
            Some(Value::String(s)) if s == "locked" => Review::Locked,
            _ => Review::Off,
        },
        preview: match top.get("preview") {
            Some(Value::Array(a)) => a.iter().filter_map(scalar_text).collect(),
            _ => Vec::new(),
        },
        hidden: match top.get("hidden") {
            Some(Value::Array(a)) => a.iter().filter_map(scalar_text).collect(),
            _ => Vec::new(),
        },
        template: text_of("template"),
        attributes,
        name,
        plural,
        folder,
    };
    let readability = match declared {
        Some(n) if n > CURRENT_VERSION as i64 => Readability::Newer(n),
        _ => Readability::Ok,
    };
    Ok((def, readability))
}

fn read_option(v: &Value) -> Option<OptionDef> {
    match v {
        Value::Object(m) => Some(OptionDef {
            label: m.get("label").and_then(scalar_text)?,
            color: m.get("color").and_then(scalar_text),
            extra: m.iter().filter(|(k, _)| k.as_str() != "label" && k.as_str() != "color").map(|(k, v)| (nfc(k), nfc_value(v))).collect(),
        }),
        other => scalar_text(other).map(|label| OptionDef { label, color: None, extra: Vec::new() }),
    }
}

fn builtin_attr_keys(text: &str) -> Vec<String> {
    match tegg_format::parse_yaml_value(text) {
        Ok(Some(Value::Object(m))) => match m.get("attributes") {
            Some(Value::Array(a)) => a.iter().filter_map(|i| i.get("key").and_then(Value::as_str)).map(nfc).collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

// ------------------------------------------------------------------------------------------------ keys and rules

/// D-223: as `type_key`, then characters other than letters (any script), digits, `-` and `_` removed, then leading
/// characters that aren't letters removed. `Telefon do práce` → `telefon-do-práce`, `Cena (Kč)` → `cena-kč`.
pub fn derive_attr_key(name: &str) -> String {
    let kept: String = type_key(name).chars().filter(|c| c.is_alphabetic() || c.is_numeric() || *c == '-' || *c == '_').collect();
    kept.trim_start_matches(|c: char| !c.is_alphabetic()).to_string()
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
    /// Name, plural, folder, attribute key/name, option label.
    Empty { field: Field },
    /// `/ : \ * ? " < > | # ^ [ ]` or a control character (D-52, D-68).
    ForbiddenChar { field: Field },
    /// The type key equals another type's key, system types included (case-insensitive, NFC).
    KeyTaken,
    /// Key > 200 UTF-8 bytes (D-51).
    KeyTooLong,
    /// Equals another type's folder (case-insensitive, NFC).
    FolderTaken,
    /// Absolute, `..`, a segment starting with `.`, `_templates`, `_attachments`, `.trash`, `.tegg` or under them.
    FolderInvalid,
    /// FR-TYP-15, any case.
    ReservedKey { key: String },
    AttrKeyTaken,
    AttrKeyInvalid,
    RangeCollision,
    /// D-227 (case-insensitive, NFC).
    OptionEmpty,
    OptionDuplicate,
    /// Renaming an option used by an object (D-227); checked by the core.
    OptionUsed { label: String },
    /// More than 4 preview keys (FR-TYP-11 AC-1).
    PreviewFull,
    /// Slice 5A-1 (D-473): no `status` option of the Task type with state Open / Done would remain.
    NeedOpen,
    NeedDone,
}

const FORBIDDEN: &str = "/:\\*?\"<>|#^[]";
const MAX_KEY_BYTES: usize = 200;
const MAX_PREVIEW: usize = 4;

fn has_forbidden(s: &str) -> bool {
    s.chars().any(|c| FORBIDDEN.contains(c) || c.is_control())
}

/// Folder comparison: NFC, case-insensitive (APFS default), no trailing `/`.
fn fold_folder(f: &str) -> String {
    nfc(f.trim()).trim_end_matches('/').to_lowercase()
}

/// FR-TYP-01 AC-3, D-222: returns the key of `name`. `undefined_ok`: a key used only by objects (no file) is
/// allowed (D-121); such keys are never in `others`, so the flag only documents the caller's intent.
pub fn check_type_name(name: &str, plural: &str, others: &[TypeNames], undefined_ok: bool) -> Result<String, RuleError> {
    let _ = undefined_ok;
    let (n, p) = (nfc(name.trim()), nfc(plural.trim()));
    if n.is_empty() {
        return Err(RuleError::Empty { field: Field::Name });
    }
    if p.is_empty() {
        return Err(RuleError::Empty { field: Field::Plural });
    }
    if has_forbidden(&n) {
        return Err(RuleError::ForbiddenChar { field: Field::Name });
    }
    if has_forbidden(&p) {
        return Err(RuleError::ForbiddenChar { field: Field::Plural });
    }
    let key = type_key(&n);
    if others.iter().any(|o| !o.is_self && type_key(o.key) == key) {
        return Err(RuleError::KeyTaken);
    }
    if key.len() > MAX_KEY_BYTES {
        return Err(RuleError::KeyTooLong);
    }
    check_folder(&p, others)?;
    Ok(key)
}

/// FR-TYP-01 AC-5: relative, `/`-separated, NFC, no empty segment, no forbidden character, not in an app folder,
/// not another type's folder. Returns the folder NFC without a trailing `/`.
pub fn check_folder(folder: &str, others: &[TypeNames]) -> Result<String, RuleError> {
    let f = nfc(folder.trim());
    if f.is_empty() {
        return Err(RuleError::Empty { field: Field::Folder });
    }
    if f.starts_with('/') {
        return Err(RuleError::FolderInvalid);
    }
    let f = f.trim_end_matches('/').to_string();
    if f.is_empty() {
        return Err(RuleError::FolderInvalid);
    }
    let segments: Vec<&str> = f.split('/').collect();
    if segments.iter().any(|s| s.trim().is_empty() || s.starts_with('.')) {
        return Err(RuleError::FolderInvalid); // empty segment, `.`, `..`, hidden, `.trash`, `.tegg`
    }
    if matches!(segments[0].to_lowercase().as_str(), "_templates" | "_attachments") {
        return Err(RuleError::FolderInvalid);
    }
    if segments.iter().any(|s| has_forbidden(s)) {
        return Err(RuleError::ForbiddenChar { field: Field::Folder });
    }
    let me = fold_folder(&f);
    if others.iter().any(|o| !o.is_self && fold_folder(o.folder) == me) {
        return Err(RuleError::FolderTaken);
    }
    Ok(f)
}

/// FR-TYP-03 AC-2, D-223: letters, digits, `-`, `_`; starts with a letter; not reserved (FR-TYP-15); not another
/// attribute's key; no clash with the `-start` / `-end` keys of a date range.
pub fn check_attr_key(key: &str, def: &TypeFile, new_type: &AttrType) -> Result<(), RuleError> {
    let k = nfc(key);
    if k.trim().is_empty() {
        return Err(RuleError::Empty { field: Field::AttrKey });
    }
    if tegg_format::RESERVED_KEYS.contains(&k.to_lowercase().as_str()) {
        return Err(RuleError::ReservedKey { key: key.to_string() });
    }
    let valid_chars = k.chars().all(|c| c.is_alphabetic() || c.is_numeric() || c == '-' || c == '_');
    if !valid_chars || !k.chars().next().is_some_and(char::is_alphabetic) {
        return Err(RuleError::AttrKeyInvalid);
    }
    if def.attributes.iter().any(|a| a.key == k) {
        return Err(RuleError::AttrKeyTaken);
    }
    if *new_type == AttrType::DateRange && def.attributes.iter().any(|a| a.key == format!("{k}-start") || a.key == format!("{k}-end")) {
        return Err(RuleError::RangeCollision);
    }
    if def.attributes.iter().filter(|a| a.r#type == AttrType::DateRange).any(|a| k == format!("{}-start", a.key) || k == format!("{}-end", a.key)) {
        return Err(RuleError::RangeCollision);
    }
    Ok(())
}

/// D-227: labels non-empty, unique case-insensitively (NFC). `old`: the labels before the change; a new label that
/// differs from an existing one only in case or normalization counts as a duplicate of it (FR-TYP-03 AC-5).
fn check_options(options: &[OptionDef], old: &[OptionDef]) -> Result<(), RuleError> {
    let old: Vec<String> = old.iter().map(|o| nfc(o.label.trim())).collect();
    for o in options {
        let l = nfc(o.label.trim());
        if !l.is_empty() && !old.contains(&l) && old.iter().any(|x| x.to_lowercase() == l.to_lowercase()) {
            return Err(RuleError::OptionDuplicate);
        }
    }
    let mut seen: Vec<String> = Vec::new();
    for o in options {
        let l = nfc(o.label.trim());
        if l.is_empty() {
            return Err(RuleError::OptionEmpty);
        }
        let f = l.to_lowercase();
        if seen.contains(&f) {
            return Err(RuleError::OptionDuplicate);
        }
        seen.push(f);
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------------ value validity

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Validity {
    Empty,
    Valid,
    /// Invalid list positions (Multi-select, multiple Relation); empty = the whole value.
    Invalid { items: Vec<usize> },
}

fn is_empty_value(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty(),
        Some(Value::Array(a)) => a.is_empty(),
        _ => false,
    }
}

fn valid_date(v: &Value) -> Option<NaiveDate> {
    let s = v.as_str()?;
    if s.len() != 10 || s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return None;
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn valid_url(s: &str) -> bool {
    let lower = s.to_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"));
    match rest {
        Some(r) => !r.is_empty() && !r.starts_with('/') && !s.chars().any(char::is_whitespace),
        None => false,
    }
}

fn valid_email(s: &str) -> bool {
    if s.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = s.split_once('@') else { return false };
    !local.is_empty() && !domain.contains('@') && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

fn is_link(v: &Value) -> bool {
    v.as_str().map(str::trim).is_some_and(|s| s.len() > 4 && s.starts_with("[[") && s.ends_with("]]"))
}

fn is_scalar(v: &Value) -> bool {
    matches!(v, Value::String(_) | Value::Number(_) | Value::Bool(_))
}

/// R10 "Valid when read" (D-231). `fm` is the note's frontmatter as JSON (the index's `attributes` form); a date
/// range reads `<key>-start` / `<key>-end`. Empty is never invalid.
pub fn validate(attr: &AttrDef, fm: &Map<String, Value>) -> Validity {
    let whole = || Validity::Invalid { items: Vec::new() };
    if attr.r#type == AttrType::DateRange {
        let (s, e) = (fm.get(&format!("{}-start", attr.key)), fm.get(&format!("{}-end", attr.key)));
        let (se, ee) = (is_empty_value(s), is_empty_value(e));
        if se && ee {
            return Validity::Empty;
        }
        let sd = if se { None } else { s.and_then(valid_date).map(Some).unwrap_or(None) };
        let ed = if ee { None } else { e.and_then(valid_date) };
        if (!se && sd.is_none()) || (!ee && ed.is_none()) {
            return whole();
        }
        return match (sd, ed) {
            (Some(a), Some(b)) if b < a => whole(),
            _ => Validity::Valid,
        };
    }
    let v = fm.get(&attr.key);
    if is_empty_value(v) {
        return Validity::Empty;
    }
    let Some(v) = v else { return Validity::Empty };
    let label = |s: &str| attr.options.iter().any(|o| nfc(&o.label) == nfc(s));
    let ok = |b: bool| if b { Validity::Valid } else { whole() };
    match &attr.r#type {
        AttrType::Text | AttrType::LongText => ok(is_scalar(v)),
        AttrType::Number => ok(v.is_number()),
        AttrType::Checkbox => ok(v.is_boolean()),
        AttrType::Date => ok(valid_date(v).is_some()),
        AttrType::DateTime => ok(v.as_str().is_some_and(|s| DateTime::parse_from_rfc3339(s).is_ok())),
        AttrType::Select => ok(v.as_str().is_some_and(label)),
        AttrType::MultiSelect => match v {
            Value::Array(a) => list_validity(a, |x| x.as_str().is_some_and(label)),
            Value::String(s) => ok(label(s)),
            _ => whole(),
        },
        AttrType::Url => ok(v.as_str().is_some_and(valid_url)),
        AttrType::Email => ok(v.as_str().is_some_and(valid_email)),
        AttrType::Relation => match v {
            Value::Array(a) if attr.multiple => list_validity(a, is_link),
            other => ok(is_link(other)),
        },
        AttrType::DateRange | AttrType::File | AttrType::Color | AttrType::Recurrence | AttrType::Other(_) => Validity::Valid,
    }
}

fn list_validity(items: &[Value], ok: impl Fn(&Value) -> bool) -> Validity {
    let bad: Vec<usize> = items.iter().enumerate().filter(|(_, x)| !ok(x)).map(|(i, _)| i).collect();
    if bad.is_empty() { Validity::Valid } else { Validity::Invalid { items: bad } }
}

// ------------------------------------------------------------------------------------------------ writing: scalars

/// Plain when YAML 1.2 reads the plain text back as the same string (in block or flow context), else
/// double-quoted with JSON escapes, non-ASCII kept (§14.1.4 scalars). NFC.
fn scalar(s: &str, flow: bool) -> String {
    let s = nfc(s);
    if plain_ok(&s, flow) { s } else { serde_json::to_string(&s).unwrap_or_else(|_| format!("\"{s}\"")) }
}

fn plain_ok(s: &str, flow: bool) -> bool {
    if s.is_empty() || s != s.trim() || s.chars().any(|c| c.is_control()) {
        return false;
    }
    let first = s.chars().next().unwrap_or(' ');
    if "[]{},#&*!|>'\"%@`".contains(first) {
        return false;
    }
    if matches!(s, "-" | "?" | ":") || s.starts_with("- ") || s.starts_with("? ") || s.starts_with(": ") {
        return false;
    }
    if s.contains(": ") || s.contains(" #") || s.ends_with(':') || s.contains(":\t") {
        return false;
    }
    if flow && s.chars().any(|c| ",[]{}".contains(c)) {
        return false;
    }
    match tegg_format::parse_yaml_value(&format!("k: {s}\n")) {
        Ok(Some(Value::Object(m))) => m.get("k") == Some(&Value::String(s.to_string())),
        _ => false,
    }
}

/// A JSON value as a YAML scalar or flow collection.
fn value_text(v: &Value, flow: bool) -> String {
    match v {
        Value::String(s) => scalar(s, flow),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".into(),
        Value::Array(a) => format!("[{}]", a.iter().map(|x| value_text(x, true)).collect::<Vec<_>>().join(", ")),
        Value::Object(m) => {
            if m.is_empty() {
                "{}".into()
            } else {
                format!("{{ {} }}", m.iter().map(|(k, x)| format!("{}: {}", scalar(k, true), value_text(x, true))).collect::<Vec<_>>().join(", "))
            }
        }
    }
}

fn flow_list(items: &[String]) -> String {
    format!("[{}]", items.iter().map(|i| scalar(i, true)).collect::<Vec<_>>().join(", "))
}

/// `{ label: <l>, <extra…>, color: <c> }`. Extra fields are written between label and color, as the built-in
/// Task file has them (`{ label: To do, state: open, color: gray }`, D-99).
fn option_text(o: &OptionDef) -> String {
    let mut parts = vec![format!("label: {}", scalar(&o.label, true))];
    parts.extend(o.extra.iter().map(|(k, v)| format!("{}: {}", scalar(k, true), value_text(v, true))));
    if let Some(c) = &o.color {
        parts.push(format!("color: {}", scalar(c, true)));
    }
    format!("{{ {} }}", parts.join(", "))
}

// ------------------------------------------------------------------------------------------------ writing: whole files

/// Canonical top-level order (§14.1.4, from the approved fixtures).
const TOP_ORDER: [&str; 13] = ["version", "name", "plural", "system", "folder", "icon", "color", "description", "review", "preview", "hidden", "template", "attributes"];
/// Canonical attribute item order.
const ITEM_ORDER: [&str; 9] = ["key", "name", "type", "default", "required", "options", "to", "multiple", "description"];
const ITEM_INDENT: usize = 2;

fn render_top(field: &str, def: &TypeFile) -> Option<Vec<String>> {
    let one = |v: String| Some(vec![format!("{field}: {v}")]);
    match field {
        "version" => one(def.declared_version.unwrap_or(CURRENT_VERSION as i64).to_string()),
        "name" => one(scalar(&def.name, false)),
        "plural" => one(scalar(&def.plural, false)),
        "system" => one(def.system.to_string()),
        "folder" => one(scalar(&def.folder, false)),
        "icon" => one(scalar(&def.icon, false)),
        "color" => one(scalar(&def.color, false)),
        "description" => def.description.as_ref().filter(|d| !d.trim().is_empty()).and_then(|d| one(scalar(d, false))),
        "review" => one(match def.review {
            Review::Off => "false".into(),
            Review::On => "true".into(),
            Review::Locked => "locked".into(),
        }),
        "preview" => one(flow_list(&def.preview)),
        "hidden" => one(flow_list(&def.hidden)), // FR-TYP-17, D-316
        "template" => def.template.as_ref().and_then(|t| one(scalar(t, false))),
        "attributes" => {
            if def.attributes.is_empty() {
                one("[]".into())
            } else {
                let mut out = vec!["attributes:".to_string()];
                for a in &def.attributes {
                    out.extend(render_item(a, ITEM_INDENT));
                }
                Some(out)
            }
        }
        _ => None,
    }
}

/// The lines of one item field at field indent `fi`; None when the field isn't written (cleared or default).
fn render_field(field: &str, a: &AttrDef, fi: usize) -> Option<Vec<String>> {
    let sp = " ".repeat(fi);
    let one = |v: String| Some(vec![format!("{sp}{field}: {v}")]);
    match field {
        "key" => one(scalar(&a.key, false)),
        "name" => one(scalar(&a.name, false)),
        "type" => one(scalar(a.r#type.as_str(), false)),
        "default" => a.default.as_ref().filter(|d| !d.is_null()).and_then(|d| one(value_text(d, false))),
        "required" => a.required.then(|| vec![format!("{sp}required: true")]),
        "options" => {
            if a.options.is_empty() {
                return None;
            }
            let mut out = vec![format!("{sp}options:")];
            out.extend(a.options.iter().map(|o| format!("{sp}  - {}", option_text(o))));
            Some(out)
        }
        "to" => a.to.as_ref().and_then(|t| one(flow_list(t))),
        "multiple" => a.multiple.then(|| vec![format!("{sp}multiple: true")]),
        "description" => a.description.as_ref().filter(|d| !d.trim().is_empty()).and_then(|d| one(scalar(d, false))),
        _ => None,
    }
}

fn render_item(a: &AttrDef, ind: usize) -> Vec<String> {
    let fi = ind + 2;
    let mut out = Vec::new();
    for f in ITEM_ORDER {
        if let Some(lines) = render_field(f, a, fi) {
            out.extend(lines);
        }
    }
    if let Some(first) = out.first_mut() {
        *first = format!("{}- {}", " ".repeat(ind), first.trim_start());
    }
    out
}

/// Canonical write of a whole definition (AR-07 AC-6, D-90 default files): header, then the canonical order;
/// LF, final newline.
pub fn serialize(def: &TypeFile) -> String {
    let mut out = String::from(HEADER);
    for f in TOP_ORDER {
        // A whole file has a `hidden` line only when something is hidden (FR-TYP-17, D-316).
        if f == "hidden" && def.hidden.is_empty() {
            continue;
        }
        for l in render_top(f, def).unwrap_or_default() {
            out.push_str(&l);
            out.push('\n');
        }
    }
    out
}

/// The canonical file of a new user type (FR-TYP-01 AC-2, `tests/fixtures/types/expected/čajovna.yml`): folder =
/// plural, icon `file-text`, colour `gray`, review off, no preview, no attributes, no description or template.
pub fn new_type_file(name: &str, plural: &str) -> String {
    new_type_file_in(name, plural, None)
}

/// As `new_type_file`, with a folder other than the plural (D-259: the folder follows the plural until edited).
pub fn new_type_file_in(name: &str, plural: &str, folder: Option<&str>) -> String {
    let (name, plural) = (nfc(name.trim()), nfc(plural.trim()));
    let def = TypeFile {
        key: type_key(&name),
        declared_version: Some(CURRENT_VERSION as i64),
        system: false,
        folder: folder.map(|f| nfc(f.trim())).filter(|f| !f.is_empty()).unwrap_or_else(|| plural.clone()),
        icon: "file-text".into(),
        color: "gray".into(),
        description: None,
        review: Review::Off,
        preview: Vec::new(),
        hidden: Vec::new(),
        template: None,
        attributes: Vec::new(),
        name,
        plural,
    };
    serialize(&def)
}

// ------------------------------------------------------------------------------------------------ writing: patches

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
    /// FR-TYP-17, D-316.
    SetHidden(Vec<String>),
    AddAttribute(AttrDef),
    UpdateAttribute { key: String, change: AttrChange },
    RemoveAttribute(String),
    MoveAttribute { key: String, to: usize },
    // Slice 5A-1 (docs/contracts/ms5-tasks.md §2.2): one op per type-settings action on an option, each one line.
    SetOptionState { attr: String, label: String, state: String },
    /// Appends after the last option (FR-TSK-02 AC-3).
    AddOption { attr: String, option: OptionDef },
    SetOptionColor { attr: String, label: String, color: String },
    MoveOption { attr: String, label: String, to: usize },
    RemoveOption { attr: String, label: String },
    RenameOption { attr: String, from: String, to: String },
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
}

impl From<RuleError> for SchemaError {
    fn from(e: RuleError) -> Self {
        SchemaError::Rule(e)
    }
}

/// Applies `ops` in order, all or nothing, as line edits of `text` (§14.1.4). `Ok(None)`: every op leaves its value
/// equal, nothing to write (FR-SYN-06). The returned text always reads back as `Readability::Ok`.
pub fn patch(key: &str, text: &str, ops: &[TypeOp], ctx: &PatchContext) -> Result<Option<String>, SchemaError> {
    let key = nfc(key);
    if ops.is_empty() {
        return Ok(None); // nothing asked, nothing written (also for newer and invalid files)
    }
    let parsed = parse(&key, text);
    match parsed.readability {
        Readability::Invalid { .. } => return Err(SchemaError::Invalid),
        Readability::Newer(_) => return Err(SchemaError::NewerVersion),
        Readability::Ok => {}
    }
    let mut def = parsed.def;
    let (mut lines, final_nl) = split_lines(text);
    let original = lines.clone();
    let system = SYSTEM_KEYS.contains(&key.as_str());
    for op in ops {
        apply(&mut def, &mut lines, op, system, ctx)?;
    }
    if lines == original {
        return Ok(None);
    }
    if top_span(&lines, "version").is_none() {
        // AR-07 AC-2: the first change writes `version: 1` as the first key after the leading comments.
        let at = leading_comments_end(&lines);
        lines.insert(at, format!("version: {CURRENT_VERSION}"));
    }
    let out = join_lines(&lines, final_nl || original.is_empty());
    if parse(&key, &out).readability != Readability::Ok {
        return Err(SchemaError::Invalid); // never write a file Tegg itself couldn't read
    }
    Ok(Some(out))
}

fn apply(def: &mut TypeFile, lines: &mut Vec<String>, op: &TypeOp, system: bool, ctx: &PatchContext) -> Result<(), SchemaError> {
    match op {
        TypeOp::SetName(n) => {
            if system {
                return Err(SchemaError::SystemTypeName); // FR-TYP-06 AC-3
            }
            let n = nfc(n.trim());
            if n.is_empty() {
                return Err(RuleError::Empty { field: Field::Name }.into());
            }
            if has_forbidden(&n) {
                return Err(RuleError::ForbiddenChar { field: Field::Name }.into());
            }
            // The key is fixed at creation (D-221), so a new name never takes another type's key.
            if def.name != n {
                def.name = n;
                set_top(lines, "name", render_top("name", def));
            }
        }
        TypeOp::SetPlural(p) => {
            if system {
                return Err(SchemaError::SystemTypeName);
            }
            let p = nfc(p.trim());
            if p.is_empty() {
                return Err(RuleError::Empty { field: Field::Plural }.into());
            }
            if has_forbidden(&p) {
                return Err(RuleError::ForbiddenChar { field: Field::Plural }.into());
            }
            if def.plural != p {
                def.plural = p;
                set_top(lines, "plural", render_top("plural", def));
            }
        }
        TypeOp::SetFolder(f) => {
            let f = check_folder(f, ctx.others)?;
            if def.folder.trim_end_matches('/') != f {
                def.folder = f;
                set_top(lines, "folder", render_top("folder", def));
            }
        }
        TypeOp::SetIcon(i) => {
            let i = nfc(i.trim());
            if !i.is_empty() && def.icon != i {
                def.icon = i;
                set_top(lines, "icon", render_top("icon", def));
            }
        }
        TypeOp::SetColor(c) => {
            let c = nfc(c.trim());
            if !c.is_empty() && def.color != c {
                def.color = c;
                set_top(lines, "color", render_top("color", def));
            }
        }
        TypeOp::SetDescription(d) => {
            let d = d.as_ref().map(|d| nfc(d.trim())).filter(|d| !d.is_empty());
            if def.description != d {
                def.description = d;
                set_top(lines, "description", render_top("description", def));
            }
        }
        TypeOp::SetReview(on) => {
            if def.review == Review::Locked {
                return Err(SchemaError::ReviewLocked); // FR-TYP-12 AC-2
            }
            let r = if *on { Review::On } else { Review::Off };
            if def.review != r {
                def.review = r;
                set_top(lines, "review", render_top("review", def));
            }
        }
        TypeOp::SetPreview(keys) => {
            if keys.len() > MAX_PREVIEW {
                return Err(RuleError::PreviewFull.into());
            }
            let keys: Vec<String> = keys.iter().map(|k| nfc(k)).collect();
            if def.preview != keys {
                def.preview = keys;
                set_top(lines, "preview", render_top("preview", def));
            }
        }
        TypeOp::SetHidden(keys) => {
            let mut out: Vec<String> = Vec::new();
            for k in keys.iter().map(|k| nfc(k)) {
                if !out.contains(&k) {
                    out.push(k);
                }
            }
            if def.hidden != out {
                def.hidden = out;
                set_top(lines, "hidden", render_top("hidden", def));
            }
        }
        TypeOp::AddAttribute(a) => {
            let mut a = a.clone();
            a.key = nfc(&a.key);
            a.name = nfc(a.name.trim());
            a.built_in = false;
            check_attr_key(&a.key, def, &a.r#type)?;
            if a.name.is_empty() {
                return Err(RuleError::Empty { field: Field::AttrName }.into());
            }
            check_options(&a.options, &[])?;
            a.options = a.options.iter().map(|o| OptionDef { label: nfc(o.label.trim()), ..o.clone() }).collect();
            add_item(lines, &a);
            def.attributes.push(a);
        }
        TypeOp::UpdateAttribute { key, change } => {
            let key = nfc(key);
            let Some(i) = def.attributes.iter().position(|a| a.key == key) else { return Ok(()) };
            let old = def.attributes[i].clone();
            let mut new = old.clone();
            if let Some(n) = &change.name {
                let n = nfc(n.trim());
                if n.is_empty() {
                    return Err(RuleError::Empty { field: Field::AttrName }.into());
                }
                new.name = n;
            }
            if let Some(t) = &change.r#type {
                if *t != old.r#type {
                    if *t == AttrType::DateRange {
                        let others = TypeFile { attributes: def.attributes.iter().filter(|a| a.key != key).cloned().collect(), ..def.clone() };
                        if others.attributes.iter().any(|a| a.key == format!("{key}-start") || a.key == format!("{key}-end")) {
                            return Err(RuleError::RangeCollision.into());
                        }
                    }
                    new.r#type = t.clone();
                    // FR-TYP-03 AC-11: what the new type has no use for is removed.
                    if !t.has_options() {
                        new.options.clear();
                    }
                    if *t != AttrType::Relation {
                        new.to = None;
                        new.multiple = false;
                    }
                }
            }
            if let Some(d) = &change.default {
                new.default = d.as_ref().filter(|v| !v.is_null()).map(nfc_value);
            }
            if let Some(r) = change.required {
                new.required = r;
            }
            if let Some(opts) = &change.options {
                check_options(opts, &old.options)?;
                if new.r#type.has_options() || !new.r#type.editable() {
                    // Fields the UI doesn't know (e.g. `state`) are kept for a label that stays.
                    new.options = opts
                        .iter()
                        .map(|o| {
                            let label = nfc(o.label.trim());
                            let extra = if o.extra.is_empty() { old.options.iter().find(|x| x.label == label).map(|x| x.extra.clone()).unwrap_or_default() } else { o.extra.clone() };
                            OptionDef { label, color: o.color.clone(), extra }
                        })
                        .collect();
                }
            }
            if let Some(t) = &change.to {
                new.to = t.as_ref().map(|v| v.iter().map(|k| nfc(k)).collect());
            }
            if let Some(m) = change.multiple {
                new.multiple = m;
            }
            if let Some(d) = &change.description {
                new.description = d.as_ref().map(|d| nfc(d.trim())).filter(|d| !d.is_empty());
            }
            if new == old {
                return Ok(());
            }
            if old.built_in {
                return Err(SchemaError::BuiltInChanged); // FR-TYP-06 AC-2
            }
            for f in ["name", "type", "default", "required", "options", "to", "multiple", "description"] {
                let fi = item_field_indent(lines, i);
                if render_field(f, &old, fi) != render_field(f, &new, fi) {
                    set_item_field(lines, i, f, &new);
                }
            }
            def.attributes[i] = new;
        }
        TypeOp::RemoveAttribute(key) => {
            let key = nfc(key);
            let Some(i) = def.attributes.iter().position(|a| a.key == key) else { return Ok(()) };
            if def.attributes[i].built_in {
                return Err(SchemaError::BuiltInChanged);
            }
            remove_item(lines, i);
            def.attributes.remove(i);
            if def.attributes.is_empty() {
                set_top(lines, "attributes", render_top("attributes", def));
            }
            // FR-TYP-04 AC-4, FR-TYP-11 AC-2: its preview key goes in the same write.
            if def.preview.contains(&key) {
                def.preview.retain(|p| *p != key);
                set_top(lines, "preview", render_top("preview", def));
            }
            // FR-TYP-17 AC-3: and its hidden key.
            if def.hidden.contains(&key) {
                def.hidden.retain(|p| *p != key);
                set_top(lines, "hidden", render_top("hidden", def));
            }
        }
        TypeOp::MoveAttribute { key, to } => {
            let key = nfc(key);
            let Some(i) = def.attributes.iter().position(|a| a.key == key) else { return Ok(()) };
            let to = (*to).min(def.attributes.len().saturating_sub(1));
            if i != to {
                move_item(lines, i, to);
                let a = def.attributes.remove(i);
                def.attributes.insert(to, a);
            }
        }
        // Slice 5A-1 stubs (ms5-tasks §2.2): not implemented yet, nothing changes (TS-I1).
        TypeOp::SetOptionState { .. }
        | TypeOp::AddOption { .. }
        | TypeOp::SetOptionColor { .. }
        | TypeOp::MoveOption { .. }
        | TypeOp::RemoveOption { .. }
        | TypeOp::RenameOption { .. } => {}
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------------ line model

fn split_lines(text: &str) -> (Vec<String>, bool) {
    let nl = text.ends_with('\n');
    let body = if nl { &text[..text.len() - 1] } else { text };
    if body.is_empty() && !nl {
        return (Vec::new(), false);
    }
    (body.split('\n').map(str::to_string).collect(), nl)
}

fn join_lines(lines: &[String], final_nl: bool) -> String {
    let mut s = lines.join("\n");
    if final_nl {
        s.push('\n');
    }
    s
}

fn indent_of(l: &str) -> usize {
    l.len() - l.trim_start_matches(' ').len()
}

fn is_blank_or_comment(l: &str) -> bool {
    let t = l.trim();
    t.is_empty() || t.starts_with('#')
}

fn is_dash(l: &str) -> bool {
    let t = l.trim_start_matches(' ');
    t.starts_with("- ") || t == "-"
}

/// The key of a `key: …` line (`s` starts at the key), quoted keys included.
fn map_key(s: &str) -> Option<String> {
    if let Some(q) = s.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let close = s[1..].find(q)? + 1;
        return s[close + 1..].trim_start().starts_with(':').then(|| s[1..close].to_string());
    }
    let b = s.as_bytes();
    for (i, c) in s.char_indices() {
        if c == ':' && (i + 1 == b.len() || b[i + 1] == b' ' || b[i + 1] == b'\t') {
            return Some(s[..i].trim_end().to_string());
        }
    }
    None
}

/// A top-level `key:` line.
fn top_key(l: &str) -> Option<String> {
    if l.is_empty() || l.starts_with([' ', '\t', '#', '-']) || l.starts_with("...") {
        return None;
    }
    map_key(l)
}

/// Lines `[start, end)` of a top-level entry: its key line and the continuation lines after it (indented or `-`);
/// trailing column-0 comments and blank lines aren't part of it.
fn top_span(lines: &[String], key: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| top_key(l).as_deref() == Some(key))?;
    let mut end = start + 1;
    for (j, l) in lines.iter().enumerate().skip(start + 1) {
        if top_key(l).is_some() || l.starts_with("---") || l.starts_with("...") {
            break;
        }
        if (l.starts_with([' ', '\t']) || l.starts_with('-')) && !l.trim().is_empty() {
            end = j + 1;
        }
    }
    Some((start, end))
}

fn leading_comments_end(lines: &[String]) -> usize {
    lines.iter().position(|l| !is_blank_or_comment(l)).unwrap_or(lines.len())
}

/// Item indent and the `[start, end)` of each item of the `attributes` entry; an item runs to the next item.
fn item_spans(lines: &[String], (s, e): (usize, usize)) -> (usize, Vec<(usize, usize)>) {
    let Some(first) = (s + 1..e).find(|&j| is_dash(&lines[j])) else { return (ITEM_INDENT, Vec::new()) };
    let ind = indent_of(&lines[first]);
    let starts: Vec<usize> = (first..e).filter(|&j| indent_of(&lines[j]) == ind && is_dash(&lines[j])).collect();
    let spans = starts.iter().enumerate().map(|(n, &st)| (st, starts.get(n + 1).copied().unwrap_or(e))).collect();
    (ind, spans)
}

fn attr_items(lines: &[String]) -> (usize, Vec<(usize, usize)>) {
    match top_span(lines, "attributes") {
        Some(span) => item_spans(lines, span),
        None => (ITEM_INDENT, Vec::new()),
    }
}

/// Field indent of item `i`: the column after `- ` on its first line.
fn item_field_indent(lines: &[String], i: usize) -> usize {
    let (ind, items) = attr_items(lines);
    match items.get(i) {
        Some(&(s, _)) => {
            let rest = &lines[s][ind + 1..];
            ind + 1 + (rest.len() - rest.trim_start_matches(' ').len())
        }
        None => ind + 2,
    }
}

/// Fields of item `i`: (key, start, end); the first field sits on the `- ` line.
fn item_fields(lines: &[String], i: usize) -> Vec<(String, usize, usize)> {
    let (_, items) = attr_items(lines);
    let Some(&(s, e)) = items.get(i) else { return Vec::new() };
    let fi = item_field_indent(lines, i);
    let mut out: Vec<(String, usize, usize)> = Vec::new();
    for j in s..e {
        let l = &lines[j];
        let key = if j == s {
            l.get(fi..).and_then(map_key)
        } else if indent_of(l) == fi && !is_blank_or_comment(l) && !is_dash(l) {
            map_key(l.trim_start())
        } else {
            None
        };
        match key {
            Some(k) => out.push((k, j, j + 1)),
            None => {
                if !l.trim().is_empty() && (indent_of(l) > fi || (indent_of(l) == fi && is_dash(l))) {
                    if let Some(last) = out.last_mut() {
                        last.2 = j + 1;
                    }
                }
            }
        }
    }
    out
}

fn set_top(lines: &mut Vec<String>, key: &str, new: Option<Vec<String>>) {
    match (top_span(lines, key), new) {
        (Some((s, e)), Some(n)) => {
            lines.splice(s..e, n);
        }
        (Some((s, e)), None) => {
            lines.drain(s..e);
        }
        (None, Some(n)) => {
            // After the entry of the nearest preceding canonical key that exists, else after the leading comments.
            let pos = TOP_ORDER.iter().position(|k| *k == key).unwrap_or(TOP_ORDER.len());
            let at = TOP_ORDER[..pos].iter().rev().find_map(|k| top_span(lines, k).map(|(_, e)| e)).unwrap_or_else(|| leading_comments_end(lines));
            lines.splice(at..at, n);
        }
        (None, None) => {}
    }
}

fn set_item_field(lines: &mut Vec<String>, i: usize, field: &str, a: &AttrDef) {
    let (ind, items) = attr_items(lines);
    let Some(&(s, _)) = items.get(i) else { return };
    let fi = item_field_indent(lines, i);
    let fields = item_fields(lines, i);
    let new = render_field(field, a, fi);
    match (fields.iter().find(|f| f.0 == field), new) {
        (Some(&(_, fs, fe)), Some(mut n)) => {
            if fs == s {
                n[0] = format!("{}- {}", " ".repeat(ind), n[0].trim_start());
            }
            lines.splice(fs..fe, n);
        }
        (Some(&(_, fs, fe)), None) => {
            lines.drain(fs..fe);
            if fs == s && fs < lines.len() && indent_of(&lines[fs]) == fi {
                let rest = lines[fs].trim_start().to_string();
                lines[fs] = format!("{}- {rest}", " ".repeat(ind));
            }
        }
        (None, Some(n)) => {
            let pos = ITEM_ORDER.iter().position(|k| *k == field).unwrap_or(ITEM_ORDER.len());
            let at = ITEM_ORDER[..pos].iter().rev().find_map(|k| fields.iter().find(|f| f.0 == *k).map(|f| f.2)).unwrap_or_else(|| fields.last().map(|f| f.2).unwrap_or(s + 1));
            lines.splice(at..at, n);
        }
        (None, None) => {}
    }
}

/// FR-TYP-03 AC-1: one item appended at the end of `attributes` (`attributes: []` becomes `attributes:` + item).
fn add_item(lines: &mut Vec<String>, a: &AttrDef) {
    match top_span(lines, "attributes") {
        Some((s, e)) => {
            let (ind, items) = item_spans(lines, (s, e));
            let inline_empty = items.is_empty() && e == s + 1;
            if inline_empty {
                let mut n = vec!["attributes:".to_string()];
                n.extend(render_item(a, ITEM_INDENT));
                lines.splice(s..e, n);
            } else {
                let at = items.last().map(|it| it.1).unwrap_or(e);
                lines.splice(at..at, render_item(a, ind));
            }
        }
        None => {
            let mut n = vec!["attributes:".to_string()];
            n.extend(render_item(a, ITEM_INDENT));
            set_top(lines, "attributes", Some(n));
        }
    }
}

fn remove_item(lines: &mut Vec<String>, i: usize) {
    let (_, items) = attr_items(lines);
    if let Some(&(s, e)) = items.get(i) {
        lines.drain(s..e);
    }
}

/// FR-TYP-03 AC-9: the item's lines move unchanged.
fn move_item(lines: &mut Vec<String>, from: usize, to: usize) {
    let (_, items) = attr_items(lines);
    let (Some(first), Some(last)) = (items.first(), items.last()) else { return };
    let (start, end) = (first.0, last.1);
    let mut chunks: Vec<Vec<String>> = items.iter().map(|&(s, e)| lines[s..e].to_vec()).collect();
    if from >= chunks.len() {
        return;
    }
    let c = chunks.remove(from);
    chunks.insert(to.min(chunks.len()), c);
    lines.splice(start..end, chunks.into_iter().flatten());
}

// ------------------------------------------------------------------------------------------------ unit tests (AR-06)

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx_patch(key: &str, text: &str, ops: Vec<TypeOp>) -> Result<Option<String>, SchemaError> {
        patch(key, text, &ops, &PatchContext { others: &[] })
    }

    #[test]
    fn scalars_are_plain_only_when_yaml_reads_them_back_as_the_same_string() {
        for s in ["Osoba", "Lidé z práce.", "Lidé/Kontakty", "a, b", "To do"] {
            assert_eq!(scalar(s, false), s, "{s}");
        }
        for (s, want) in [("ano: ne", "\"ano: ne\""), ("123", "\"123\""), ("true", "\"true\""), ("null", "\"null\""), ("", "\"\""), (" x", "\" x\""), ("#x", "\"#x\""), ("\"q\"", "\"\\\"q\\\"\"")] {
            assert_eq!(scalar(s, false), want, "{s}");
        }
        assert_eq!(scalar("a, b", true), "\"a, b\"", "flow context quotes commas");
        assert_eq!(scalar("Čajovna", false), "Čajovna", "non-ASCII kept");
    }

    #[test]
    fn serialize_then_parse_keeps_odd_values() {
        let mut def = parse("x", &new_type_file("X", "Xs")).def;
        def.description = Some("ano: ne #1".into());
        def.preview = vec!["a, b".into(), "c".into()];
        def.attributes.push(AttrDef {
            key: "k".into(),
            name: "123".into(),
            r#type: AttrType::Select,
            default: Some(Value::String("yes: no".into())),
            required: true,
            options: vec![OptionDef { label: "a]b".into(), color: None, extra: vec![("state".into(), Value::String("open".into()))] }],
            to: None,
            multiple: false,
            description: None,
            built_in: false,
        });
        let text = serialize(&def);
        let back = parse("x", &text);
        assert_eq!(back.readability, Readability::Ok, "{text}");
        assert_eq!(back.def, def, "{text}");
    }

    #[test]
    fn patch_inserts_version_without_header_and_keeps_unknown_layout() {
        let text = "name: A\nattributes:\n- key: b\n  name: B\n  type: text\n";
        let got = ctx_patch("a", text, vec![TypeOp::SetColor("red".into())]).ok().flatten().unwrap_or_default();
        assert_eq!(got, "version: 1\nname: A\ncolor: red\nattributes:\n- key: b\n  name: B\n  type: text\n");
        // Items at column 0 and a non-key first field are patched in place.
        let text = "version: 1\nattributes:\n- name: B\n  key: b\n  type: text\n";
        let ch = AttrChange { name: Some("Bé".into()), ..Default::default() };
        let got = ctx_patch("a", text, vec![TypeOp::UpdateAttribute { key: "b".into(), change: ch }]);
        assert_eq!(got, Ok(Some("version: 1\nattributes:\n- name: Bé\n  key: b\n  type: text\n".into())));
    }

    #[test]
    fn removing_the_last_property_writes_an_empty_list() {
        let text = new_type_file("A", "As");
        let added = ctx_patch("a", &text, vec![TypeOp::AddAttribute(AttrDef {
            key: "b".into(),
            name: "B".into(),
            r#type: AttrType::Text,
            default: None,
            required: false,
            options: vec![],
            to: None,
            multiple: false,
            description: None,
            built_in: false,
        })])
        .ok()
        .flatten()
        .unwrap_or_default();
        assert!(added.ends_with("attributes:\n  - key: b\n    name: B\n    type: text\n"), "{added}");
        assert_eq!(ctx_patch("a", &added, vec![TypeOp::RemoveAttribute("b".into())]), Ok(Some(text)));
    }

    #[test]
    fn a_comment_after_an_entry_stays_in_place() {
        let text = "# h\nversion: 1\ncolor: red\n# why red\nreview: false\n";
        let got = ctx_patch("a", text, vec![TypeOp::SetColor("blue".into()), TypeOp::SetDescription(Some("D".into()))]);
        assert_eq!(got, Ok(Some("# h\nversion: 1\ncolor: blue\ndescription: D\n# why red\nreview: false\n".into())));
    }
}

// ------------------------------------------------------------------------------------------------ slice 5A-1: task states
// docs/contracts/ms5-tasks.md §2.2 (D-471, D-473). Stubs until 5A-1 is built: they return deliberately wrong results so
// the red tests fail on their assertions (TS-I1).

/// The semantic state of a Task status option (`state` in the option's flow map).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaskState {
    Open,
    InProgress,
    Done,
    Cancelled,
}

impl TaskState {
    /// `open`, `in-progress`, `done`, `cancelled`; anything else is None. Stub: always None.
    pub fn parse(_s: &str) -> Option<TaskState> {
        None
    }
}

/// The raw `state` of an option (from `OptionDef.extra`). Stub: always None.
pub fn option_state(_o: &OptionDef) -> Option<&str> {
    None
}

/// `patch` with the option usage counts the `optionUsed` refusal needs (label, number of objects using it). Stub: the
/// counts are ignored.
pub fn patch_with_usage(key: &str, text: &str, ops: &[TypeOp], ctx: &PatchContext, _used: &[(&str, usize)]) -> Result<Option<String>, SchemaError> {
    patch(key, text, ops, ctx)
}
