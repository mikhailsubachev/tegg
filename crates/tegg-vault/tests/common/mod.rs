//! Setup helpers for the tegg-vault AC tests. No assertions live here: a panic in this file is a setup
//! failure, never a red test (CONTRACT §5.2). Every helper only uses std::fs on temporary directories.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use tegg_vault::AppDirs;

pub const NFD_CTENI: &str = "C\u{30C}teni\u{301}"; // "Čtení" decomposed
pub const NFC_CTENI: &str = "\u{10C}ten\u{ED}";

pub const VAULT_YML: &str = "version: 1\ndefault-type: Quick Note\nattachments: _attachments\ndaily-format: YYYY-MM-DD\n";

/// A temporary sandbox: `base/` holds the vault parent, the Application Support stand-in and siblings.
pub struct Sandbox {
    pub tmp: tempfile::TempDir,
    pub base: PathBuf,
    pub dirs: AppDirs,
}

pub fn sandbox() -> Sandbox {
    let tmp = tempfile::tempdir().expect("tempdir");
    let base = tmp.path().canonicalize().expect("canonical tempdir");
    let app = base.join("Application Support").join("Tegg");
    std::fs::create_dir_all(&app).expect("app support dir");
    Sandbox { tmp, base, dirs: AppDirs { root: app } }
}

pub fn write_raw(root: &Path, rel: &str, bytes: &[u8]) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(&p, bytes).expect("write fixture file");
}

/// A hand-made Tegg vault (only `.tegg/vault.yml`), as an existing vault on disk would be.
pub fn manual_vault(root: &Path) {
    write_raw(root, ".tegg/vault.yml", VAULT_YML.as_bytes());
}

/// A realistic vault with notes, an untyped file, invalid YAML and files the app must not touch.
pub fn rich_vault(root: &Path) {
    manual_vault(root);
    write_raw(root, ".tegg/types/page.yml", b"name: Page\nplural: Pages\nfolder: Pages\nsystem: true\nversion: 1\nattributes: []\n");
    write_raw(root, "Pages/Netypovan\u{e1}.md", "# Nadpis\n\nText bez hlavi\u{10d}ky s #\u{161}t\u{ed}tkem.\n".as_bytes());
    write_raw(root, "Pages/Rozbit\u{e1}.md", "---\nstav: nov\u{fd}\nstav: hotov\u{fd}\n---\nT\u{11b}lo.\n".as_bytes());
    write_raw(
        root,
        "Tasks/Zavolat Tom\u{e1}\u{161}ovi.md",
        "---\nid: 01JA2B3C4D5E6F7G8H9J0KMNPQ\ntype: task\ndue: 2026-10-09\n---\nZavolat kv\u{16f}li \u{159}ece.\n".as_bytes(),
    );
    write_raw(root, "Images/Mapa \u{159}eky.md", b"---\ntype: image\nfile: \"[[mapa.png]]\"\n---\n");
    write_raw(root, "_attachments/mapa.png", &[0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0, 0, 0, 0]);
    write_raw(root, "_attachments/manu\u{e1}l.pdf", b"%PDF-1.7\n%%EOF\n");
    write_raw(root, "Docs/zpr\u{e1}va.docx", b"PK\x03\x04 docx");
    write_raw(root, "Docs/pozn\u{e1}mky.txt", "text \u{159}eka\n".as_bytes());
    write_raw(root, ".obsidian/app.json", b"{\"legacyEditor\":false}\n");
    write_raw(root, ".obsidian/snippets/pozn\u{e1}mka.md", b"# not a note\n");
    write_raw(root, ".git/HEAD", b"ref: refs/heads/main\n");
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Dir,
    File { bytes: Vec<u8>, mtime_ns: i128, ino: u64 },
}

/// Recursive snapshot of `root`: relative path (as stored on disk) → entry. Directory mtimes are not
/// recorded (creating a child changes them legitimately). `skip` names relative subtrees to leave out.
pub fn snapshot_skipping(root: &Path, skip: &[&Path]) -> BTreeMap<String, Entry> {
    fn walk(root: &Path, dir: &Path, skip: &[&Path], out: &mut BTreeMap<String, Entry>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd {
            let e = e.expect("dir entry");
            let p = e.path();
            if skip.iter().any(|s| p.starts_with(s)) {
                continue;
            }
            let rel = p.strip_prefix(root).expect("under root").to_string_lossy().into_owned();
            let md = std::fs::symlink_metadata(&p).expect("metadata");
            if md.is_dir() {
                out.insert(rel, Entry::Dir);
                walk(root, &p, skip, out);
            } else {
                let mtime_ns = md.mtime() as i128 * 1_000_000_000 + md.mtime_nsec() as i128;
                out.insert(rel, Entry::File { bytes: std::fs::read(&p).expect("read"), mtime_ns, ino: md.ino() });
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, skip, &mut out);
    out
}

pub fn snapshot(root: &Path) -> BTreeMap<String, Entry> {
    snapshot_skipping(root, &[])
}

/// Relative file paths (sorted) under `root`.
pub fn files(root: &Path) -> Vec<String> {
    snapshot(root).into_iter().filter(|(_, e)| matches!(e, Entry::File { .. })).map(|(k, _)| k).collect()
}

/// Relative directory paths (sorted) under `root`.
pub fn dirs_of(root: &Path) -> Vec<String> {
    snapshot(root).into_iter().filter(|(_, e)| matches!(e, Entry::Dir)).map(|(k, _)| k).collect()
}

/// Raw names in one directory, as bytes (to check NFC/NFD on disk).
pub fn raw_names(dir: &Path) -> Vec<Vec<u8>> {
    use std::os::unix::ffi::OsStrExt;
    let mut v: Vec<Vec<u8>> = std::fs::read_dir(dir)
        .map(|rd| rd.map(|e| e.expect("entry").file_name().as_bytes().to_vec()).collect())
        .unwrap_or_default();
    v.sort();
    v
}

pub fn inode(p: &Path) -> u64 {
    std::fs::metadata(p).expect("metadata").ino()
}

/// Top-level `key: value` scalars of a simple YAML document (quotes stripped); nested lines ignored.
pub fn top_level_scalars(yaml: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for line in yaml.lines() {
        if line.starts_with(' ') || line.starts_with('#') || line.starts_with('-') || line.trim().is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|x| x.strip_suffix('"')).unwrap_or(v);
            let v = v.strip_prefix('\'').and_then(|x| x.strip_suffix('\'')).unwrap_or(v);
            out.insert(k.trim().to_string(), v.to_string());
        }
    }
    out
}

/// Masks values of keys that legitimately differ between two creations (generated ids and timestamps).
pub fn mask_generated(text: &str) -> String {
    text.lines()
        .map(|l| {
            let t = l.trim_start();
            for k in ["id:", "created:", "modified:"] {
                if t.starts_with(k) {
                    return format!("{}{k} <masked>", &l[..l.len() - t.len()]);
                }
            }
            l.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("mkdir");
    for e in std::fs::read_dir(from).expect("read_dir") {
        let e = e.expect("entry");
        let dst = to.join(e.file_name());
        if e.file_type().expect("type").is_dir() {
            copy_tree(&e.path(), &dst);
        } else {
            std::fs::copy(e.path(), dst).expect("copy");
        }
    }
}

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().expect("repo root")
}
