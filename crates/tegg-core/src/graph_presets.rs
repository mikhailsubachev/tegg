//! Slice G3 (docs/contracts/v1-graph.md §16.1; FR-GRP-02, D-906, D-907; AP-920…AP-945 → D-1080…D-1105): the graph's
//! filter presets in the vault file `.tegg/graph.yml`. Platform-neutral (AR-03): reads and writes only through `Vault`.
//! Nothing about presets is in the index (AR-01), and nothing is cached: every call reads the file, so a
//! `vault:changed` naming `.tegg/graph.yml` needs no invalidation here.
//!
//! Reading (R118 read rules) parses the values with `yaml_rust2`; writing (R118 write rules, AP-921) patches lines:
//! a line scanner finds each item of the `presets` block list and each key of an item, and only the operated item's
//! lines change. Every other byte (comments, unknown keys, CRLF, a missing final newline, NFD names) stays.

use std::collections::BTreeSet;

use tegg_format::nfc;
use tegg_vault::{FileVersion, VaultError, WriteOutcome};
use yaml_rust2::{Yaml, YamlLoader};

use crate::yaml_text::scalar;
use crate::{lock, Core, CoreError};

/// The presets file (R118).
pub const GRAPH_YML: &str = ".tegg/graph.yml";
/// The current format version (AR-07).
pub const PRESETS_VERSION: u32 = 1;

/// The first line of a new file (`tests/fixtures/graph-presets/expected/created.yml`).
const HEADER: &str = "# Tegg graph filter presets (FR-GRP-02, D-906, D-907). Edit them in the graph's Preset menu.";
/// R118: kinds are written in this order, then unknown values.
const KINDS: [&str; 4] = ["link", "relation", "embed", "tag"];
/// AP-928: at most 100 Unicode scalar values.
const MAX_NAME: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphPreset {
    /// NFC, trimmed, as listed.
    pub name: String,
    /// Raw keys, NFC, file order; unknown keys kept (D-907).
    pub hidden_types: Vec<String>,
    /// Raw values; only link/relation/embed/tag take effect.
    pub hidden_kinds: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetsState {
    Missing,
    Ok,
    Newer { version: u64 },
    Unreadable { line: Option<u32>, reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphPresets {
    /// The file's version as read; None when Missing.
    pub version: Option<FileVersion>,
    pub state: PresetsState,
    /// Listed presets in file order (R118 read rules); empty when Unreadable.
    pub presets: Vec<GraphPreset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetOp {
    Save { name: String, hidden_types: Vec<String>, hidden_kinds: Vec<String> },
    Update { name: String, hidden_types: Vec<String>, hidden_kinds: Vec<String> },
    Rename { from: String, to: String },
    Delete { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetError {
    NameEmpty,
    NameTaken { existing: String },
    NameTooLong,
    NameControl,
    NoSuchPreset,
    NewerVersion,
    Unreadable,
}

// ------------------------------------------------------------------------------------------------ names

/// Trimming of names: Unicode White_Space (`char::is_whitespace`). Control characters are refused before trimming
/// (AP-928, D-1115), so the trim only ever removes spaces.
fn trim(s: &str) -> &str {
    s.trim_matches(char::is_whitespace)
}

/// The name as listed and written: trimmed, NFC.
fn clean(s: &str) -> String {
    nfc(trim(s))
}

/// D-907: names compare after NFC and trimming, case-insensitively (no locale, FR-FMT-12 AC-7).
fn name_key(s: &str) -> String {
    clean(s).to_lowercase()
}

/// AP-928, D-1115: the name a save or rename would write, or why not. `own` is the listed index being renamed.
fn validate(raw: &str, listed: &[GraphPreset], own: Option<usize>) -> Result<String, PresetError> {
    if raw.chars().any(char::is_control) {
        return Err(PresetError::NameControl);
    }
    let name = clean(raw);
    if name.is_empty() {
        return Err(PresetError::NameEmpty);
    }
    if name.chars().count() > MAX_NAME {
        return Err(PresetError::NameTooLong);
    }
    let key = name.to_lowercase();
    if key == "default" {
        return Err(PresetError::NameTaken { existing: "Default".into() });
    }
    if let Some((_, p)) = listed.iter().enumerate().find(|(i, p)| Some(*i) != own && name_key(&p.name) == key) {
        return Err(PresetError::NameTaken { existing: p.name.clone() });
    }
    Ok(name)
}

fn find_listed(listed: &[GraphPreset], name: &str) -> Result<usize, PresetError> {
    let key = name_key(name);
    listed.iter().position(|p| name_key(&p.name) == key).ok_or(PresetError::NoSuchPreset)
}

/// R118: known values in `order`, then the others in their previous order, then new ones as given; NFC, no repeats.
fn ordered(given: &[String], order: &[String], previous: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let given: Vec<String> = given.iter().map(|v| nfc(v)).filter(|v| seen.insert(v.clone())).collect();
    let mut known: Vec<(usize, String)> = Vec::new();
    let mut unknown: Vec<(usize, usize, String)> = Vec::new();
    for (gi, v) in given.into_iter().enumerate() {
        if let Some(i) = order.iter().position(|o| *o == v) {
            known.push((i, v));
        } else if let Some(i) = previous.iter().position(|o| nfc(o) == v) {
            unknown.push((0, i, v));
        } else {
            unknown.push((1, gi, v));
        }
    }
    known.sort();
    unknown.sort();
    known.into_iter().map(|(_, v)| v).chain(unknown.into_iter().map(|(_, _, v)| v)).collect()
}

fn same_set(a: &[String], b: &[String]) -> bool {
    let a: BTreeSet<String> = a.iter().map(|v| nfc(v)).collect();
    let b: BTreeSet<String> = b.iter().map(|v| nfc(v)).collect();
    a == b
}

fn flow(values: &[String]) -> String {
    format!("[{}]", values.iter().map(|v| scalar(v)).collect::<Vec<_>>().join(", "))
}

// ------------------------------------------------------------------------------------------------ reading

/// One item of the `presets` list as YAML read it.
#[derive(Debug, Clone)]
struct RawItem {
    /// The index among the listed presets, when listed.
    listed: Option<usize>,
    types: Vec<String>,
    kinds: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PresetsValue {
    Missing,
    /// `presets:` with nothing (YAML null): no presets.
    Null,
    /// A YAML list (block or flow).
    List,
}

#[derive(Debug, Clone)]
struct Parsed {
    state: PresetsState,
    presets: Vec<GraphPreset>,
    items: Vec<RawItem>,
    has_version: bool,
    value: PresetsValue,
    /// The first document as YAML read it (the parse-back check of every write compares against it).
    doc: Yaml,
}

fn unreadable(line: Option<u32>, reason: impl Into<String>) -> Parsed {
    Parsed { state: PresetsState::Unreadable { line, reason: reason.into() }, presets: Vec::new(), items: Vec::new(), has_version: false, value: PresetsValue::Missing, doc: Yaml::Null }
}

fn strings(y: &Yaml) -> Option<Vec<String>> {
    match y {
        Yaml::BadValue => Some(Vec::new()), // the key is missing
        Yaml::Array(a) => a.iter().map(|v| v.as_str().map(nfc)).collect(),
        _ => None,
    }
}

/// R118 read rules (AP-922).
fn parse(bytes: &[u8]) -> Parsed {
    let Ok(text) = std::str::from_utf8(bytes) else { return unreadable(None, "The file isn't valid UTF-8.") };
    // A UTF-8 BOM opens the stream (YAML 1.2 §5.2); `yaml_rust2` would read it as part of the first key.
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let docs = match YamlLoader::load_from_str(text) {
        Ok(d) => d,
        Err(e) => {
            let line = open_flow_line(text, e.marker().index()).or(Some(e.marker().line())).filter(|l| *l > 0);
            return unreadable(line.and_then(|l| u32::try_from(l).ok()), e.info().to_string());
        }
    };
    let top = match docs.into_iter().next() {
        // An empty file (or only comments) holds no presets.
        None | Some(Yaml::Null) => Yaml::Hash(Default::default()),
        Some(y @ Yaml::Hash(_)) => y,
        Some(_) => return unreadable(None, "The top level isn't a mapping."),
    };
    let (has_version, version) = match &top["version"] {
        Yaml::BadValue => (false, 1),
        Yaml::Integer(n) if *n >= 1 => (true, *n as u64),
        _ => return unreadable(None, "`version` isn't a positive integer."),
    };
    let (value, list) = match &top["presets"] {
        Yaml::BadValue => (PresetsValue::Missing, Vec::new()),
        Yaml::Null => (PresetsValue::Null, Vec::new()),
        Yaml::Array(a) => (PresetsValue::List, a.clone()),
        _ => return unreadable(None, "`presets` isn't a list."),
    };
    let mut presets: Vec<GraphPreset> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut items = Vec::new();
    for y in &list {
        let types = strings(&y["hidden-types"]);
        let kinds = strings(&y["hidden-kinds"]);
        let name = y["name"].as_str().map(clean).filter(|n| !n.is_empty());
        let mut listed = None;
        if let (Some(name), Some(t), Some(k)) = (name, types.clone(), kinds.clone()) {
            let key = name.to_lowercase();
            if key != "default" && seen.insert(key) {
                listed = Some(presets.len());
                presets.push(GraphPreset { name, hidden_types: t, hidden_kinds: k });
            }
        }
        items.push(RawItem { listed, types: types.unwrap_or_default(), kinds: kinds.unwrap_or_default() });
    }
    let state = if version > u64::from(PRESETS_VERSION) { PresetsState::Newer { version } } else { PresetsState::Ok };
    Parsed { state, presets, items, has_version, value, doc: top }
}

/// The 1-based line where the outermost flow collection still open at character `at` started, if any: a parser
/// error inside an unclosed `[` or `{` is reported on the line that opened it (FR-GRP-02 AC-19: `invalid-yaml`'s
/// unclosed list on line 5, where `yaml_rust2` stops on line 6).
pub(crate) fn open_flow_line(text: &str, at: usize) -> Option<usize> {
    let mut stack: Vec<usize> = Vec::new();
    for (n, line) in text.split_inclusive('\n').enumerate() {
        let mut quote: Option<char> = None;
        let mut prev = ' ';
        for c in line.chars() {
            match quote {
                Some(q) => {
                    if c == q {
                        quote = None;
                    }
                }
                None => match c {
                    '#' if prev == ' ' || prev == '\t' => break,
                    '"' | '\'' if !stack.is_empty() || prev == ' ' => quote = Some(c),
                    '[' | '{' => stack.push(n + 1),
                    ']' | '}' => {
                        stack.pop();
                    }
                    _ => {}
                },
            }
            prev = c;
        }
        let consumed: usize = text.split_inclusive('\n').take(n + 1).map(|l| l.chars().count()).sum();
        if consumed > at {
            break;
        }
    }
    stack.first().copied()
}

// ------------------------------------------------------------------------------------------------ the line scanner

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Line {
    pub(crate) body: String,
    /// `""`, `"\n"` or `"\r\n"`.
    pub(crate) eol: String,
}

pub(crate) fn split(text: &str) -> Vec<Line> {
    text.split_inclusive('\n')
        .map(|part| {
            let body = part.strip_suffix("\r\n").or_else(|| part.strip_suffix('\n')).unwrap_or(part);
            Line { body: body.to_string(), eol: part[body.len()..].to_string() }
        })
        .collect()
}

pub(crate) fn join(lines: &[Line]) -> String {
    lines.iter().map(|l| format!("{}{}", l.body, l.eol)).collect()
}

pub(crate) fn indent(body: &str) -> usize {
    body.len() - body.trim_start_matches(' ').len()
}
pub(crate) fn blank(body: &str) -> bool {
    body.trim().is_empty()
}
pub(crate) fn comment(body: &str) -> bool {
    body.trim_start().starts_with('#')
}
/// A content line (not blank, not a comment).
pub(crate) fn content(body: &str) -> bool {
    !blank(body) && !comment(body)
}
/// A block sequence entry at column `at`: `-` followed by a space or the end of the line.
pub(crate) fn dash_at(body: &str, at: usize) -> bool {
    let rest = &body[at.min(body.len())..];
    rest == "-" || rest.starts_with("- ")
}

/// The mapping key starting at byte `at` of `body`: (key, byte index of its `:`).
pub(crate) fn key_at(body: &str, at: usize) -> Option<(String, usize)> {
    let s = body.get(at..)?;
    let (key, after) = match s.chars().next()? {
        q @ ('"' | '\'') => {
            let end = closing_quote(s, q)?;
            let inner = &s[1..end];
            let key = if q == '\'' { inner.replace("''", "'") } else { serde_json::from_str::<String>(&s[..=end]).unwrap_or_else(|_| inner.to_string()) };
            (key, end + 1)
        }
        _ => {
            let mut i = 0;
            loop {
                let rel = s[i..].find(':')?;
                let c = i + rel;
                if s[c + 1..].is_empty() || s[c + 1..].starts_with([' ', '\t']) {
                    break (s[..c].trim_end().to_string(), c);
                }
                i = c + 1;
            }
        }
    };
    let rest = &s[after..];
    let colon = after + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
    (s[colon..].starts_with(':')).then(|| (key, at + colon))
}

/// The byte index of the quote closing the quoted scalar that starts `s` (on one line).
pub(crate) fn closing_quote(s: &str, q: char) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 1;
    while i < b.len() {
        if q == '"' && b[i] == b'\\' {
            i += 2;
            continue;
        }
        if b[i] == q as u8 {
            if q == '\'' && b.get(i + 1) == Some(&b'\'') {
                i += 2;
                continue;
            }
            return Some(i);
        }
        i += 1;
    }
    None
}

/// The byte after the flow collection starting `s[0]` (`[` or `{`) closes, within `s`; None when it continues.
/// `depth` and `quote` carry the state across lines.
pub(crate) fn flow_end(s: &str, depth: &mut i32, quote: &mut Option<char>) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        match *quote {
            Some('"') => {
                if c == b'\\' {
                    i += 1;
                } else if c == b'"' {
                    *quote = None;
                }
            }
            Some(_) => {
                if c == b'\'' {
                    if b.get(i + 1) == Some(&b'\'') {
                        i += 1;
                    } else {
                        *quote = None;
                    }
                }
            }
            None => match c {
                b'"' => *quote = Some('"'),
                b'\'' => *quote = Some('\''),
                b'[' | b'{' => *depth += 1,
                b']' | b'}' => {
                    *depth -= 1;
                    if *depth == 0 {
                        return Some(i + 1);
                    }
                }
                b'#' if i > 0 && (b[i - 1] == b' ' || b[i - 1] == b'\t') => return None, // a comment ends the line
                _ => {}
            },
        }
        i += 1;
    }
    None
}

/// One item of the `presets` block list: its lines `start..=end` and the column of its keys.
#[derive(Debug, Clone, Copy)]
struct ItemAt {
    start: usize,
    end: usize,
    dash: usize,
    keys: usize,
}

#[derive(Debug, Clone)]
struct Layout {
    /// The top-level `presets:` line.
    presets: Option<usize>,
    items: Vec<ItemAt>,
}

/// Finds the `presets` key and its items' line ranges; None when the file can't be patched by lines (a non-empty
/// flow list, a key the scanner can't find, or items it can't line up with what YAML read).
fn scan(lines: &[Line], parsed: &Parsed) -> Option<Layout> {
    let p = lines.iter().position(|l| indent(&l.body) == 0 && content(&l.body) && key_at(&l.body, 0).is_some_and(|(k, _)| k == "presets"));
    if parsed.value == PresetsValue::Missing {
        return Some(Layout { presets: None, items: Vec::new() });
    }
    let p = p?;
    let (_, colon) = key_at(&lines[p].body, 0)?;
    let inline = lines[p].body[colon + 1..].trim_start();
    if !inline.is_empty() && !inline.starts_with('#') {
        // A flow list on the key line: only `[]` (no items) can be patched.
        return (parsed.items.is_empty() && inline.starts_with('[')).then(|| Layout { presets: Some(p), items: Vec::new() });
    }
    let mut items: Vec<ItemAt> = Vec::new();
    let mut d: Option<usize> = None;
    let mut region_end = p; // the last line of the list region
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
            items.push(ItemAt { start: i, end: i, dash: dd, keys: 0 });
        }
        region_end = i;
    }
    if items.len() != parsed.items.len() {
        return None;
    }
    // D-1122: a flow item (`- {name: x}`, `- [..]`) can't be patched by lines; the whole file then isn't.
    if items.iter().any(|it| lines[it.start].body[it.dash + 1..].trim_start().starts_with(['{', '['])) {
        return None;
    }
    // Each item ends at its last content line before the next content line indented at most as far as the dash.
    // Comment lines are skipped like blank lines (QA G3): one inside the item, at any column, goes with the item;
    // comments after its last content line stay outside it.
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
        let spaces = after.len() - after.trim_start_matches(' ').len();
        items[n].keys = if after.trim().is_empty() {
            (items[n].start + 1..=end).map(|i| &lines[i].body).find(|b| content(b)).map(|b| indent(b)).unwrap_or(dd + 2)
        } else {
            dd + 1 + spaces
        };
    }
    Some(Layout { presets: Some(p), items })
}

/// A key of an item: the lines `line..=end` (relative to the item) hold it and its value.
struct KeyAt {
    line: usize,
    end: usize,
    /// The new line is `prefix + value + tail`.
    prefix: String,
    tail: String,
}

/// Finds `key` among the item's lines (`il`, the dash line first) at column `k`.
fn find_key(il: &[Line], k: usize, key: &str) -> Option<KeyAt> {
    let line = (0..il.len()).find(|&i| {
        let b = &il[i].body;
        let at_col = if i == 0 { b.len() > k } else { content(b) && indent(b) == k };
        at_col && key_at(b, k).is_some_and(|(name, _)| name == key)
    })?;
    let body = &il[line].body;
    let (_, colon) = key_at(body, k)?;
    let rest = &body[colon + 1..];
    let v_off = colon + 1 + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
    let v = &body[v_off..];
    // Continuation lines of a block value: deeper than the key, or a compact `- ` list at the key's column. Comment
    // lines are skipped like blank lines (QA G3): one between continuation lines goes with the value, one after the
    // last stays.
    let block_end = |compact: bool| {
        let mut end = line;
        for i in line + 1..il.len() {
            let b = &il[i].body;
            if !content(b) {
                continue;
            }
            let ind = indent(b);
            if ind > k || (compact && ind == k && dash_at(b, ind)) {
                end = i;
            } else {
                break;
            }
        }
        end
    };
    if v.is_empty() || v.starts_with('#') {
        let end = block_end(true);
        return Some(KeyAt { line, end, prefix: format!("{} ", &body[..=colon]), tail: rest.to_string() });
    }
    let prefix = body[..v_off].to_string();
    let first = v.chars().next()?;
    if first == '[' || first == '{' {
        let (mut depth, mut quote) = (0, None);
        if let Some(p) = flow_end(v, &mut depth, &mut quote) {
            return Some(KeyAt { line, end: line, prefix, tail: v[p..].to_string() });
        }
        for i in line + 1..il.len() {
            if let Some(p) = flow_end(&il[i].body, &mut depth, &mut quote) {
                return Some(KeyAt { line, end: i, prefix, tail: il[i].body[p..].to_string() });
            }
        }
        return None;
    }
    if first == '"' || first == '\'' {
        if let Some(p) = closing_quote(v, first) {
            return Some(KeyAt { line, end: line, prefix, tail: v[p + 1..].to_string() });
        }
        return None; // a quoted scalar over several lines isn't patched
    }
    // A plain scalar: it ends before ` #`; continuation lines (deeper, not comments) belong to it.
    let cut = [" #", "\t#"].iter().filter_map(|m| v.find(m)).min().unwrap_or(v.len());
    let value_len = v[..cut].trim_end().len();
    let mut end = line;
    for i in line + 1..il.len() {
        let b = &il[i].body;
        if blank(b) {
            continue;
        }
        if indent(b) > k && !comment(b) && cut == v.len() {
            end = i;
        } else {
            break;
        }
    }
    let tail = if end == line { v[value_len..].to_string() } else { String::new() };
    Some(KeyAt { line, end, prefix, tail })
}

/// Replaces `lines[from..=to]` with `new` (bodies; the file's `eol`), keeping a missing final newline missing.
fn splice(lines: &mut Vec<Line>, from: usize, to: usize, new: Vec<String>, eol: &str) {
    let last_eol = lines[to].eol.clone();
    let n = new.len();
    let replacement: Vec<Line> =
        new.into_iter().enumerate().map(|(i, body)| Line { body, eol: if i + 1 == n { last_eol.clone() } else { eol.to_string() } }).collect();
    let at_end = to + 1 == lines.len();
    lines.splice(from..=to, replacement);
    if n == 0 && at_end && last_eol.is_empty() && from > 0 {
        lines[from - 1].eol.clear();
    }
}

/// Inserts `new` after line `after` (None: at the start), keeping a missing final newline missing.
pub(crate) fn insert_after(lines: &mut Vec<Line>, after: Option<usize>, new: Vec<String>, eol: &str) {
    let at = after.map_or(0, |a| a + 1);
    let mut add: Vec<Line> = new.into_iter().map(|body| Line { body, eol: eol.to_string() }).collect();
    if let Some(a) = after {
        if lines[a].eol.is_empty() {
            lines[a].eol = eol.to_string();
            if let Some(l) = add.last_mut() {
                l.eol.clear();
            }
        }
    }
    lines.splice(at..at, add);
}

fn item_lines(dash: usize, keys: usize, name: &str, types: &[String], kinds: &[String]) -> Vec<String> {
    let gap = keys.saturating_sub(dash + 1).max(1);
    vec![
        format!("{}-{}name: {}", " ".repeat(dash), " ".repeat(gap), scalar(name)),
        format!("{}hidden-types: {}", " ".repeat(dash + 1 + gap), flow(types)),
        format!("{}hidden-kinds: {}", " ".repeat(dash + 1 + gap), flow(kinds)),
    ]
}

/// The file's line ending: the first one it has, else LF.
pub(crate) fn file_eol(lines: &[Line]) -> String {
    lines.iter().map(|l| l.eol.clone()).find(|e| !e.is_empty()).unwrap_or_else(|| "\n".into())
}

/// The patched text of an existing file, or None when the operation leaves it as it is.
fn patch(full: &str, parsed: &Parsed, op: &Resolved) -> Result<Option<String>, PresetError> {
    // A UTF-8 BOM stays first: the lines are patched without it.
    let (bom, text) = match full.strip_prefix('\u{FEFF}') {
        Some(rest) => ("\u{FEFF}", rest),
        None => ("", full),
    };
    let mut lines = split(text);
    if several_documents(&lines) {
        return Err(PresetError::Unreadable); // D-1122: only a one-document file is patched
    }
    let layout = scan(&lines, parsed).ok_or(PresetError::Unreadable)?;
    let eol = file_eol(&lines);
    let item_of = |listed: usize| -> Result<(usize, ItemAt), PresetError> {
        let raw = parsed.items.iter().position(|it| it.listed == Some(listed)).ok_or(PresetError::NoSuchPreset)?;
        Ok((raw, layout.items[raw]))
    };
    match op {
        Resolved::Save { name, types, kinds } => {
            let (dash, keys) = layout.items.last().map_or((2, 4), |it| (it.dash, it.keys));
            let new = item_lines(dash, keys, name, types, kinds);
            match (layout.items.last(), layout.presets) {
                (Some(last), _) => insert_after(&mut lines, Some(last.end), new, &eol),
                (None, Some(p)) => {
                    let body = lines[p].body.clone();
                    let (_, colon) = key_at(&body, 0).ok_or(PresetError::Unreadable)?;
                    let rest = &body[colon + 1..];
                    let inline = rest.trim_start();
                    if inline.starts_with('[') {
                        // `presets: []` becomes `presets:` (a trailing comment stays).
                        let (mut depth, mut quote) = (0, None);
                        let close = flow_end(inline, &mut depth, &mut quote).ok_or(PresetError::Unreadable)?;
                        lines[p].body = format!("{}{}", &body[..=colon], &inline[close..]);
                    }
                    insert_after(&mut lines, Some(p), new, &eol);
                }
                (None, None) => {
                    let mut add = vec!["presets:".to_string()];
                    add.extend(new);
                    let last = lines.len().checked_sub(1);
                    insert_after(&mut lines, last, add, &eol);
                }
            }
        }
        Resolved::Update { listed, types, kinds } => {
            let (raw, it) = item_of(*listed)?;
            let old = &parsed.items[raw];
            let (t_changed, k_changed) = (!same_set(&old.types, types), !same_set(&old.kinds, kinds));
            if !t_changed && !k_changed {
                return Ok(None); // D-1114
            }
            let mut il: Vec<Line> = lines[it.start..=it.end].to_vec();
            let mut found: Vec<(KeyAt, String)> = Vec::new();
            let mut add: Vec<String> = Vec::new();
            for (key, values, changed) in [("hidden-types", types, t_changed), ("hidden-kinds", kinds, k_changed)] {
                match find_key(&il, it.keys, key) {
                    Some(at) if changed => found.push((at, flow(values))),
                    Some(_) => {}
                    None if old_has(text, raw, key) => return Err(PresetError::Unreadable),
                    None => add.push(format!("{}{key}: {}", " ".repeat(it.keys), flow(values))),
                }
            }
            found.sort_by(|a, b| b.0.line.cmp(&a.0.line));
            for (at, value) in found {
                let line = format!("{}{value}{}", at.prefix, at.tail);
                splice(&mut il, at.line, at.end, vec![line], &eol);
            }
            if !add.is_empty() {
                let last = il.len() - 1;
                insert_after(&mut il, Some(last), add, &eol);
            }
            lines.splice(it.start..=it.end, il);
        }
        Resolved::Rename { listed, to } => {
            let (_, it) = item_of(*listed)?;
            let mut il: Vec<Line> = lines[it.start..=it.end].to_vec();
            let at = find_key(&il, it.keys, "name").ok_or(PresetError::Unreadable)?;
            let line = format!("{}{}{}", at.prefix, scalar(to), at.tail);
            splice(&mut il, at.line, at.end, vec![line], &eol);
            lines.splice(it.start..=it.end, il);
        }
        Resolved::Delete { listed } => {
            let (_, it) = item_of(*listed)?;
            splice(&mut lines, it.start, it.end, Vec::new(), &eol);
            if parsed.items.len() == 1 {
                // AP-926: the last item leaves `presets: []`; the file stays.
                let p = layout.presets.ok_or(PresetError::Unreadable)?;
                let body = lines[p].body.clone();
                let (_, colon) = key_at(&body, 0).ok_or(PresetError::Unreadable)?;
                lines[p].body = format!("{} []{}", &body[..=colon], &body[colon + 1..]);
            }
        }
    }
    if !parsed.has_version {
        // R118, D-1124: a missing version is written as `version: 1` after the header comments (and after leading `%`
        // directives and a `---` line, QA G3).
        let n = prelude(&lines);
        insert_after(&mut lines, n.checked_sub(1), vec![format!("version: {PRESETS_VERSION}")], &eol);
    }
    let out = format!("{bom}{}", join(&lines));
    if out == full {
        return Ok(None);
    }
    // The safety net (QA G3): the new text must read back as exactly the intended change, else nothing is written.
    if !reads_back(parsed, &out, op) {
        return Err(PresetError::Unreadable);
    }
    Ok(Some(out))
}

/// `body` is the document marker `m` (`---` or `...`) at column 0, alone or before a space.
pub(crate) fn doc_marker(body: &str, m: &str) -> bool {
    body.strip_prefix(m).is_some_and(|r| r.is_empty() || r.starts_with([' ', '\t']))
}

/// Whether the text holds more than one YAML document: a `---` after content (or a second one), or a `...`.
pub(crate) fn several_documents(lines: &[Line]) -> bool {
    let mut started = false;
    for l in lines {
        let b = &l.body;
        if !content(b) || (!started && b.starts_with('%')) {
            continue;
        }
        if doc_marker(b, "...") || (doc_marker(b, "---") && started) {
            return true;
        }
        started = true;
    }
    false
}

/// The number of leading lines `version: 1` goes after: comments, `%` directives and the first `---` line (alone or
/// with a comment).
pub(crate) fn prelude(lines: &[Line]) -> usize {
    let mut started = false;
    let mut n = 0;
    for l in lines {
        let b = &l.body;
        let start = doc_marker(b, "---") && b[3..].trim_start().chars().next().is_none_or(|c| c == '#');
        if comment(b) || (!started && (b.starts_with('%') || start)) {
            started |= start;
            n += 1;
        } else {
            break;
        }
    }
    n
}

fn ystr(s: &str) -> Yaml {
    Yaml::String(s.to_string())
}
fn ylist(values: &[String]) -> Yaml {
    Yaml::Array(values.iter().map(|v| ystr(v)).collect())
}

/// The parse-back check: `out` reads as Ok, every top-level key but `version` and `presets` is unchanged, `version`
/// is the old one (or 1 when it was missing), and the `presets` list is the old one with exactly `op` applied (other
/// items unchanged in order and content). Covers what the line scanner can't see: anchors and aliases, a second
/// document, a range it cut wrong.
fn reads_back(old: &Parsed, out: &str, op: &Resolved) -> bool {
    let new = parse(out.as_bytes());
    if new.state != PresetsState::Ok {
        return false;
    }
    let (Yaml::Hash(o), Yaml::Hash(n)) = (&old.doc, &new.doc) else { return false };
    let skip = |k: &Yaml| matches!(k.as_str(), Some("version" | "presets"));
    if o.iter().filter(|(k, _)| !skip(k)).count() != n.iter().filter(|(k, _)| !skip(k)).count() {
        return false;
    }
    if o.iter().filter(|(k, _)| !skip(k)).any(|(k, v)| n.get(k) != Some(v)) {
        return false;
    }
    let want_version = if old.has_version { o.get(&ystr("version")).cloned() } else { Some(Yaml::Integer(i64::from(PRESETS_VERSION))) };
    if n.get(&ystr("version")).cloned() != want_version {
        return false;
    }
    let mut want: Vec<Yaml> = match o.get(&ystr("presets")) {
        Some(Yaml::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    let raw_of = |listed: usize| old.items.iter().position(|it| it.listed == Some(listed));
    match op {
        Resolved::Save { name, types, kinds } => {
            let mut h = yaml_rust2::yaml::Hash::new();
            h.insert(ystr("name"), ystr(name));
            h.insert(ystr("hidden-types"), ylist(types));
            h.insert(ystr("hidden-kinds"), ylist(kinds));
            want.push(Yaml::Hash(h));
        }
        Resolved::Update { listed, types, kinds } => {
            let Some(raw) = raw_of(*listed) else { return false };
            let old_item = &old.items[raw];
            let Some(Yaml::Hash(h)) = want.get_mut(raw) else { return false };
            for (key, values, changed) in [("hidden-types", types, !same_set(&old_item.types, types)), ("hidden-kinds", kinds, !same_set(&old_item.kinds, kinds))] {
                match h.get_mut(&ystr(key)) {
                    Some(v) if changed => *v = ylist(values),
                    Some(_) => {}
                    None => {
                        h.insert(ystr(key), ylist(values));
                    }
                }
            }
        }
        Resolved::Rename { listed, to } => {
            let Some(raw) = raw_of(*listed) else { return false };
            let Some(Yaml::Hash(h)) = want.get_mut(raw) else { return false };
            let Some(v) = h.get_mut(&ystr("name")) else { return false };
            *v = ystr(to);
        }
        Resolved::Delete { listed } => {
            let Some(raw) = raw_of(*listed) else { return false };
            want.remove(raw);
        }
    }
    matches!(n.get(&ystr("presets")), Some(Yaml::Array(a)) if *a == want)
}

/// Whether YAML read `key` in raw item `raw` although the scanner didn't find it (then the file isn't patched).
fn old_has(text: &str, raw: usize, key: &str) -> bool {
    YamlLoader::load_from_str(text).ok().and_then(|d| d.into_iter().next()).is_some_and(|y| !matches!(y["presets"][raw][key], Yaml::BadValue))
}

/// An operation after validation.
enum Resolved {
    Save { name: String, types: Vec<String>, kinds: Vec<String> },
    Update { listed: usize, types: Vec<String>, kinds: Vec<String> },
    Rename { listed: usize, to: String },
    Delete { listed: usize },
}

fn new_file(name: &str, types: &[String], kinds: &[String]) -> String {
    let mut out = format!("{HEADER}\nversion: {PRESETS_VERSION}\npresets:\n");
    for l in item_lines(2, 4, name, types, kinds) {
        out.push_str(&l);
        out.push('\n');
    }
    out
}

impl Core {
    /// Reads `.tegg/graph.yml`; never writes, never creates.
    pub fn graph_presets(&self) -> GraphPresets {
        match self.shared.vault.read(GRAPH_YML) {
            Ok((bytes, version)) => {
                let p = parse(&bytes);
                GraphPresets { version: Some(version), state: p.state, presets: p.presets }
            }
            Err(VaultError::NotFound) => GraphPresets { version: None, state: PresetsState::Missing, presets: Vec::new() },
            Err(e) => GraphPresets { version: None, state: PresetsState::Unreadable { line: None, reason: format!("{e:?}") }, presets: Vec::new() },
        }
    }

    /// One operation = at most one atomic write (FR-SYN-02). `base` is `GraphPresets.version` as last read.
    pub fn graph_presets_apply(&self, base: Option<FileVersion>, op: PresetOp) -> Result<GraphPresets, CoreError> {
        let disk = match self.shared.vault.read(GRAPH_YML) {
            Ok((bytes, v)) => Some((bytes, v)),
            Err(VaultError::NotFound) => None,
            Err(e) => return Err(e.into()),
        };
        // FR-SYN-03 AC-22, AC-24 (D-175): never write on a version that wasn't read.
        match (&base, &disk) {
            (Some(b), Some((_, d))) if !b.same_content(d) => return Err(CoreError::Vault(VaultError::Conflict { disk: d.clone() })),
            (None, Some((_, d))) => return Err(CoreError::Vault(VaultError::Conflict { disk: d.clone() })),
            (Some(_), None) => return Err(CoreError::Vault(VaultError::Gone)),
            _ => {}
        }
        let parsed = match &disk {
            Some((bytes, _)) => parse(bytes),
            None => Parsed { state: PresetsState::Missing, presets: Vec::new(), items: Vec::new(), has_version: false, value: PresetsValue::Missing, doc: Yaml::Null },
        };
        match parsed.state {
            PresetsState::Newer { .. } => return Err(CoreError::Preset(PresetError::NewerVersion)),
            PresetsState::Unreadable { .. } => return Err(CoreError::Preset(PresetError::Unreadable)),
            _ => {}
        }
        let listed = &parsed.presets;
        let type_order = {
            let data = lock(&self.shared.index).graph_data();
            self.graph_type_order(&data)
        };
        let kind_order: Vec<String> = KINDS.iter().map(|k| k.to_string()).collect();
        let resolved = match op {
            PresetOp::Save { name, hidden_types, hidden_kinds } => {
                let name = validate(&name, listed, None).map_err(CoreError::Preset)?;
                Resolved::Save { name, types: ordered(&hidden_types, &type_order, &[]), kinds: ordered(&hidden_kinds, &kind_order, &[]) }
            }
            PresetOp::Update { name, hidden_types, hidden_kinds } => {
                let i = find_listed(listed, &name).map_err(CoreError::Preset)?;
                let p = &listed[i];
                Resolved::Update {
                    listed: i,
                    types: ordered(&hidden_types, &type_order, &p.hidden_types),
                    kinds: ordered(&hidden_kinds, &kind_order, &p.hidden_kinds),
                }
            }
            PresetOp::Rename { from, to } => {
                let i = find_listed(listed, &from).map_err(CoreError::Preset)?;
                let to = validate(&to, listed, Some(i)).map_err(CoreError::Preset)?;
                if to == listed[i].name {
                    return Ok(self.graph_presets()); // the same name: nothing to write (FR-SYN-06 AC-40)
                }
                Resolved::Rename { listed: i, to }
            }
            PresetOp::Delete { name } => Resolved::Delete { listed: find_listed(listed, &name).map_err(CoreError::Preset)? },
        };
        let new = match &disk {
            None => match &resolved {
                Resolved::Save { name, types, kinds } => Some(new_file(name, types, kinds)),
                _ => return Err(CoreError::Preset(PresetError::NoSuchPreset)),
            },
            Some((bytes, _)) => {
                let text = std::str::from_utf8(bytes).map_err(|_| CoreError::NotUtf8)?;
                patch(text, &parsed, &resolved).map_err(CoreError::Preset)?
            }
        };
        let Some(new) = new else { return Ok(self.graph_presets()) };
        match self.shared.vault.write(GRAPH_YML, new.as_bytes(), base.as_ref())? {
            WriteOutcome::Written(version) => {
                let p = parse(new.as_bytes());
                Ok(GraphPresets { version: Some(version), state: p.state, presets: p.presets })
            }
            WriteOutcome::Unchanged => Ok(self.graph_presets()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_yaml_reports_the_parser_line() {
        let text = "# h\nversion: 1\npresets:\n  - name: A\n    hidden-types: [tag, page\n    hidden-kinds: []\n";
        let p = parse(text.as_bytes());
        assert!(matches!(p.state, PresetsState::Unreadable { line: Some(5), .. }), "{:?}", p.state);
    }

    #[test]
    fn ordering_keeps_unknown_values_in_their_previous_order() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(ordered(&s(&["x", "tag", "y", "link"]), &s(&["link", "tag"]), &s(&["y", "x"])), s(&["link", "tag", "y", "x"]));
    }

    fn save_on(text: &str) -> Result<Option<String>, PresetError> {
        let op = Resolved::Save { name: "A".into(), types: vec!["tag".into()], kinds: vec![] };
        patch(text, &parse(text.as_bytes()), &op)
    }

    #[test]
    fn saves_on_edge_shapes() {
        assert_eq!(save_on(""), Ok(Some("version: 1\npresets:\n  - name: A\n    hidden-types: [tag]\n    hidden-kinds: []\n".into())));
        assert_eq!(save_on("# h\npresets:\nx: 1\n"), Ok(Some("# h\nversion: 1\npresets:\n  - name: A\n    hidden-types: [tag]\n    hidden-kinds: []\nx: 1\n".into())));
        assert_eq!(save_on("version: 1\npresets: []  # c\n"), Ok(Some("version: 1\npresets:  # c\n  - name: A\n    hidden-types: [tag]\n    hidden-kinds: []\n".into())));
        assert_eq!(save_on("version: 1\npresets: [{name: B}]\n"), Err(PresetError::Unreadable));
        assert_eq!(save_on("version: 1\npresets:\n- name: B\n"), Ok(Some("version: 1\npresets:\n- name: B\n- name: A\n  hidden-types: [tag]\n  hidden-kinds: []\n".into())));
    }
}
