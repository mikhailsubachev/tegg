//! MS4 slice 4D-lite (docs/contracts/ms4-tags.md §1): tags in the index — Tag files, display names, colours, counts
//! and Last used (D-640, D-647, D-653, D-657, D-665, D-667). Stubs until the slice is built: every query returns an
//! empty result, so the AC tests fail on their assertions (TS-I1).

use crate::{Core, FileVersion};

/// The winning Tag file of a key (§1.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagFileRef {
    pub path: String,
    pub version: FileVersion,
}

/// One tag (§1.2, R79).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRow {
    /// `tag_key`: NFC, lower case.
    pub key: String,
    /// Display name (D-657): the winner's title (stem when missing), else the most frequent spelling (D-185).
    pub name: String,
    /// The winning Tag file.
    pub file: Option<TagFileRef>,
    /// Other Tag files of the key, in winner order.
    pub losers: Vec<String>,
    /// One of the eight R14 tokens, else None (unknown, empty, missing, virtual; D-653).
    pub color: Option<String>,
    /// The winner's raw `color` (D-669).
    pub color_raw: Option<String>,
    /// Objects with an occurrence, one per object (D-647).
    pub count: usize,
    /// Newest valid `modified` among them, as written (D-667).
    pub last_used: Option<String>,
    /// The same instant (ns since the epoch) for sorting.
    pub last_used_ns: Option<i128>,
}

/// One object of a tag page (§1.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagObjectRow {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
    /// Type key; "" untyped reads as page (D-103).
    pub r#type: String,
    pub modified: Option<String>,
    pub modified_ns: Option<i128>,
    /// The object's other tag keys (all occurrences, deduplicated, without the page's key).
    pub tags: Vec<String>,
    pub review: Option<String>,
    pub status: Option<String>,
    pub due: Option<String>,
    pub completed: Option<String>,
}

/// What a rename or delete of a tag touches (§1.4).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TagUsage {
    pub notes: usize,
    pub templates: usize,
    pub file: Option<String>,
    pub losers: Vec<String>,
}

impl Core {
    /// §1.2: rows for every key with count ≥ 1 and every winning Tag file, in key order. 4D-lite stub.
    pub fn tag_rows(&self) -> Vec<TagRow> {
        Vec::new()
    }

    /// §1.3: one row per object with an occurrence of `key`, in path order. 4D-lite stub.
    pub fn tag_objects(&self, key: &str) -> Vec<TagObjectRow> {
        let _ = key;
        Vec::new()
    }

    /// §1.4. 4D-lite stub.
    pub fn tag_usage(&self, key: &str) -> TagUsage {
        let _ = key;
        TagUsage::default()
    }
}
