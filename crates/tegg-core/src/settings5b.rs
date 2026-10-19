//! Slice 5B: portable vault settings in `.tegg/vault.yml` (docs/contracts/ms5-capture.md §5.1; FR-VLT-05, FR-SET-01;
//! D-541, D-551). Reading never writes. A patch writes only that key's line (or appends the key after the last entry),
//! keeps comments and other lines byte for byte, and needs the file's current version as base (D-235).
//! STUB (TS-I1): not built yet; reads nothing and refuses every patch with `NotImplemented`.

use crate::{Core, CoreError, FileVersion};

/// `default-type` as stored and as matched (D-239).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultTypeSetting {
    /// The raw value as written (NFC); None when the key is missing or not a string.
    pub raw: Option<String>,
    /// The matched type key; `quick-note` when not valid.
    pub key: String,
    /// False when missing, empty, not a string, or no such type.
    pub valid: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultSettings {
    /// None when vault.yml is missing.
    pub version: Option<FileVersion>,
    pub default_type: DefaultTypeSetting,
    /// Raw or `YYYY-MM-DD`.
    pub daily_format: String,
    /// Raw or `_attachments`.
    pub attachments: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKey {
    DefaultType,
    DailyFormat,
    Attachments,
}

impl Core {
    /// STUB: an empty, invalid reading.
    pub fn vault_settings(&self) -> VaultSettings {
        VaultSettings {
            version: None,
            default_type: DefaultTypeSetting { raw: None, key: String::new(), valid: false },
            daily_format: String::new(),
            attachments: String::new(),
        }
    }

    /// `Conflict` when `base` isn't the current version; `Invalid { reason }` for a D-336-rejected format or a
    /// D-222-rejected folder; an equal value writes nothing. STUB: `NotImplemented`.
    pub fn vault_settings_patch(&self, _base: Option<FileVersion>, _key: VaultKey, _value: String) -> Result<VaultSettings, CoreError> {
        Err(CoreError::NotImplemented)
    }
}
