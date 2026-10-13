//! Tegg index: SQLite + FTS5 in Application Support, search, quick switcher, links, conflicts.
//! Interface: docs/contracts/ms2-core.md §2. The index is a disposable cache (AR-01): everything in it is
//! derived from the files, and a missing, corrupt or older database is rebuilt. Design ported from spike
//! S4 (D-83); the FTS table holds folded text (text.rs), so search rules and SQLite see the same words.

mod text;

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
use text::{contains_item, parse_query, tokens, within_one_edit, Item};

/// Bump on any change to what is stored; a different version means rebuild (architecture §3.1).
const SCHEMA_VERSION: i64 = 1;
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
    pub r#type: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub attributes: Value,
    pub folder: String,
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
    Alias,
    Attribute,
    Body,
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
    pub typo: bool,
    pub snippet: Option<Snippet>,
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

// ---------------------------------------------------------------- what is stored per note

/// Persisted per note (JSON in `notes.meta`); everything else is derived when loaded.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Stored {
    id: Option<String>,
    r#type: String,
    title: String,
    aliases: Vec<String>,
    tags: Vec<String>,
    /// Tags as written, aligned with `tags` (D-185). Older index rows lack it; the key is used then.
    #[serde(default)]
    tag_spellings: Vec<String>,
    attributes: Value,
    links: Vec<String>,
    body_start: usize,
    body_line: usize,
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
    title_t: Vec<String>,
    alias_t: Vec<Vec<String>>,
    attr_t: Vec<String>,
    /// Folded title, aliases and stem, whitespace collapsed (switcher).
    names_f: Vec<String>,
    created: Option<DateVal>,
    modified: Option<DateVal>,
    modified_ts: Option<i64>,
    created_ts: Option<i64>,
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
    fn new(rowid: i64, path: String, mtime_ns: i64, size: i64, s: Stored) -> Meta {
        let (folder, stem) = split_path(&path);
        let mut names_f = vec![collapse(&fold(&s.title))];
        names_f.extend(s.aliases.iter().map(|a| collapse(&fold(a))));
        names_f.push(collapse(&fold(&stem)));
        let attr = |k: &str| s.attributes.get(k).and_then(DateVal::parse);
        let (created, modified) = (attr("created"), attr("modified"));
        Meta {
            rowid,
            folder,
            stem,
            title_t: tokens(&s.title),
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
            title: self.s.title.clone(),
            aliases: self.s.aliases.clone(),
            tags: self.s.tags.clone(),
            attributes: self.s.attributes.clone(),
            folder: self.folder.clone(),
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
    // D-103: an untyped file is a Page.
    let r#type = ex.r#type.map(|t| t.to_lowercase()).unwrap_or_else(|| "page".into());
    let fts = [text::fts_text(&ex.title), text::fts_text(&aliases.join(" \n ")), text::fts_text(&attribute_text(&attributes)), text::fts_text(body)];
    let stored = Stored {
        id: ex.id,
        r#type,
        title: ex.title,
        aliases,
        tags: ex.tags,
        tag_spellings: ex.tag_spellings,
        attributes,
        links: ex.links.into_iter().map(|l| l.target).collect(),
        body_start,
        body_line,
    };
    Some(Prepared { path: path.to_string(), mtime_ns: version.mtime_ns as i64, size: version.size as i64, stored, raw, fts })
}

// ---------------------------------------------------------------- the index

/// Derived link data, rebuilt lazily after a change.
struct Links {
    by_path: HashMap<String, String>,
    by_id: HashMap<String, String>,
    by_stem: HashMap<String, String>,
    backlinks: HashMap<String, BTreeSet<String>>,
}

pub struct Index {
    conn: Connection,
    metas: HashMap<i64, Meta>,
    by_path: HashMap<String, i64>,
    /// Caches derived from `metas`, dropped on every change.
    vocab: RefCell<Option<Vec<String>>>,
    links: RefCell<Option<Links>>,
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
        let mut idx = Index { conn, metas: HashMap::new(), by_path: HashMap::new(), vocab: RefCell::new(None), links: RefCell::new(None) };
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

        // Candidate rows: every positive item matches exactly (`exact`) or through an alternative (`full`).
        let mut exact: Option<BTreeSet<i64>> = None;
        let mut full: Option<BTreeSet<i64>> = None;
        for it in &positives {
            let e: BTreeSet<i64> = self.fts_rowids(&quote(&it.tokens))?.into_iter().map(|(r, _)| r).collect();
            let mut f = e.clone();
            for chunk in it.alternatives.chunks(200) {
                let alt = chunk.iter().map(|a| quote(std::slice::from_ref(a))).collect::<Vec<_>>().join(" OR ");
                f.extend(self.fts_rowids(&alt)?.into_iter().map(|(r, _)| r));
            }
            exact = Some(match exact {
                Some(x) => x.intersection(&e).copied().collect(),
                None => e,
            });
            full = Some(match full {
                Some(x) => x.intersection(&f).copied().collect(),
                None => f,
            });
        }
        let (exact, mut full) = match (exact, full) {
            (Some(e), Some(f)) => (e, f),
            _ => {
                let all: BTreeSet<i64> = self.metas.keys().copied().collect();
                (all.clone(), all)
            }
        };
        for it in items.iter().filter(|i| i.negative) {
            for (r, _) in self.fts_rowids(&quote(&it.tokens))? {
                full.remove(&r);
            }
        }
        // bm25 of the exact query, for ranking within a group (lower is better).
        let mut score: HashMap<i64, f64> = HashMap::new();
        if !positives.is_empty() && !exact.is_empty() {
            let all = positives.iter().map(|i| quote(&i.tokens)).collect::<Vec<_>>().join(" AND ");
            score = self.fts_rowids(&all)?.into_iter().collect();
        }

        let mut hits: Vec<(&Meta, bool, MatchField)> = full
            .iter()
            .filter_map(|r| self.metas.get(r))
            .filter(|m| self.passes(m, q))
            .map(|m| {
                let typo = !exact.contains(&m.rowid);
                let any = |toks: &[String]| positives.iter().any(|i| contains_item(toks, i));
                let field = if positives.is_empty() || any(&m.title_t) {
                    MatchField::Title
                } else if m.alias_t.iter().any(|a| any(a)) {
                    MatchField::Alias
                } else if any(&m.attr_t) {
                    MatchField::Attribute
                } else {
                    MatchField::Body
                };
                (m, typo, field)
            })
            .collect();
        hits.sort_by(|a, b| {
            let sa = score.get(&a.0.rowid).copied().unwrap_or(0.0);
            let sb = score.get(&b.0.rowid).copied().unwrap_or(0.0);
            (a.1, a.2).cmp(&(b.1, b.2)).then(sa.total_cmp(&sb)).then_with(|| a.0.path.cmp(&b.0.path))
        });
        let total = hits.len();
        let limit = if q.limit == 0 { 50 } else { q.limit };
        let mut results = Vec::new();
        for (m, typo, field) in hits.into_iter().skip(q.offset).take(limit) {
            let snippet = if positives.is_empty() { None } else { self.snippet_for(m, &items)? };
            results.push(SearchResult { path: m.path.clone(), r#type: m.s.r#type.clone(), title: m.s.title.clone(), matched_in: field, typo, snippet });
        }
        Ok(SearchPage { results, total })
    }

    fn snippet_for(&self, m: &Meta, items: &[Item]) -> Result<Option<Snippet>, IndexError> {
        let raw: Option<String> = self.conn.prepare_cached("SELECT raw FROM notes WHERE rowid = ?1")?.query_row(params![m.rowid], |r| r.get(0)).optional()?;
        let Some(raw) = raw else { return Ok(None) };
        let body = raw.get(m.s.body_start..).unwrap_or("");
        Ok(text::snippet(body, items).map(|s| Snippet { text: s.text, highlights: s.highlights, line: m.s.body_line + s.body_line + 1, byte_in_line: s.byte_in_line }))
    }

    /// FR-SRC-02 filters, combined with AND (D-103, D-104, D-109).
    fn passes(&self, m: &Meta, q: &SearchQuery) -> bool {
        if !q.types.is_empty() && !q.types.iter().any(|t| t.to_lowercase() == m.s.r#type) {
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
        let mut l = Links { by_path, by_id, by_stem, backlinks: HashMap::new() };
        let mut back: HashMap<String, BTreeSet<String>> = HashMap::new();
        for m in self.metas.values() {
            for t in &m.s.links {
                if let Some(target) = resolve(&l, t) {
                    if target != m.path {
                        back.entry(target).or_default().insert(m.path.clone());
                    }
                }
            }
        }
        l.backlinks = back;
        l
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

    /// FR-FMT-09 AC-2: daily notes are recognized by their `date` attribute, whatever the file name.
    pub fn daily_note(&self, date: NaiveDate) -> Option<String> {
        let want = tegg_format::format_date(date);
        let mut found: Vec<&Meta> = self
            .metas
            .values()
            .filter(|m| m.s.r#type == "daily-note" && m.attr_texts("date").iter().any(|d| d.trim().get(..10) == Some(want.as_str())))
            .collect();
        found.sort_by(|a, b| (a.path.chars().count(), &a.path).cmp(&(b.path.chars().count(), &b.path)));
        found.first().map(|m| m.path.clone())
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
static NUMBERED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?) \((\d+)\)$").expect("regex"));
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
