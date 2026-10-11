//! AC tests for the file-system seam (docs/contracts/ms1-core.md §3.1): AR-04 AC-2 (in-memory and local
//! `VaultFs` give identical results), AR-04 AC-3 (`SyncAdapter` with a folder implementation),
//! FR-FMT-12 AC-1 (NFD names listed as NFC). Written from the ACs and the contract only (D-61).

mod common;

use common::*;
use std::io::ErrorKind;
use tegg_vault::*;

const A: &str = "Řeka 1\n";
const B: &str = "Řeka 2, delší\n";

fn kind<T>(r: &std::io::Result<T>) -> String {
    match r {
        Ok(_) => "ok".into(),
        Err(e) => format!("{:?}", e.kind()),
    }
}

/// Runs one scenario through any `VaultFs` and records every observable outcome except mtimes.
fn fs_scenario(fs: &dyn VaultFs) -> (Vec<String>, Option<[u8; 32]>) {
    let mut t = Vec::new();
    t.push(format!("mkdir Pages: {}", kind(&fs.create_dir_all("Pages"))));
    let replaced = fs.replace("Pages/Čtení.md", A.as_bytes());
    t.push(format!("replace: {} size={:?}", kind(&replaced), replaced.as_ref().ok().map(|v| v.size)));
    let read = fs.read("Pages/Čtení.md");
    t.push(format!(
        "read: {} bytes={:?} same-version={}",
        kind(&read),
        read.as_ref().ok().map(|(b, _)| String::from_utf8_lossy(b).into_owned()),
        matches!((&read, &replaced), (Ok((_, v)), Ok(w)) if v == w)
    ));
    let version = fs.version("Pages/Čtení.md");
    t.push(format!(
        "version: {} same={}",
        kind(&version),
        matches!((&version, &replaced), (Ok(Some(v)), Ok(w)) if v == w)
    ));
    t.push(format!("version missing: {:?}", fs.version("Pages/Chybí.md").map(|v| v.is_none()).map_err(|e| e.kind())));
    t.push(format!("read missing: {}", kind(&fs.read("Pages/Chybí.md"))));
    t.push(format!("create_new existing: {}", kind(&fs.create_new("Pages/Čtení.md", B.as_bytes()))));
    t.push(format!(
        "after create_new existing: {:?}",
        fs.read("Pages/Čtení.md").ok().map(|(b, _)| String::from_utf8_lossy(&b).into_owned())
    ));
    let created = fs.create_new("Pages/Nový.md", B.as_bytes());
    t.push(format!("create_new fresh: {} size={:?}", kind(&created), created.as_ref().ok().map(|v| v.size)));
    let hashes_differ = matches!((&replaced, &created), (Ok(a), Ok(b)) if a.hash != b.hash);
    t.push(format!("hashes differ for different bytes: {hashes_differ}"));
    t.push(format!("rename onto existing: {}", kind(&fs.rename_no_replace("Pages/Nový.md", "Pages/Čtení.md"))));
    t.push(format!("mkdir Tasks: {}", kind(&fs.create_dir_all("Tasks"))));
    t.push(format!("rename to free name: {}", kind(&fs.rename_no_replace("Pages/Nový.md", "Tasks/Nový.md"))));
    let replaced2 = fs.replace("Pages/Čtení.md", B.as_bytes());
    t.push(format!("replace existing: {} size={:?}", kind(&replaced2), replaced2.as_ref().ok().map(|v| v.size)));
    let mut listed: Vec<String> = fs
        .list()
        .map(|v| {
            v.into_iter()
                .map(|e| match e {
                    FsEntry::File { path } => format!("F {path}"),
                    FsEntry::Dir { path } => format!("D {path}"),
                })
                .collect()
        })
        .unwrap_or_else(|e| vec![format!("list error {:?}", e.kind())]);
    listed.sort();
    t.push(format!("list: {listed:?}"));
    (t, replaced.ok().map(|v| v.hash))
}

fn expected_fs_transcript() -> Vec<String> {
    vec![
        "mkdir Pages: ok".into(),
        format!("replace: ok size=Some({})", A.len()),
        format!("read: ok bytes=Some({A:?}) same-version=true"),
        "version: ok same=true".into(),
        "version missing: Ok(true)".into(),
        format!("read missing: {:?}", ErrorKind::NotFound),
        format!("create_new existing: {:?}", ErrorKind::AlreadyExists),
        format!("after create_new existing: Some({A:?})"),
        format!("create_new fresh: ok size=Some({})", B.len()),
        "hashes differ for different bytes: true".into(),
        format!("rename onto existing: {:?}", ErrorKind::AlreadyExists),
        "mkdir Tasks: ok".into(),
        "rename to free name: ok".into(),
        format!("replace existing: ok size=Some({})", B.len()),
        format!("list: {:?}", vec!["D Pages", "D Tasks", "F Pages/Čtení.md", "F Tasks/Nový.md"]),
    ]
}

#[test]
fn ar_04_ac2_local_fs_follows_the_vault_fs_contract() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    std::fs::create_dir_all(&root).expect("root");
    let (t, _) = fs_scenario(&LocalFs::new(&root));
    assert_eq!(t, expected_fs_transcript());
}

#[test]
fn ar_04_ac2_mem_fs_follows_the_vault_fs_contract() {
    let (t, _) = fs_scenario(&MemFs::new());
    assert_eq!(t, expected_fs_transcript());
}

#[test]
fn ar_04_ac2_mem_and_local_fs_give_identical_results_and_hashes() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    std::fs::create_dir_all(&root).expect("root");
    let (tl, hl) = fs_scenario(&LocalFs::new(&root));
    let (tm, hm) = fs_scenario(&MemFs::new());
    assert_eq!(tl, tm);
    assert!(hl.is_some() && hl == hm, "BLAKE3 of the same bytes must agree: {hl:?} vs {hm:?}");
}

/// The same vault-level scenario on any `VaultFs` (writes, unchanged writes, conflicts, names, trash).
fn vault_scenario(fs: Box<dyn VaultFs>, dirs: &AppDirs) -> Vec<String> {
    let mut t = Vec::new();
    let vault = match Vault::open_with(fs, dirs) {
        Ok(v) => v,
        Err(e) => return vec![format!("open_with failed: {e:?}")],
    };
    let created = vault.create_file("Pages", "Řeka", "md", A.as_bytes());
    t.push(format!("create note: {:?}", created.as_ref().ok().map(|(p, v)| (p.clone(), v.size))));
    let read = vault.read("Pages/Řeka.md");
    let base = read.as_ref().ok().map(|(_, v)| v.clone());
    t.push(format!("read: {:?}", read.as_ref().ok().map(|(b, _)| String::from_utf8_lossy(b).into_owned())));
    let same = vault.write("Pages/Řeka.md", A.as_bytes(), base.as_ref());
    t.push(format!("write same: {:?}", same.as_ref().ok()));
    let changed = vault.write("Pages/Řeka.md", B.as_bytes(), base.as_ref());
    t.push(format!("write changed: {}", matches!(&changed, Ok(WriteOutcome::Written(v)) if v.size == B.len() as u64)));
    let stale = vault.write("Pages/Řeka.md", "třetí\n".as_bytes(), base.as_ref());
    t.push(format!("write with stale base: {}", matches!(stale, Err(VaultError::Conflict { .. }))));
    let p1 = vault.create_file("_attachments", "photo", "png", &[1]).map(|(p, _)| p).ok();
    let p2 = vault.create_file("_attachments", "photo", "png", &[2]).map(|(p, _)| p).ok();
    t.push(format!("create_file: {p1:?} {p2:?}"));
    let trashed = vault.trash("Pages/Řeka.md").ok();
    t.push(format!("trash: {trashed:?}"));
    let restored = trashed.as_deref().and_then(|p| vault.restore(p).ok());
    t.push(format!("restore: {restored:?}"));
    let mut managed = vault.managed_files().unwrap_or_default();
    managed.sort();
    t.push(format!("managed: {managed:?}"));
    t
}

fn expected_vault_transcript() -> Vec<String> {
    vec![
        format!("create note: {:?}", Some(("Pages/Řeka.md".to_string(), A.len() as u64))),
        format!("read: Some({A:?})"),
        "write same: Some(Unchanged)".into(),
        "write changed: true".into(),
        "write with stale base: true".into(),
        format!("create_file: {:?} {:?}", Some("_attachments/photo.png"), Some("_attachments/photo (2).png")),
        format!("trash: {:?}", Some(".trash/Pages/Řeka.md")),
        format!("restore: {:?}", Some("Pages/Řeka.md")),
        format!(
            "managed: {:?}",
            vec![".tegg/vault.yml", "Pages/Řeka.md", "_attachments/photo (2).png", "_attachments/photo.png"]
        ),
    ]
}

#[test]
fn ar_04_ac2_vault_behaves_identically_on_mem_and_local_fs() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    manual_vault(&root);
    let local = vault_scenario(Box::new(LocalFs::new(&root)), &sb.dirs);
    let mem = MemFs::new();
    let seeded = mem.create_dir_all(".tegg").is_ok() && mem.replace(".tegg/vault.yml", VAULT_YML.as_bytes()).is_ok();
    let in_memory = if seeded { vault_scenario(Box::new(mem), &sb.dirs) } else { vec!["MemFs could not be seeded".into()] };
    assert_eq!(local, expected_vault_transcript());
    assert_eq!(in_memory, local);
}

struct InjectingAdapter;
impl SyncAdapter for InjectingAdapter {
    fn name(&self) -> &str {
        "test-injector"
    }
}

#[test]
fn ar_04_ac3_sync_adapter_trait_has_a_folder_implementation() {
    let adapters: Vec<Box<dyn SyncAdapter>> = vec![Box::new(FolderSync), Box::new(InjectingAdapter)];
    let names: Vec<String> = adapters.iter().map(|a| a.name().to_string()).collect();
    assert!(!names[0].is_empty(), "FolderSync has a name");
    assert_ne!(names[0], names[1]);
}

#[test]
fn fr_fmt_12_ac1_local_fs_lists_nfd_names_as_nfc() {
    let sb = sandbox();
    let root = sb.base.join("Trezor");
    write_raw(&root, &format!("Pages/{NFD_CTENI}.md"), "Kniha.\n".as_bytes());
    let fs = LocalFs::new(&root);
    let mut listed: Vec<String> = fs
        .list()
        .map(|v| v.into_iter().filter_map(|e| if let FsEntry::File { path } = e { Some(path) } else { None }).collect())
        .unwrap_or_default();
    listed.sort();
    assert_eq!(listed, vec![format!("Pages/{NFC_CTENI}.md")]);
    let read = fs.read(&format!("Pages/{NFC_CTENI}.md"));
    assert!(matches!(&read, Ok((b, _)) if b == "Kniha.\n".as_bytes()), "read: {:?}", read.as_ref().err());
}
