//! MS4 slice 4A: backlinks panel, broken links, duplicate titles, create from a link (docs/contracts/ms4-links.md §3;
//! FR-LNK-01, -02, -04, -14; D-276…D-291).
//!
//! STUB (red tests, TS-I1): the types are the contract's; every query returns a deliberately wrong result (empty
//! panel, no broken links, no duplicate groups, an `Exists` plan with an empty path, `NotImplemented`) until 4A is
//! built. The new error kinds `PlanChanged { now }` and `Exists { path }` (§3) are added to `CoreError` with the
//! implementation; the AC tests read them through `Debug`.

use crate::{Core, CoreError};
pub use tegg_format::excerpt::{At, Excerpt};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BacklinksPanel {
    pub objects: usize,
    pub groups: Vec<BacklinkGroup>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BacklinkGroup {
    pub type_key: String,
    pub defined: bool,
    pub raw: String,
    pub entries: Vec<BacklinkEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BacklinkEntry {
    pub source: String,
    pub title: String,
    pub type_key: String,
    /// As written; ordering uses the instant.
    pub modified: Option<String>,
    /// The editor can't open it (NFR-REL-03): open in the source view.
    pub read_only: bool,
    /// All of them, file order, frontmatter first (the UI shows 3, D-278).
    pub occurrences: Vec<Occurrence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OccurrenceKind {
    Body,
    Attribute,
    Embed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub kind: OccurrenceKind,
    /// The frontmatter key.
    pub attribute: Option<String>,
    /// The Name from the source's type schema, if the key is defined there.
    pub attribute_name: Option<String>,
    /// The first link of this occurrence that points here.
    pub at: At,
    pub excerpt: Excerpt,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BrokenLinks {
    pub occurrences: usize,
    pub objects: usize,
    pub groups: Vec<BrokenGroup>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BrokenGroup {
    /// NFC, lower case, without subpath and alias.
    pub key: String,
    /// Most frequent spelling, ties by code point.
    pub label: String,
    /// Occurrences.
    pub count: usize,
    pub create: LinkCreatePlan,
    pub sources: Vec<BacklinkEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateGroup {
    pub key: String,
    pub label: String,
    pub objects: Vec<DuplicateObject>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateObject {
    pub path: String,
    pub title: String,
    pub type_key: String,
    pub folder: String,
    pub details: DuplicateDetails,
    pub backlinks: usize,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DuplicateDetails {
    /// As written; the UI formats it (D-160, machine zone).
    pub created: Option<String>,
    /// Up to 2 set preview values, in preview order.
    pub preview: Vec<(String, serde_json::Value)>,
    /// When it differs from the title (NFC compare).
    pub stem: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateRefusal {
    /// D-288, D-222.
    Folder,
    /// D-287 from a read-only view: the UI decides.
    NeedsEdit,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LinkCreatePlan {
    /// `rewrite`: the new link text (D-287).
    Create { path: String, title: String, type_key: String, rewrite: Option<String> },
    /// The target resolves now.
    Exists { path: String },
    Forbidden { reason: CreateRefusal },
}

#[derive(Debug, Clone, PartialEq)]
pub struct LinkCreated {
    pub path: String,
    pub rewrite: Option<String>,
}

impl Core {
    /// FR-LNK-01, -02 (D-276…D-282): one query per opened note, answered from the index. STUB: empty.
    pub fn backlinks_panel(&self, path: &str) -> BacklinksPanel {
        let _ = path;
        BacklinksPanel::default()
    }

    /// FR-LNK-04 (D-284). STUB: empty.
    pub fn broken_links(&self) -> BrokenLinks {
        BrokenLinks::default()
    }

    /// FR-LNK-14 (D-284, D-290). STUB: empty.
    pub fn duplicate_titles(&self) -> Vec<DuplicateGroup> {
        Vec::new()
    }

    /// FR-LNK-04 (D-286…D-288): read-only plan for the Create offer. STUB: `Exists` with an empty path.
    pub fn link_create_plan(&self, from: &str, target: &str, relation_to: Option<&[String]>) -> LinkCreatePlan {
        let _ = (from, target, relation_to);
        LinkCreatePlan::Exists { path: String::new() }
    }

    /// Writes the planned note if the plan still holds; re-plans first (FR-LNK-04 AC-11). STUB: `NotImplemented`.
    pub fn link_create(&self, from: &str, target: &str, expect: &LinkCreatePlan, bytes: &[u8]) -> Result<LinkCreated, CoreError> {
        let _ = (from, target, expect, bytes);
        Err(CoreError::NotImplemented)
    }

    /// §3.1 (D-291 part 2): the first of `<stem>`, `<stem> (2)`, … free vault-wide and in `folder`. STUB: empty.
    pub fn free_stem(&self, folder: &str, stem: &str) -> String {
        let _ = (folder, stem);
        String::new()
    }
}
