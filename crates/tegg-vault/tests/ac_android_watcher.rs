//! Slice AND-1, L1 (Rust, Mac host): docs/acceptance/android-shell.md FR-SYN-03 AC-37 "Read events are not changes"
//! (F1, D-2028, T2) through the pure `tegg_vault::fs_change_of(event, base)` of docs/contracts/android-shell.md §3.1 and
//! RA6's table. The events are built here with `notify::Event::new(…).add_path(…)` (the `notify` re-export of
//! `tegg_vault`, contract §1), so the test runs on the Mac. Written from the ACs and the contract only (D-61); the
//! regression test `bug_and0f1_fr_syn_03_access_events_are_not_changes` is in `crates/tegg-vault/src/local.rs`.

use std::path::{Path, PathBuf};

use tegg_vault::notify::event::{
    AccessKind, AccessMode, CreateKind, DataChange, EventKind, MetadataKind, ModifyKind, RemoveKind, RenameMode,
};
use tegg_vault::notify::Event;
use tegg_vault::{fs_change_of, FsChange};

const BASE: &str = "/storage/emulated/0/Documents/Trezor";
const NOTE: &str = "Pages/Úvodní stránka.md";

fn nfd(s: &str) -> String {
    // "Úvodní stránka" decomposed by hand (no normalisation crate needed): U+00DA → U+0055 U+0301, U+00ED → U+0069
    // U+0301, U+00E1 → U+0061 U+0301.
    s.replace('Ú', "U\u{301}").replace('í', "i\u{301}").replace('á', "a\u{301}")
}

fn ev(kind: EventKind, rel: &str) -> Event {
    Event::new(kind).add_path(Path::new(BASE).join(rel))
}

fn show(c: &Option<FsChange>) -> String {
    format!("{c:?}")
}

fn one(rel: &str) -> Option<FsChange> {
    Some(FsChange::Paths(vec![rel.to_string()]))
}

#[test]
fn fr_syn_03_ac37_watcher_maps_event_kinds() {
    let base = Path::new(BASE);
    assert_ne!(nfd(NOTE), NOTE, "setup: the NFD spelling differs in bytes");

    // Read events: no change (Tegg's own reads, F1), in NFC and NFD bytes.
    let reads = [
        ("Access(Open(Any))", EventKind::Access(AccessKind::Open(AccessMode::Any))),
        ("Access(Read)", EventKind::Access(AccessKind::Read)),
        ("Access(Close(Read))", EventKind::Access(AccessKind::Close(AccessMode::Read))),
        ("Access(Close(Execute))", EventKind::Access(AccessKind::Close(AccessMode::Execute))),
        ("Access(Close(Other))", EventKind::Access(AccessKind::Close(AccessMode::Other))),
        ("Access(Close(Any))", EventKind::Access(AccessKind::Close(AccessMode::Any))),
        ("Access(Any)", EventKind::Access(AccessKind::Any)),
        ("Access(Other)", EventKind::Access(AccessKind::Other)),
    ];
    for (name, kind) in reads {
        for rel in [NOTE.to_string(), nfd(NOTE)] {
            let got = fs_change_of(&ev(kind, &rel), base);
            assert!(got.is_none(), "{name} on {rel:?} is a read, not a change (RA6); got {}", show(&got));
        }
    }

    // The end of another program's write is a change (AP-2028), reported NFC.
    let got = fs_change_of(&ev(EventKind::Access(AccessKind::Close(AccessMode::Write)), &nfd(NOTE)), base);
    assert_eq!(show(&got), show(&one(NOTE)), "Access(Close(Write)) on the NFD path → Paths([NFC path])");

    // Kinds are never trusted: every other event is a change of its path.
    let changes = [
        ("Modify(Data(Content))", EventKind::Modify(ModifyKind::Data(DataChange::Content))),
        ("Create(File)", EventKind::Create(CreateKind::File)),
        ("Remove(File)", EventKind::Remove(RemoveKind::File)),
        ("Modify(Metadata(Any))", EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any))),
        ("Any", EventKind::Any),
        ("Other", EventKind::Other),
    ];
    for (name, kind) in changes {
        for rel in [NOTE.to_string(), nfd(NOTE)] {
            let got = fs_change_of(&ev(kind, &rel), base);
            assert_eq!(show(&got), show(&one(NOTE)), "{name} on {rel:?} → Paths([\"{NOTE}\"]) (NFC)");
        }
    }

    // A rename reports both paths, in order.
    let rename = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
        .add_path(base.join("Pages/A.md"))
        .add_path(base.join("Pages/B.md"));
    let got = fs_change_of(&rename, base);
    assert_eq!(
        show(&got),
        show(&Some(FsChange::Paths(vec!["Pages/A.md".into(), "Pages/B.md".into()]))),
        "Modify(Name(Both)) → both paths in order"
    );

    // The rescan flag wins over the kind.
    let rescan = ev(EventKind::Access(AccessKind::Open(AccessMode::Any)), NOTE).set_flag(tegg_vault::notify::event::Flag::Rescan);
    assert_eq!(show(&fs_change_of(&rescan, base)), show(&Some(FsChange::Rescan)), "Access(Open(Any)) with the rescan flag → Rescan");

    // Paths outside the vault, and the vault root itself, are dropped.
    let outside = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content))).add_path(PathBuf::from("/storage/emulated/0/Documents/Jiný/Poznámka.md"));
    assert!(fs_change_of(&outside, base).is_none(), "a path outside base → None");
    let root_only = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(base.to_path_buf());
    assert!(fs_change_of(&root_only, base).is_none(), "the empty relative path is dropped → None");
}
