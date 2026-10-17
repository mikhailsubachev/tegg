//! MS4 slice 4F (docs/contracts/ms4-embeds.md §4): loading embedded notes, one call per nesting level (D-429).

use crate::{Core, FileVersion, LinkTarget};

/// What `embed_load` found at a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedLoadState {
    Ok,
    /// No such file, or it is in `.trash/` or `_templates/`.
    Missing,
    Io,
}

/// One embedded file as read for an embed (ms4-embeds §4).
#[derive(Debug, Clone, PartialEq)]
pub struct EmbedNote {
    pub path: String,
    pub state: EmbedLoadState,
    /// Decoded with U+FFFD for invalid bytes (D-180).
    pub text: Option<String>,
    /// Base for the embed's autosave.
    pub version: Option<FileVersion>,
    pub utf8: bool,
    /// Resolution of every link target of the file, from its own path, in `linkTargets` order.
    pub links: Vec<LinkTarget>,
}

impl Core {
    /// D-429: reads every path once (first-seen order), from the files, records no recency, resolves each file's
    /// link targets from its own path.
    pub fn embed_load(&self, _paths: &[String]) -> Vec<EmbedNote> {
        Vec::new() // 4F stub (ms4-embeds §4)
    }
}
