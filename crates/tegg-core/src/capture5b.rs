//! Slice 5B: the capture window's only write (docs/contracts/ms5-capture.md §3.3; D-540, D-552, NFR-SEC-03 AC-3).
//! `capture_create` refuses Daily Note, Tag, Image, PDF and unknown keys (`UnsupportedType`) and bytes without this
//! type, `review: unreviewed` and a `captured` value (`NotACapture`); then it is exactly `create_object` (folder re-read
//! now, folders created, `free_stem`, create-exclusive, indexed at once). No path argument exists.
//! STUB (TS-I1): not built yet; refuses every capture with `NotImplemented`.

use crate::{Core, CoreError};

impl Core {
    /// Returns the vault path written (NFC). STUB: `NotImplemented`.
    pub fn capture_create(&self, _type_key: &str, _title: &str, _bytes: &[u8]) -> Result<String, CoreError> {
        Err(CoreError::NotImplemented)
    }
}
