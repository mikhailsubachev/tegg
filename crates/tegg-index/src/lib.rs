//! Tegg index: SQLite + FTS5 in Application Support, search, quick switcher, links, conflicts.
//! Interface: docs/contracts/ms2-core.md §2. The index is a disposable cache (AR-01): everything in it is
//! derived from the files, and a missing, corrupt or older database is rebuilt. Design ported from spike
//! S4 (D-83); the FTS table holds folded text (text.rs), so search rules and SQLite see the same words.

mod text;
// Slice G1 (docs/contracts/v1-graph.md §1): the local graph's neighbourhood query.
pub mod graph;
pub use graph::{CancelFlag, EdgeKind, EdgeWay, GraphEdge, GraphError, GraphNode, GraphRequest, GraphResult, NodeId};
#[cfg(any(test, feature = "test-hooks"))]
pub use graph::PauseHook;

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::LazyLock;

use chrono::{DateTime, FixedOffset, NaiveDate, TimeZone};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tegg_format::nfc;
use tegg_vault::FileVersion;

pub use text::fold;
use text::{contains_item, contains_item_exact, contains_sequence, parse_query, tokens, within_one_edit, Item};

/// Bump on any change to what is stored; a different version means rebuild (architecture §3.1).
const SCHEMA_VERSION: i64 = 5; // 5: content hash and UTF-8 flag (5A-1, ms5-tasks §2.1); 2: matched type key, `type_raw`, `type_single` (3D, D-239); 3: link attributes (D-257);
// 4: link positions and block texts (4A, ms4-links §2.3)
/// Frontmatter keys whose values are not searchable attribute text (they have their own fields or are ids/dates).
const NOT_ATTRIBUTE_TEXT: &[&str] = &["id", "type", "title", "aliases", "tags", "created", "modified"];

#[derive(Debug, Clone)]
pub enum IndexError {
    Sqlite(String),
    Io(String),
    NotImplemented,
}

impl From<rusqlite::Error> for IndexError {
    fn from(e: rusqlite::Error) -> Self {
        IndexError::Sqlite(e.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectInfo {
    pub path: String,
    pub id: Option<String>,
    /// The matched type key (FR-TYP-13, D-239): `type_key` of a non-empty string `type`, else `page`.
    pub r#type: String,
    /// False when `type` is present but not one non-empty string (list, number, empty): shown as Page.
    pub type_single: bool,
    /// The `type` value as written (NFC, trimmed) when it is a non-empty string.
    pub type_raw: Option<String>,
    pub title: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub attributes: Value,
    pub folder: String,
    /// MS4 4B (ms4-daily §2, D-334, AP-264): a Daily Note's stored `title:` text when it differs from its `date`
    /// (the displayed title is the date). STUB: always `None` until 4B is built.
    pub stored_title: Option<String>,
}

/// Slice PIN (v1-pinned §1.3): `Index::pin_lookup`'s answer.
#[derive(Debug, Clone, Default)]
pub struct PinLookup {
    /// Requested ids (NFC) → the live object holding it.
    pub by_id: HashMap<String, ObjectInfo>,
    /// Requested paths (NFC) → the object at that path.
    pub by_path: HashMap<String, ObjectInfo>,
    /// Tag keys with an occurrence or a Tag file (tags.md R79).
    pub tags: std::collections::HashSet<String>,
    /// Matched type keys with at least one indexed object (D-121).
    pub types: std::collections::HashSet<String>,
    /// Daily Note dates of the objects found, by path.
    pub dates: HashMap<String, NaiveDate>,
}

/// 5A-1: what a task row needs beyond `ObjectInfo` (ms5-tasks §2.1).
#[derive(Debug, Clone, PartialEq)]
pub struct NoteState {
    pub version: FileVersion,
    pub utf8: bool,
    pub excerpt: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateRange {
    pub from: NaiveDate,
    pub to: NaiveDate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttrFilter {
    Equals { key: String, value: String },
    Range { key: String, from: Option<String>, to: Option<String> },
}

#[derive(Debug, Clone)]
pub struct SearchQuery {
    pub text: String,
    pub types: Vec<String>,
    pub tags: Vec<String>,
    pub created: Option<DateRange>,
    pub modified: Option<DateRange>,
    pub attributes: Vec<AttrFilter>,
    pub review: Option<String>,
    pub tz: chrono_tz::Tz,
    pub offset: usize,
    pub limit: usize,
}

impl SearchQuery {
    /// A text search with no filters, first page of 50 (D-107), in `tz`.
    pub fn text(text: &str, tz: chrono_tz::Tz) -> SearchQuery {
        SearchQuery {
            text: text.to_string(),
            types: vec![],
            tags: vec![],
            created: None,
            modified: None,
            attributes: vec![],
            review: None,
            tz,
            offset: 0,
            limit: 50,
        }
    }

    fn has_filters(&self) -> bool {
        !self.types.is_empty()
            || !self.tags.is_empty()
            || self.created.is_some()
            || self.modified.is_some()
            || !self.attributes.is_empty()
            || self.review.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MatchField {
    Title,
    /// The file stem matched, not the title (D-254); ranked as Title.
    FileName,
    Alias,
    Attribute,
    Body,
}

/// A link to a note, from `source`, in frontmatter key `attribute` (None for the body) (D-257).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backlink {
    pub source: String,
    pub attribute: Option<String>,
}

/// D-253: how an unquoted multi-word query matched; a single-word query is always `Phrase`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum QueryTier {
    Phrase,
    AllWords,
    AnyWord,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snippet {
    pub text: String,
    pub highlights: Vec<(usize, usize)>,
    pub line: usize,
    pub byte_in_line: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchResult {
    pub path: String,
    pub r#type: String,
    pub title: String,
    pub matched_in: MatchField,
    pub tier: QueryTier,
    pub typo: bool,
    pub snippet: Option<Snippet>,
    /// Some only when `matched_in` is `FileName`: the stem with the matches highlighted, `line` 0 (D-254).
    pub file_name: Option<Snippet>,
    /// Frontmatter `modified` as written when it is a valid date-time, else None; never a file date (D-103, D-1206).
    pub modified: Option<String>,
    /// Tag keys (frontmatter and inline), NFC, lower case, de-duplicated, sorted (D-1211).
    pub tags: Vec<String>,
    /// Matches in `title`, byte ranges, typo-matched words included (D-1210).
    pub title_highlights: Vec<(usize, usize)>,
    /// Some only when `matched_in` is `Alias`: the matched alias as written, `line` 0 (D-1209).
    pub alias: Option<Snippet>,
    /// Some only when `matched_in` is `Attribute` (D-1208).
    pub attribute: Option<AttributeHit>,
}

/// The first attribute matching the query, in frontmatter order (D-1208, v1-search §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttributeHit {
    /// The frontmatter key as written.
    pub key: String,
    /// The matched value as written (a list: the matched item; > 160 characters: a window around the match), `line` 0.
    pub value: Snippet,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SearchPage {
    pub results: Vec<SearchResult>,
    pub total: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum MatchTier {
    Exact,
    Prefix,
    WordPrefix,
    Substring,
    InOrder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwitcherKind {
    Object,
    Create,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwitcherItem {
    pub kind: SwitcherKind,
    pub path: Option<String>,
    pub title: String,
    pub r#type: String,
    pub folder: String,
    pub matched_alias: Option<String>,
    pub tier: Option<MatchTier>,
    /// FR-LNK-14 (D-289, D-301): set by the core when another object shares the title.
    pub duplicate: Option<DuplicateDetails>,
}

/// FR-LNK-14 AC-6 (D-289): what tells objects with the same title apart.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DuplicateDetails {
    /// As written; the UI formats it (D-160).
    pub created: Option<String>,
    /// Up to 2 set preview values, in preview order.
    pub preview: Vec<(String, Value)>,
    /// The file stem when it differs from the title.
    pub stem: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ConflictKind {
    DuplicateId,
    PossibleCopy,
    NameNormalization,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagInfo {
    pub key: String,
    /// The most frequent written form; ties by code point (D-185).
    pub spelling: String,
    /// Objects carrying the tag.
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflict {
    pub kind: ConflictKind,
    pub primary: String,
    pub others: Vec<String>,
}

fn yes() -> bool {
    true
}

// ---------------------------------------------------------------- what is stored per note

/// Persisted per note (JSON in `notes.meta`); everything else is derived when loaded.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stored {
    id: Option<String>,
    r#type: String,
    #[serde(default = "yes")]
    type_single: bool,
    #[serde(default)]
    type_raw: Option<String>,
    title: String,
    aliases: Vec<String>,
    tags: Vec<String>,
    /// Tags as written, aligned with `tags` (D-185). Older index rows lack it; the key is used then.
    #[serde(default)]
    tag_spellings: Vec<String>,
    attributes: Value,
    links: Vec<String>,
    /// The frontmatter key of each link, aligned with `links`; None for body links (D-257).
    #[serde(default)]
    link_attrs: Vec<Option<String>>,
    body_start: usize,
    body_line: usize,
    /// Per link, aligned with `links` (4A, ms4-links §2.3).
    #[serde(default)]
    link_meta: Vec<StoredLink>,
    #[serde(default)]
    blocks: Vec<tegg_format::BlockText>,
    #[serde(default)]
    frontmatter_error: bool,
    /// 5A-1 (ms5-tasks §2.1): the BLAKE3 of the bytes indexed, so a row carries the version a write is based on.
    #[serde(default)]
    hash: Option<[u8; 32]>,
    /// False when the bytes aren't UTF-8 (the editor opens it read-only, NFR-REL-03).
    #[serde(default = "yes")]
    utf8: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredLink {
    subpath: Option<String>,
    alias: Option<String>,
    embed: bool,
    markdown: bool,
    at: tegg_format::At,
    block: Option<u32>,
}

/// One link of a note with what it resolves to now (ms4-links §1).
#[derive(Debug, Clone, PartialEq)]
pub struct LinkRecord {
    /// Index into the note's extracted links (what `Segment::Link` refers to).
    pub index: usize,
    pub target: String,
    pub subpath: Option<String>,
    pub alias: Option<String>,
    pub embed: bool,
    pub markdown: bool,
    pub attribute: Option<String>,
    pub at: tegg_format::At,
    pub block: Option<u32>,
    pub resolved: tegg_format::LinkTargetInfo,
}

/// A note's links and block texts, for the backlinks panel and broken links (ms4-links §3).
#[derive(Debug, Clone, PartialEq)]
pub struct NoteLinks {
    pub path: String,
    pub title: String,
    pub r#type: String,
    pub type_raw: Option<String>,
    pub attributes: Value,
    pub frontmatter_error: bool,
    pub links: Vec<LinkRecord>,
    pub blocks: Vec<tegg_format::BlockText>,
}

/// A note read and extracted, ready to be written to the index. Built outside the index lock, so
/// indexing can read and parse in parallel while queries keep running (FR-UX-07 AC-2).
pub struct Prepared {
    path: String,
    mtime_ns: i64,
    size: i64,
    stored: Stored,
    raw: String,
    fts: [String; 4],
}

impl Prepared {
    pub fn path(&self) -> &str {
        &self.path
    }
}

/// In memory, per note: the stored fields plus folded forms for filters, ranking and the switcher.
struct Meta {
    rowid: i64,
    path: String,
    mtime_ns: i64,
    size: i64,
    s: Stored,
    folder: String,
    stem: String,
    stem_t: Vec<String>,
    title_t: Vec<String>,
    alias_t: Vec<Vec<String>>,
    attr_t: Vec<String>,
    /// Folded title, aliases and stem, whitespace collapsed (switcher).
    names_f: Vec<String>,
    created: Option<DateVal>,
    modified: Option<DateVal>,
    modified_ts: Option<i64>,
    created_ts: Option<i64>,
    /// ms4-daily §2 (D-332): a Daily Note's valid `date`; its displayed title is that date (D-320).
    daily: Option<NaiveDate>,
    /// D-334, D-342: the stored `title:` of a Daily Note when it differs from its date.
    stored_title: Option<String>,
}

#[derive(Debug, Clone, Copy)]
enum DateVal {
    Day(NaiveDate),
    Instant(DateTime<FixedOffset>),
}

impl DateVal {
    fn parse(v: &Value) -> Option<DateVal> {
        let s = v.as_str()?.trim();
        if let Ok(t) = DateTime::parse_from_rfc3339(s) {
            return Some(DateVal::Instant(t));
        }
        tegg_format::parse_date(s).map(DateVal::Day)
    }
    /// D-104: the calendar day in the machine's zone; a date-only value is that day everywhere (FR-FMT-11).
    fn day_in(&self, tz: chrono_tz::Tz) -> NaiveDate {
        match self {
            DateVal::Day(d) => *d,
            DateVal::Instant(t) => tz.from_utc_datetime(&t.naive_utc()).date_naive(),
        }
    }
    fn timestamp(&self) -> i64 {
        match self {
            DateVal::Day(d) => d.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp()).unwrap_or(0),
            DateVal::Instant(t) => t.timestamp(),
        }
    }
}

/// Every match of the query's words in `text`, as sorted byte ranges.
fn highlights_in(text: &str, positives: &[&Item]) -> Vec<(usize, usize)> {
    let ws = text::words(text);
    let mut highlights: Vec<(usize, usize)> = positives
        .iter()
        .flat_map(|it| text::match_spans(text, &ws, it))
        .collect();
    highlights.sort();
    highlights.dedup();
    highlights
}

/// D-254: the stem (NFC) with every word of the query highlighted by byte ranges.
fn file_name_snippet(stem: &str, positives: &[&Item]) -> Snippet {
    let text = nfc(stem);
    let highlights = highlights_in(&text, positives);
    let byte_in_line = highlights.first().map_or(0, |h| h.0);
    Snippet { text, highlights, line: 0, byte_in_line }
}

const WINDOW_CHARS: usize = 160;

/// D-1208: `text` with its highlights, cut to ≤ 160 characters around the first match (an `…` marks a cut end).
fn window(text: &str, highlights: Vec<(usize, usize)>) -> Snippet {
    let starts: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    if starts.len() <= WINDOW_CHARS {
        let byte_in_line = highlights.first().map_or(0, |h| h.0);
        return Snippet { text: text.to_string(), highlights, line: 0, byte_in_line };
    }
    let first = highlights.first().map_or(0, |h| h.0);
    let at = starts.iter().position(|&b| b >= first).unwrap_or(0);
    // One character each for the ellipses.
    let room = WINDOW_CHARS - 2;
    let from_c = at.saturating_sub(40).min(starts.len() - room);
    let to_c = from_c + room;
    let from_b = starts[from_c];
    let to_b = starts.get(to_c).copied().unwrap_or(text.len());
    let (pre, post) = (if from_c > 0 { "…" } else { "" }, if to_b < text.len() { "…" } else { "" });
    let shift = pre.len();
    let highlights = highlights.into_iter().filter(|h| h.0 >= from_b && h.1 <= to_b).map(|h| (h.0 - from_b + shift, h.1 - from_b + shift)).collect::<Vec<_>>();
    let byte_in_line = highlights.first().map_or(0, |h| h.0);
    Snippet { text: format!("{pre}{}{post}", &text[from_b..to_b]), highlights, line: 0, byte_in_line }
}

/// Top-level frontmatter keys in the order they are written (the attribute map itself is sorted).
fn frontmatter_keys(raw: &str) -> Vec<String> {
    let mut lines = raw.strip_prefix('\u{feff}').unwrap_or(raw).split('\n');
    if lines.next().map(|l| l.trim_end()) != Some("---") {
        return Vec::new();
    }
    let mut keys = Vec::new();
    for line in lines {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line == "---" || line == "..." {
            break;
        }
        if line.starts_with([' ', '\t', '-', '#']) || line.is_empty() {
            continue;
        }
        if let Some((k, _)) = line.split_once(':') {
            let k = k.trim().trim_matches(|c| c == '"' || c == '\'');
            keys.push(k.to_string());
        }
    }
    keys
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn split_path(path: &str) -> (String, String) {
    let (folder, name) = path.rsplit_once('/').unwrap_or(("", path));
    let stem = name.strip_suffix(".md").unwrap_or(name);
    (folder.to_string(), stem.to_string())
}

/// Scalar attribute values as text (lists flattened), for search and filters.
fn value_texts(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Number(n) => out.push(n.to_string()),
        Value::Bool(b) => out.push(b.to_string()),
        Value::Array(a) => a.iter().for_each(|x| value_texts(x, out)),
        Value::Object(m) => m.values().for_each(|x| value_texts(x, out)),
        Value::Null => {}
    }
}

fn attribute_text(attrs: &Value) -> String {
    let mut out = Vec::new();
    if let Value::Object(m) = attrs {
        for (k, v) in m {
            if !NOT_ATTRIBUTE_TEXT.contains(&k.as_str()) {
                value_texts(v, &mut out);
            }
        }
    }
    out.join(" \n ")
}

impl Meta {
    fn new(rowid: i64, path: String, mtime_ns: i64, size: i64, mut s: Stored) -> Meta {
        let (folder, stem) = split_path(&path);
        let daily = (s.r#type == "daily-note").then(|| daily_date(&s.attributes)).flatten();
        let mut stored_title = None;
        if let Some(d) = daily {
            let date = tegg_format::format_date(d);
            if nfc(s.title.trim()) != date {
                stored_title = Some(std::mem::replace(&mut s.title, date));
            } else {
                s.title = date;
            }
        }
        let mut names_f = vec![collapse(&fold(&s.title))];
        names_f.extend(s.aliases.iter().map(|a| collapse(&fold(a))));
        names_f.push(collapse(&fold(&stem)));
        if let Some(st) = &stored_title {
            names_f.push(collapse(&fold(st)));
        }
        let mut title_t = tokens(&s.title);
        if let Some(st) = &stored_title {
            title_t.extend(tokens(st));
        }
        let attr = |k: &str| s.attributes.get(k).and_then(DateVal::parse);
        let (created, modified) = (attr("created"), attr("modified"));
        Meta {
            rowid,
            folder,
            stem_t: tokens(&stem),
            stem,
            title_t,
            daily,
            stored_title,
            alias_t: s.aliases.iter().map(|a| tokens(a)).collect(),
            attr_t: tokens(&attribute_text(&s.attributes)),
            names_f,
            created_ts: created.map(|d| d.timestamp()),
            modified_ts: modified.map(|d| d.timestamp()),
            created,
            modified,
            path,
            mtime_ns,
            size,
            s,
        }
    }

    fn info(&self) -> ObjectInfo {
        ObjectInfo {
            path: self.path.clone(),
            id: self.s.id.clone(),
            r#type: self.s.r#type.clone(),
            type_single: self.s.type_single,
            type_raw: self.s.type_raw.clone(),
            title: self.s.title.clone(),
            aliases: self.s.aliases.clone(),
            tags: self.s.tags.clone(),
            attributes: self.s.attributes.clone(),
            folder: self.folder.clone(),
            stored_title: self.stored_title.clone(),
        }
    }

    fn attr_texts(&self, key: &str) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(v) = self.s.attributes.get(key) {
            value_texts(v, &mut out);
        }
        out
    }
}

/// ms4-daily §2 (D-332): the first 10 characters of `date`, trimmed, when they are a valid calendar date.
fn daily_date(attrs: &Value) -> Option<NaiveDate> {
    let mut v = Vec::new();
    value_texts(attrs.get("date")?, &mut v);
    v.iter().find_map(|d| d.trim().get(..10).and_then(tegg_format::date::parse_date))
}

/// D-319, D-335: newest `created` first (missing counts as oldest), then newest `modified`, then NFC path bytes.
/// The instants are read by `tegg_format::daily::instant`, shared with the fake core (D-365, PR #38 review).
fn daily_order(a: &Meta, b: &Meta) -> std::cmp::Ordering {
    let inst = |m: &Meta, k: &str| m.s.attributes.get(k).and_then(|v| v.as_str()).and_then(tegg_format::daily::instant).map(|i| i.nanos());
    inst(b, "created").cmp(&inst(a, "created")).then_with(|| inst(b, "modified").cmp(&inst(a, "modified"))).then_with(|| nfc(&a.path).cmp(&nfc(&b.path)))
}

/// Contract §1: `*.md` outside dot-folders and `_templates/`; never temporary files (FR-SYN-02 AC-2),
/// `.trash/` (D-102) or `.tegg/`.
pub fn is_indexable(path: &str) -> bool {
    path.ends_with(".md") && !path.split('/').any(|c| c.starts_with('.')) && path.split('/').next() != Some("_templates")
}

/// Reads and extracts one note (pure; no index access). `None` for paths the index ignores.
pub fn prepare(path: &str, bytes: &[u8], version: &FileVersion) -> Option<Prepared> {
    if !is_indexable(path) {
        return None;
    }
    let raw = String::from_utf8_lossy(bytes).into_owned();
    let (_, stem) = split_path(path);
    let ex = tegg_format::extract(bytes, &stem);
    let attributes = match ex.attributes {
        Some(Value::Object(m)) => Value::Object(m),
        _ => Value::Object(Default::default()),
    };
    let aliases = {
        let mut out = Vec::new();
        if let Some(v) = attributes.get("aliases") {
            value_texts(v, &mut out);
        }
        out.into_iter().map(|a| nfc(&a)).filter(|a| !a.trim().is_empty()).collect::<Vec<_>>()
    };
    let body_start = tegg_format::body_start(&raw).min(raw.len());
    let body_line = raw[..body_start].matches('\n').count();
    let body = &raw[body_start..];
    // FR-TYP-13 (D-239): matched by key here, not in the extractor; D-103: an untyped file is a Page; a `type` that
    // isn't one non-empty string is a Page too, flagged `type_single = false`. Files are never rewritten.
    let _ = ex.r#type;
    let (r#type, type_single, type_raw) = match attributes.get("type") {
        None => ("page".to_string(), true, None),
        Some(Value::String(t)) if !t.trim().is_empty() => (tegg_format::type_key(t), true, Some(nfc(t.trim()))),
        Some(_) => ("page".to_string(), false, None),
    };
    let fts = [text::fts_text(&ex.title), text::fts_text(&aliases.join(" \n ")), text::fts_text(&attribute_text(&attributes)), text::fts_text(body)];
    let stored = Stored {
        id: ex.id,
        r#type,
        type_single,
        type_raw,
        title: ex.title,
        aliases,
        tags: ex.tags,
        tag_spellings: ex.tag_spellings,
        attributes,
        link_attrs: ex.links.iter().map(|l| l.attribute.clone()).collect(),
        link_meta: ex
            .links
            .iter()
            .map(|l| StoredLink { subpath: l.subpath.clone(), alias: l.alias.clone(), embed: l.embed, markdown: l.markdown, at: l.at, block: l.block })
            .collect(),
        links: ex.links.into_iter().map(|l| l.target).collect(),
        body_start,
        body_line,
        blocks: ex.blocks,
        frontmatter_error: ex.frontmatter_error.is_some(),
        hash: Some(version.hash),
        utf8: std::str::from_utf8(bytes).is_ok(),
    };
    Some(Prepared { path: path.to_string(), mtime_ns: version.mtime_ns as i64, size: version.size as i64, stored, raw, fts })
}

// ---------------------------------------------------------------- the index

/// Derived link data, rebuilt lazily after a change.
struct Links {
    by_path: HashMap<String, String>,
    by_id: HashMap<String, String>,
    by_stem: HashMap<String, String>,
    /// Every path per stem key (NFC, lower case), for the same-folder rule (ms3-shell §11.1).
    stems: HashMap<String, Vec<String>>,
    /// Daily Note per `YYYY-MM-DD` (D-162): the D-319 winner.
    daily: HashMap<String, String>,
    /// Every Daily Note per date, winner first (D-319).
    daily_all: HashMap<String, Vec<String>>,
    /// Sources of date links to dates without a Daily Note (D-348).
    date_sources: HashMap<String, BTreeSet<String>>,
    backlinks: HashMap<String, BTreeSet<String>>,
    /// Per source path, what each of its links resolves to (None: not a note).
    resolved: HashMap<String, Vec<Resolved>>,
}

#[derive(Debug, Clone, PartialEq)]
enum Resolved {
    /// A link in frontmatter that can't be parsed: not read (NFR-REL-03), never a backlink or broken.
    Ignored,
    Note(String),
    Daily(String),
    DateMissing,
    Unresolved,
}

pub struct Index {
    conn: Connection,
    metas: HashMap<i64, Meta>,
    by_path: HashMap<String, i64>,
    /// Caches derived from `metas`, dropped on every change.
    vocab: RefCell<Option<Vec<String>>>,
    links: RefCell<Option<Links>>,
    /// G1 (v1-graph §1): the vault-wide graph, derived on first use.
    graph: RefCell<Option<std::sync::Arc<graph::GraphData>>>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS notes (rowid INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, mtime INTEGER NOT NULL,
  size INTEGER NOT NULL, meta TEXT NOT NULL, raw TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, aliases, attrs, body, tokenize = 'unicode61 remove_diacritics 0');
CREATE VIRTUAL TABLE IF NOT EXISTS fts_vocab USING fts5vocab(fts, 'row');
";

fn connect(db_path: &Path) -> Result<Connection, IndexError> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version != SCHEMA_VERSION {
        conn.execute_batch("DROP TABLE IF EXISTS fts_vocab; DROP TABLE IF EXISTS fts; DROP TABLE IF EXISTS notes;")?;
        conn.execute_batch(SCHEMA)?;
        conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
    }
    conn.query_row("SELECT count(*) FROM notes", [], |r| r.get::<_, i64>(0))?;
    Ok(conn)
}

impl Index {
    /// Opens the database; a missing, corrupt or other-version file is replaced by an empty one (AR-01).
    pub fn open(db_path: &Path) -> Result<Index, IndexError> {
        if let Some(dir) = db_path.parent() {
            tegg_vault::create_local_dir(dir).map_err(|e| IndexError::Io(e.to_string()))?;
        }
        let conn = match connect(db_path) {
            Ok(c) => c,
            Err(_) => {
                for suffix in ["", "-wal", "-shm"] {
                    let p = format!("{}{suffix}", db_path.to_string_lossy());
                    tegg_vault::remove_local_path(Path::new(&p)).map_err(|e| IndexError::Io(e.to_string()))?;
                }
                connect(db_path)?
            }
        };
        let mut idx = Index { conn, metas: HashMap::new(), by_path: HashMap::new(), vocab: RefCell::new(None), links: RefCell::new(None), graph: RefCell::new(None) };
        idx.load()?;
        Ok(idx)
    }

    fn load(&mut self) -> Result<(), IndexError> {
        let mut stmt = self.conn.prepare("SELECT rowid, path, mtime, size, meta FROM notes")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?))
        })?;
        let mut bad = false;
        for row in rows {
            let (rowid, path, mtime, size, meta) = row?;
            match serde_json::from_str::<Stored>(&meta) {
                Ok(s) => {
                    self.by_path.insert(path.clone(), rowid);
                    self.metas.insert(rowid, Meta::new(rowid, path, mtime, size, s));
                }
                Err(_) => bad = true,
            }
        }
        drop(stmt);
        if bad {
            // Unreadable rows: start over; the caller re-indexes from the files (AR-01).
            self.conn.execute_batch("DELETE FROM notes; DELETE FROM fts;")?;
            self.metas.clear();
            self.by_path.clear();
        }
        Ok(())
    }

    fn changed(&mut self) {
        *self.vocab.get_mut() = None;
        *self.links.get_mut() = None;
        *self.graph.get_mut() = None;
    }

    /// Indexes or re-indexes one file from its bytes. Excluded paths (contract §1) are ignored.
    pub fn upsert(&mut self, path: &str, bytes: &[u8], version: &FileVersion) -> Result<(), IndexError> {
        match prepare(path, bytes, version) {
            Some(p) => self.apply(vec![p]),
            None => Ok(()),
        }
    }

    /// Writes prepared notes in one transaction.
    pub fn apply(&mut self, batch: Vec<Prepared>) -> Result<(), IndexError> {
        if batch.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        let mut added = Vec::new();
        for p in batch {
            if let Some(old) = self.by_path.get(&p.path).copied() {
                tx.execute("DELETE FROM fts WHERE rowid = ?1", params![old])?;
                tx.execute("DELETE FROM notes WHERE rowid = ?1", params![old])?;
                self.metas.remove(&old);
            }
            let meta = serde_json::to_string(&p.stored).map_err(|e| IndexError::Io(e.to_string()))?;
            tx.execute("INSERT INTO notes (path, mtime, size, meta, raw) VALUES (?1, ?2, ?3, ?4, ?5)", params![p.path, p.mtime_ns, p.size, meta, p.raw])?;
            let rowid = tx.last_insert_rowid();
            tx.execute("INSERT INTO fts (rowid, title, aliases, attrs, body) VALUES (?1, ?2, ?3, ?4, ?5)", params![rowid, p.fts[0], p.fts[1], p.fts[2], p.fts[3]])?;
            added.push((rowid, p));
        }
        tx.commit()?;
        for (rowid, p) in added {
            self.by_path.insert(p.path.clone(), rowid);
            self.metas.insert(rowid, Meta::new(rowid, p.path, p.mtime_ns, p.size, p.stored));
        }
        self.changed();
        Ok(())
    }

    /// Removes the path, or every path under it when `path` is a folder.
    pub fn remove(&mut self, path: &str) -> Result<(), IndexError> {
        let prefix = format!("{}/", path.trim_end_matches('/'));
        let gone: Vec<(String, i64)> = self.by_path.iter().filter(|(p, _)| *p == path || p.starts_with(&prefix)).map(|(p, r)| (p.clone(), *r)).collect();
        if gone.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        for (_, r) in &gone {
            tx.execute("DELETE FROM fts WHERE rowid = ?1", params![r])?;
            tx.execute("DELETE FROM notes WHERE rowid = ?1", params![r])?;
        }
        tx.commit()?;
        for (p, r) in gone {
            self.by_path.remove(&p);
            self.metas.remove(&r);
        }
        self.changed();
        Ok(())
    }

    /// Paths and versions currently indexed (offline catch-up by mtime + size).
    pub fn versions(&self) -> Result<Vec<(String, i128, u64)>, IndexError> {
        let mut v: Vec<_> = self.metas.values().map(|m| (m.path.clone(), m.mtime_ns as i128, m.size as u64)).collect();
        v.sort();
        Ok(v)
    }

    pub fn len(&self) -> usize {
        self.metas.len()
    }

    pub fn is_empty(&self) -> bool {
        self.metas.is_empty()
    }

    fn meta(&self, path: &str) -> Option<&Meta> {
        let r = self.by_path.get(path).or_else(|| self.by_path.get(&nfc(path)))?;
        self.metas.get(r)
    }

    pub fn object(&self, path: &str) -> Option<ObjectInfo> {
        self.meta(path).map(Meta::info)
    }

    /// 5A-1 (ms5-tasks §2.1): the version the note was indexed at, whether it is UTF-8, and the start of its body as
    /// plain text (`text::excerpt`). None for a path the index doesn't hold.
    pub fn note_state(&self, path: &str) -> Option<NoteState> {
        let m = self.meta(path)?;
        let excerpt = self.raw_of(m).ok().flatten().map(|raw| text::excerpt(raw.get(m.s.body_start..).unwrap_or(""))).unwrap_or_default();
        let version = FileVersion { mtime_ns: m.mtime_ns as i128, size: m.size as u64, hash: m.s.hash.unwrap_or([0; 32]) };
        Some(NoteState { version, utf8: m.s.utf8, excerpt })
    }

    /// D-185: every tag key of indexed objects (templates and `.trash/` are never indexed).
    pub fn tags(&self) -> Vec<TagInfo> {
        let mut by_key: BTreeMap<String, (usize, BTreeMap<String, usize>)> = BTreeMap::new();
        for m in self.metas.values() {
            let mut seen = std::collections::HashSet::new();
            for (i, key) in m.s.tags.iter().enumerate() {
                let e = by_key.entry(key.clone()).or_default();
                if seen.insert(key.clone()) {
                    e.0 += 1;
                }
                let spelled = m.s.tag_spellings.get(i).cloned().unwrap_or_else(|| key.clone());
                *e.1.entry(spelled).or_default() += 1;
            }
        }
        by_key
            .into_iter()
            .map(|(key, (count, forms))| {
                // Highest count first; BTreeMap order breaks ties by code point.
                let best = forms.iter().fold(None::<(&String, usize)>, |b, (f, n)| match b {
                    Some((_, bn)) if bn >= *n => b,
                    _ => Some((f, *n)),
                });
                TagInfo { spelling: best.map(|b| b.0.clone()).unwrap_or_else(|| key.clone()), key, count }
            })
            .collect()
    }

    pub fn objects(&self) -> Vec<ObjectInfo> {
        let mut v: Vec<ObjectInfo> = self.metas.values().map(Meta::info).collect();
        v.sort_by(|a, b| a.path.cmp(&b.path));
        v
    }

    /// Slice PIN (v1-pinned §1.3, FR-HOM-02 AC-25): everything the sidebar's pins resolve against, in one read: the
    /// objects of `ids` (the primary of a duplicate-id group, as links resolve them, FR-SYN-04 AC-1) and of `paths`
    /// (NFC), every tag key with an occurrence or a Tag file (tags.md R79), the matched type keys with an object, and
    /// the dates of the Daily Notes found.
    pub fn pin_lookup(&self, ids: &[String], paths: &[String]) -> PinLookup {
        let wanted: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
        let mut groups: HashMap<String, Vec<&Meta>> = HashMap::new();
        let mut out = PinLookup::default();
        for m in self.metas.values() {
            if !wanted.is_empty() {
                if let Some(id) = &m.s.id {
                    let key = nfc(id.trim_matches(char::is_whitespace));
                    if wanted.contains(key.as_str()) {
                        groups.entry(key).or_default().push(m);
                    }
                }
            }
            out.types.insert(m.s.r#type.clone());
            out.tags.extend(m.s.tags.iter().cloned());
            if m.s.r#type == "tag" && m.s.type_single {
                let title = m.s.attributes.get("title").and_then(Value::as_str).map(|t| t.trim()).filter(|t| !t.is_empty());
                out.tags.insert(tegg_format::tag_key(title.unwrap_or(&m.stem)));
            }
        }
        let mut found: Vec<&Meta> = Vec::new();
        for (id, group) in groups {
            let primary = self.primary(&group);
            if let Some(m) = group.iter().find(|m| m.path == primary) {
                out.by_id.insert(id, m.info());
                found.push(m);
            }
        }
        for p in paths {
            if let Some(m) = self.meta(p) {
                out.by_path.insert(nfc(p), m.info());
                found.push(m);
            }
        }
        for m in found {
            if let Some(d) = m.daily {
                out.dates.insert(m.path.clone(), d);
            }
        }
        out
    }

    /// D-784 (ms4-tags §1.6): the number of indexed objects with an occurrence of any tag, without copying them
    /// (All tags' `<m> tagged objects`, D-721; one read instead of one `tag_objects` per tag).
    pub fn tagged_objects(&self) -> usize {
        self.metas.values().filter(|m| !m.s.tags.is_empty()).count()
    }

    // ------------------------------------------------------------ search (FR-SRC-01…04)

    fn fts_rowids(&self, query: &str) -> Result<Vec<(i64, f64)>, IndexError> {
        let mut stmt = self.conn.prepare_cached("SELECT rowid, bm25(fts) FROM fts WHERE fts MATCH ?1")?;
        let rows = stmt.query_map(params![query], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    fn vocab(&self) -> Result<Vec<String>, IndexError> {
        if let Some(v) = self.vocab.borrow().as_ref() {
            return Ok(v.clone());
        }
        let mut stmt = self.conn.prepare_cached("SELECT term FROM fts_vocab")?;
        let terms = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        *self.vocab.borrow_mut() = Some(terms.clone());
        Ok(terms)
    }

    pub fn search(&self, q: &SearchQuery) -> Result<SearchPage, IndexError> {
        let mut items = parse_query(&q.text);
        // D-101: one-edit alternatives from the index vocabulary, for single words of ≥ 5 letters.
        if items.iter().any(Item::typo_eligible) {
            let vocab = self.vocab()?;
            for it in items.iter_mut().filter(|i| i.typo_eligible()) {
                let w = &it.tokens[0];
                let n = w.chars().count();
                it.alternatives = vocab
                    .iter()
                    .filter(|t| t.len().abs_diff(w.len()) <= 2 && t.chars().count().abs_diff(n) <= 1 && *t != w && within_one_edit(t, w))
                    .cloned()
                    .collect();
            }
        }
        let positives: Vec<&Item> = items.iter().filter(|i| !i.negative).collect();
        if positives.is_empty() && !q.has_filters() {
            return Ok(SearchPage::default());
        }
        let quote = |toks: &[String]| format!("\"{}\"", toks.join(" ").replace('"', "\"\""));
        // D-253: unquoted words are ranked in tiers; quoted phrases must all match.
        let words: Vec<&Item> = positives.iter().copied().filter(|i| !i.quoted).collect();
        let phrases: Vec<&Item> = positives.iter().copied().filter(|i| i.quoted).collect();

        // Per item: rows matching it exactly; rows matching it exactly or by the D-1342 prefix; rows matching it at all
        // (exactly, by the prefix, by a typo, D-101, or in the file stem, D-254).
        let mut exact_of: Vec<BTreeSet<i64>> = Vec::new();
        let mut pre_of: Vec<BTreeSet<i64>> = Vec::new();
        let mut full_of: Vec<BTreeSet<i64>> = Vec::new();
        for it in &positives {
            let mut e: BTreeSet<i64> = self.fts_rowids(&quote(&it.tokens))?.into_iter().map(|(r, _)| r).collect();
            // FTS5: a `*` after a string marks its last token as a prefix (a range scan of the term index).
            let mut p: BTreeSet<i64> = if it.prefix { self.fts_rowids(&format!("{}*", quote(&it.tokens)))?.into_iter().map(|(r, _)| r).collect() } else { BTreeSet::new() };
            let mut f = BTreeSet::new();
            for chunk in it.alternatives.chunks(200) {
                let alt = chunk.iter().map(|a| quote(std::slice::from_ref(a))).collect::<Vec<_>>().join(" OR ");
                f.extend(self.fts_rowids(&alt)?.into_iter().map(|(r, _)| r));
            }
            let bare = Item { alternatives: Vec::new(), ..(*it).clone() };
            for m in self.metas.values() {
                if contains_item_exact(&m.stem_t, it) {
                    e.insert(m.rowid);
                } else if it.prefix && contains_item(&m.stem_t, &bare) {
                    p.insert(m.rowid);
                } else if it.tokens.len() == 1 && m.stem_t.iter().any(|t| it.alternatives.contains(t)) {
                    f.insert(m.rowid);
                }
            }
            p.extend(e.iter().copied());
            f.extend(p.iter().copied());
            exact_of.push(e);
            pre_of.push(p);
            full_of.push(f);
        }
        let idx = |it: &Item| positives.iter().position(|p| std::ptr::eq(*p, it)).unwrap_or(0);
        let mut full: BTreeSet<i64> = if positives.is_empty() {
            self.metas.keys().copied().collect()
        } else if words.is_empty() {
            let mut all: Option<BTreeSet<i64>> = None;
            for p in &phrases {
                let f = &full_of[idx(p)];
                all = Some(match all {
                    Some(x) => x.intersection(f).copied().collect(),
                    None => f.clone(),
                });
            }
            all.unwrap_or_default()
        } else {
            let mut any: BTreeSet<i64> = words.iter().flat_map(|w| full_of[idx(w)].iter().copied()).collect();
            for p in &phrases {
                any = any.intersection(&full_of[idx(p)]).copied().collect();
            }
            any
        };
        for it in items.iter().filter(|i| i.negative) {
            for (r, _) in self.fts_rowids(&quote(&it.tokens))? {
                full.remove(&r);
            }
        }
        // bm25 of the words (the prefix item as a prefix), for ranking within a group (lower is better).
        let mut score: HashMap<i64, f64> = HashMap::new();
        if !positives.is_empty() {
            let any = positives.iter().map(|i| if i.prefix { format!("{}*", quote(&i.tokens)) } else { quote(&i.tokens) }).collect::<Vec<_>>().join(" OR ");
            score = self.fts_rowids(&any)?.into_iter().collect();
        }
        // D-1341: the query words of the groups, one item per token (the unquoted positive words; a query of only
        // phrases uses the phrases' words). A word's D-101 alternatives and D-1342 prefix go with it.
        let group_words: Vec<Item> = (if words.is_empty() { &phrases } else { &words })
            .iter()
            .flat_map(|it| {
                let n = it.tokens.len();
                it.tokens.iter().enumerate().map(move |(k, t)| Item {
                    tokens: vec![t.clone()],
                    negative: false,
                    quoted: false,
                    alternatives: if n == 1 { it.alternatives.clone() } else { Vec::new() },
                    prefix: it.prefix && k == n - 1,
                })
            })
            .collect();
        let group_refs: Vec<&Item> = group_words.iter().collect();
        let holds_all = |toks: &[String], loose: bool| !group_words.is_empty() && group_words.iter().all(|w| if loose { contains_item(toks, w) } else { contains_item_exact(toks, w) });
        // Step a: the folded word sequence equals the query's; b: the words in a row; c: otherwise; None: not every word.
        let step_of = |toks: &[String]| -> Option<u8> {
            if !holds_all(toks, true) {
                None
            } else if contains_sequence(toks, &group_refs) {
                Some(if toks.len() == group_words.len() { 0 } else { 1 })
            } else {
                Some(2)
            }
        };

        // Sort key: (group, step or tier, exact before typo-or-prefix, field rank); then bm25, then path. The last
        // field marks a row whose tier waits for the body check (`Phrase` until then; resolved below).
        type Hit<'a> = (&'a Meta, (u8, u8, bool, MatchField), bool, QueryTier, MatchField, bool);
        let mut hits: Vec<Hit> = Vec::new();
        for m in full.iter().filter_map(|r| self.metas.get(r)).filter(|m| self.passes(m, q)) {
            let matched: Vec<&Item> = positives.iter().copied().filter(|it| full_of[idx(it)].contains(&m.rowid)).collect();
            let typo = matched.iter().any(|it| !pre_of[idx(it)].contains(&m.rowid));
            let inexact = matched.iter().any(|it| !exact_of[idx(it)].contains(&m.rowid));
            let all_words = words.iter().all(|w| full_of[idx(w)].contains(&m.rowid));
            // NFR-PERF-04: the body's word sequence is read only for rows that can reach the page (below).
            let mut pending = false;
            let tier = if words.len() <= 1 {
                QueryTier::Phrase
            } else if !all_words {
                QueryTier::AnyWord
            } else if [&m.title_t, &m.stem_t, &m.attr_t].iter().any(|t| contains_sequence(t, &words)) || m.alias_t.iter().any(|a| contains_sequence(a, &words)) {
                QueryTier::Phrase
            } else {
                pending = true;
                QueryTier::Phrase
            };
            let any = |toks: &[String]| matched.iter().any(|i| contains_item(toks, i));
            let field = if positives.is_empty() || any(&m.title_t) {
                MatchField::Title
            } else if any(&m.stem_t) {
                MatchField::FileName
            } else if m.alias_t.iter().any(|a| any(a)) {
                MatchField::Alias
            } else if any(&m.attr_t) {
                MatchField::Attribute
            } else {
                MatchField::Body
            };
            // D-253: title/file name, alias, attribute, body (D-107).
            let field_rank = if field == MatchField::FileName { MatchField::Title } else { field };
            let (title_step, stem_step) = if positives.is_empty() { (None, None) } else { (step_of(&m.title_t), step_of(&m.stem_t)) };
            let alias_step = if title_step.is_some() || stem_step.is_some() || positives.is_empty() { None } else { m.alias_t.iter().filter_map(|a| step_of(a)).min() };
            let (key, field) = if let Some(step) = title_step.into_iter().chain(stem_step).min() {
                let exact = holds_all(&m.title_t, false) || holds_all(&m.stem_t, false);
                ((1, step, !exact, MatchField::Title), if title_step.is_some() { MatchField::Title } else { MatchField::FileName })
            } else if let Some(step) = alias_step {
                let exact = m.alias_t.iter().any(|a| holds_all(a, false));
                ((2, step, !exact, MatchField::Title), MatchField::Alias)
            } else {
                ((3, tier as u8, inexact, field_rank), field)
            };
            hits.push((m, key, typo, tier, field, pending));
        }
        let by_rank = |a: &Hit, b: &Hit| {
            let sa = score.get(&a.0.rowid).copied().unwrap_or(0.0);
            let sb = score.get(&b.0.rowid).copied().unwrap_or(0.0);
            a.1.cmp(&b.1).then(sa.total_cmp(&sb)).then_with(|| a.0.path.cmp(&b.0.path))
        };
        if positives.is_empty() {
            // D-1205: filters only: the newest `modified` instant first, missing or invalid last, ties by path.
            let at = |m: &Meta| match m.modified {
                Some(DateVal::Instant(t)) => Some(t.timestamp_nanos_opt().unwrap_or(t.timestamp().saturating_mul(1_000_000_000))),
                _ => None,
            };
            hits.sort_by(|a, b| at(b.0).cmp(&at(a.0)).then_with(|| a.0.path.cmp(&b.0.path)));
        } else {
            // D-1341: title or file name first, then alias, then the rest in D-253's order (tier, exact before typo,
            // field); inside each: exact before typo-or-prefix (D-1342), then bm25, then path.
            hits.sort_by(by_rank);
        }
        let total = hits.len();
        let limit = if q.limit == 0 { 50 } else { q.limit };
        // A pending row is `Phrase` if its body holds the words in a row, else `AllWords` (a later place in group 3;
        // groups 1 and 2 don't sort by tier). Walking the order with pending rows as `Phrase`, a row found `AllWords`
        // only moves back, so once the rows that keep their place fill the page, the rest can't enter it.
        let need = q.offset.saturating_add(limit);
        let (mut kept, mut moved) = (0usize, false);
        for h in hits.iter_mut() {
            if kept >= need {
                break;
            }
            if h.5 {
                h.5 = false;
                if !self.body_tokens(h.0)?.is_some_and(|b| contains_sequence(&b, &words)) {
                    h.3 = QueryTier::AllWords;
                    if h.1 .0 == 3 {
                        h.1 .1 = QueryTier::AllWords as u8;
                        moved = true;
                        continue;
                    }
                }
            }
            kept += 1;
        }
        if moved {
            hits.sort_by(by_rank);
        }
        let mut results = Vec::new();
        for (m, _, typo, tier, field, _) in hits.into_iter().skip(q.offset).take(limit) {
            let mut snippet = if positives.is_empty() { None } else { self.snippet_for(m, &items)? };
            // D-1207: without a body match, the body's lead without highlights.
            if snippet.is_none() {
                snippet = self.lead_for(m)?;
            }
            let file_name = (field == MatchField::FileName).then(|| file_name_snippet(&m.stem, &positives));
            let alias = if field == MatchField::Alias {
                // D-1341: a group-2 result shows the alias holding every word.
                let whole = m.s.aliases.iter().map(|a| nfc(a)).find(|a| step_of(&tokens(a)).is_some());
                whole.into_iter().chain(m.s.aliases.iter().map(|a| nfc(a))).find_map(|a| {
                    let h = highlights_in(&a, &positives);
                    (!h.is_empty()).then(|| window(&a, h))
                })
            } else {
                None
            };
            let attribute = if field == MatchField::Attribute { self.attribute_hit(m, &positives)? } else { None };
            let modified = match (m.modified, m.s.attributes.get("modified").and_then(|v| v.as_str())) {
                (Some(DateVal::Instant(_)), Some(v)) => Some(v.trim().to_string()),
                _ => None,
            };
            let mut tags: Vec<String> = m.s.tags.iter().map(|t| nfc(t).to_lowercase()).collect();
            tags.sort();
            tags.dedup();
            let title_highlights = if positives.is_empty() { Vec::new() } else { highlights_in(&m.s.title, &positives) };
            results.push(SearchResult {
                path: m.path.clone(),
                r#type: m.s.r#type.clone(),
                title: m.s.title.clone(),
                matched_in: field,
                tier,
                typo,
                snippet,
                file_name,
                modified,
                tags,
                title_highlights,
                alias,
                attribute,
            });
        }
        Ok(SearchPage { results, total })
    }

    fn raw_of(&self, m: &Meta) -> Result<Option<String>, IndexError> {
        Ok(self.conn.prepare_cached("SELECT raw FROM notes WHERE rowid = ?1")?.query_row(params![m.rowid], |r| r.get(0)).optional()?)
    }

    /// The body's folded tokens: the FTS `body` column, which holds exactly `fts_text(body)` (the tokens joined by
    /// spaces; a token never holds whitespace). Reading it skips folding the raw body again (NFR-PERF-04, D-1341).
    fn body_tokens(&self, m: &Meta) -> Result<Option<Vec<String>>, IndexError> {
        let body: Option<String> = self.conn.prepare_cached("SELECT body FROM fts WHERE rowid = ?1")?.query_row(params![m.rowid], |r| r.get(0)).optional()?;
        Ok(body.map(|b| b.split(' ').filter(|t| !t.is_empty()).map(str::to_string).collect()))
    }

    fn lead_for(&self, m: &Meta) -> Result<Option<Snippet>, IndexError> {
        let Some(raw) = self.raw_of(m)? else { return Ok(None) };
        let body = raw.get(m.s.body_start..).unwrap_or("");
        Ok(text::lead(body).map(|s| Snippet { text: s.text, highlights: s.highlights, line: m.s.body_line + s.body_line + 1, byte_in_line: s.byte_in_line }))
    }

    /// D-1208: the first non-reserved attribute value (a list item on its own) matching the query, in frontmatter order.
    fn attribute_hit(&self, m: &Meta, positives: &[&Item]) -> Result<Option<AttributeHit>, IndexError> {
        let Value::Object(attrs) = &m.s.attributes else { return Ok(None) };
        let mut keys = self.raw_of(m)?.map(|raw| frontmatter_keys(&raw)).unwrap_or_default();
        keys.retain(|k| attrs.contains_key(k));
        keys.extend(attrs.keys().filter(|k| !keys.contains(k)).cloned().collect::<Vec<_>>());
        for key in keys.iter().filter(|k| !NOT_ATTRIBUTE_TEXT.contains(&k.as_str())) {
            let mut values = Vec::new();
            value_texts(&attrs[key.as_str()], &mut values);
            for v in values {
                let v = nfc(&v);
                let h = highlights_in(&v, positives);
                if !h.is_empty() {
                    return Ok(Some(AttributeHit { key: key.clone(), value: window(&v, h) }));
                }
            }
        }
        Ok(None)
    }

    fn snippet_for(&self, m: &Meta, items: &[Item]) -> Result<Option<Snippet>, IndexError> {
        let Some(raw) = self.raw_of(m)? else { return Ok(None) };
        let body = raw.get(m.s.body_start..).unwrap_or("");
        Ok(text::snippet(body, items).map(|s| Snippet { text: s.text, highlights: s.highlights, line: m.s.body_line + s.body_line + 1, byte_in_line: s.byte_in_line }))
    }

    /// FR-SRC-02 filters, combined with AND (D-103, D-104, D-109).
    fn passes(&self, m: &Meta, q: &SearchQuery) -> bool {
        if !q.types.is_empty() && !q.types.iter().any(|t| tegg_format::type_key(t) == m.s.r#type) {
            return false;
        }
        if !q.tags.iter().all(|t| m.s.tags.contains(&nfc(t).to_lowercase())) {
            return false;
        }
        let in_range = |d: &Option<DateVal>, r: &Option<DateRange>| match r {
            None => true,
            Some(r) => d.map(|d| d.day_in(q.tz)).is_some_and(|day| day >= r.from && day <= r.to),
        };
        if !in_range(&m.created, &q.created) || !in_range(&m.modified, &q.modified) {
            return false;
        }
        if let Some(review) = &q.review {
            if !m.attr_texts("review").iter().any(|v| fold(v) == fold(review)) {
                return false;
            }
        }
        q.attributes.iter().all(|f| match f {
            AttrFilter::Equals { key, value } => m.attr_texts(key).iter().any(|v| fold(v.trim()) == fold(value.trim())),
            AttrFilter::Range { key, from, to } => m.attr_texts(key).iter().any(|v| in_value_range(v, from.as_deref(), to.as_deref(), q.tz)),
        })
    }

    // ------------------------------------------------------------ switcher (FR-NAV-01, D-105)

    /// Object items only; `tegg-core` appends the Create item (D-106), which needs the vault's default type.
    pub fn switcher(&self, q: &str, recency: &dyn Fn(&str) -> Option<i64>, limit: usize) -> Vec<SwitcherItem> {
        let qf = collapse(&fold(q));
        let compact: Vec<char> = qf.chars().filter(|c| !c.is_whitespace()).collect();
        let mut hits: Vec<(Option<MatchTier>, Option<i64>, &Meta, Option<String>)> = Vec::new();
        for m in self.metas.values() {
            if qf.is_empty() {
                hits.push((None, recency(&m.path), m, None));
                continue;
            }
            let mut best: Option<(MatchTier, usize)> = None;
            for (i, name) in m.names_f.iter().enumerate() {
                if let Some(t) = tier(name, &qf, &compact) {
                    if best.is_none_or(|(b, _)| t < b) {
                        best = Some((t, i));
                    }
                }
            }
            if let Some((t, i)) = best {
                let alias = (i >= 1 && i <= m.s.aliases.len()).then(|| m.s.aliases[i - 1].clone());
                hits.push((Some(t), recency(&m.path), m, alias));
            }
        }
        hits.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| match (a.1, b.1) {
                    (Some(x), Some(y)) => y.cmp(&x),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => b.2.modified_ts.cmp(&a.2.modified_ts),
                })
                .then_with(|| a.2.names_f[0].cmp(&b.2.names_f[0]))
                .then_with(|| a.2.path.cmp(&b.2.path))
        });
        hits.into_iter()
            .take(limit)
            .map(|(t, _, m, alias)| SwitcherItem {
                kind: SwitcherKind::Object,
                path: Some(m.path.clone()),
                title: m.s.title.clone(),
                r#type: m.s.r#type.clone(),
                folder: m.folder.clone(),
                matched_alias: alias,
                tier: t,
                duplicate: None,
            })
            .collect()
    }

    // ------------------------------------------------------------ links (FR-LNK-14)

    fn with_links<R>(&self, f: impl FnOnce(&Links) -> R) -> R {
        if self.links.borrow().is_none() {
            let l = self.build_links();
            *self.links.borrow_mut() = Some(l);
        }
        f(self.links.borrow().as_ref().expect("just built"))
    }

    fn build_links(&self) -> Links {
        let mut by_path = HashMap::new();
        let mut by_stem: HashMap<String, String> = HashMap::new();
        let mut paths: Vec<&Meta> = self.metas.values().collect();
        // Shorter paths win a shared stem, then alphabetical: deterministic.
        paths.sort_by(|a, b| (a.path.chars().count(), &a.path).cmp(&(b.path.chars().count(), &b.path)));
        for m in &paths {
            let p = nfc(&m.path).to_lowercase();
            by_path.insert(p.strip_suffix(".md").unwrap_or(&p).to_string(), m.path.clone());
            by_stem.entry(nfc(&m.stem).to_lowercase()).or_insert_with(|| m.path.clone());
        }
        let mut by_id = HashMap::new();
        for (id, group) in self.id_groups() {
            by_id.insert(id, self.primary(&group).to_string());
        }
        let mut stems: HashMap<String, Vec<String>> = HashMap::new();
        for m in &paths {
            stems.entry(nfc(&m.stem).to_lowercase()).or_default().push(m.path.clone());
        }
        let mut dailies: Vec<&Meta> = self.metas.values().filter(|m| m.daily.is_some()).collect();
        dailies.sort_by(|a, b| daily_order(a, b));
        let mut daily_all: HashMap<String, Vec<String>> = HashMap::new();
        for m in dailies {
            daily_all.entry(tegg_format::format_date(m.daily.expect("filtered"))).or_default().push(m.path.clone());
        }
        let daily: HashMap<String, String> = daily_all.iter().map(|(d, v)| (d.clone(), v[0].clone())).collect();
        let mut l = Links { by_path, by_id, by_stem, stems, daily, daily_all, date_sources: HashMap::new(), backlinks: HashMap::new(), resolved: HashMap::new() };
        let mut date_sources: HashMap<String, BTreeSet<String>> = HashMap::new();
        let mut back: HashMap<String, BTreeSet<String>> = HashMap::new();
        let mut resolved = HashMap::new();
        for m in self.metas.values() {
            let r: Vec<Resolved> = m
                .s
                .links
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    if m.s.frontmatter_error && m.s.link_attrs.get(i).is_some_and(|a| a.is_some()) {
                        Resolved::Ignored
                    } else {
                        resolve_from(&l, &m.path, t)
                    }
                })
                .collect();
            for (i, x) in r.iter().enumerate() {
                if let Resolved::Note(p) | Resolved::Daily(p) = x {
                    if *p != m.path {
                        back.entry(p.clone()).or_default().insert(m.path.clone());
                    }
                }
                if *x == Resolved::DateMissing {
                    if let Some(d) = date_key(&m.s.links[i]) {
                        date_sources.entry(d).or_default().insert(m.path.clone());
                    }
                }
            }
            resolved.insert(m.path.clone(), r);
        }
        l.backlinks = back;
        l.resolved = resolved;
        l.date_sources = date_sources;
        l
    }

    /// ms4-links §1, §3: a note's links with their current resolution, and its block texts.
    pub fn note_links(&self, path: &str) -> Option<NoteLinks> {
        let m = self.meta(path)?;
        self.with_links(|l| Some(self.note_links_of(l, m)))
    }

    /// D-291: every indexed stem (NFC, lower case), vault-wide; templates and `.trash/` are never indexed.
    pub fn stem_keys(&self) -> std::collections::HashSet<String> {
        self.metas.values().map(|m| nfc(&m.stem).to_lowercase()).collect()
    }

    /// ms6-trash-media §3.2 (FR-ATT-07): every note with a link whose last path segment is `file_name` (NFC,
    /// case-insensitive; alias and heading removed), with those link targets as written.
    pub fn sources_linking_name(&self, file_name: &str) -> Vec<(String, Vec<String>)> {
        let want = nfc(file_name).to_lowercase();
        let base = |t: &str| {
            let t = t.split('|').next().unwrap_or(t).split('#').next().unwrap_or(t).trim();
            nfc(t.rsplit('/').next().unwrap_or(t)).to_lowercase()
        };
        let mut v: Vec<(String, Vec<String>)> = self
            .metas
            .values()
            .filter_map(|m| {
                let hits: Vec<String> = m.s.links.iter().filter(|t| base(t) == want).cloned().collect();
                (!hits.is_empty()).then(|| (m.path.clone(), hits))
            })
            .collect();
        v.sort();
        v
    }

    /// ms4-links §3: every note that has a link to a note that doesn't resolve (dates and attachments excluded).
    pub fn broken_sources(&self) -> Vec<NoteLinks> {
        self.with_links(|l| {
            let mut v: Vec<NoteLinks> = self
                .metas
                .values()
                .filter(|m| {
                    l.resolved.get(&m.path).is_some_and(|r| r.iter().zip(&m.s.links).any(|(x, t)| *x == Resolved::Unresolved && is_note_target(t)))
                })
                .map(|m| self.note_links_of(l, m))
                .collect();
            v.sort_by(|a, b| a.path.cmp(&b.path));
            v
        })
    }

    fn note_links_of(&self, l: &Links, m: &Meta) -> NoteLinks {
        let empty = Vec::new();
        let res = l.resolved.get(&m.path).unwrap_or(&empty);
        let links = m
            .s
            .links
            .iter()
            .enumerate()
            .map(|(i, t)| {
                let meta = m.s.link_meta.get(i);
                let info = |kind, p: Option<&String>| {
                    let o = p.and_then(|p| self.meta(p));
                    tegg_format::LinkTargetInfo {
                        target: t.clone(),
                        kind,
                        path: p.cloned(),
                        title: o.map(|o| o.s.title.clone()),
                        r#type: o.map(|o| o.s.r#type.clone()),
                    }
                };
                if matches!(res.get(i), Some(Resolved::Ignored)) {
                    return None;
                }
                let resolved = match res.get(i) {
                    Some(Resolved::Note(p)) => info(tegg_format::TargetKind::Note, Some(p)),
                    Some(Resolved::Daily(p)) => info(tegg_format::TargetKind::Daily, Some(p)),
                    Some(Resolved::DateMissing) => info(tegg_format::TargetKind::DateMissing, None),
                    _ => info(tegg_format::TargetKind::Unresolved, None),
                };
                Some(LinkRecord {
                    index: i,
                    target: t.clone(),
                    subpath: meta.and_then(|x| x.subpath.clone()),
                    alias: meta.and_then(|x| x.alias.clone()),
                    embed: meta.is_some_and(|x| x.embed),
                    markdown: meta.is_some_and(|x| x.markdown),
                    attribute: m.s.link_attrs.get(i).cloned().flatten(),
                    at: meta.map(|x| x.at).unwrap_or_default(),
                    block: meta.and_then(|x| x.block),
                    resolved,
                })
            })
            .flatten()
            .collect();
        NoteLinks {
            path: m.path.clone(),
            title: m.s.title.clone(),
            r#type: m.s.r#type.clone(),
            type_raw: m.s.type_raw.clone(),
            attributes: m.s.attributes.clone(),
            frontmatter_error: m.s.frontmatter_error,
            links,
            blocks: m.s.blocks.clone(),
        }
    }

    /// FR-LNK-14: by vault path (with or without `.md`), by `id`, or by file name; never by title alone.
    pub fn resolve_link(&self, target: &str) -> Option<String> {
        self.with_links(|l| resolve(l, target))
    }

    /// Sorted paths of notes whose links resolve to `path` (embeds included).
    pub fn backlinks(&self, path: &str) -> Vec<String> {
        let path = self.meta(path).map(|m| m.path.clone()).unwrap_or_else(|| path.to_string());
        self.with_links(|l| l.backlinks.get(&path).map(|s| s.iter().cloned().collect()).unwrap_or_default())
    }

    /// FR-LNK-02 (D-257): each note linking to `path`, once per link, with the frontmatter key the link is in
    /// (None for the body), sorted by source path.
    pub fn backlinks_detailed(&self, path: &str) -> Vec<Backlink> {
        let path = self.meta(path).map(|m| m.path.clone()).unwrap_or_else(|| path.to_string());
        let mut out: Vec<Backlink> = self.with_links(|l| {
            let mut v = Vec::new();
            for m in self.metas.values().filter(|m| m.path != path) {
                let res = l.resolved.get(&m.path);
                for (i, _) in m.s.links.iter().enumerate() {
                    let hit = matches!(res.and_then(|r| r.get(i)), Some(Resolved::Note(p) | Resolved::Daily(p)) if *p == path);
                    if hit {
                        v.push(Backlink { source: m.path.clone(), attribute: m.s.link_attrs.get(i).cloned().flatten() });
                    }
                }
            }
            v
        });
        out.sort_by(|a, b| (&a.source, &a.attribute).cmp(&(&b.source, &b.attribute)));
        out
    }

    /// MS4 4B (ms4-daily §2, D-319): the other Daily Notes of `date` (the losers), in winner order. STUB: empty until
    /// 4B is built.
    pub fn daily_duplicates(&self, date: NaiveDate) -> Vec<String> {
        let d = tegg_format::format_date(date);
        self.with_links(|l| l.daily_all.get(&d).map(|v| v[1..].to_vec()).unwrap_or_default())
    }

    /// FR-DLY-03 AC-3: the dates of one month that have a Daily Note, ascending.
    pub fn daily_dates(&self, year: i32, month: u32) -> Vec<NaiveDate> {
        use chrono::Datelike;
        let mut v: Vec<NaiveDate> = self.with_links(|l| l.daily.keys().filter_map(|d| tegg_format::date::parse_date(d)).filter(|d| d.year() == year && d.month() == month).collect());
        v.sort();
        v
    }

    /// D-348: sources whose date links point at `date` while it has no Daily Note, sorted.
    pub fn date_link_sources(&self, date: NaiveDate) -> Vec<String> {
        let d = tegg_format::format_date(date);
        self.with_links(|l| l.date_sources.get(&d).map(|s| s.iter().cloned().collect()).unwrap_or_default())
    }

    /// ms4-daily §2: a Daily Note's valid date, if the note is one.
    pub fn daily_date_of(&self, path: &str) -> Option<NaiveDate> {
        self.meta(path).and_then(|m| m.daily)
    }

    /// FR-FMT-09 AC-2: daily notes are recognized by their `date` attribute, whatever the file name.
    /// D-319: the winner of `date`.
    pub fn daily_note(&self, date: NaiveDate) -> Option<String> {
        let want = tegg_format::format_date(date);
        self.with_links(|l| l.daily.get(&want).cloned())
    }

    // ------------------------------------------------------------ conflicts (FR-SYN-04, -05, FR-FMT-12)

    fn id_groups(&self) -> BTreeMap<String, Vec<&Meta>> {
        let mut g: BTreeMap<String, Vec<&Meta>> = BTreeMap::new();
        for m in self.metas.values() {
            if let Some(id) = &m.s.id {
                g.entry(id.clone()).or_default().push(m);
            }
        }
        g
    }

    /// FR-SYN-04 AC-1: the file named like the title; else the older `created`; else the shorter path.
    fn primary<'a>(&self, group: &[&'a Meta]) -> &'a str {
        let named: Vec<&Meta> = group.iter().copied().filter(|m| nfc(&m.stem).to_lowercase() == nfc(&m.s.title).to_lowercase()).collect();
        let pool = if named.is_empty() { group.to_vec() } else { named };
        pool.into_iter()
            .min_by(|a, b| {
                let (ca, cb) = (a.created_ts.unwrap_or(i64::MAX), b.created_ts.unwrap_or(i64::MAX));
                ca.cmp(&cb).then(a.path.chars().count().cmp(&b.path.chars().count())).then(a.path.cmp(&b.path))
            })
            .map(|m| m.path.as_str())
            .unwrap_or("")
    }

    pub fn conflicts(&self) -> Vec<Conflict> {
        let mut out = Vec::new();
        for (_, group) in self.id_groups() {
            if group.len() > 1 {
                let primary = self.primary(&group).to_string();
                let mut others: Vec<String> = group.iter().map(|m| m.path.clone()).filter(|p| *p != primary).collect();
                others.sort();
                out.push(Conflict { kind: ConflictKind::DuplicateId, primary, others });
            }
        }
        // FR-SYN-04 AC-2, D-111: a sync client's copy name and ≥ 90 % equal lines, with a different (or no) id.
        let by_lower: HashMap<String, &Meta> = self.metas.values().map(|m| (nfc(&m.path).to_lowercase(), m)).collect();
        let mut copies: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for m in self.metas.values() {
            for base in copy_bases(&m.stem) {
                let base_path = if m.folder.is_empty() { format!("{base}.md") } else { format!("{}/{base}.md", m.folder) };
                let Some(b) = by_lower.get(&nfc(&base_path).to_lowercase()) else { continue };
                if b.rowid == m.rowid || (m.s.id.is_some() && m.s.id == b.s.id) {
                    continue;
                }
                if self.similar(b.rowid, m.rowid) {
                    copies.entry(b.path.clone()).or_default().push(m.path.clone());
                    break;
                }
            }
        }
        for (primary, mut others) in copies {
            others.sort();
            out.push(Conflict { kind: ConflictKind::PossibleCopy, primary, others });
        }
        // FR-FMT-12 AC-3: two paths that are the same name under NFC.
        let mut by_nfc: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for m in self.metas.values() {
            by_nfc.entry(nfc(&m.path)).or_default().push(m.path.clone());
        }
        for (canonical, mut paths) in by_nfc {
            if paths.len() > 1 {
                paths.sort();
                let primary = if paths.contains(&canonical) { canonical } else { paths[0].clone() };
                let others = paths.into_iter().filter(|p| *p != primary).collect();
                out.push(Conflict { kind: ConflictKind::NameNormalization, primary, others });
            }
        }
        out.sort_by(|a, b| (a.kind, &a.primary).cmp(&(b.kind, &b.primary)));
        out
    }

    fn raw(&self, rowid: i64) -> Option<String> {
        self.conn.query_row("SELECT raw FROM notes WHERE rowid = ?1", params![rowid], |r| r.get(0)).optional().ok().flatten()
    }

    /// D-111: at least 90 % equal lines after normalizing line endings.
    fn similar(&self, a: i64, b: i64) -> bool {
        let (Some(a), Some(b)) = (self.raw(a), self.raw(b)) else { return false };
        let lines = |s: &str| -> Vec<String> {
            let s = s.replace("\r\n", "\n");
            let s = s.strip_suffix('\n').unwrap_or(&s).to_string();
            s.split('\n').map(str::to_string).collect()
        };
        let (la, lb) = (lines(&a), lines(&b));
        let mut counts: HashMap<&str, i64> = HashMap::new();
        for l in &la {
            *counts.entry(l.as_str()).or_default() += 1;
        }
        let mut common = 0;
        for l in &lb {
            if let Some(c) = counts.get_mut(l.as_str()) {
                if *c > 0 {
                    *c -= 1;
                    common += 1;
                }
            }
        }
        let max = la.len().max(lb.len()).max(1);
        common as f64 / max as f64 >= 0.9
    }

    /// Deterministic dump of everything derivable from the files (AR-01 snapshots).
    pub fn snapshot(&self) -> String {
        let mut metas: Vec<&Meta> = self.metas.values().collect();
        metas.sort_by(|a, b| a.path.cmp(&b.path));
        self.with_links(|links| {
            let mut out = String::new();
            for m in metas {
                let back: Vec<&String> = links.backlinks.get(&m.path).map(|s| s.iter().collect()).unwrap_or_default();
                let line = serde_json::json!({
                    "path": m.path, "id": m.s.id, "type": m.s.r#type, "title": m.s.title, "aliases": m.s.aliases,
                    "tags": m.s.tags, "attributes": m.s.attributes, "links": m.s.links, "backlinks": back,
                    "body_line": m.s.body_line,
                });
                out.push_str(&line.to_string());
                out.push('\n');
            }
            out
        })
    }
}

/// A target that names a note: not a date and not an attachment with another extension (ms4-links §3, D-284).
pub fn is_note_target(target: &str) -> bool {
    let t = nfc(target.trim());
    if t.is_empty() {
        return false;
    }
    let name = t.rsplit('/').next().unwrap_or(&t);
    match name.rsplit_once('.') {
        Some((_, ext)) => ext.eq_ignore_ascii_case("md") || ext.contains(' ') || ext.len() > 5,
        None => true,
    }
}

/// ms3-shell §11.1 rules from the linking note `from` (D-155, D-162, D-291; dialect §6).
fn resolve_from(l: &Links, from: &str, target: &str) -> Resolved {
    let mut t = nfc(target.trim());
    if let Some(i) = t.find('|') {
        t.truncate(i);
    }
    if let Some(i) = t.find('#') {
        t.truncate(i);
    }
    let t = t.trim().to_string();
    if t.is_empty() {
        return Resolved::Unresolved;
    }
    if tegg_format::date::parse_date(&t).is_some() {
        return match l.daily.get(&t) {
            Some(p) => Resolved::Daily(p.clone()),
            None => Resolved::DateMissing,
        };
    }
    let from = nfc(from);
    let from_dir = from.rsplit_once('/').map(|(d, _)| d.to_lowercase()).unwrap_or_default();
    let lower = t.to_lowercase();
    let key = lower.strip_suffix(".md").unwrap_or(&lower);
    if !from_dir.is_empty() {
        if let Some(p) = l.by_path.get(&format!("{from_dir}/{key}")) {
            return Resolved::Note(p.clone());
        }
    }
    if let Some(p) = l.by_path.get(key) {
        return Resolved::Note(p.clone());
    }
    if let Some(p) = l.by_id.get(&t) {
        return Resolved::Note(p.clone());
    }
    if !key.contains('/') {
        if let Some(c) = l.stems.get(key) {
            let folder = |p: &String| p.rsplit_once('/').map(|(d, _)| nfc(d).to_lowercase()).unwrap_or_default();
            if let Some(p) = c.iter().find(|p| folder(p) == from_dir) {
                return Resolved::Note(p.clone());
            }
            if let Some(p) = c.first() {
                return Resolved::Note(p.clone()); // `stems` lists shortest path first, then code-point order
            }
        }
    }
    Resolved::Unresolved
}

/// The date a link target names (D-332), without subpath and alias.
fn date_key(target: &str) -> Option<String> {
    let t = nfc(target.trim());
    let t = t.split(['|', '#']).next().unwrap_or("").trim();
    tegg_format::date::parse_date(t).map(tegg_format::format_date)
}

fn resolve(l: &Links, target: &str) -> Option<String> {
    let t = nfc(target.trim());
    let lower = t.to_lowercase();
    let key = lower.strip_suffix(".md").unwrap_or(&lower);
    if let Some(p) = l.by_path.get(key) {
        return Some(p.clone());
    }
    if let Some(p) = l.by_id.get(&t) {
        return Some(p.clone());
    }
    if !key.contains('/') {
        return l.by_stem.get(key).cloned();
    }
    None
}

static DROPBOX_COPY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?) \([^()]*conflicted copy[^()]*\)$").expect("regex"));
// Google Drive's copy name is `Name (1)`; Tegg's own duplicate-title suffixes start at `(2)` (D-53), so `(2)` and up
// are never a copy hint (FR-SYN-04 AC-2, FR-LNK-14 AC-5, D-757).
static NUMBERED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?) \(1\)$").expect("regex"));
static ICLOUD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?) (\d+)$").expect("regex"));

/// FR-SYN-04 AC-2: the original name a sync client's copy name points to (Dropbox, Google Drive, iCloud).
fn copy_bases(stem: &str) -> Vec<String> {
    [&*DROPBOX_COPY, &*NUMBERED, &*ICLOUD].iter().filter_map(|re| re.captures(stem).map(|c| c[1].to_string())).collect()
}

/// Switcher match tiers (S4): exact, prefix, word prefix, substring, letters in order.
fn tier(name: &str, q: &str, compact: &[char]) -> Option<MatchTier> {
    if name == q {
        return Some(MatchTier::Exact);
    }
    if name.starts_with(q) {
        return Some(MatchTier::Prefix);
    }
    if let Some(pos) = name.match_indices(q).map(|(i, _)| i).find(|&i| name[..i].chars().last().is_some_and(|c| !c.is_alphanumeric())) {
        let _ = pos;
        return Some(MatchTier::WordPrefix);
    }
    if name.contains(q) {
        return Some(MatchTier::Substring);
    }
    let mut it = compact.iter().peekable();
    for c in name.chars() {
        if it.peek() == Some(&&c) {
            it.next();
        }
    }
    (it.peek().is_none() && !compact.is_empty()).then_some(MatchTier::InOrder)
}

/// D-109: a date (`YYYY-MM-DD`, or a date-time taken in `tz`) or a number between `from` and `to`.
fn in_value_range(v: &str, from: Option<&str>, to: Option<&str>, tz: chrono_tz::Tz) -> bool {
    let v = v.trim();
    if let Some(d) = DateVal::parse(&Value::String(v.into())) {
        let day = d.day_in(tz);
        let bound = |b: Option<&str>, f: fn(NaiveDate, NaiveDate) -> bool| match b {
            None => true,
            Some(b) => tegg_format::parse_date(b.trim()).is_some_and(|b| f(day, b)),
        };
        return bound(from, |d, b| d >= b) && bound(to, |d, b| d <= b);
    }
    if let Ok(n) = v.parse::<f64>() {
        let bound = |b: Option<&str>, f: fn(f64, f64) -> bool| match b {
            None => true,
            Some(b) => b.trim().parse::<f64>().is_ok_and(|b| f(n, b)),
        };
        return bound(from, |n, b| n >= b) && bound(to, |n, b| n <= b);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(bytes: &[u8]) -> tegg_vault::FileVersion {
        let mut hash = [0u8; 32];
        for (i, b) in bytes.iter().enumerate() {
            hash[i % 32] ^= *b;
        }
        tegg_vault::FileVersion { mtime_ns: 1_790_000_000_000_000_000, size: bytes.len() as u64, hash }
    }

    /// The lazy D-253 tier walk (body read only for rows that can reach the page) gives every page as the slice of
    /// one fully resolved order, with the same tiers, typo flags and total (QA review of c663072, FR-SRC-03 AC-12).
    #[test]
    fn lazy_tier_pages_slice_the_full_order() {
        let dir = tempfile::tempdir().expect("setup: tempdir");
        let mut idx = Index::open(&dir.path().join("index.sqlite")).expect("setup: open");
        let mut put = |path: &str, text: &str| idx.upsert(path, text.as_bytes(), &version(text.as_bytes())).expect("setup: upsert");
        put("Pages/Účet chaty.md", "# Účet chaty\n\nnic\n");
        put("Pages/Lipno účet.md", "# Lipno účet\n\nchaty opravy\n");
        for i in 0..24 {
            let body = match i % 4 {
                0 => "Platba za účet chaty na horách.",
                1 => "Chaty jsou drahé, účet přijde později.",
                2 => "Jen účet bez druhého slova.",
                _ => "U chaty se opravy protáhly, účet čeká.",
            };
            put(&format!("Pages/Poznámka {i:02}.md"), &format!("# Poznámka {i:02}\n\n{body}\n"));
        }
        for text in ["účet chaty", "ucet chaty", "\"účet chaty\"", "účet chaty -opravy", "chaty účet", "účt chaty"] {
            let mut full_q = SearchQuery::text(text, chrono_tz::Europe::Prague);
            full_q.limit = 1000;
            let full = idx.search(&full_q).expect("search");
            assert!(full.total > 5, "{text:?}: enough rows to page");
            let key = |r: &SearchResult| (r.path.clone(), r.tier, r.typo);
            let want: Vec<_> = full.results.iter().map(key).collect();
            if text == "účet chaty" {
                // Body phrases and body "all words" rows both reach the walk.
                assert!(want.iter().any(|w| w.1 == QueryTier::Phrase) && want.iter().any(|w| w.1 == QueryTier::AllWords), "{text:?}: {want:?}");
            }
            for limit in 1..=5 {
                for offset in 0..=5 {
                    let mut q = full_q.clone();
                    q.offset = offset;
                    q.limit = limit;
                    let p = idx.search(&q).expect("search");
                    assert_eq!(p.total, full.total, "{text:?} offset {offset} limit {limit}: total");
                    let got: Vec<_> = p.results.iter().map(key).collect();
                    let end = (offset + limit).min(want.len());
                    assert_eq!(got, want[offset.min(end)..end].to_vec(), "{text:?} offset {offset} limit {limit}");
                }
            }
        }
    }
}
