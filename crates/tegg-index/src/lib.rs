//! Tegg index: SQLite + FTS5 in Application Support, search, quick switcher, conflicts.
//! Interface: docs/contracts/ms2-core.md §2. The index is a disposable cache (AR-01).
//! MS2 scaffold: stubs return wrong values until implemented (TS-I1).

use std::path::Path;

use chrono::NaiveDate;
use tegg_vault::FileVersion;

/// NFC → lower case → combining marks removed (FR-SRC-04, FR-FMT-12): `Čtení` → `cteni`.
pub fn fold(s: &str) -> String {
    s.to_string()
}

#[derive(Debug, Clone)]
pub enum IndexError {
    Sqlite(String),
    Io(String),
    NotImplemented,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectInfo {
    pub path: String,
    pub id: Option<String>,
    pub r#type: String,
    pub title: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub attributes: serde_json::Value,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchField {
    Title,
    Alias,
    Body,
    Attribute,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    DuplicateId,
    PossibleCopy,
    NameNormalization,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflict {
    pub kind: ConflictKind,
    pub primary: String,
    pub others: Vec<String>,
}

pub struct Index {
    _private: (),
}

impl Index {
    pub fn open(_db_path: &Path) -> Result<Index, IndexError> {
        Ok(Index { _private: () })
    }
    pub fn upsert(&mut self, _path: &str, _bytes: &[u8], _version: &FileVersion) -> Result<(), IndexError> {
        Err(IndexError::NotImplemented)
    }
    pub fn remove(&mut self, _path: &str) -> Result<(), IndexError> {
        Err(IndexError::NotImplemented)
    }
    pub fn versions(&self) -> Result<Vec<(String, i128, u64)>, IndexError> {
        Ok(vec![])
    }
    pub fn search(&self, _q: &SearchQuery) -> Result<SearchPage, IndexError> {
        Ok(SearchPage::default())
    }
    pub fn switcher(&self, _q: &str, _recency: &dyn Fn(&str) -> Option<i64>, _limit: usize) -> Vec<SwitcherItem> {
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
}
