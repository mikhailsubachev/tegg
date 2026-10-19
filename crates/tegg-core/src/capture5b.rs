//! Slice 5B: the capture window's only write (docs/contracts/ms5-capture.md §3.3; D-540, D-552, NFR-SEC-03 AC-3).
//! `capture_create` refuses Daily Note, Tag, Image, PDF and unknown keys (`UnsupportedType`) and bytes without this
//! type, `review: unreviewed` and a `captured` value (`NotACapture`); then it is exactly `create_object` (folder re-read
//! now, folders created, `free_stem`, create-exclusive, indexed at once). No path argument exists.

use serde_json::Value;
use tegg_format::type_key;

use crate::{Core, CoreError};

/// System types a capture never creates (R55, D-541).
pub const NOT_CAPTURABLE: [&str; 4] = ["daily-note", "tag", "image", "pdf"];

impl Core {
    /// Returns the vault path written (NFC).
    pub fn capture_create(&self, type_key_: &str, title: &str, bytes: &[u8]) -> Result<String, CoreError> {
        let key = type_key(type_key_);
        // An invalid type file has no folder rule to trust (FR-TYP-14); the capture window never offers it.
        if NOT_CAPTURABLE.contains(&key.as_str()) || !self.type_get(&key).is_some_and(|t| !t.invalid) {
            return Err(CoreError::UnsupportedType);
        }
        let fm = match tegg_format::extract(bytes, "x").attributes {
            Some(Value::Object(m)) => m,
            _ => return Err(CoreError::NotACapture),
        };
        let text = |k: &str| fm.get(k).and_then(Value::as_str).map(|s| tegg_format::nfc(s.trim()));
        let typed = text("type").is_some_and(|t| type_key(&t) == key);
        let unreviewed = text("review").as_deref() == Some("unreviewed");
        let captured = fm.get("captured").is_some_and(|v| !v.is_null() && v.as_str().map_or(true, |s| !s.trim().is_empty()));
        if !(typed && unreviewed && captured) {
            return Err(CoreError::NotACapture);
        }
        self.create_object(&key, title, bytes)
    }
}
