//! Type definitions read from `.tegg/types/*.yml` (docs/contracts/ms3-shell.md §2 `vault_types`, §8).
//! STUB (MS3 slice 3A red tests, D-61 / TS-I1): returns no types until implemented.

use crate::Vault;

/// One `.tegg/types/<key>.yml` file, keys and names NFC (FR-FMT-12). Mirrors `TypeDefDto` (ms3-shell §2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeDef {
    pub key: String,
    pub name: String,
    pub plural: String,
    pub folder: String,
    pub icon: String,
    pub color: String,
    pub system: bool,
    /// The file couldn't be read; name and plural fall back to the key (NFR-REL-03).
    pub invalid: bool,
}

impl Vault {
    /// Every type definition of the vault, read-only, one per file (order not guaranteed).
    pub fn types(&self) -> Vec<TypeDef> {
        Vec::new()
    }
}
