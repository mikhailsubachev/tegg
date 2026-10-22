//! MS4 slice 4F (docs/contracts/ms4-embeds.md §4): loading embedded notes, one call per nesting level (D-429).

use tegg_format::nfc;

use crate::{lock, Core, FileVersion, LinkTarget, VaultError};

/// What `embed_load` found at a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedLoadState {
    Ok,
    /// No such file, or it is in `.trash/` or `_templates/`.
    Missing,
    Io,
    /// ms6-trash-media §2 (6A): a path under `.trash/` that exists (the D-27 placeholder). 6A stub: never returned.
    Trashed,
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
    pub fn embed_load(&self, paths: &[String]) -> Vec<EmbedNote> {
        let mut seen: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for p in paths {
            let path = nfc(p);
            if seen.contains(&path) {
                continue;
            }
            seen.push(path.clone());
            out.push(self.embed_one(&path));
        }
        out
    }

    fn embed_one(&self, path: &str) -> EmbedNote {
        let missing = |state| EmbedNote { path: path.to_string(), state, text: None, version: None, utf8: true, links: Vec::new() };
        // Never an embed target (FR-TPL-07, D-102).
        if path.starts_with("_templates/") || path.starts_with(".trash/") {
            return missing(EmbedLoadState::Missing);
        }
        let (bytes, version) = match self.shared.vault.read(path) {
            Ok(r) => r,
            Err(VaultError::NotFound) | Err(VaultError::Gone) => return missing(EmbedLoadState::Missing),
            Err(_) => return missing(EmbedLoadState::Io),
        };
        let utf8 = std::str::from_utf8(&bytes).is_ok();
        {
            // As `read_note_info`: a non-UTF-8 file is never written (NFR-REL-03), but no recency is recorded.
            let mut bad = lock(&self.shared.not_utf8);
            if utf8 { bad.remove(path) } else { bad.insert(path.to_string()) };
        }
        let text = String::from_utf8_lossy(&bytes).into_owned();
        let stem = path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md");
        let mut targets: Vec<String> = Vec::new();
        for l in tegg_format::extract(&bytes, stem).links {
            let t = l.target.trim().to_string();
            if !t.is_empty() && !is_attachment(&t) && !targets.contains(&t) {
                targets.push(t);
            }
        }
        let links = self.resolve_links(path, &targets);
        EmbedNote { path: path.to_string(), state: EmbedLoadState::Ok, text: Some(text), version: Some(version), utf8, links }
    }
}

/// A target with a file extension other than `.md` (and not a date): an attachment, never a note (D-144).
fn is_attachment(target: &str) -> bool {
    let name = target.rsplit('/').next().unwrap_or(target);
    match name.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() && ext.len() <= 6 && ext.chars().all(|c| c.is_ascii_alphanumeric()) => {
            !ext.eq_ignore_ascii_case("md") && !is_date(target)
        }
        _ => false,
    }
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}
