//! Capture writes into the vault. Platform-neutral (AR-03): std + libc only, no Tauri.
//!
//! Spike-grade versions of the rules the product core will own: file-name sanitizing
//! (FR-FMT-08, D-51, D-52, FR-FMT-12), atomic writes that never clobber (FR-SYN-02,
//! FR-LNK-14 duplicates) and the capture frontmatter (FR-CAP-04).

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, FixedOffset, SecondsFormat};
use unicode_normalization::UnicodeNormalization;

const MAX_STEM_BYTES: usize = 200; // D-51: without ".md"

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureKind {
    QuickNote,
    Task,
}

impl CaptureKind {
    fn type_name(self) -> &'static str {
        match self {
            CaptureKind::QuickNote => "Quick Note",
            CaptureKind::Task => "Task",
        }
    }
    fn folder(self) -> &'static str {
        match self {
            CaptureKind::QuickNote => "Quick Notes",
            CaptureKind::Task => "Tasks",
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Capture {
    pub kind: CaptureKind,
    pub text: String,
    /// Task only, `YYYY-MM-DD` (FR-FMT-11). Key name is provisional for the spike.
    pub due: Option<String>,
}

/// Title = first non-empty line, without a leading Markdown heading/list marker.
pub fn title_of(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let line = line.trim_start_matches('#').trim_start();
    let line = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")).unwrap_or(line);
    let t: String = line.nfc().collect();
    if t.is_empty() { "Untitled".into() } else { t }
}

/// File stem for a title: NFC, forbidden characters → space, collapsed spaces,
/// no leading/trailing dots or spaces (D-52), and `stem + suffix` ≤ 200 bytes (D-51).
pub fn sanitize_stem(title: &str, suffix_reserve: usize) -> String {
    let mut out = String::new();
    for c in title.nfc() {
        let bad = matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            || c.is_control();
        let c = if bad || c.is_whitespace() { ' ' } else { c };
        if c == ' ' && (out.is_empty() || out.ends_with(' ')) {
            continue;
        }
        out.push(c);
    }
    let budget = MAX_STEM_BYTES - suffix_reserve;
    if out.len() > budget {
        let mut end = budget;
        while !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
    }
    let out = out.trim_matches(|c| c == ' ' || c == '.').to_string();
    if out.is_empty() { "Untitled".into() } else { out }
}

/// YAML double-quoted scalar (JSON strings are valid YAML).
fn yaml_str(s: &str) -> String {
    serde_json::to_string(s).expect("string serializes")
}

pub fn render(c: &Capture, id: &str, now: DateTime<FixedOffset>) -> String {
    let ts = now.to_rfc3339_opts(SecondsFormat::Secs, false);
    let mut fm = vec![
        format!("id: {id}"),
        format!("type: {}", c.kind.type_name()),
        format!("title: {}", yaml_str(&title_of(&c.text))),
        format!("created: {ts}"),
        "review: unreviewed".to_string(),
        format!("captured: {ts}"),
    ];
    if c.kind == CaptureKind::Task {
        if let Some(d) = c.due.as_deref().filter(|d| is_plain_date(d)) {
            fm.push(format!("due: {d}"));
        }
    }
    let body = c.text.trim_end_matches(['\n', '\r', ' ']).nfc().collect::<String>();
    format!("---\n{}\n---\n\n{}\n", fm.join("\n"), body)
}

fn is_plain_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() && s.len() == 10
}

/// Writes a new capture and returns its path. Never overwrites: a taken name gets ` (2)`, ` (3)` …
pub fn write_capture(vault: &Path, c: &Capture, now: DateTime<FixedOffset>) -> io::Result<PathBuf> {
    let dir = vault.join(c.kind.folder());
    fs::create_dir_all(&dir)?;
    let id = uuid::Uuid::new_v4().to_string();
    let content = render(c, &id, now);
    let title = title_of(&c.text);

    let tmp = dir.join(format!(".{id}.tegg-tmp"));
    {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    let result = (|| {
        for n in 1..1000 {
            let suffix = if n == 1 { String::new() } else { format!(" ({n})") };
            let stem = sanitize_stem(&title, " (999)".len());
            let target = dir.join(format!("{stem}{suffix}.md"));
            match rename_no_clobber(&tmp, &target) {
                Ok(()) => return Ok(target),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        Err(io::Error::new(io::ErrorKind::AlreadyExists, "no free file name"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Atomic rename that fails with `AlreadyExists` instead of replacing the target (FR-SYN-02, NFR-REL-02).
#[cfg(target_os = "macos")]
fn rename_no_clobber(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let a = CString::new(from.as_os_str().as_bytes())?;
    let b = CString::new(to.as_os_str().as_bytes())?;
    // SAFETY: both are valid NUL-terminated paths for the duration of the call.
    let r = unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) };
    if r == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
}

/// Portable fallback: a hard link fails if the target exists; then drop the temp name.
#[cfg(not(target_os = "macos"))]
fn rename_no_clobber(from: &Path, to: &Path) -> io::Result<()> {
    fs::hard_link(from, to)?;
    fs::remove_file(from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339("2026-10-10T09:05:00+02:00").unwrap()
    }

    #[test]
    fn fr_cap_04_capture_is_unreviewed_with_captured_timestamp() {
        let c = Capture { kind: CaptureKind::QuickNote, text: "Koupit mléko\nvíc textu".into(), due: None };
        let s = render(&c, "x1", now());
        assert_eq!(
            s,
            "---\nid: x1\ntype: Quick Note\ntitle: \"Koupit mléko\"\ncreated: 2026-10-10T09:05:00+02:00\n\
             review: unreviewed\ncaptured: 2026-10-10T09:05:00+02:00\n---\n\nKoupit mléko\nvíc textu\n"
        );
    }

    #[test]
    fn fr_fmt_11_task_due_is_plain_date_or_dropped() {
        let mut c = Capture { kind: CaptureKind::Task, text: "Call".into(), due: Some("2026-10-12".into()) };
        assert!(render(&c, "x", now()).contains("\ndue: 2026-10-12\n"));
        c.due = Some("2026-10-12T10:00".into());
        assert!(!render(&c, "x", now()).contains("due:"));
    }

    #[test]
    fn fr_fmt_08_sanitizes_forbidden_characters_and_length() {
        assert_eq!(sanitize_stem("a/b: c?  d", 0), "a b c d");
        assert_eq!(sanitize_stem("..hidden.", 0), "hidden");
        assert_eq!(sanitize_stem("", 0), "Untitled");
        let long = "ž".repeat(300);
        let s = sanitize_stem(&long, 6);
        assert!(s.len() + 6 <= 200 && s.len() > 190 && s.chars().all(|c| c == 'ž'));
    }

    #[test]
    fn fr_fmt_12_titles_and_names_are_nfc() {
        let decomposed = "Cafe\u{301} c\u{30c}aj";
        assert_eq!(title_of(decomposed), "Café čaj");
        assert_eq!(sanitize_stem(decomposed, 0), "Café čaj");
    }

    #[test]
    fn fr_lnk_14_duplicate_titles_get_suffix_and_never_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let c = Capture { kind: CaptureKind::QuickNote, text: "Same".into(), due: None };
        let a = write_capture(dir.path(), &c, now()).unwrap();
        let before = fs::read(&a).unwrap();
        let b = write_capture(dir.path(), &c, now()).unwrap();
        let d = write_capture(dir.path(), &c, now()).unwrap();
        assert_eq!(a.file_name().unwrap(), "Same.md");
        assert_eq!(b.file_name().unwrap(), "Same (2).md");
        assert_eq!(d.file_name().unwrap(), "Same (3).md");
        assert_eq!(fs::read(&a).unwrap(), before);
        let leftovers: Vec<_> = fs::read_dir(a.parent().unwrap()).unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tegg-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind");
    }

    #[test]
    fn fr_syn_02_rename_no_clobber_refuses_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        fs::write(&a, "new").unwrap();
        fs::write(&b, "old").unwrap();
        let e = rename_no_clobber(&a, &b).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&b).unwrap(), "old");
    }
}
