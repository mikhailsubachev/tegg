//! Card data (docs/contracts/v1-cards.md §3.2, §3.5; cards.md R211, R212; D-1942, D-1984).
//!
//! Compile-only stub for slice OC's red tests (D-61): the types and signatures of the contract, no behaviour. Nothing
//! fills `CardData` yet; `type_card_example` answers None and `is_empty_value` false. The build replaces this file.

use serde_json::Value;

use crate::{Core, LinkTarget};

/// Everything one ObjectCard draws besides its type's definition (plan §4.3; FR-TYP-11 AC-18).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CardData {
    pub r#type: String,
    pub title: String,
    pub keys: Vec<String>,
    pub values: serde_json::Map<String, Value>,
    pub excerpt: Option<String>,
    pub links: Vec<LinkTarget>,
    pub unreviewed: bool,
    pub file: Option<LinkTarget>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CardExample {
    pub path: String,
    pub card: CardData,
}

/// R212's last row (empty values). Stub: false.
pub fn is_empty_value(_v: &Value) -> bool {
    false
}

impl Core {
    /// D-1984 (AP-1591): the type's most recently modified object as card data with every candidate key. Stub: None.
    pub fn type_card_example(&self, _key: &str) -> Option<CardExample> {
        None
    }
}
