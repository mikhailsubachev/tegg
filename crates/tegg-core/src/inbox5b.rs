//! Slice 5B: the Inbox query (docs/contracts/ms5-capture.md §7.1; R61, D-554). Members from the index's stored
//! frontmatter: `review` exactly `unreviewed` (NFC, trimmed, plain or quoted) on any type, or a Quick Note / Daily Note
//! whose `review` is missing or anything but `reviewed`; never `_templates/`, `.trash/`, files without frontmatter or
//! virtual Daily Notes. The core never decides "today" or a group (§7.2 is TypeScript). Every field comes from the
//! indexed file (AR-01), so a rebuilt index gives the same rows (FR-INB-01 AC-8).

use serde_json::Value;
use tegg_format::nfc;

use crate::{Core, ObjectInfo};

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

/// A string value as written (NFC, trimmed); other values are none.
fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(|s| nfc(s.trim()))
}

/// R61 (D-554).
fn member(o: &ObjectInfo) -> bool {
    let p = nfc(&o.path);
    if p.starts_with("_templates/") || p.starts_with(".trash/") {
        return false;
    }
    let Some(fm) = o.attributes.as_object() else { return false };
    let review = text(fm.get("review"));
    review.as_deref() == Some("unreviewed") || (matches!(o.r#type.as_str(), "quick-note" | "daily-note") && review.as_deref() != Some("reviewed"))
}

impl Core {
    /// Members only, in path order.
    pub fn inbox_list(&self) -> Vec<InboxRow> {
        let all = self.objects(); // before the index lock: `objects` takes it too
        let idx = self.index();
        let mut rows: Vec<InboxRow> = all
            .iter()
            .filter(|o| member(o))
            .filter_map(|o| {
                let st = idx.note_state(&o.path)?;
                let fm = o.attributes.as_object()?;
                let mut tags: Vec<String> = Vec::new();
                for t in &o.tags {
                    let t = nfc(t);
                    if !t.is_empty() && !tags.iter().any(|x| x.to_lowercase() == t.to_lowercase()) {
                        tags.push(t);
                    }
                }
                Some(InboxRow {
                    path: nfc(&o.path),
                    id: o.id.clone(),
                    title: nfc(&o.title),
                    r#type: o.r#type.clone(),
                    review_raw: text(fm.get("review")),
                    captured: text(fm.get("captured")),
                    created: text(fm.get("created")),
                    modified: text(fm.get("modified")),
                    tags,
                    excerpt: st.excerpt,
                    read_only: !st.utf8,
                })
            })
            .collect();
        rows.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
        rows
    }

    pub fn inbox_count(&self) -> usize {
        self.objects().iter().filter(|o| member(o)).count()
    }
}
