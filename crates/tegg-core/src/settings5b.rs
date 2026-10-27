//! Slice 5B: portable vault settings in `.tegg/vault.yml` (docs/contracts/ms5-capture.md §5.1; FR-VLT-05, FR-SET-01;
//! D-541, D-551). Reading never writes. A patch writes only that key's line (or appends the key after the last entry),
//! keeps comments and other lines byte for byte, and needs the file's current version as base (D-235).

use tegg_format::{nfc, type_key};
use yaml_rust2::{Yaml, YamlLoader};

use crate::{Core, CoreError, FileVersion, VaultError};

const YML: &str = ".tegg/vault.yml";
const DEFAULT_FORMAT: &str = "YYYY-MM-DD";
const DEFAULT_ATTACHMENTS: &str = "_attachments";

/// `default-type` as stored and as matched (D-239).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefaultTypeSetting {
    /// The raw value as written (NFC); None when the key is missing or not a string.
    pub raw: Option<String>,
    /// The matched type key; `quick-note` when not valid.
    pub key: String,
    /// False when missing, empty, not a string, or no such type.
    pub valid: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultSettings {
    /// None when vault.yml is missing.
    pub version: Option<FileVersion>,
    pub default_type: DefaultTypeSetting,
    /// Raw or `YYYY-MM-DD`.
    pub daily_format: String,
    /// Raw or `_attachments`.
    pub attachments: String,
    /// Slice PW (docs/contracts/page-width.md §2, AP-754): `normal` or `wide`; a missing or unknown value reads as `normal`.
    pub page_width: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultKey {
    DefaultType,
    DailyFormat,
    Attachments,
    /// Slice PW: `page-width` (docs/contracts/page-width.md §2).
    PageWidth,
}

impl VaultKey {
    fn name(self) -> &'static str {
        match self {
            VaultKey::DefaultType => "default-type",
            VaultKey::DailyFormat => "daily-format",
            VaultKey::Attachments => "attachments",
            VaultKey::PageWidth => "page-width",
        }
    }
}

fn top(text: &str) -> Option<Yaml> {
    YamlLoader::load_from_str(text).ok()?.into_iter().next()
}

/// D-239, D-541: the default type of `vault.yml`'s text; `exists` tells whether a type key is defined.
pub(crate) fn default_type_of(text: Option<&str>, exists: impl Fn(&str) -> bool) -> DefaultTypeSetting {
    let raw = text.and_then(top).and_then(|y| y["default-type"].as_str().map(nfc));
    let key = raw.as_deref().map(type_key).filter(|k| !k.is_empty() && exists(k));
    DefaultTypeSetting { valid: key.is_some(), key: key.unwrap_or_else(|| "quick-note".into()), raw }
}

/// A YAML scalar for a fresh value: plain when YAML reads it back as the same string, else double-quoted (D-230).
fn scalar(v: &str) -> String {
    let plain = !v.is_empty()
        && !v.starts_with(|c: char| c.is_whitespace() || "-?:,[]{}#&*!|>'\"%@`".contains(c))
        && !v.ends_with(char::is_whitespace)
        && !v.contains(": ")
        && !v.contains(" #")
        && matches!(top(&format!("k: {v}")).map(|y| y["k"].clone()), Some(Yaml::String(s)) if s == v);
    if plain {
        v.to_string()
    } else {
        serde_json::to_string(v).unwrap_or_default()
    }
}

/// The text with `key`'s top-level line set to `value`, or the key appended after the last entry.
fn patch_line(text: &str, key: &str, value: &str) -> String {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let line = format!("{key}: {}", scalar(value));
    let mut out = String::with_capacity(text.len() + line.len() + 2);
    let mut found = false;
    for part in text.split_inclusive('\n') {
        let body = part.trim_end_matches(['\n', '\r']);
        let is_key = !found && body.strip_prefix(key).is_some_and(|rest| rest.starts_with(':'));
        if is_key {
            found = true;
            out.push_str(&line);
            out.push_str(&part[body.len()..]);
        } else {
            out.push_str(part);
        }
    }
    if !found {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push_str(eol);
        }
        out.push_str(&line);
        out.push_str(eol);
    }
    out
}

/// D-222 folder rules for the attachments folder: relative, no hidden or `..` segment, not `_templates`, no
/// forbidden character; `_attachments` itself is allowed.
fn check_attachments(folder: &str) -> Result<String, String> {
    let f = nfc(folder.trim()).trim_end_matches('/').to_string();
    if f.is_empty() || f.starts_with('/') {
        return Err("Enter a folder inside the vault.".into());
    }
    let segments: Vec<&str> = f.split('/').collect();
    if segments.iter().any(|s| s.trim().is_empty() || s.starts_with('.')) {
        return Err("Folders can't be hidden or outside the vault.".into());
    }
    if segments[0].eq_ignore_ascii_case("_templates") {
        return Err("Templates have their own folder.".into());
    }
    if segments.iter().any(|s| s.chars().any(|c| "\\:*?\"<>|".contains(c) || c.is_control())) {
        return Err("Folder names can't contain \\ : * ? \" < > |".into());
    }
    Ok(f)
}

impl Core {
    pub fn vault_settings(&self) -> VaultSettings {
        let (text, version) = match self.shared.vault.read(YML) {
            Ok((b, v)) => (Some(String::from_utf8_lossy(&b).into_owned()), Some(v)),
            Err(_) => (None, None),
        };
        let y = text.as_deref().and_then(top);
        let get = |k: &str, d: &str| y.as_ref().and_then(|y| y[k].as_str().map(nfc)).unwrap_or_else(|| d.to_string());
        VaultSettings {
            version,
            default_type: default_type_of(text.as_deref(), |k| self.type_get(k).is_some()),
            daily_format: get("daily-format", DEFAULT_FORMAT),
            attachments: get("attachments", DEFAULT_ATTACHMENTS),
            // AP-754: only the exact value `wide` reads as wide; a missing or any other value reads as `normal`, never rewritten.
            page_width: if get("page-width", "") == "wide" { "wide".into() } else { "normal".into() },
        }
    }

    /// `Conflict` when `base` isn't the current version; `Invalid { reason }` for a D-336-rejected format or a
    /// D-222-rejected folder; an equal value writes nothing.
    pub fn vault_settings_patch(&self, base: Option<FileVersion>, key: VaultKey, value: String) -> Result<VaultSettings, CoreError> {
        let value = nfc(value.trim());
        let value = match key {
            VaultKey::DefaultType => {
                let k = type_key(&value);
                if k.is_empty() || self.type_get(&k).is_none() {
                    return Err(CoreError::UnknownType);
                }
                k
            }
            VaultKey::DailyFormat => {
                let probe = chrono::NaiveDate::from_ymd_opt(2026, 10, 14).expect("a valid date");
                if value.is_empty() || tegg_format::daily::file_stem(&value, probe).is_err() {
                    return Err(CoreError::Invalid { reason: "This format can't name a daily note. Use YYYY, MM and DD.".into() });
                }
                value
            }
            VaultKey::Attachments => check_attachments(&value).map_err(|reason| CoreError::Invalid { reason })?,
            VaultKey::PageWidth => {
                if value != "normal" && value != "wide" {
                    return Err(CoreError::Invalid { reason: "Page width is normal or wide.".into() });
                }
                value
            }
        };
        let (text, disk) = match self.shared.vault.read(YML) {
            Ok((b, disk)) => (String::from_utf8(b).map_err(|_| CoreError::NotUtf8)?, Some(disk)),
            Err(VaultError::NotFound) => (String::new(), None),
            Err(e) => return Err(e.into()),
        };
        match (&base, &disk) {
            (Some(b), Some(d)) if !b.same_content(d) => return Err(CoreError::Vault(VaultError::Conflict { disk: d.clone() })),
            (None, Some(d)) => return Err(CoreError::Vault(VaultError::Conflict { disk: d.clone() })),
            (Some(_), None) => return Err(CoreError::Vault(VaultError::Gone)),
            _ => {}
        }
        let current = top(&text).and_then(|y| y[key.name()].as_str().map(nfc));
        if current.as_deref() != Some(value.as_str()) {
            let new = patch_line(&text, key.name(), &value);
            self.shared.vault.write(YML, new.as_bytes(), base.as_ref())?;
            self.shared.load_default_type();
        }
        Ok(self.vault_settings())
    }
}
