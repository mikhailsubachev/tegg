//! Slice PIN (docs/contracts/v1-pinned.md §1; FR-HOM-02, FR-STO-06, FR-LNK-03; D-1370…D-1404): the sidebar's pins in
//! the vault file `.tegg/pinned.yml`. Platform-neutral (AR-03): reads and writes only through `Vault`, reads the index
//! through the core's lock. Nothing about pins is in the index (AR-01, FR-STO-06 AC-2) and nothing is cached: every
//! call reads the file (§1.5), so a `vault:changed` naming it needs no invalidation here.
//!
//! Reading (R131 read rules) parses the values with `yaml_rust2`; writing (R131 write rules, AP-1228) patches lines
//! with the graph presets' line scanner: only the operated item's lines change, and every other byte (comments,
//! unknown keys, skipped and `query:` items, CRLF, a missing final newline, NFD values, a BOM) stays. Every write is
//! parsed back first and refused with `Unreadable` unless it lists exactly the expected pins (D-1129).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;

use tegg_format::nfc;
use tegg_vault::{FileVersion, VaultError, WriteOutcome};
use yaml_rust2::{Yaml, YamlLoader};

use crate::graph_presets::{
    closing_quote, content, dash_at, file_eol, flow_end, indent, insert_after, join, key_at, open_flow_line, prelude, several_documents,
    split, Line,
};
use crate::yaml_text::scalar;
use crate::{lock, Core, CoreError};

pub use tegg_jobs::host::{PinPatch, PinsWrite};

/// The pins file (R131).
pub const PINNED_YML: &str = ".tegg/pinned.yml";
/// The current format version (AR-07).
pub const PINS_VERSION: u32 = 1;

/// The first line of a new file (`tests/fixtures/pinned-files/expected/created.yml`); file content, not a UI string.
const HEADER: &str = "# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.";

/// What a pin item stores, NFC (R131). `Object` has at least one of the two.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinTarget {
    Object { id: Option<String>, path: Option<String> },
    /// `tag_key`: NFC, lower case, a leading `#` dropped.
    Tag { key: String },
    /// NFC, as the `type/<type>` route.
    Type { key: String },
    /// v1-queries §1.9 (slice Q, D-1484): a saved query by name (NFC, trimmed); resolved by its name key (D-1434).
    Query { name: String },
}

/// One listed pin (R131's read rules passed, not a `query:` item), in file order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinItem {
    pub target: PinTarget,
    /// 0-based line range of the item in the file, `- ` line first.
    pub lines: std::ops::Range<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsFileState {
    Missing,
    Ok,
    Newer { version: u64 },
    Unreadable { line: Option<u32>, reason: String },
}

/// The pure parse of the file's bytes (no index, no disk).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinsFile {
    pub state: PinsFileState,
    /// Empty when Missing or Unreadable.
    pub items: Vec<PinItem>,
    /// False: listed, but every write is refused (§1.4, D-1122).
    pub patchable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinState {
    Ok,
    Pending,
    Trashed,
    Missing,
    NoObjects,
}

/// One row of the section: a listed pin and what it resolves to (R131 resolution, R133).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinRow {
    /// 0-based position among listed pins.
    pub index: usize,
    /// As stored (NFC).
    pub target: PinTarget,
    pub state: PinState,
    /// Ok object: its live path; Trashed object: its `.trash/…` path.
    pub path: Option<String>,
    /// Ok / Trashed object: its title (stem when untitled, D-103).
    pub title: Option<String>,
    /// Ok / Trashed object: its matched type key (D-239).
    pub r#type: Option<String>,
    /// Ok Daily Note: its date (`daily/<date>` route).
    pub date: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Pins {
    /// The file's version as read; None when Missing.
    pub version: Option<FileVersion>,
    pub state: PinsFileState,
    pub patchable: bool,
    /// The first index build after open has ended.
    pub index_ready: bool,
    pub rows: Vec<PinRow>,
}

/// A user action (R131 write rules). `at` / `to` are 0-based final positions among listed pins; `at: None` is the end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinOp {
    Pin { target: PinRequest, at: Option<usize> },
    Unpin { index: usize },
    Move { from: usize, to: usize },
}

/// What the UI asks to pin; the core turns it into a `PinTarget`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinRequest {
    Object { path: String },
    Tag { key: String },
    Type { key: String },
    /// v1-queries §1.9 (slice Q): a saved query by name; pinnable while a live query has that name.
    Query { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinError {
    NewerVersion,
    Unreadable,
    NotPinnable,
    NoSuchPin,
}

/// `apply_text`'s edits: a `PinOp` with the request already turned into a stored target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinEdit {
    Insert { target: PinTarget, at: Option<usize> },
    Remove { index: usize },
    Move { from: usize, to: usize },
}

// ------------------------------------------------------------------------------------------------ keys and targets

fn trim_ws(s: &str) -> &str {
    s.trim_matches(char::is_whitespace)
}

/// tags.md `tag_key` for pins: NFC, trimmed, a leading `#` dropped, lower case (R131).
pub fn tag_key(s: &str) -> String {
    let t = nfc(trim_ws(s));
    t.strip_prefix('#').unwrap_or(&t).to_lowercase()
}

fn type_key_of(s: &str) -> String {
    nfc(trim_ws(s))
}

/// R131: a stored path is vault-relative, `/`-separated, has no `..`, ends in `.md`, and isn't in `.tegg/`, `.trash/`
/// or `_templates/`.
fn path_ok(p: &str) -> bool {
    let first = p.split('/').next().unwrap_or("");
    !p.starts_with('/') && !p.split('/').any(|s| s == "..") && p.ends_with(".md") && !matches!(first, ".tegg" | ".trash" | "_templates")
}

/// What one raw `pins` item is (R131 read rules).
#[derive(Debug, Clone, PartialEq, Eq)]
enum Kind {
    Pin(PinTarget),
    Skip,
}

/// D-1434: query names compare trimmed, NFC, case-insensitively.
fn query_key(s: &str) -> String {
    nfc(trim_ws(s)).to_lowercase()
}

fn has(y: &Yaml, k: &str) -> bool {
    !matches!(y[k], Yaml::BadValue)
}

fn kind_of(y: &Yaml) -> Kind {
    if !matches!(y, Yaml::Hash(_)) {
        return Kind::Skip;
    }
    let kinds = [has(y, "id") || has(y, "path"), has(y, "tag"), has(y, "type"), has(y, "query")].iter().filter(|b| **b).count();
    if kinds != 1 {
        return Kind::Skip;
    }
    if has(y, "query") {
        // v1-queries §1.9: a non-blank string is a listed pin now (R131's read rules otherwise unchanged).
        return match y["query"].as_str().map(|s| nfc(trim_ws(s))) {
            Some(name) if !name.is_empty() => Kind::Pin(PinTarget::Query { name }),
            _ => Kind::Skip,
        };
    }
    if has(y, "tag") {
        return match y["tag"].as_str().map(tag_key) {
            Some(key) if !key.is_empty() => Kind::Pin(PinTarget::Tag { key }),
            _ => Kind::Skip,
        };
    }
    if has(y, "type") {
        return match y["type"].as_str().map(type_key_of) {
            Some(key) if !key.is_empty() => Kind::Pin(PinTarget::Type { key }),
            _ => Kind::Skip,
        };
    }
    let mut id = None;
    if has(y, "id") {
        match y["id"].as_str().map(trim_ws) {
            Some(s) if !s.is_empty() => id = Some(nfc(s)),
            _ => return Kind::Skip,
        }
    }
    let mut path = None;
    if has(y, "path") {
        match y["path"].as_str().map(nfc) {
            Some(p) if path_ok(&p) => path = Some(p),
            _ => return Kind::Skip,
        }
    }
    Kind::Pin(PinTarget::Object { id, path })
}

/// AP-1236, D-1394: the same target. Object items are the same when they share an `id`, or when their NFC paths match
/// and at least one of them is path-only (in either order).
fn same_target(a: &PinTarget, b: &PinTarget) -> bool {
    match (a, b) {
        (PinTarget::Tag { key: x }, PinTarget::Tag { key: y }) | (PinTarget::Type { key: x }, PinTarget::Type { key: y }) => x == y,
        (PinTarget::Query { name: x }, PinTarget::Query { name: y }) => nfc(x) == nfc(y),
        (PinTarget::Object { id: ia, path: pa }, PinTarget::Object { id: ib, path: pb }) => {
            if let (Some(x), Some(y)) = (ia, ib) {
                if x == y {
                    return true;
                }
            }
            (ia.is_none() || ib.is_none()) && pa.is_some() && pa == pb
        }
        _ => false,
    }
}

/// R131: the listed targets of raw items, with each one's raw index.
fn listed_of(raw: &[Yaml]) -> Vec<(usize, PinTarget)> {
    let mut out: Vec<(usize, PinTarget)> = Vec::new();
    for (i, y) in raw.iter().enumerate() {
        if let Kind::Pin(t) = kind_of(y) {
            if !out.iter().any(|(_, x)| same_target(&t, x)) {
                out.push((i, t));
            }
        }
    }
    out
}

fn ystr(s: &str) -> Yaml {
    Yaml::String(s.to_string())
}

/// The item YAML reads back from what `item_lines` writes for `t`.
fn stored(t: &PinTarget) -> Yaml {
    let mut h = yaml_rust2::yaml::Hash::new();
    match t {
        PinTarget::Object { id, path } => {
            if let Some(i) = id {
                h.insert(ystr("id"), ystr(i));
            }
            if let Some(p) = path {
                h.insert(ystr("path"), ystr(&nfc(p)));
            }
        }
        PinTarget::Tag { key } => {
            h.insert(ystr("tag"), ystr(key));
        }
        PinTarget::Type { key } => {
            h.insert(ystr("type"), ystr(key));
        }
        PinTarget::Query { name } => {
            h.insert(ystr("query"), ystr(&nfc(name)));
        }
    }
    Yaml::Hash(h)
}

// ------------------------------------------------------------------------------------------------ reading

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PinsValue {
    Missing,
    /// `pins:` with nothing (YAML null): no pins (D-1121).
    Null,
    List,
}

/// One item of the `pins` list: its lines `start..=end`, the dash's column and the column of its keys.
#[derive(Debug, Clone, Copy)]
struct ItemAt {
    start: usize,
    end: usize,
    dash: usize,
    keys: usize,
    /// A one-line flow mapping (`- {tag: účty}`), patchable as a whole line (§1.2).
    flow: bool,
}

#[derive(Debug, Clone)]
struct Layout {
    /// The top-level `pins:` line.
    pins: Option<usize>,
    items: Vec<ItemAt>,
    /// `pins: []` (no items).
    empty_flow: bool,
}

#[derive(Debug, Clone)]
struct Parsed {
    state: PinsFileState,
    raw: Vec<Yaml>,
    /// Listed pins: (raw index, target).
    listed: Vec<(usize, PinTarget)>,
    has_version: bool,
    /// The first document as YAML read it (the parse-back check compares against it).
    doc: Yaml,
    lines: Vec<Line>,
    bom: &'static str,
    layout: Option<Layout>,
    patchable: bool,
}

impl Parsed {
    fn file(&self) -> PinsFile {
        let items = match self.state {
            PinsFileState::Ok | PinsFileState::Newer { .. } => self
                .listed
                .iter()
                .map(|(raw, target)| {
                    let lines = self.layout.as_ref().and_then(|l| l.items.get(*raw)).map_or(0..0, |it| it.start..it.end + 1);
                    PinItem { target: target.clone(), lines }
                })
                .collect(),
            _ => Vec::new(),
        };
        PinsFile { state: self.state.clone(), items, patchable: self.patchable }
    }
}

fn unreadable(line: Option<u32>, reason: impl Into<String>) -> Parsed {
    Parsed {
        state: PinsFileState::Unreadable { line, reason: reason.into() },
        raw: Vec::new(),
        listed: Vec::new(),
        has_version: true,
        doc: Yaml::Null,
        lines: Vec::new(),
        bom: "",
        layout: None,
        patchable: false,
    }
}

fn missing() -> Parsed {
    Parsed { state: PinsFileState::Missing, patchable: true, has_version: false, ..unreadable(None, "") }
}

/// R131 read rules (AP-1245).
fn parse(bytes: &[u8]) -> Parsed {
    let Ok(full) = std::str::from_utf8(bytes) else { return unreadable(None, "The file isn't valid UTF-8.") };
    // A UTF-8 BOM opens the stream (YAML 1.2 §5.2) and stays first on a write (D-1129).
    let (bom, text) = match full.strip_prefix('\u{FEFF}') {
        Some(rest) => ("\u{FEFF}", rest),
        None => ("", full),
    };
    let docs = match YamlLoader::load_from_str(text) {
        Ok(d) => d,
        Err(e) => {
            // D-1120: inside an unclosed flow collection, the line where it opened.
            let line = open_flow_line(text, e.marker().index()).or(Some(e.marker().line())).filter(|l| *l > 0);
            return unreadable(line.and_then(|l| u32::try_from(l).ok()), e.info().to_string());
        }
    };
    let top = match docs.into_iter().next() {
        // An empty file, a comments-only file: no pins (D-1121).
        None | Some(Yaml::Null) => Yaml::Hash(Default::default()),
        Some(y @ Yaml::Hash(_)) => y,
        Some(_) => return unreadable(None, "The top level isn't a mapping."),
    };
    let (has_version, version) = match &top["version"] {
        Yaml::BadValue => (false, 1),
        Yaml::Integer(n) if *n >= 1 => (true, *n as u64),
        _ => return unreadable(None, "`version` isn't a positive integer."),
    };
    let (value, raw) = match &top["pins"] {
        Yaml::BadValue => (PinsValue::Missing, Vec::new()),
        Yaml::Null => (PinsValue::Null, Vec::new()),
        Yaml::Array(a) => (PinsValue::List, a.clone()),
        _ => return unreadable(None, "`pins` isn't a list."),
    };
    let listed = listed_of(&raw);
    let lines = split(text);
    let layout = if several_documents(&lines) { None } else { scan(&lines, raw.len(), value) };
    let state = if version > u64::from(PINS_VERSION) { PinsFileState::Newer { version } } else { PinsFileState::Ok };
    let patchable = layout.is_some() && version == u64::from(PINS_VERSION);
    Parsed { state, raw, listed, has_version, doc: top, lines, bom, layout, patchable }
}

/// The `pins` key line and its items' line ranges (comment and blank lines never end an item, D-1129); None when the
/// items can't be lined up with what YAML read (a non-empty flow sequence, a multi-line flow item, D-1122).
fn scan(lines: &[Line], raw_count: usize, value: PinsValue) -> Option<Layout> {
    if value == PinsValue::Missing {
        return Some(Layout { pins: None, items: Vec::new(), empty_flow: false });
    }
    let p = lines.iter().position(|l| indent(&l.body) == 0 && content(&l.body) && key_at(&l.body, 0).is_some_and(|(k, _)| k == "pins"))?;
    let (_, colon) = key_at(&lines[p].body, 0)?;
    let inline = lines[p].body[colon + 1..].trim_start();
    if !inline.is_empty() && !inline.starts_with('#') {
        return (raw_count == 0 && inline.starts_with('[')).then_some(Layout { pins: Some(p), items: Vec::new(), empty_flow: true });
    }
    let mut items: Vec<ItemAt> = Vec::new();
    let mut d: Option<usize> = None;
    let mut region_end = p;
    for (i, l) in lines.iter().enumerate().skip(p + 1) {
        if !content(&l.body) {
            continue;
        }
        let ind = indent(&l.body);
        let dd = *d.get_or_insert(ind);
        if ind < dd || (ind == dd && !dash_at(&l.body, ind)) {
            break;
        }
        if ind == dd {
            items.push(ItemAt { start: i, end: i, dash: dd, keys: 0, flow: false });
        }
        region_end = i;
    }
    if items.len() != raw_count {
        return None;
    }
    for n in 0..items.len() {
        let dd = items[n].dash;
        let limit = items.get(n + 1).map(|x| x.start - 1).unwrap_or(region_end.max(items[n].start));
        let mut end = items[n].start;
        for i in items[n].start + 1..=limit.min(lines.len() - 1) {
            let b = &lines[i].body;
            if !content(b) {
                continue;
            }
            if indent(b) <= dd {
                break;
            }
            end = i;
        }
        items[n].end = end;
        let body = &lines[items[n].start].body;
        let after = &body[dd + 1..];
        let rest = after.trim_start_matches(' ');
        let spaces = after.len() - rest.len();
        if rest.starts_with(['{', '[']) {
            // A flow item is patchable only on one line (§1.2).
            let (mut depth, mut quote) = (0, None);
            if end != items[n].start || flow_end(rest, &mut depth, &mut quote).is_none() {
                return None;
            }
            items[n].flow = true;
            items[n].keys = dd + 1 + spaces;
        } else if rest.trim().is_empty() || rest.starts_with('#') {
            items[n].keys = (items[n].start + 1..=end).map(|i| &lines[i].body).find(|b| content(b)).map(|b| indent(b)).unwrap_or(dd + 2);
        } else {
            items[n].keys = dd + 1 + spaces;
        }
    }
    Some(Layout { pins: Some(p), items, empty_flow: false })
}

/// R131 read rules: the pure parse of the file's bytes.
pub fn read(bytes: &[u8]) -> PinsFile {
    parse(bytes).file()
}

// ------------------------------------------------------------------------------------------------ writing

fn line(body: String, eol: &str) -> Line {
    Line { body, eol: eol.to_string() }
}

/// The lines of a new item (R131 write rules, D-1124): `- id:` then `path:`, `- path:`, `- tag:` or `- type:`.
fn item_lines(t: &PinTarget, dash: usize, keys: usize) -> Vec<String> {
    let d = " ".repeat(dash);
    let gap = " ".repeat(keys.saturating_sub(dash + 1).max(1));
    let k = " ".repeat(dash + 1 + gap.len());
    match t {
        PinTarget::Tag { key } => vec![format!("{d}-{gap}tag: {}", scalar(&nfc(key)))],
        PinTarget::Type { key } => vec![format!("{d}-{gap}type: {}", scalar(&nfc(key)))],
        PinTarget::Query { name } => vec![format!("{d}-{gap}query: {}", scalar(&nfc(name)))],
        PinTarget::Object { id: Some(i), path: Some(p) } => vec![format!("{d}-{gap}id: {}", scalar(i)), format!("{k}path: {}", scalar(&nfc(p)))],
        PinTarget::Object { id: Some(i), path: None } => vec![format!("{d}-{gap}id: {}", scalar(i))],
        PinTarget::Object { id: None, path } => vec![format!("{d}-{gap}path: {}", scalar(&nfc(path.as_deref().unwrap_or(""))))],
    }
}

/// Removes `lines[from..=to]`, keeping a missing final newline missing; returns the removed lines.
fn cut(lines: &mut Vec<Line>, from: usize, to: usize) -> Vec<Line> {
    let at_end = to + 1 == lines.len();
    let last_eol_empty = lines[to].eol.is_empty();
    let removed: Vec<Line> = lines.drain(from..=to).collect();
    if at_end && last_eol_empty && from > 0 {
        lines[from - 1].eol.clear();
    }
    removed
}

/// Inserts `add` before index `at` (`lines.len()`: at the end), keeping a missing final newline missing.
fn put(lines: &mut Vec<Line>, at: usize, add: Vec<Line>, eol: &str) {
    let mut block: Vec<Line> = add.into_iter().map(|l| Line { eol: if l.eol.is_empty() { eol.to_string() } else { l.eol }, body: l.body }).collect();
    if at == lines.len() && at > 0 && lines[at - 1].eol.is_empty() {
        lines[at - 1].eol = eol.to_string();
        if let Some(l) = block.last_mut() {
            l.eol.clear();
        }
    }
    lines.splice(at..at, block);
}

fn new_file(t: &PinTarget) -> String {
    let mut out = format!("{HEADER}\nversion: {PINS_VERSION}\npins:\n");
    for l in item_lines(t, 2, 4) {
        out.push_str(&l);
        out.push('\n');
    }
    out
}

/// The parse-back check (D-1129): `out` reads as Ok, every top-level key but `version` and `pins` is unchanged,
/// `version` is the old one (or 1 when it was missing), the raw items are `want`, and the listed pins are R131 applied
/// to them (a skipped duplicate of a removed item is listed afterwards, D-1393).
fn reads_back(old: &Parsed, out: &str, want: &[Yaml]) -> bool {
    let new = parse(out.as_bytes());
    if new.state != PinsFileState::Ok || !same_other_keys(old, &new) {
        return false;
    }
    let (Yaml::Hash(o), Yaml::Hash(n)) = (&old.doc, &new.doc) else { return false };
    let want_version = if old.has_version { o.get(&ystr("version")).cloned() } else { Some(Yaml::Integer(i64::from(PINS_VERSION))) };
    if n.get(&ystr("version")).cloned() != want_version {
        return false;
    }
    new.raw == want && new.listed.iter().map(|(_, t)| t).eq(listed_of(want).iter().map(|(_, t)| t))
}

fn same_other_keys(old: &Parsed, new: &Parsed) -> bool {
    let (Yaml::Hash(o), Yaml::Hash(n)) = (&old.doc, &new.doc) else { return false };
    let skip = |k: &Yaml| matches!(k.as_str(), Some("version" | "pins"));
    o.iter().filter(|(k, _)| !skip(k)).count() == n.iter().filter(|(k, _)| !skip(k)).count() && o.iter().filter(|(k, _)| !skip(k)).all(|(k, v)| n.get(k) == Some(v))
}

/// `pins: []` → `pins:` (a trailing comment stays).
fn from_empty_flow(lines: &mut [Line], p: usize) -> Option<()> {
    let body = lines[p].body.clone();
    let (_, colon) = key_at(&body, 0)?;
    let inline = body[colon + 1..].trim_start();
    let (mut depth, mut quote) = (0, None);
    let close = flow_end(inline, &mut depth, &mut quote)?;
    lines[p].body = format!("{}{}", &body[..=colon], &inline[close..]);
    Some(())
}

/// `pins:` → `pins: []` (D-1396: only when no item at all remains).
fn to_empty_flow(lines: &mut [Line], p: usize) -> Option<()> {
    let body = lines[p].body.clone();
    let (_, colon) = key_at(&body, 0)?;
    lines[p].body = format!("{} []{}", &body[..=colon], &body[colon + 1..]);
    Some(())
}

/// R131 write rules (AP-1228): the new text after `edit`, or None when the bytes would stay equal. `text: None` = no
/// file (an `Insert` creates it, `expected/created.yml`).
pub fn apply_text(text: Option<&str>, file: &PinsFile, edit: &PinEdit) -> Result<Option<String>, PinError> {
    let p = match text {
        Some(t) => parse(t.as_bytes()),
        None => missing(),
    };
    // `file` is the caller's parse of the same text; the patch re-reads the text for the line layout.
    let _ = file;
    match p.state {
        PinsFileState::Unreadable { .. } => return Err(PinError::Unreadable),
        PinsFileState::Newer { .. } => return Err(PinError::NewerVersion),
        _ => {}
    }
    let Some(full) = text else {
        return match edit {
            PinEdit::Insert { target, .. } => Ok(Some(new_file(target))),
            _ => Err(PinError::NoSuchPin),
        };
    };
    let layout = match (&p.layout, p.patchable) {
        (Some(l), true) => l.clone(),
        _ => return Err(PinError::Unreadable),
    };
    let n = p.listed.len();
    match edit {
        PinEdit::Remove { index } if *index >= n => return Err(PinError::NoSuchPin),
        PinEdit::Move { from, to } if *from >= n || *to >= n => return Err(PinError::NoSuchPin),
        PinEdit::Move { from, to } if from == to => return Ok(None),
        _ => {}
    }
    let mut lines = p.lines.clone();
    let eol = file_eol(&lines);
    let listed_raw: Vec<usize> = p.listed.iter().map(|(r, _)| *r).collect();
    let (dash, keys) = layout.items.last().map_or((2, 4), |it| (it.dash, it.keys));
    // The line a new item goes before for final position `k` among the listed items left after removing raw item
    // `skip` (None: at the end of the list).
    let place_for = |k: usize, skip: Option<usize>| -> Option<usize> {
        let left: Vec<usize> = listed_raw.iter().copied().filter(|r| Some(*r) != skip).collect();
        left.get(k).map(|r| layout.items[*r].start)
    };
    // The line after the list's last item (other than `skip`), else after the `pins:` line.
    let end_of_list = |skip: Option<usize>| -> usize {
        match layout.items.iter().enumerate().filter(|(i, _)| Some(*i) != skip).last() {
            Some((_, it)) => it.end + 1,
            None => layout.pins.map_or(0, |p| p + 1),
        }
    };
    let mut want = p.raw.clone();
    match edit {
        PinEdit::Insert { target, at } => {
            let add: Vec<Line> = item_lines(target, dash, keys).into_iter().map(|b| line(b, &eol)).collect();
            let k = at.unwrap_or(n).min(n);
            match layout.pins {
                None => {
                    let mut block = vec![line("pins:".into(), &eol)];
                    block.extend(add);
                    let at = lines.len();
                    put(&mut lines, at, block, &eol);
                }
                Some(pl) => {
                    if layout.empty_flow {
                        from_empty_flow(&mut lines, pl).ok_or(PinError::Unreadable)?;
                    }
                    let at = place_for(k, None).unwrap_or_else(|| end_of_list(None));
                    put(&mut lines, at, add, &eol);
                }
            }
            let raw_at = if k < n { listed_raw[k] } else { layout.items.len() };
            want.insert(raw_at, stored(target));
        }
        PinEdit::Remove { index } => {
            let it = layout.items[listed_raw[*index]];
            cut(&mut lines, it.start, it.end);
            if layout.items.len() == 1 {
                to_empty_flow(&mut lines, layout.pins.ok_or(PinError::Unreadable)?).ok_or(PinError::Unreadable)?;
            }
            want.remove(listed_raw[*index]);
        }
        PinEdit::Move { from, to } => {
            let skip = listed_raw[*from];
            let it = layout.items[skip];
            let size = it.end - it.start + 1;
            let shift = |i: usize| if i > it.end { i - size } else { i };
            let at = place_for(*to, Some(skip)).map(shift).unwrap_or_else(|| shift(end_of_list(Some(skip)) - 1) + 1);
            let moved = cut(&mut lines, it.start, it.end);
            put(&mut lines, at, moved, &eol);
            let r = want.remove(skip);
            let left: Vec<usize> = listed_raw.iter().copied().filter(|x| *x != skip).map(|x| if x > skip { x - 1 } else { x }).collect();
            let pos = left.get(*to).copied().unwrap_or(want.len());
            want.insert(pos, r);
        }
    }
    if !p.has_version {
        // R131, D-1124: a missing version is written as `version: 1` after the header comments (and leading `%`
        // directives and a `---` line), only on a write that changes the file.
        let k = prelude(&lines);
        put(&mut lines, k, vec![line(format!("version: {PINS_VERSION}"), &eol)], &eol);
    }
    let out = format!("{}{}", p.bom, join(&lines));
    if out == full {
        return Ok(None);
    }
    if !reads_back(&p, &out, &want) {
        return Err(PinError::Unreadable);
    }
    Ok(Some(out))
}

// ------------------------------------------------------------------------------------------------ the job patch

/// A key's one-line value inside an item: its line and the text before and after the value.
struct ValueAt {
    line: usize,
    prefix: String,
    tail: String,
}

/// `key: <value>` of a block item (one-line plain or quoted values).
fn find_value(lines: &[Line], item: &ItemAt, key: &str) -> Option<ValueAt> {
    for i in item.start..=item.end {
        let t = &lines[i].body;
        let col = if i == item.start { item.keys } else { indent(t) };
        if i != item.start && (!content(t) || col != item.keys) {
            continue;
        }
        let Some((k, colon)) = key_at(t, col) else { continue };
        if k != key {
            continue;
        }
        let rest = &t[colon + 1..];
        let v_off = colon + 1 + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
        let v = &t[v_off..];
        let end = match v.chars().next() {
            Some(q @ ('"' | '\'')) => closing_quote(v, q)? + 1,
            _ => {
                let cut = [" #", "\t#"].iter().filter_map(|m| v.find(m)).min().unwrap_or(v.len());
                v[..cut].trim_end().len()
            }
        };
        return Some(ValueAt { line: i, prefix: t[..v_off].to_string(), tail: v[end..].to_string() });
    }
    None
}

/// The `tag` value of a one-line flow mapping (`- {tag: účty}`): the byte range of its token in `body`.
fn flow_tag_value(body: &str, item: &ItemAt) -> Option<std::ops::Range<usize>> {
    flow_value(body, item, "tag")
}

/// The value of `want` in a one-line flow mapping (`- {query: x}`): the byte range of its token in `body`.
fn flow_value(body: &str, item: &ItemAt, want: &str) -> Option<std::ops::Range<usize>> {
    let b = body.as_bytes();
    let mut i = item.keys + 1; // after `{`
    loop {
        while i < b.len() && (b[i] == b' ' || b[i] == b'\t') {
            i += 1;
        }
        let (k, colon) = flow_key(body, i)?;
        let mut v = colon + 1;
        while v < b.len() && (b[v] == b' ' || b[v] == b'\t') {
            v += 1;
        }
        let end = match b.get(v) {
            Some(&q) if q == b'"' || q == b'\'' => v + closing_quote(&body[v..], q as char)? + 1,
            _ => v + body[v..].find([',', '}']).map(|e| body[v..v + e].trim_end().len())?,
        };
        if k == want {
            return Some(v..end);
        }
        let next = end + body[end..].find(',')?;
        i = next + 1;
    }
}

/// A plain or quoted key at `at` inside a flow mapping, and the byte index of its `:`.
fn flow_key(body: &str, at: usize) -> Option<(String, usize)> {
    let s = body.get(at..)?;
    let (key, after) = match s.chars().next()? {
        q @ ('"' | '\'') => {
            let end = closing_quote(s, q)?;
            (s[1..end].to_string(), end + 1)
        }
        _ => {
            let c = s.find(':')?;
            (s[..c].trim_end().to_string(), c)
        }
    };
    let rest = &s[after..];
    let colon = after + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
    s[colon..].starts_with(':').then(|| (key, at + colon))
}

enum IdChange {
    Keep,
    Set(String),
    Drop,
}

/// Points an object item at `path` (and changes its `id` as asked), keeping every other byte of it. False: the item
/// can't be patched line by line (it is then left alone).
fn set_object(lines: &mut Vec<Line>, item: &ItemAt, id: IdChange, path: &str, eol: &str) -> bool {
    if item.flow {
        return false;
    }
    let idv = find_value(lines, item, "id");
    let pv = find_value(lines, item, "path");
    let p = scalar(&nfc(path));
    if let (IdChange::Drop, Some(v)) = (&id, &idv) {
        // The kept object has no `id`: the item becomes path-only (D-1402). Only the `id:` line goes and the `path:`
        // value changes; every other line, comment and unknown key of the item stays (FR-FMT-07, R131).
        if v.line == item.start {
            // `- id: …` holds the dash: that line becomes `- path: …`, and a separate `path:` line goes.
            let head = lines[v.line].body[..item.keys].to_string();
            lines[v.line].body = format!("{head}path: {p}{}", v.tail);
            if let Some(pl) = &pv {
                if pl.line != v.line {
                    lines.remove(pl.line);
                }
            }
        } else {
            lines.remove(v.line);
            match &pv {
                Some(pl) => {
                    let at = if pl.line > v.line { pl.line - 1 } else { pl.line };
                    lines[at].body = format!("{}{p}{}", pl.prefix, pl.tail);
                }
                None => lines.insert(v.line, line(format!("{}path: {p}", " ".repeat(item.keys)), eol)),
            }
        }
        return true;
    }
    if let (IdChange::Set(new), Some(v)) = (&id, &idv) {
        lines[v.line].body = format!("{}{}{}", v.prefix, scalar(new), v.tail);
    }
    match (&pv, &idv) {
        (Some(v), _) => lines[v.line].body = format!("{}{p}{}", v.prefix, v.tail),
        (None, Some(v)) => insert_after(lines, Some(v.line), vec![format!("{}path: {p}", " ".repeat(item.keys))], eol),
        (None, None) => return false,
    }
    if let (IdChange::Set(new), None, Some(v)) = (&id, &idv, &pv) {
        // A path-only item gets `- id: <id>` / `path:` (AP-4: the rename wrote an id).
        let body = lines[v.line].body.clone();
        if v.line == item.start {
            let head = &body[..item.keys];
            let rest = &body[item.keys..];
            let eol_was = lines[v.line].eol.clone();
            lines[v.line] = line(format!("{head}id: {}", scalar(new)), eol);
            lines.insert(v.line + 1, Line { body: format!("{}{rest}", " ".repeat(item.keys)), eol: eol_was });
        } else {
            lines.insert(v.line, line(format!("{}id: {}", " ".repeat(item.keys), scalar(new)), eol));
        }
    }
    true
}

/// The job patch (§1.6): the new text, or None when no item matches or the file can't be patched (it is then left
/// alone). Only listed items are touched; a renamed tag is rewritten even if the new key is pinned already (§8 13).
pub fn patch_text(text: &str, file: &PinsFile, patches: &[PinPatch]) -> Option<String> {
    let _ = file;
    let p = parse(text.as_bytes());
    if p.state != PinsFileState::Ok || !p.patchable {
        return None;
    }
    let layout = p.layout.clone()?;
    let mut lines = p.lines.clone();
    let eol = file_eol(&lines);
    // raw index → the target it must read back as.
    let mut expect: HashMap<usize, PinTarget> = HashMap::new();
    let mut order: Vec<&(usize, PinTarget)> = p.listed.iter().collect();
    // Bottom-up, so earlier line numbers stay valid.
    order.sort_by(|a, b| layout.items[b.0].start.cmp(&layout.items[a.0].start));
    for (raw, t) in order {
        let item = layout.items[*raw];
        for patch in patches {
            let done = match (patch, t) {
                (PinPatch::TagRenamed { from, to }, PinTarget::Tag { key }) if *key == tag_key(from) => {
                    let to = tag_key(to);
                    let ok = if item.flow {
                        match flow_tag_value(&lines[item.start].body, &item) {
                            Some(r) => {
                                lines[item.start].body.replace_range(r, &scalar(&to));
                                true
                            }
                            None => false,
                        }
                    } else {
                        match find_value(&lines, &item, "tag") {
                            Some(v) => {
                                lines[v.line].body = format!("{}{}{}", v.prefix, scalar(&to), v.tail);
                                true
                            }
                            None => false,
                        }
                    };
                    ok.then(|| PinTarget::Tag { key: to })
                }
                (PinPatch::QueryRenamed { from, to }, PinTarget::Query { name }) if query_key(name) == query_key(from) => {
                    let to = nfc(trim_ws(to));
                    let ok = if item.flow {
                        match flow_value(&lines[item.start].body, &item, "query") {
                            Some(r) => {
                                lines[item.start].body.replace_range(r, &scalar(&to));
                                true
                            }
                            None => false,
                        }
                    } else {
                        match find_value(&lines, &item, "query") {
                            Some(v) => {
                                lines[v.line].body = format!("{}{}{}", v.prefix, scalar(&to), v.tail);
                                true
                            }
                            None => false,
                        }
                    };
                    ok.then_some(PinTarget::Query { name: to })
                }
                (PinPatch::Moved { from, to, id }, PinTarget::Object { id: tid, path: tpath }) => {
                    let by_id = tid.is_some() && id.as_ref().map(|i| nfc(trim_ws(i))) == *tid;
                    let by_path = tid.is_none() && tpath.as_deref() == Some(nfc(from).as_str());
                    // An `id`-only item resolves by `id`: left as it is.
                    if !(by_id || by_path) || tpath.is_none() {
                        None
                    } else {
                        let change = match (by_path, id) {
                            (true, Some(i)) => IdChange::Set(nfc(trim_ws(i))),
                            _ => IdChange::Keep,
                        };
                        let new_id = match &change {
                            IdChange::Set(i) => Some(i.clone()),
                            _ => tid.clone(),
                        };
                        set_object(&mut lines, &item, change, to, &eol).then(|| PinTarget::Object { id: new_id, path: Some(nfc(to)) })
                    }
                }
                (PinPatch::Merged { from, from_id, to, id }, PinTarget::Object { id: tid, path: tpath }) => {
                    let by_id = tid.is_some() && from_id.as_ref().map(|i| nfc(trim_ws(i))) == *tid;
                    let by_path = tid.is_none() && tpath.as_deref() == Some(nfc(from).as_str());
                    if !(by_id || by_path) {
                        None
                    } else {
                        let new_id = id.as_ref().map(|i| nfc(trim_ws(i)));
                        let change = match (&new_id, tid) {
                            (Some(i), _) => IdChange::Set(i.clone()),
                            (None, Some(_)) => IdChange::Drop,
                            (None, None) => IdChange::Keep,
                        };
                        set_object(&mut lines, &item, change, to, &eol).then(|| PinTarget::Object { id: new_id, path: Some(nfc(to)) })
                    }
                }
                _ => None,
            };
            if let Some(target) = done {
                expect.insert(*raw, target);
                break; // one patch per item: its lines may have moved
            }
        }
    }
    if expect.is_empty() {
        return None;
    }
    if !p.has_version {
        let k = prelude(&lines);
        put(&mut lines, k, vec![line(format!("version: {PINS_VERSION}"), &eol)], &eol);
    }
    let out = format!("{}{}", p.bom, join(&lines));
    if out == text {
        return None;
    }
    // The safety net (D-1129): every other item reads back unchanged, each patched one as its new target.
    let back = parse(out.as_bytes());
    if back.state != PinsFileState::Ok || back.raw.len() != p.raw.len() || !same_other_keys(&p, &back) {
        return None;
    }
    let fine = p.raw.iter().zip(back.raw.iter()).enumerate().all(|(i, (old, new))| match expect.get(&i) {
        Some(t) => kind_of(new) == Kind::Pin(t.clone()),
        None => old == new,
    });
    fine.then_some(out)
}

// ------------------------------------------------------------------------------------------------ the core

fn stem_of(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}

impl Core {
    /// §1.3: reads `.tegg/pinned.yml` and resolves every listed pin; never writes, never creates.
    pub fn pins(&self) -> Pins {
        match self.shared.vault.read(PINNED_YML) {
            Ok((bytes, v)) => self.pins_of(&bytes, Some(v)),
            Err(e) => self.pins_absent(e),
        }
    }

    fn pins_absent(&self, e: VaultError) -> Pins {
        let index_ready = self.shared.graph_ready.load(Ordering::SeqCst);
        let state = match e {
            VaultError::NotFound | VaultError::Gone => PinsFileState::Missing,
            VaultError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => PinsFileState::Missing,
            other => PinsFileState::Unreadable { line: None, reason: format!("{other:?}") },
        };
        let patchable = state == PinsFileState::Missing;
        Pins { version: None, state, patchable, index_ready, rows: Vec::new() }
    }

    /// R131 resolution (R133; D-1372, D-1374) of the file's bytes: one index lock for every row (FR-HOM-02 AC-25).
    fn pins_of(&self, bytes: &[u8], version: Option<FileVersion>) -> Pins {
        let index_ready = self.shared.graph_ready.load(Ordering::SeqCst);
        let file = read(bytes);
        let mut ids: Vec<String> = Vec::new();
        let mut paths: Vec<String> = Vec::new();
        let mut type_pins = false;
        for it in &file.items {
            match &it.target {
                PinTarget::Object { id, path } => {
                    ids.extend(id.iter().cloned());
                    paths.extend(path.iter().cloned());
                }
                PinTarget::Type { .. } => type_pins = true,
                PinTarget::Tag { .. } | PinTarget::Query { .. } => {}
            }
        }
        let defined: HashSet<String> = if type_pins { self.types().into_iter().map(|t| t.key).collect() } else { HashSet::new() };
        let look = lock(&self.shared.index).pin_lookup(&ids, &paths);
        let mut trash: Option<std::sync::Arc<crate::trash6a::FileCache>> = None;
        let mut rows = Vec::with_capacity(file.items.len());
        for (index, it) in file.items.iter().enumerate() {
            let mut row = PinRow { index, target: it.target.clone(), state: PinState::Missing, path: None, title: None, r#type: None, date: None };
            match &it.target {
                PinTarget::Object { id, path } => {
                    let live = |o: &tegg_index::ObjectInfo, row: &mut PinRow| {
                        row.state = PinState::Ok;
                        row.path = Some(o.path.clone());
                        row.title = Some(o.title.clone());
                        row.r#type = Some(o.r#type.clone());
                        row.date = look.dates.get(&o.path).map(|d| tegg_format::format_date(*d));
                    };
                    let mut trashed = |row: &mut PinRow, by: &dyn Fn(&tegg_index::ObjectInfo) -> bool| -> bool {
                        let cache = trash.get_or_insert_with(|| self.file_cache());
                        match cache.trashed.iter().find(|o| by(o)) {
                            Some(o) => {
                                row.state = PinState::Trashed;
                                row.path = Some(format!(".trash/{}", o.path));
                                row.title = Some(o.title.clone());
                                row.r#type = Some(o.r#type.clone());
                                true
                            }
                            None => false,
                        }
                    };
                    let norm = |s: &str| nfc(trim_ws(s));
                    // R131 resolution, in order (AP-1229, AP-1231): a live `id` (whatever its path now), a trashed
                    // `id`, a live file at `path` with no `id` or the same one (another `id` is never adopted), a
                    // trashed file at `path`, else missing.
                    let by_id = id.as_ref().and_then(|i| look.by_id.get(i));
                    let at_path = path.as_ref().and_then(|p| look.by_path.get(p)).filter(|o| id.is_none() || o.id.is_none() || o.id.as_deref().map(norm) == *id);
                    if let Some(o) = by_id {
                        live(o, &mut row);
                    } else if !id.as_ref().is_some_and(|i| trashed(&mut row, &|o| o.id.as_deref().map(norm).as_ref() == Some(i))) {
                        if let Some(o) = at_path {
                            live(o, &mut row);
                        } else if let Some(p) = path {
                            trashed(&mut row, &|o| nfc(&o.path) == *p);
                        }
                    }
                }
                PinTarget::Tag { key } => row.state = if look.tags.contains(key) { PinState::Ok } else { PinState::NoObjects },
                // v1-queries §1.9 (D-1484, D-1498): resolved from the files, never pending.
                PinTarget::Query { name } => {
                    let (lookup, title, path) = self.query_pin(name);
                    row.state = match lookup {
                        crate::queries_q::Lookup::Trashed => PinState::Trashed,
                        crate::queries_q::Lookup::Missing => PinState::Missing,
                        _ => PinState::Ok,
                    };
                    row.title = title;
                    row.path = path;
                    rows.push(row);
                    continue;
                }
                PinTarget::Type { key } => {
                    let def = defined.contains(key);
                    row.state = if def || look.types.contains(key) { PinState::Ok } else { PinState::Missing };
                    if !def && !index_ready {
                        row.state = PinState::Pending;
                    }
                }
            }
            // FR-HOM-02 AC-20: until the first index build ends, nothing is missing.
            if !index_ready && matches!(row.state, PinState::Missing | PinState::NoObjects) {
                row.state = PinState::Pending;
            }
            rows.push(row);
        }
        Pins { version, state: file.state, patchable: file.patchable, index_ready, rows }
    }

    /// §1.4: one operation = at most one atomic write (FR-SYN-02). `base` is `Pins.version` as last read.
    pub fn pins_apply(&self, base: Option<FileVersion>, op: PinOp) -> Result<Pins, CoreError> {
        let disk = match self.shared.vault.read(PINNED_YML) {
            Ok((bytes, v)) => Some((bytes, v)),
            Err(VaultError::NotFound) => None,
            Err(e) => return Err(e.into()),
        };
        // FR-SYN-03 AC-26, AC-27 (D-175): never write on a version that wasn't read; the create is exclusive.
        match (&base, &disk) {
            (Some(b), Some((_, d))) if !b.same_content(d) => return Err(CoreError::Vault(VaultError::Conflict { disk: d.clone() })),
            (None, Some((_, d))) => return Err(CoreError::Vault(VaultError::Conflict { disk: d.clone() })),
            (Some(_), None) => return Err(CoreError::Vault(VaultError::Gone)),
            _ => {}
        }
        let parsed = match &disk {
            Some((bytes, _)) => parse(bytes),
            None => missing(),
        };
        match parsed.state {
            PinsFileState::Newer { .. } => return Err(CoreError::Pin(PinError::NewerVersion)),
            PinsFileState::Unreadable { .. } => return Err(CoreError::Pin(PinError::Unreadable)),
            _ => {}
        }
        if disk.is_some() && !parsed.patchable {
            return Err(CoreError::Pin(PinError::Unreadable));
        }
        let n = parsed.listed.len();
        let edit = match op {
            PinOp::Pin { target, at } => {
                let t = self.pin_target(&target).map_err(CoreError::Pin)?;
                // D-1379: a target already listed is moved to `at` instead.
                match parsed.listed.iter().position(|(_, x)| same_target(x, &t)) {
                    Some(from) => PinEdit::Move { from, to: at.unwrap_or(n - 1).min(n - 1) },
                    None => PinEdit::Insert { target: t, at },
                }
            }
            PinOp::Unpin { index } => PinEdit::Remove { index },
            PinOp::Move { from, to } => PinEdit::Move { from, to },
        };
        let text = match &disk {
            Some((bytes, _)) => Some(std::str::from_utf8(bytes).map_err(|_| CoreError::Pin(PinError::Unreadable))?),
            None => None,
        };
        let new = apply_text(text, &parsed.file(), &edit).map_err(CoreError::Pin)?;
        let Some(new) = new else {
            // No-op: nothing written (FR-SYN-06).
            return Ok(match disk {
                Some((bytes, v)) => self.pins_of(&bytes, Some(v)),
                None => self.pins(),
            });
        };
        match self.shared.vault.write(PINNED_YML, new.as_bytes(), base.as_ref())? {
            WriteOutcome::Written(v) => {
                self.shared.emit(crate::CoreEvent::VaultChanged { paths: vec![PINNED_YML.to_string()] });
                Ok(self.pins_of(new.as_bytes(), Some(v)))
            }
            WriteOutcome::Unchanged => Ok(self.pins()),
        }
    }

    /// §1.4: what a request stores. An object is read from its file (its `id` from the frontmatter, not the index; the
    /// note is never written); a Tag object is stored as its tag (D-1382).
    fn pin_target(&self, req: &PinRequest) -> Result<PinTarget, PinError> {
        match req {
            // v1-queries §1.9: only a live query; the stored value is its file's name.
            PinRequest::Query { name } => self.query_live_name(name).map(|name| PinTarget::Query { name }).ok_or(PinError::NotPinnable),
            PinRequest::Tag { key } => Some(tag_key(key)).filter(|k| !k.is_empty()).map(|key| PinTarget::Tag { key }).ok_or(PinError::NotPinnable),
            PinRequest::Type { key } => Some(type_key_of(key)).filter(|k| !k.is_empty()).map(|key| PinTarget::Type { key }).ok_or(PinError::NotPinnable),
            PinRequest::Object { path } => {
                let path = nfc(path);
                if !path_ok(&path) {
                    return Err(PinError::NotPinnable);
                }
                let (bytes, _) = self.shared.vault.read(&path).map_err(|_| PinError::NotPinnable)?;
                let ex = tegg_format::extract(&bytes, stem_of(&path));
                if ex.r#type.as_deref().map(tegg_format::type_key).as_deref() == Some("tag") {
                    let key = tag_key(&ex.title);
                    return if key.is_empty() { Err(PinError::NotPinnable) } else { Ok(PinTarget::Tag { key }) };
                }
                let id = ex.id.as_deref().map(trim_ws).filter(|i| !i.is_empty()).map(nfc);
                Ok(PinTarget::Object { id, path: Some(path) })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> String {
        s.to_string()
    }

    #[test]
    fn edge_shapes() {
        let tag = PinTarget::Tag { key: t("x") };
        let ins = |text: &str| apply_text(Some(text), &read(text.as_bytes()), &PinEdit::Insert { target: tag.clone(), at: None });
        assert_eq!(ins(""), Ok(Some(t("version: 1\npins:\n  - tag: x\n"))));
        assert_eq!(ins("# h\npins:\nx: 1\n"), Ok(Some(t("# h\nversion: 1\npins:\n  - tag: x\nx: 1\n"))));
        assert_eq!(ins("version: 1\npins: []  # c\n"), Ok(Some(t("version: 1\npins:  # c\n  - tag: x\n"))));
        assert_eq!(ins("version: 1\npins: [{tag: y}]\n"), Err(PinError::Unreadable));
        assert_eq!(ins("version: 1\npins:\n- tag: y"), Ok(Some(t("version: 1\npins:\n- tag: y\n- tag: x"))));
        let rm = apply_text(Some("version: 1\npins:\n  - tag: y\n"), &read(b""), &PinEdit::Remove { index: 0 });
        assert_eq!(rm, Ok(Some(t("version: 1\npins: []\n"))));
    }

    #[test]
    fn job_patches() {
        let text = "version: 1\npins:\n  - path: A.md\n  - {tag: účty, x: 1}\n  - id: I\n    path: B.md\n";
        let f = read(text.as_bytes());
        let out = patch_text(text, &f, &[PinPatch::Moved { from: t("A.md"), to: t("C.md"), id: Some(t("N")) }, PinPatch::TagRenamed { from: t("Účty"), to: t("Peníze") }]);
        assert_eq!(out, Some(t("version: 1\npins:\n  - id: N\n    path: C.md\n  - {tag: peníze, x: 1}\n  - id: I\n    path: B.md\n")));
        let out = patch_text(text, &f, &[PinPatch::Merged { from: t("B.md"), from_id: Some(t("I")), to: t("K.md"), id: Some(t("J")) }]);
        assert_eq!(out, Some(t("version: 1\npins:\n  - path: A.md\n  - {tag: účty, x: 1}\n  - id: J\n    path: K.md\n")));
        assert_eq!(patch_text(text, &f, &[PinPatch::Moved { from: t("Z.md"), to: t("Y.md"), id: None }]), None);
    }
}
