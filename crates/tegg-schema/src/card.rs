//! The card list of a type (docs/contracts/v1-cards.md §2.2; cards.md R209, R210; D-1947, D-1964, D-1967).
//!
//! Compile-only stub for slice OC's red tests (D-61): the signatures of the contract, no behaviour. Every function
//! returns an empty list; the build replaces this file.

use crate::{Parsed, TypeFile};

/// R209: the built-in keys a card list may hold besides attribute keys, in the order `Add property` offers them.
pub const CARD_BUILT_INS: [&str; 7] = ["tags", "body", "description", "source", "aliases", "created", "modified"];
/// R210: undefined types, invalid type files.
pub const CARD_FALLBACK: [&str; 3] = ["tags", "body", "modified"];

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CardList {
    /// R209 "card list": `card:` as written when present and readable, else R210's default.
    pub list: Vec<String>,
    /// True when `list` is R210's default.
    pub default: bool,
    /// The effective keys.
    pub keys: Vec<String>,
}

/// R210 for a defined type. Stub: empty.
pub fn default_card(_def: &TypeFile) -> Vec<String> {
    Vec::new()
}

/// R209 + R210 for a parsed file. Stub: empty.
pub fn card_list(_parsed: &Parsed) -> CardList {
    CardList::default()
}

/// A `type` value without a definition (D-121). Stub: empty.
pub fn card_list_undefined() -> CardList {
    CardList::default()
}
