//! MS6 slice 6A AC tests at the core (L4): adding images and PDFs (docs/acceptance/trash-media.md R72, R73, FR-ATT-01
//! AC-1 the paste's file and object, create-exclusive, in this order, nothing else written; AC-4 names and titles;
//! AC-5 metadata from the bytes, per format (§3.1, one fixture file per format); AC-6 refused content and > 200 MB;
//! AC-7 a failed object write removes the file again; AC-9 the attachments folder setting; AC-15 backlinks of media,
//! search, the type lists; FR-SYN-06 AC-30 a paste writes exactly the file and the object). The object bytes follow the
//! twin table shared with packages/doc/test/media.ac.test.ts (§3.5). Interface docs/contracts/ms6-trash-media.md §3.1
//! (`media_info`), §3.3 (`media_names`), §3.4 (`Core::media_add`), §3.5 (`media_object`). Written from the ACs and the
//! contract only (D-61).
//!
//! Fixture: tests/fixtures/vaults/trash-media + new-empty/.tegg in a temporary directory; samples tests/fixtures/media.

mod common;
mod trash6a_setup;

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use common::*;
use tegg_core::{media_info, media_names, media_object, Core, CoreError, CoreOptions, MediaAdd, MediaInfo, MediaObjectFields, NameRequest, OwnerRef, VaultFs};
use tegg_format::nfc;
use tegg_vault::{FileVersion, FsEntry, LocalFs};
use trash6a_setup::*;

macro_rules! ok {
    ($e:expr, $what:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                assert!(false, "{} failed: {:?}", $what, e);
                unreachable!()
            }
        }
    };
}

const PASTED: &str = "Pasted image 20261022100000.png";

fn now() -> SystemTime {
    let t = chrono::DateTime::parse_from_rfc3339(NOW).expect("setup: NOW");
    SystemTime::UNIX_EPOCH + Duration::from_secs(t.timestamp() as u64)
}
fn png_info() -> MediaInfo {
    MediaInfo { media_type: "image/png", ext: "png", width: Some(64), height: Some(48), pages: None }
}
fn pdf_info() -> MediaInfo {
    MediaInfo { media_type: "application/pdf", ext: "pdf", width: None, height: None, pages: Some(2) }
}
fn add(name: &str, bytes: Vec<u8>, owner: Option<(&str, &str)>) -> MediaAdd {
    MediaAdd { bytes, name: name.to_string(), owner: owner.map(|(p, t)| OwnerRef { path: p.to_string(), title: t.to_string() }), now: now(), zone_date: "2026-10-22".to_string() }
}
/// The object's text with its id, `created` and `modified` checked and masked.
fn masked(t: &str) -> String {
    let mut out = Vec::new();
    for line in t.split_inclusive('\n') {
        if let Some(id) = line.strip_prefix("id: ") {
            let id = id.trim_end();
            assert!(id.len() == 26 && id.chars().all(|c| "0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(c)), "id is a ULID: {id}");
            out.push("id: <ULID>\n".to_string());
        } else if let Some(v) = line.strip_prefix("created: ").or_else(|| line.strip_prefix("modified: ")) {
            let at = chrono::DateTime::parse_from_rfc3339(v.trim_end());
            assert!(at.is_ok_and(|a| a.timestamp() == chrono::DateTime::parse_from_rfc3339(NOW).map(|n| n.timestamp()).unwrap_or(0)), "an ISO date-time with offset at now: {v}");
            out.push(format!("{}: <now>\n", if line.starts_with("created") { "created" } else { "modified" }));
        } else {
            out.push(line.to_string());
        }
    }
    out.concat()
}

// ------------------------------------------------------------------------------------------------ AC-5, AC-6: §3.1

#[test]
fn fr_att_01_ac5_media_info_per_format() {
    let rows: Vec<(&str, Vec<u8>, MediaInfo)> = vec![
        ("záhon.png", fixture(PNG), png_info()),
        ("Rozpočet.pdf", fixture(PDF), pdf_info()),
        ("exif6.jpg (EXIF orientation 6 swaps)", sample("exif6.jpg"), MediaInfo { media_type: "image/jpeg", ext: "jpg", width: Some(8), height: Some(16), pages: None }),
        ("plain.jpg", sample("plain.jpg"), MediaInfo { media_type: "image/jpeg", ext: "jpg", width: Some(16), height: Some(8), pages: None }),
        ("anim.gif", sample("anim.gif"), MediaInfo { media_type: "image/gif", ext: "gif", width: Some(3), height: Some(2), pages: None }),
        ("pixel.webp", sample("pixel.webp"), MediaInfo { media_type: "image/webp", ext: "webp", width: Some(1), height: Some(1), pages: None }),
        ("header.heic", sample("header.heic"), MediaInfo { media_type: "image/heic", ext: "heic", width: Some(40), height: Some(30), pages: None }),
        ("vektor.svg (viewBox)", sample("vektor.svg"), MediaInfo { media_type: "image/svg+xml", ext: "svg", width: Some(120), height: Some(80), pages: None }),
        ("vektor-px.svg (width, height)", sample("vektor-px.svg"), MediaInfo { media_type: "image/svg+xml", ext: "svg", width: Some(30), height: Some(20), pages: None }),
        ("tri-strany.pdf", sample("tri-strany.pdf"), MediaInfo { pages: Some(3), ..pdf_info() }),
    ];
    let bad: Vec<String> = rows.iter().filter(|(_, b, want)| media_info(b).as_ref() != Some(want)).map(|(n, b, want)| format!("{n}: want {want:?}, got {:?}", media_info(b))).collect();
    assert!(bad.is_empty(), "by magic bytes (§3.1): {bad:#?}");
    let head = [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    assert_eq!(media_info(&head), Some(MediaInfo { width: None, height: None, ..png_info() }), "unreadable metadata: the media type only (AC-5)");
}

#[test]
fn fr_att_01_ac6_refused_content() {
    assert!(media_info(&fixture(PNG)).is_some(), "a real PNG is accepted");
    for n in ["text.png", "empty.png", "zprava.docx"] {
        assert_eq!(media_info(&sample(n)), None, "{n} is refused by its bytes, whatever its extension");
    }
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    let before = snap(&root);
    let r = core.media_add(add("text.png", sample("text.png"), Some((PLAN, "Plán zahrady"))));
    assert!(matches!(r, Err(CoreError::Refused)), "media_add refuses: {r:?}");
    // §11 (AP-554): 200 MB = 200 × 1024 × 1024 bytes; one byte more is refused.
    let big = core.media_add(add("velký.png", { let mut v = fixture(PNG); v.resize(200 * 1024 * 1024 + 1, 0); v }, Some((PLAN, "Plán zahrady"))));
    assert!(matches!(big, Err(CoreError::TooLarge)), "over 200 MiB is refused (D-625): {:?}", big.as_ref().err());
    assert_eq!(changed(&before, &snap(&root)), Vec::<String>::new(), "nothing is written");
}

// ------------------------------------------------------------------------------------------------ AC-4: §3.3

fn exists_in(paths: &[&str]) -> impl Fn(&str) -> bool {
    let set: Vec<String> = paths.iter().map(|p| nfc(p).to_lowercase()).collect();
    move |p: &str| set.contains(&nfc(p).to_lowercase())
}
fn names(taken: &[&str], name: &str, info: MediaInfo, owner: Option<&str>, attachments: &str) -> (String, String, String) {
    let folder = if info.media_type == "application/pdf" { "PDFs" } else { "Images" };
    let req = NameRequest { name: name.to_string(), info, owner_title: owner.map(|s| s.to_string()), date: "2026-10-22".to_string(), attachments: attachments.to_string(), folder: folder.to_string() };
    let base = [PNG, PDF, IMG, PDF_OBJ, PLAN];
    let all: Vec<&str> = base.iter().copied().chain(taken.iter().copied()).collect();
    let n = media_names(&exists_in(&all), &req);
    (n.file, n.object, n.title)
}

#[test]
fn fr_att_01_ac4_r72_names_and_titles() {
    let heic = MediaInfo { media_type: "image/heic", ext: "heic", width: Some(40), height: Some(30), pages: None };
    let rows: Vec<((String, String, String), (&str, &str, &str))> = vec![
        (names(&[], "Záhon 2.PNG", png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Záhon 2.PNG", "Images/Záhon 2.md", "Záhon 2")),
        (names(&[], PASTED, png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Pasted image 20261022100000.png", "Images/Plán zahrady 1.md", "Plán zahrady 1")),
        (names(&[], "image.png", png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/image.png", "Images/Plán zahrady 1.md", "Plán zahrady 1")),
        (names(&[], "IMG_1234.HEIC", heic, Some("Plán zahrady"), "_attachments"), ("_attachments/IMG_1234.HEIC", "Images/Plán zahrady 1.md", "Plán zahrady 1")),
        (names(&[], "Rozpočet 2026.pdf", pdf_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Rozpočet 2026.pdf", "PDFs/Rozpočet 2026.md", "Rozpočet 2026")),
        (names(&[], PASTED, png_info(), None, "_attachments"), ("_attachments/Pasted image 20261022100000.png", "Images/Capture 2026-10-22 1.md", "Capture 2026-10-22 1")),
        (names(&[&format!("_attachments/{PASTED}")], PASTED, png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Pasted image 20261022100000 (2).png", "Images/Plán zahrady 1.md", "Plán zahrady 1")),
        (names(&["Images/Plán zahrady 1.md"], "image.png", png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/image.png", "Images/Plán zahrady 2.md", "Plán zahrady 2")),
        (names(&[], "Za\u{301}hon 2.png", png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Záhon 2.png", "Images/Záhon 2.md", "Záhon 2")),
        (names(&[], "Plán: jaro?.png", png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Plán jaro.png", "Images/Plán jaro.md", "Plán: jaro?")),
        (names(&[], "Obrázek", png_info(), Some("Plán zahrady"), "_attachments"), ("_attachments/Obrázek.png", "Images/Obrázek.md", "Obrázek")),
        (names(&[], PASTED, png_info(), Some("Plán zahrady"), "Přílohy"), ("Přílohy/Pasted image 20261022100000.png", "Images/Plán zahrady 1.md", "Plán zahrady 1")),
    ];
    let bad: Vec<String> = rows
        .iter()
        .filter(|(got, want)| (nfc(&got.0), nfc(&got.1), nfc(&got.2)) != (want.0.to_string(), want.1.to_string(), want.2.to_string()))
        .map(|(got, want)| format!("want {want:?}, got {got:?}"))
        .collect();
    assert!(bad.is_empty(), "R72/R73 (D-621): {bad:#?}");
}

// ------------------------------------------------------------------------------------------------ AC-1: §3.4, §3.5

/// Records the file system's writes in order (create, replace, rename, remove).
struct Recorder(LocalFs, Arc<Mutex<Vec<String>>>, Option<&'static str>);
impl Recorder {
    fn log(&self, s: String) {
        if let Ok(mut l) = self.1.lock() {
            l.push(s);
        }
    }
}
impl VaultFs for Recorder {
    fn list(&self) -> std::io::Result<Vec<FsEntry>> { self.0.list() }
    fn read(&self, p: &str) -> std::io::Result<(Vec<u8>, FileVersion)> { self.0.read(p) }
    fn version(&self, p: &str) -> std::io::Result<Option<FileVersion>> { self.0.version(p) }
    fn replace(&self, p: &str, b: &[u8]) -> std::io::Result<FileVersion> { self.log(format!("replace {}", nfc(p))); self.0.replace(p, b) }
    fn create_new(&self, p: &str, b: &[u8]) -> std::io::Result<FileVersion> {
        if self.2.is_some_and(|f| nfc(p).starts_with(f)) {
            return Err(std::io::Error::other("test: the object write fails"));
        }
        self.log(format!("create {}", nfc(p)));
        self.0.create_new(p, b)
    }
    fn rename_no_replace(&self, f: &str, t: &str) -> std::io::Result<()> { self.log(format!("rename {} {}", nfc(f), nfc(t))); self.0.rename_no_replace(f, t) }
    fn create_dir_all(&self, p: &str) -> std::io::Result<()> { self.0.create_dir_all(p) }
    fn remove_file(&self, p: &str) -> std::io::Result<()> { self.log(format!("remove {}", nfc(p))); self.0.remove_file(p) }
    fn changed_ns(&self, p: &str) -> std::io::Result<Option<i128>> { self.0.changed_ns(p) }
}
fn recorded(sb: &Sandbox, root: &std::path::Path, fail: Option<&'static str>) -> (Core, Arc<Mutex<Vec<String>>>) {
    let log = Arc::new(Mutex::new(Vec::new()));
    let fs: Arc<dyn VaultFs> = Arc::new(Recorder(LocalFs::new(root), log.clone(), fail));
    let core = match Core::open_with(fs, &sb.dirs, CoreOptions { watch: false, sync: None }) {
        Ok(c) => c,
        Err(e) => panic!("setup: open_with: {e:?}"),
    };
    assert!(core.wait_idle(Duration::from_secs(60)), "idle");
    log.lock().map(|mut l| l.clear()).ok();
    (core, log)
}

#[test]
fn fr_att_01_ac1_paste_writes_the_file_then_the_object() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let (core, log) = recorded(&sb, &root, None);
    let before = snap(&root);
    let added = ok!(core.media_add(add(PASTED, fixture(PNG), Some((PLAN, "Plán zahrady")))), "media_add");
    assert_eq!((nfc(&added.file), nfc(&added.object), added.title.clone(), added.embed.clone()), (format!("_attachments/{PASTED}"), "Images/Plán zahrady 1.md".to_string(), "Plán zahrady 1".to_string(), PASTED.to_string()), "R72 paste row");
    assert_eq!(added.info, png_info(), "the metadata read from the bytes");
    let ops = log.lock().map(|l| l.clone()).unwrap_or_default();
    assert_eq!(ops.iter().filter(|o| o.starts_with("create")).cloned().collect::<Vec<_>>(), vec![format!("create _attachments/{PASTED}"), "create Images/Plán zahrady 1.md".to_string()], "create-exclusive, the file first");
    assert!(!ops.iter().any(|o| o.starts_with("replace") || o.starts_with("remove")), "no replace, no remove: {ops:?}");
    assert_eq!(read(&root, &format!("_attachments/{PASTED}")), Some(fixture(PNG)), "the clipboard bytes, unchanged");
    let want = "---\nid: <ULID>\ntype: image\ntitle: Plán zahrady 1\ncreated: <now>\nmodified: <now>\nfile: \"[[Pasted image 20261022100000.png]]\"\nmedia-type: image/png\nsize: 1234\nwidth: 64\nheight: 48\nsource: \"[[Plán zahrady]]\"\n---\n";
    assert_eq!(masked(&text(&root, "Images/Plán zahrady 1.md")), want, "§3.5 bytes");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    // `changed` lists paths sorted (the write order is checked above through the file system's log).
    assert_eq!(diff, strs(&["Images/Plán zahrady 1.md", &format!("_attachments/{PASTED}")]), "FR-SYN-06 AC-30: exactly the file and the object");
    assert!(core.object("Images/Plán zahrady 1.md").is_some_and(|o| o.r#type == "image"), "indexed at once");
}

#[test]
fn fr_att_01_ac1_object_bytes_twin_table() {
    let table: serde_json::Value = serde_json::from_slice(&std::fs::read(repo_root().join("tests/fixtures/media/objects.json")).expect("setup: table")).expect("setup: json");
    let cases = table["cases"].as_array().cloned().unwrap_or_default();
    assert_eq!(cases.len(), 4, "four cases");
    let mut bad = Vec::new();
    for c in cases {
        let f = &c["fields"];
        let info = &f["info"];
        let st = |s: &str| -> &'static str { Box::leak(s.to_string().into_boxed_str()) };
        let num = |v: &serde_json::Value| v.as_u64().map(|n| n as u32);
        let fields = MediaObjectFields {
            id: f["id"].as_str().unwrap_or_default().to_string(),
            title: f["title"].as_str().unwrap_or_default().to_string(),
            now: f["now"].as_str().unwrap_or_default().to_string(),
            embed: f["embed"].as_str().unwrap_or_default().to_string(),
            info: MediaInfo { media_type: st(info["mediaType"].as_str().unwrap_or_default()), ext: st(info["ext"].as_str().unwrap_or_default()), width: num(&info["width"]), height: num(&info["height"]), pages: num(&info["pages"]) },
            size: f["size"].as_u64().unwrap_or_default(),
            source: f["source"].as_str().map(|s| s.to_string()),
        };
        let got = media_object(&fields);
        if got != c["bytes"].as_str().unwrap_or_default() {
            bad.push(format!("{}: {got:?}", c["name"]));
        }
    }
    assert!(bad.is_empty(), "§3.5 bytes, identical to the TS twin's table: {bad:#?}");
}

// ------------------------------------------------------------------------------------------------ AC-7

#[test]
fn fr_att_01_ac7_a_failed_object_write_removes_the_file_again() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let (core, log) = recorded(&sb, &root, Some("Images/"));
    let before = snap(&root);
    let r = core.media_add(add("Záhon 2.PNG", fixture(PNG), Some((PLAN, "Plán zahrady"))));
    assert!(matches!(r, Err(CoreError::Vault(_))), "the object's error is returned: {r:?}");
    let ops = log.lock().map(|l| l.clone()).unwrap_or_default();
    assert_eq!(ops, strs(&["create _attachments/Záhon 2.PNG", "remove _attachments/Záhon 2.PNG"]), "the file was written, then removed (its own new file)");
    let mut diff = changed(&before, &snap(&root));
    diff.retain(|p| !p.ends_with('/'));
    assert_eq!(diff, Vec::<String>::new(), "nothing half done");
}

// ------------------------------------------------------------------------------------------------ AC-9

#[test]
fn fr_att_01_ac9_the_attachments_folder_setting() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    write_raw(&root, ".tegg/vault.yml", text(&root, ".tegg/vault.yml").replace("attachments: _attachments", "attachments: Přílohy").as_bytes());
    let core = open(&root, &sb);
    let png = ident(&root, PNG);
    let added = ok!(core.media_add(add(PASTED, fixture(PNG), Some((PLAN, "Plán zahrady")))), "media_add");
    assert_eq!(nfc(&added.file), format!("Přílohy/{PASTED}"), "new files go to Přílohy/ (created)");
    assert!(root.join("Přílohy").is_dir(), "the folder is created");
    assert_eq!(ident(&root, PNG), png, "existing files aren't moved");
}

// ------------------------------------------------------------------------------------------------ AC-15

#[test]
fn fr_att_01_ac15_backlinks_search_and_type_lists() {
    let sb = sandbox();
    let root = tm_vault(&sb);
    let core = open(&root, &sb);
    assert!(core.backlinks(IMG).iter().any(|p| nfc(p) == PLAN), "Img's backlinks list Plán (it embeds the file, FR-ATT-07): {:?}", core.backlinks(IMG));
    assert!(core.backlinks(PDF_OBJ).iter().any(|p| nfc(p) == PLAN), "Pdf's backlinks list Plán");
    let s = ok!(core.search(&tegg_core::SearchQuery::text("Záhon", chrono_tz::Europe::Prague)), "search");
    assert!(s.results.iter().any(|r| nfc(&r.path) == IMG && r.r#type == "image"), "search finds Záhon as an image");
    let p = ok!(core.search(&tegg_core::SearchQuery::text("Rozpočet", chrono_tz::Europe::Prague)), "search");
    assert!(p.results.iter().any(|r| nfc(&r.path) == PDF_OBJ && r.r#type == "pdf"), "search finds Rozpočet as a PDF");
    assert!(core.list_type("image").iter().any(|o| nfc(&o.path) == IMG), "Images lists it");
    assert!(core.list_type("pdf").iter().any(|o| nfc(&o.path) == PDF_OBJ), "PDFs lists it");
}
