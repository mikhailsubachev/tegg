//! Slice Q (docs/contracts/v1-queries.md §1.3): compile-only red-test stubs, no behaviour (TS-I1). The build replaces
//! them with the real fence scanner.

/// One fenced code block whose info string's first word is exactly `query` (R140).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryFence {
    /// Byte range of the whole fence in the file (opening to closing line, EOLs included).
    pub range: std::ops::Range<usize>,
    /// The body without container prefixes (`> `, list indentation), as CommonMark reads it.
    pub body: String,
    /// `read_fence(body)`'s Reference name (NFC), else None.
    pub saved: Option<String>,
    /// Inside a list, quote or callout.
    pub nested: bool,
    /// The whole info string as written.
    pub info: String,
}

/// Stub: finds nothing.
pub fn query_fences(_text: &str) -> Vec<QueryFence> {
    Vec::new()
}
