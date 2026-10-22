//! MS6 slice 6A AC tests of the desktop shell (L4, `app-shell-test` step): the read-only media scheme
//! (docs/acceptance/trash-media.md FR-ATT-01 AC-12 "loaded from the vault through the shell's media protocol; no other
//! scheme, no network, no file outside the vault"; docs/contracts/ms6-trash-media.md §3.6; D-622). Through
//! `tegg_app_lib::media_scheme_probe(vault_root, method, uri, webview_label, range)`, the function the
//! `register_asynchronous_uri_scheme_protocol("tegg-media", …)` handler answers with (the contract names the mechanism,
//! not the entry point: red-test point AP-548): a vault image is `200` with its sniffed type and `no-cache`; a path
//! outside the vault, through `..`, through a symlink out of it, under `.tegg/`, a folder, a missing file or a non-media
//! file is `404` with an empty body; only `GET`; a PDF honours `Range`; staging URLs answer the capture window only.
//! Written from the AC and the contract only (D-61).

use std::path::{Path, PathBuf};

use tegg_app_lib::media_scheme_probe;

struct Tmp(PathBuf);
impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
/// A copy of the trash-media fixture's files the tests need, plus a file outside the vault and a symlink to it.
fn vault(tag: &str) -> (Tmp, PathBuf) {
    let base = std::env::temp_dir().join(format!("tegg-6a-scheme-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let root = base.join("Zahrada");
    let fx = repo().join("tests/fixtures/vaults/trash-media");
    for rel in ["_attachments/záhon.png", "_attachments/Rozpočet.pdf", "Images/Záhon.md", ".trash/_attachments/Smazaný obrázek.png"] {
        let to = root.join(rel);
        std::fs::create_dir_all(to.parent().expect("setup: parent")).expect("setup: dir");
        std::fs::copy(fx.join(rel), &to).expect("setup: copy");
    }
    std::fs::create_dir_all(root.join(".tegg")).expect("setup: .tegg");
    std::fs::copy(fx.join("_attachments/záhon.png"), root.join(".tegg/skryto.png")).expect("setup: .tegg png");
    std::fs::write(base.join("venku.png"), std::fs::read(fx.join("_attachments/záhon.png")).expect("setup: read")).expect("setup: outside");
    std::os::unix::fs::symlink(base.join("venku.png"), root.join("_attachments/odkaz.png")).expect("setup: symlink");
    (Tmp(base), root)
}
const U: &str = "tegg-media://localhost/";
fn url(path: &str) -> String {
    let enc: String = path.split('/').map(|seg| seg.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>()).collect::<Vec<_>>().join("/");
    format!("{U}{enc}")
}

#[test]
fn fr_att_01_ac12_a_vault_image_is_served_read_only() {
    let (_t, root) = vault("ok");
    let r = media_scheme_probe(&root, "GET", &url("_attachments/záhon.png"), "main", None);
    assert_eq!(r.status, 200, "a vault image");
    assert_eq!(r.content_type.as_deref(), Some("image/png"), "the sniffed media type");
    assert_eq!(r.body, std::fs::read(root.join("_attachments/záhon.png")).unwrap_or_default(), "its bytes");
    let nfd = media_scheme_probe(&root, "GET", &url("_attachments/za\u{301}hon.png"), "main", None);
    assert_eq!(nfd.status, 200, "the path is NFC-normalized");
    let trashed = media_scheme_probe(&root, "GET", &url(".trash/_attachments/Smazaný obrázek.png"), "main", None);
    assert_eq!(trashed.status, 200, "trashed files are served (the Trash view shows them)");
}

#[test]
fn fr_att_01_ac12_nothing_outside_the_vault_or_not_media() {
    let (_t, root) = vault("no");
    for (what, uri) in [
        ("outside through ..", format!("{U}..%2Fvenku.png")),
        ("outside through ../ segments", format!("{U}_attachments/../../venku.png")),
        ("a symlink out of the vault", url("_attachments/odkaz.png")),
        ("under .tegg/", url(".tegg/skryto.png")),
        ("a folder (no listing)", url("_attachments")),
        ("a missing file", url("_attachments/chybí.png")),
        ("a note (not media)", url("Images/Záhon.md")),
        ("an absolute path", format!("{U}%2Fetc%2Fhosts")),
    ] {
        let r = media_scheme_probe(&root, "GET", &uri, "main", None);
        assert_eq!((r.status, r.body.len()), (404, 0), "{what}: 404 with an empty body ({uri})");
    }
    let ok = media_scheme_probe(&root, "GET", &url("_attachments/záhon.png"), "main", None);
    assert_eq!(ok.status, 200, "positive control");
    for m in ["POST", "PUT", "DELETE"] {
        assert_eq!(media_scheme_probe(&root, m, &url("_attachments/záhon.png"), "main", None).status, 404, "{m}: GET only");
    }
}

#[test]
fn fr_att_01_ac12_pdf_range_requests() {
    let (_t, root) = vault("range");
    let all = std::fs::read(root.join("_attachments/Rozpočet.pdf")).unwrap_or_default();
    let r = media_scheme_probe(&root, "GET", &url("_attachments/Rozpočet.pdf"), "main", Some("bytes=0-7"));
    assert_eq!(r.status, 206, "Range honoured for PDFs");
    assert_eq!(r.content_type.as_deref(), Some("application/pdf"), "PDF");
    assert_eq!(r.body, all[..8].to_vec(), "the requested bytes");
}

#[test]
fn fr_att_01_ac11_staging_urls_answer_the_capture_window_only() {
    let (_t, root) = vault("stage");
    let main = media_scheme_probe(&root, "GET", &format!("{U}stage/unknown-token"), "main", None);
    assert_eq!(main.status, 404, "the main window gets no staging URL");
    let unknown = media_scheme_probe(&root, "GET", &format!("{U}stage/unknown-token"), "capture", None);
    assert_eq!(unknown.status, 404, "an unknown token is 404");
    let ok = media_scheme_probe(&root, "GET", &url("_attachments/záhon.png"), "main", None);
    assert_eq!(ok.status, 200, "positive control: vault files answer the main window");
}
