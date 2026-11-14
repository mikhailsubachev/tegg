//! Slice REL (docs/contracts/v1-related.md §1.9): compile-only red-test stub, no behaviour (TS-I1, D-1398). The build
//! replaces it with R182 rules 1–2.

/// R182 rules 1–2: the eligible blocks of a body as plain text. Stub: no blocks.
pub fn plain_blocks(_body: &str) -> Vec<String> {
    Vec::new()
}
