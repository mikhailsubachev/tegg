//! The card list of a type (docs/contracts/v1-cards.md §2.2; cards.md R209, R210; D-1947, D-1964, D-1967).
//!
//! The one place that decides which keys a type's cards draw: `card:` as written when it is present and readable, else
//! R210's default (system table, Tag fixed, user types from `preview`). The TS twin is `@tegg/schema` `cardList`, tied by
//! `tests/fixtures/types/card-lists.json`.

use tegg_format::nfc;

use crate::{AttrType, Parsed, Readability, TypeFile, SYSTEM_KEYS};

/// R209: the built-in keys a card list may hold besides attribute keys, in the order `Add property` offers them.
pub const CARD_BUILT_INS: [&str; 7] = ["tags", "body", "description", "source", "aliases", "created", "modified"];
/// R210: undefined types, invalid type files.
pub const CARD_FALLBACK: [&str; 3] = ["tags", "body", "modified"];
/// R210: Tag's card is fixed whatever its file says (contract §15 item 3).
const TAG_CARD: [&str; 2] = ["body", "modified"];
/// R210: the built-in keys a user type's `preview` may add to its default card (`modified` closes the list).
const PREVIEW_BUILT_INS: [&str; 4] = ["tags", "source", "aliases", "created"];

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CardList {
    /// R209 "card list": `card:` as written when present and readable (unknown keys, repeats and `title` included),
    /// else R210's default.
    pub list: Vec<String>,
    /// True when `list` is R210's default (no readable `card:`, or Tag).
    pub default: bool,
    /// "Effective keys" (NFC, the attribute's own spelling): `list` without unknown keys, repeats (first kept),
    /// `title`, `review` and `file`-kind attribute keys.
    pub keys: Vec<String>,
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// R210 (D-1967) for a system key, else None.
fn system_default(key: &str) -> Option<&'static [&'static str]> {
    Some(match key {
        "page" => &["tags", "body", "modified"],
        "task" => &["tags", "body", "status", "due", "priority", "recurrence", "source"],
        "quick-note" => &["body", "created"],
        "daily-note" => &["body", "modified"],
        "image" => &["width", "height", "size", "created"],
        "pdf" => &["tags", "pages", "size", "created"],
        "tag" => &TAG_CARD,
        _ => return None,
    })
}

/// R210 for a defined type: the system table for system keys (whatever their `preview` says); a user type `tags`,
/// `body`, then each `preview` key that is an attribute key or one of `tags`, `source`, `aliases`, `created` (others
/// skipped), then `modified`; a repeated key counts once (first place).
pub fn default_card(def: &TypeFile) -> Vec<String> {
    let key = nfc(&def.key);
    if SYSTEM_KEYS.contains(&key.as_str()) {
        return system_default(&key).map(strings).unwrap_or_else(|| strings(&CARD_FALLBACK));
    }
    let mut out: Vec<String> = strings(&["tags", "body"]);
    for p in def.preview.iter().map(|p| nfc(p)) {
        let known = def.attributes.iter().any(|a| nfc(&a.key) == p) || PREVIEW_BUILT_INS.contains(&p.as_str());
        if known && !out.contains(&p) {
            out.push(p);
        }
    }
    if !out.iter().any(|k| k == "modified") {
        out.push("modified".into());
    }
    out
}

/// What one card-list entry is (§2.2 matching: NFC-equal to an attribute key; built-ins NFC-exact, lower case only).
enum Entry {
    /// The attribute's own key (NFC).
    Attribute(String),
    BuiltIn(String),
    /// `title`, `review`, a `file`-kind attribute: known, never drawn as an entry, never warned about.
    Skipped,
    Unknown(String),
}

fn entry(def: &TypeFile, e: &str) -> Entry {
    let n = nfc(e);
    if n == "title" || n == "review" {
        return Entry::Skipped;
    }
    if let Some(a) = def.attributes.iter().find(|a| nfc(&a.key) == n) {
        return if a.r#type == AttrType::File { Entry::Skipped } else { Entry::Attribute(nfc(&a.key)) };
    }
    if CARD_BUILT_INS.contains(&n.as_str()) {
        return Entry::BuiltIn(n);
    }
    Entry::Unknown(n)
}

/// The effective keys of `list` for `def`.
pub(crate) fn effective_keys(def: &TypeFile, list: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in list {
        if let Entry::Attribute(k) | Entry::BuiltIn(k) = entry(def, e) {
            if !out.contains(&k) {
                out.push(k);
            }
        }
    }
    out
}

/// `card` entries that are neither an attribute key nor a built-in (NFC), each once, in file order (D-1964).
pub(crate) fn ignored(def: &TypeFile, card: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in card {
        if let Entry::Unknown(k) = entry(def, e) {
            if !out.contains(&k) {
                out.push(k);
            }
        }
    }
    out
}

/// R209 + R210 for a parsed file: Invalid → CARD_FALLBACK; `tag` → `[body, modified]` whatever the file says;
/// otherwise `card` when Some, else `default_card`. Newer files are read (FR-TYP-11 AC-27 (d)).
pub fn card_list(parsed: &Parsed) -> CardList {
    let def = &parsed.def;
    if matches!(parsed.readability, Readability::Invalid { .. }) {
        return CardList { list: strings(&CARD_FALLBACK), default: true, keys: strings(&CARD_FALLBACK) };
    }
    let (list, default) = match (&def.card, nfc(&def.key) == "tag") {
        (_, true) => (strings(&TAG_CARD), true),
        (Some(c), false) if !parsed.card_unreadable => (c.clone(), false),
        _ => (default_card(def), true),
    };
    let keys = effective_keys(def, &list);
    CardList { list, default, keys }
}

/// A `type` value without a definition (D-121).
pub fn card_list_undefined() -> CardList {
    CardList { list: strings(&CARD_FALLBACK), default: true, keys: strings(&CARD_FALLBACK) }
}
