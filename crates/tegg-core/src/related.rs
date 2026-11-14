//! Slice REL (docs/contracts/v1-related.md §1.11): compile-only red-test stubs, no behaviour (TS-I1, D-1398).
//! `Core::related` answers `NotReady` and the test hooks read nothing, so the red tests fail by assertion. The build
//! replaces them.
use crate::Core;
use tegg_index::RelatedList;

#[derive(Debug, Clone, PartialEq)]
pub enum RelatedError {
    NotReady,
}

impl Core {
    /// §2 `index_related`. Stub: the index is never ready.
    pub fn related(&self, _path: &str, _show_linked: bool) -> Result<RelatedList, RelatedError> {
        Err(RelatedError::NotReady)
    }
    /// §1.10. Stub: no row.
    #[cfg(any(test, feature = "test-hooks"))]
    pub fn rel_terms(&self, _path: &str) -> Option<tegg_index::RelTerms> {
        None
    }
    /// §1.10. Stub: not indexed.
    #[cfg(any(test, feature = "test-hooks"))]
    pub fn related_signature(&self, _path: &str) -> Option<Vec<(String, f64)>> {
        None
    }
    /// §1.10. Stub: no calls counted.
    #[cfg(any(test, feature = "test-hooks"))]
    pub fn related_computed(&self) -> u64 {
        0
    }
}
