//! Static MS2 AC checks (D-95: rules that already hold in the skeleton; committed separately).
//! FR-SYN-07 AC-1 / FR-SYN-01 AC-1: no network calls and no sync-provider-specific code in the core crates,
//! except FR-VLT-03 placeholder detection (`.icloud` stubs, `SF_DATALESS`).

mod common;

use std::path::{Path, PathBuf};

fn rust_sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            rust_sources(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

fn crate_dirs() -> Vec<PathBuf> {
    let crates = common::repo_root().join("crates");
    let mut v: Vec<PathBuf> = std::fs::read_dir(&crates).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.join("Cargo.toml").exists()).collect()).unwrap_or_default();
    v.sort();
    v
}

#[test]
fn fr_syn_07_ac1_core_sources_have_no_network_or_provider_specific_code() {
    let dirs = crate_dirs();
    assert!(dirs.len() >= 4, "found crates: {dirs:?}");
    let forbidden = [
        "std::net", "TcpStream", "UdpSocket", "reqwest", "hyper::", "ureq::", "curl::", "Dropbox", "dropbox", "Google Drive",
        "GoogleDrive", "CloudStorage", "Mobile Documents", "com~apple~CloudDocs", "OneDrive", "FileProvider",
    ];
    let mut hits = Vec::new();
    for d in &dirs {
        let mut files = Vec::new();
        rust_sources(&d.join("src"), &mut files);
        for f in files {
            let text = std::fs::read_to_string(&f).unwrap_or_default();
            for (n, line) in text.lines().enumerate() {
                let code = line.split("//").next().unwrap_or("");
                for w in forbidden {
                    if code.contains(w) {
                        hits.push(format!("{}:{}: {w}", f.display(), n + 1));
                    }
                }
            }
        }
    }
    assert_eq!(hits, Vec::<String>::new());
}

#[test]
fn fr_syn_07_ac1_core_crates_depend_on_no_network_crate() {
    let forbidden = ["reqwest", "hyper", "ureq", "curl", "isahc", "surf", "tokio-tungstenite", "native-tls", "rustls", "openssl"];
    let mut hits = Vec::new();
    for d in crate_dirs() {
        let manifest = std::fs::read_to_string(d.join("Cargo.toml")).unwrap_or_default();
        for line in manifest.lines() {
            let key = line.split('=').next().unwrap_or("").trim();
            if forbidden.contains(&key) {
                hits.push(format!("{}: {key}", d.display()));
            }
        }
    }
    let lock = std::fs::read_to_string(common::repo_root().join("Cargo.lock")).unwrap_or_default();
    for w in forbidden {
        if lock.contains(&format!("name = \"{w}\"")) {
            hits.push(format!("Cargo.lock: {w}"));
        }
    }
    assert_eq!(hits, Vec::<String>::new());
}
