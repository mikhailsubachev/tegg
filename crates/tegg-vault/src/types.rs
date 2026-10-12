//! Type definitions read from `.tegg/types/*.yml` (docs/contracts/ms3-shell.md §2 `vault_types`, §10).
//! Read-only display fields until `tegg-schema` (MS3 slice 3D, AR-07); never writes a type file.

use crate::{FsEntry, Vault};
use tegg_format::nfc;

const TYPES_DIR: &str = ".tegg/types/";

/// One `.tegg/types/<key>.yml` file, keys and names NFC (FR-FMT-12). Mirrors `TypeDefDto` (ms3-shell §2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeDef {
    pub key: String,
    pub name: String,
    pub plural: String,
    pub folder: String,
    pub icon: String,
    pub color: String,
    pub system: bool,
    /// The file couldn't be read; name and plural fall back to the key (NFR-REL-03).
    pub invalid: bool,
}

impl Vault {
    /// Every type definition of the vault, read-only, one per file (order not guaranteed).
    pub fn types(&self) -> Vec<TypeDef> {
        let Ok(entries) = self.fs.list() else { return Vec::new() };
        let mut out: Vec<TypeDef> = Vec::new();
        for e in entries {
            let FsEntry::File { path } = e else { continue };
            let path = nfc(&path);
            let Some(file) = path.strip_prefix(TYPES_DIR) else { continue };
            let Some(key) = file.strip_suffix(".yml") else { continue };
            if key.is_empty() || key.contains('/') || key.starts_with('.') || out.iter().any(|t| t.key == key) {
                continue;
            }
            let text = self.fs.read(&path).ok().and_then(|(b, _)| String::from_utf8(b).ok());
            out.push(parse(key, text.as_deref()));
        }
        out
    }
}

/// Top-level `key: scalar` lines only; the type files' list fields (`attributes`, `preview`) aren't needed here.
fn parse(key: &str, text: Option<&str>) -> TypeDef {
    let mut t = TypeDef {
        key: key.to_string(),
        name: key.to_string(),
        plural: key.to_string(),
        folder: String::new(),
        icon: String::new(),
        color: String::new(),
        system: false,
        invalid: text.is_none(),
    };
    let Some(text) = text else { return t };
    let mut has_name = false;
    for line in text.lines() {
        if line.starts_with([' ', '\t', '#', '-']) {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else { continue };
        let v = unquote(v.trim());
        match k.trim() {
            "name" => {
                t.name = nfc(&v);
                has_name = true;
            }
            "plural" => t.plural = nfc(&v),
            "folder" => t.folder = nfc(&v),
            "icon" => t.icon = v,
            "color" => t.color = v,
            "system" => t.system = v == "true",
            _ => {}
        }
    }
    if !has_name {
        t.invalid = true;
    }
    if t.plural == key && has_name {
        t.plural = t.name.clone();
    }
    t
}

fn unquote(v: &str) -> String {
    let v = v.split(" #").next().unwrap_or(v).trim();
    if v.len() >= 2 && ((v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\''))) {
        v[1..v.len() - 1].to_string()
    } else {
        v.to_string()
    }
}
