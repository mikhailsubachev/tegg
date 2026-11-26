//! Slice AND-2 (docs/contracts/android-phone.md §4.4, D-2420): the scheme check of `android_open_url`, pure and
//! compiled on every target so the host tests can run it.

/// True exactly when the trimmed URL parses and its scheme, case-insensitive, is `http`, `https`, `mailto` or `tel`.
/// `javascript:`, `file:`, `data:`, `content:`, `intent:`, relative and empty URLs are refused.
pub fn open_url_allowed(url: &str) -> bool {
    let url = url.trim();
    let Some(colon) = url.find(':') else { return false };
    let scheme = &url[..colon];
    let rest = &url[colon + 1..];
    // RFC 3986 scheme: a letter, then letters, digits, `+`, `-` or `.`.
    let valid = scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid {
        return false;
    }
    match scheme.to_ascii_lowercase().as_str() {
        // A web URL needs a host: `https://example.org`, not `https:` or `https:///x`.
        "http" | "https" => rest.strip_prefix("//").is_some_and(|r| r.split(['/', '?', '#']).next().is_some_and(|h| !h.is_empty())),
        "mailto" | "tel" => !rest.is_empty(),
        _ => false,
    }
}

/// Slice AND-3 (docs/contracts/android-edit.md §4.5, D-2511): the recovery copy's file key, lower-case hex SHA-256 of
/// `vault + "\u{0}" + NFC(path)`. The UI's `recoveryKey` (app/ui/src/phone/recovery.ts) gives the same key.
pub fn recovery_key(vault: &str, path: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(vault.as_bytes());
    h.update([0u8]);
    h.update(tegg_format::nfc(path).as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// android-edit §11.2 (FR-EDT-08 AC-17; CP-4 → D-2530): the recovery copies, one JSON file per vault and note in
/// `<files_dir>/recovery/` (machine-local, FR-STO-07; never in the vault). Compiled on every target so the host tests
/// run them; only the Android commands call them.
pub mod recovery {
    use std::path::{Path, PathBuf};

    use crate::dto::RecoveryDto;

    /// `<dir>/<recovery_key(vault, path)>.json`.
    pub fn file(dir: &Path, vault: &str, path: &str) -> PathBuf {
        dir.join(format!("{}.json", super::recovery_key(vault, path)))
    }

    /// Writes `copy` for the open vault `vault`: its `vault` is set to that root and its `path` to NFC, then the file is
    /// written with a temp file and a rename in `dir` (`write_local_file`).
    pub fn put(dir: &Path, vault: &str, mut copy: RecoveryDto) -> std::io::Result<()> {
        copy.vault = vault.to_string();
        copy.path = tegg_format::nfc(&copy.path);
        let bytes = serde_json::to_vec(&copy).map_err(std::io::Error::other)?;
        tegg_vault::write_local_file(&file(dir, vault, &copy.path), &bytes)
    }

    /// The copy for `vault` and the NFC form of `path`, if one is kept and readable.
    pub fn get(dir: &Path, vault: &str, path: &str) -> Option<RecoveryDto> {
        let bytes = tegg_vault::read_local_file(&file(dir, vault, path))?;
        let copy: RecoveryDto = serde_json::from_slice(&bytes).ok()?;
        (copy.vault == vault && tegg_format::nfc(&copy.path) == tegg_format::nfc(path)).then_some(copy)
    }

    /// Removes the copy; a missing one is fine.
    pub fn remove(dir: &Path, vault: &str, path: &str) -> std::io::Result<()> {
        tegg_vault::remove_local_path(&file(dir, vault, path))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::dto::VersionDto;

        fn copy(path: &str, text: &str) -> RecoveryDto {
            RecoveryDto {
                vault: "/elsewhere".into(),
                path: path.into(),
                id: Some("01JBAN3000000000000000R001".into()),
                title: "Psaní".into(),
                text: text.into(),
                base: Some(VersionDto { mtime_ns: "1".into(), size: 3, hash: "ab".into() }),
                saved_at: "2026-10-14T12:00:00+02:00".into(),
            }
        }

        /// FR-EDT-08 AC-17 (D-2511): a copy kept for one vault and note comes back for that vault and the note's NFC
        /// path only, is replaced by a later one, and is gone after `drop` (a second `drop` is fine).
        #[test]
        fn fr_edt_08_ac17_recovery_copies_round_trip() {
            let t = std::env::temp_dir().join(format!("tegg-recovery-{}-{:?}", std::process::id(), std::thread::current().id()));
            let dir = t.join("recovery");
            let vault = "/storage/emulated/0/Documents/Editor";
            put(&dir, vault, copy("Pages/Psani\u{301}.md", "první")).expect("put");
            put(&dir, vault, copy("Pages/Psaní.md", "druhá")).expect("put again");
            let got = get(&dir, vault, "Pages/Psaní.md").expect("the copy");
            assert_eq!((got.vault.as_str(), got.path.as_str(), got.text.as_str()), (vault, "Pages/Psaní.md", "druhá"));
            assert!(get(&dir, "/storage/emulated/0/Documents/Jiný", "Pages/Psaní.md").is_none(), "another vault has no copy");
            assert_eq!(std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0), 1, "one file per vault and note, no temp file left");
            remove(&dir, vault, "Pages/Psani\u{301}.md").expect("drop");
            assert!(get(&dir, vault, "Pages/Psaní.md").is_none(), "dropped");
            remove(&dir, vault, "Pages/Psaní.md").expect("a missing copy is fine");
            let _ = std::fs::remove_dir_all(&t);
        }
    }
}
