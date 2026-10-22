//! MS6 slice 6A (docs/contracts/ms6-trash-media.md §3): media metadata from the bytes (§3.1), names and titles of a
//! new Image or PDF object (§3.3, D-617), the object's bytes (§3.5; twin of `@tegg/doc` `media.ts`) and adding a file
//! with its object (§3.4).
//! 6A stub (ms6-trash-media §3): every function returns a deliberately wrong result (TS-I1).

use std::time::SystemTime;

use crate::{Core, CoreError, FileVersion};

/// §3.1: what the bytes are (R72's types only).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaInfo {
    pub media_type: &'static str,
    /// The usual extension without the dot (`png`, `jpg`, `gif`, `webp`, `heic`, `svg`, `pdf`).
    pub ext: &'static str,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pages: Option<u32>,
}

/// §3.1: by magic bytes only; `None` = refused (`media.refused`). 6A stub (ms6-trash-media §3.1): `None`.
pub fn media_info(_bytes: &[u8]) -> Option<MediaInfo> {
    None
}

/// §3.3: the input of `media_names`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameRequest {
    /// The file name from the drop or picker path, or the UI's `Pasted image <yyyyMMddHHmmss>` for a paste.
    pub name: String,
    pub info: MediaInfo,
    /// The owning note's title (title, else stem); `None` from the capture window without a title.
    pub owner_title: Option<String>,
    /// The UI's local date `yyyy-MM-dd` (capture titles `Capture <date> <n>`).
    pub date: String,
    /// The attachments folder (vault setting `attachments`, D-551).
    pub attachments: String,
    /// The type folder of the new object (`Images`, `PDFs`).
    pub folder: String,
}

/// §3.3: vault paths of the new file and object, and the object's title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaNames {
    pub file: String,
    pub object: String,
    pub title: String,
}

/// §3.3 (R72, R73, D-617): pure; `exists(vault path)` answers whether a path is taken (case-insensitive).
/// 6A stub (ms6-trash-media §3.3): the name unchanged, no object, no title.
pub fn media_names(_exists: &dyn Fn(&str) -> bool, req: &NameRequest) -> MediaNames {
    MediaNames { file: req.name.clone(), object: String::new(), title: String::new() }
}

/// §3.5: the fields of a new Image or PDF object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaObjectFields {
    pub id: String,
    pub title: String,
    /// ISO 8601 with offset (`created` and `modified`).
    pub now: String,
    /// The text inside `![[…]]` (the file name, or its vault path when the name isn't unique).
    pub embed: String,
    pub info: MediaInfo,
    pub size: u64,
    /// D-184 link text of the owning note, if any.
    pub source: Option<String>,
}

/// §3.5: the object's bytes (twin of `@tegg/doc` `mediaObject`). 6A stub (ms6-trash-media §3.5): empty.
pub fn media_object(_f: &MediaObjectFields) -> String {
    String::new()
}

/// §3.4: the owning note of a new media file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerRef {
    pub path: String,
    pub title: String,
}

/// §3.4: one file to add.
#[derive(Debug, Clone)]
pub struct MediaAdd {
    pub bytes: Vec<u8>,
    pub name: String,
    pub owner: Option<OwnerRef>,
    pub now: SystemTime,
    /// `yyyy-MM-dd`, for capture titles.
    pub zone_date: String,
}

/// §3.4: what `media_add` wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaAdded {
    pub file: String,
    pub object: String,
    pub title: String,
    /// The text inside `![[…]]`.
    pub embed: String,
    pub info: MediaInfo,
    /// The object's version.
    pub version: FileVersion,
}

impl Core {
    /// §3.4: `media_info` (refuse → `Refused`), names, the file create-exclusive in the attachments folder, then the
    /// object create-exclusive; a failed object write removes the file again. 6A stub (ms6-trash-media §3.4).
    pub fn media_add(&self, _req: MediaAdd) -> Result<MediaAdded, CoreError> {
        Err(CoreError::NotImplemented)
    }
}
