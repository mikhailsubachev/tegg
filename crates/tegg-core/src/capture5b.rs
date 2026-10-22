//! Slice 5B: the capture window's only write (docs/contracts/ms5-capture.md §3.3; D-540, D-552, D-595, NFR-SEC-03 AC-3).
//! `capture_create` refuses Daily Note, Tag, Image, PDF and unknown keys (`UnsupportedType`) and bytes without this
//! type and a `created` value (`NotACapture`; D-595, was `captured`), or whose `review` doesn't match the type's
//! workflow (D-604: `review: unreviewed` on a review type, no `review` key otherwise); then it is exactly `create_object` (folder re-read
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
        let ty = match self.type_get(&key) {
            Some(t) if !t.invalid && !NOT_CAPTURABLE.contains(&key.as_str()) => t,
            _ => return Err(CoreError::UnsupportedType),
        };
        let review_type = !matches!(ty.def.review, tegg_schema::Review::Off);
        let fm = match tegg_format::extract(bytes, "x").attributes {
            Some(Value::Object(m)) => m,
            _ => return Err(CoreError::NotACapture),
        };
        let text = |k: &str| fm.get(k).and_then(Value::as_str).map(|s| tegg_format::nfc(s.trim()));
        let typed = text("type").is_some_and(|t| type_key(&t) == key);
        // D-604: `review: unreviewed` exactly on review types.
        let review_ok = if review_type { text("review").as_deref() == Some("unreviewed") } else { !fm.contains_key("review") };
        let created = fm.get("created").is_some_and(|v| !v.is_null() && v.as_str().map_or(true, |s| !s.trim().is_empty()));
        if !(typed && review_ok && created) {
            return Err(CoreError::NotACapture);
        }
        self.create_object(&key, title, bytes)
    }
}
