//! Slice 5B: the Inbox query (docs/contracts/ms5-capture.md §7.1; R61, D-554). Members from the index's stored
//! frontmatter: `review` exactly `unreviewed` (NFC, trimmed, plain or quoted) on any type, or a Quick Note / Daily Note
//! whose `review` is missing or anything but `reviewed`; never `_templates/`, `.trash/`, files without frontmatter or
//! virtual Daily Notes. The core never decides "today" or a group (§7.2 is TypeScript).
//! STUB (TS-I1): not built yet; the Inbox is empty.

use crate::Core;

/// One Inbox member (R61).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxRow {
    /// NFC.
    pub path: String,
    pub id: Option<String>,
    /// Falls back to the stem (ObjectInfo rule).
    pub title: String,
    /// The matched key (D-239).
    pub r#type: String,
    /// As written (NFC, trimmed); None when missing or not a string.
    pub review_raw: Option<String>,
    /// Raw values; the UI parses them (§7.2).
    pub captured: Option<String>,
    pub created: Option<String>,
    pub modified: Option<String>,
    /// Frontmatter then inline tags, D-185 spelling, unique by key.
    pub tags: Vec<String>,
    /// `tegg_index::text::excerpt` (plain text, ≤ 300 chars).
    pub excerpt: String,
    /// The last read wasn't valid UTF-8 (D-180).
    pub read_only: bool,
}

impl Core {
    /// Members only, in path order. STUB: empty.
    pub fn inbox_list(&self) -> Vec<InboxRow> {
        Vec::new()
    }

    /// STUB: 0.
    pub fn inbox_count(&self) -> usize {
        0
    }
}
