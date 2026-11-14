//! Slice REL (docs/contracts/v1-related.md §1.11): `index_related` through the core. The list itself is
//! `tegg_index::Index::related`; the core adds `NotReady` while the first build of an empty index runs (as
//! `graph_neighbourhood`, D-990), the media links of an Image or PDF object (FR-ATT-07, D-1712) and the root collation of
//! equal titles (CP-2 → D-1726). Read-only: no vault write, no recency, no event.
use tegg_format::nfc;
use tegg_index::{RelatedList, RelatedParams};

use crate::Core;

#[derive(Debug, Clone, PartialEq)]
pub enum RelatedError {
    NotReady,
}

impl Core {
    /// §2 `index_related`: the Related list of `path` (NFC-normalized here). A path that isn't indexed (trashed,
    /// deleted, a template) answers an empty list with no reason.
    pub fn related(&self, path: &str, show_linked: bool) -> Result<RelatedList, RelatedError> {
        if !self.index_ready() {
            return Err(RelatedError::NotReady);
        }
        let path = nfc(path);
        // D-1712: notes that embed the open Image or PDF object's file are linked with it, as the Backlinks tab lists
        // them. Read before the index lock below (`media_sources` takes it itself).
        let extra: Vec<String> = self.media_sources(&path).into_iter().map(|(src, _)| src).collect();
        let coll = crate::queries_q::collator("und");
        let order = |a: &str, b: &str| coll.compare(a, b);
        let list = self.index().related(&path, show_linked, &RelatedParams::default(), &extra, &order);
        Ok(list.unwrap_or_default())
    }

    /// §1.10: the stored `rel` row of `path`.
    #[cfg(any(test, feature = "test-hooks"))]
    pub fn rel_terms(&self, path: &str) -> Option<tegg_index::RelTerms> {
        self.index().rel_terms(&nfc(path))
    }
    /// §1.10: the signature of `path` with the default parameters.
    #[cfg(any(test, feature = "test-hooks"))]
    pub fn related_signature(&self, path: &str) -> Option<Vec<(String, f64)>> {
        self.index().related_signature(&nfc(path), &RelatedParams::default())
    }
    /// §1.10: Related lists computed since the index was opened (FR-LNK-15 AC-29).
    #[cfg(any(test, feature = "test-hooks"))]
    pub fn related_computed(&self) -> u64 {
        self.index().related_computed()
    }
}
