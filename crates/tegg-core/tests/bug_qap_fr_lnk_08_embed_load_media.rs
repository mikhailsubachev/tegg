//! Slice P QA review: `embed_load` with `media: true` (v1-previews §2), the call every preview makes, resolves the
//! note's attachment targets after its note links (FR-LNK-08 AC-10), records no recency and writes nothing (FR-LNK-11
//! AC-12, D-138); without the flag nothing changes (FR-EMB-01 AC-2). Fixture: tests/fixtures/vaults/previews + the
//! runtime attachments of its README, in a temporary directory.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use common::*;
use tegg_core::{Core, CoreOptions, LinkKind};
use tegg_format::nfc;
use tegg_vault::{LocalFs, VaultFs};

const ODKAZY: &str = "Pages/Odkazy.md";
const VLOZENI: &str = "Pages/Vložení.md";

fn copy_dir(from: &Path, to: &Path, skip: &[&str]) {
    std::fs::create_dir_all(to).expect("setup: create dir");
    for e in std::fs::read_dir(from).expect("setup: read_dir") {
        let e = e.expect("setup: entry");
        if skip.iter().any(|s| e.file_name() == std::ffi::OsStr::new(s)) {
            continue;
        }
        if e.file_type().expect("setup: type").is_dir() {
            copy_dir(&e.path(), &to.join(e.file_name()), &[]);
        } else {
            std::fs::copy(e.path(), to.join(e.file_name())).expect("setup: copy");
        }
    }
}
fn previews_vault(sb: &Sandbox) -> PathBuf {
    let root = sb.base.join("Náhledy");
    let fx = repo_root().join("tests/fixtures/vaults");
    copy_dir(&fx.join("previews"), &root, &["README.md"]);
    copy_dir(&fx.join("new-empty/.tegg"), &root.join(".tegg"), &[]);
    copy_dir(&fx.join("previews/.tegg"), &root.join(".tegg"), &[]);
    std::fs::create_dir_all(root.join("_attachments")).expect("setup: _attachments");
    std::fs::copy(fx.join("trash-media/_attachments/záhon.png"), root.join("_attachments/graf.png")).expect("setup: graf.png");
    std::fs::copy(fx.join("trash-media/_attachments/Rozpočet.pdf"), root.join("_attachments/Smlouva.pdf")).expect("setup: Smlouva.pdf");
    root
}

#[test]
fn bug_qap_fr_lnk_08_embed_load_media_resolves_attachments_and_writes_nothing() {
    let sb = sandbox();
    let root = previews_vault(&sb);
    let fs = CountingFs::new(LocalFs::new(&root));
    let core = Core::open_with(fs.clone() as Arc<dyn VaultFs>, &sb.dirs, CoreOptions { watch: false, sync: None }).expect("Core::open_with");
    assert!(core.wait_idle(Duration::from_secs(60)), "indexing idle");
    let before = snapshot(&root);
    let recent0 = format!("{:?}", core.switcher("", 50));
    let paths = vec![ODKAZY.to_string(), VLOZENI.to_string()];

    let plain = core.embed_load(&paths);
    let media = core.embed_load_with(&paths, true);
    for (p, m) in plain.iter().zip(media.iter()) {
        assert_eq!(p.text, m.text, "the same text with and without the flag");
        let n = p.links.len();
        assert_eq!(m.links[..n], p.links[..], "the note links come first, unchanged");
        assert!(p.links.iter().all(|l| l.kind != LinkKind::Media), "without the flag no attachment resolves (FR-EMB-01 AC-2)");
        let extra: Vec<_> = m.links[n..].iter().map(|l| (nfc(&l.target), l.kind.clone(), l.path.as_deref().map(nfc))).collect();
        assert_eq!(extra, vec![("graf.png".to_string(), LinkKind::Media, Some("_attachments/graf.png".to_string()))], "{}: then its attachment", nfc(&m.path));
    }

    assert!(core.last_opened().is_none(), "no recency (D-138)");
    assert_eq!(format!("{:?}", core.switcher("", 50)), recent0, "the switcher's recents are unchanged");
    assert_eq!(fs.write_count(), 0, "no writes");
    drop(core);
    assert_eq!(snapshot(&root), before, "no vault file changed");
}
