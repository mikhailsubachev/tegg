//! §4: the mapping as data, R148's defaults and D-1526's kind inference. Rewritten from the S5 spike's `map_type`,
//! `map_attr` and `infer` (`plan.rs`).

use std::collections::BTreeMap;

use chrono_tz::Tz;
use tegg_schema::{AttrDef, AttrType, TypeFile};

pub use crate::{AttrMapping, AttrTarget, CaseLinkChoice, Mapping, MappingEntry, MappingReason, Merge, Split, TypeMapping, TypeTarget};

use crate::dates::{self, DateValue};
use crate::note::{fold, Val};
use crate::{NameChange, ValueMerge};

/// R148's first table: the system type a Capacities type goes to by default, and whether it is a query stub.
pub(crate) fn fixed_target(source_type: &str) -> Option<&'static str> {
    Some(match source_type {
        "Page" => "page",
        "Task" => "task",
        "DailyNote" => "daily-note",
        "Image" => "image",
        "PDF" => "pdf",
        "Query" | "Weblink" | "AIChat" => "page",
        _ => return None,
    })
}

/// D-1527 (6): targets offered only to the source types that default to them.
pub(crate) const CLOSED_TARGETS: [&str; 6] = ["task", "daily-note", "image", "pdf", "quick-note", "tag"];

/// R148's default target of a source type among the target's types (D-1525: name, plural or key, NFC, any case).
pub(crate) fn default_target(source_type: &str, types: &[TypeFile]) -> TypeTarget {
    if let Some(key) = fixed_target(source_type) {
        return TypeTarget::Existing { key: key.to_string() };
    }
    let want = fold(source_type);
    let hit = types.iter().find(|t| !CLOSED_TARGETS.contains(&t.key.as_str()) && (fold(&t.name) == want || fold(&t.plural) == want || t.key == tegg_format::type_key(source_type)));
    match hit {
        Some(t) => TypeTarget::Existing { key: t.key.clone() },
        None => TypeTarget::New { name: source_type.to_string() },
    }
}

/// §4.1's closed list of on-purpose rows: the key written for a consumed source key, or `None`.
pub(crate) fn consumed_key(source_type: &str, target: Option<&str>, key: &str) -> Option<&'static str> {
    Some(match key {
        "type" => "type",
        "title" => "title",
        "description" => "description",
        "aliases" => "aliases",
        "tags" => "tags",
        "createdAt" => "created",
        "lastUpdated" => "modified",
        "reviewed" => "review",
        "icon" => "icon",
        "coverImage" => "cover",
        "previewImage" if source_type == "Weblink" => "cover",
        "status" if target == Some("task") => "status",
        "priority" if target == Some("task") => "priority",
        "deadline" | "date" if target == Some("task") => "due",
        "completed" if target == Some("task") => "completed",
        "date" if target == Some("daily-note") => "date",
        _ => return None,
    })
}

/// D-78: technical keys dropped by default.
pub(crate) fn dropped_by_default(source_type: &str, key: &str) -> bool {
    match source_type {
        "Image" | "PDF" => matches!(key, "mimeType" | "fileSize" | "width" | "height" | "colors"),
        "Weblink" => matches!(key, "domain" | "iframeUrl"),
        _ => false,
    }
}

/// A string that holds nothing but wikilinks (`[[a]]`, `[[a]], [[b]]`).
pub(crate) fn only_links(s: &str) -> bool {
    let mut rest = s.trim();
    let mut any = false;
    while !rest.is_empty() {
        let Some(after) = rest.strip_prefix("[[") else { return false };
        let Some(end) = after.find("]]") else { return false };
        if end == 0 || after[..end].contains('[') {
            return false;
        }
        any = true;
        rest = after[end + 2..].trim_start().trim_start_matches(',').trim_start();
    }
    any
}

/// The wikilinks a string holds, in order: (span as written, inner text).
pub(crate) fn wikilinks(s: &str) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let mut at = 0;
    while let Some(i) = s[at..].find("[[") {
        let start = at + i;
        let Some(j) = s[start + 2..].find("]]") else { break };
        let inner = &s[start + 2..start + 2 + j];
        if !inner.is_empty() && !inner.contains('[') {
            out.push((&s[start..start + j + 4], inner));
        }
        at = start + j + 4;
    }
    out
}

/// D-1526 (amended by D-1545): the kind of a new attribute from its non-null values. `None`: no value.
/// `objects`: how many objects have a value.
pub(crate) fn infer(values: &[&Val], zone: Tz) -> Option<(AttrType, bool)> {
    if values.is_empty() {
        return None;
    }
    let text = Some((AttrType::Text, false));
    if values.iter().all(|v| matches!(v, Val::Bool(_))) {
        return Some((AttrType::Checkbox, false));
    }
    if values.iter().all(|v| matches!(v, Val::Num(_))) {
        return Some((AttrType::Number, false));
    }
    // Links, also in lists (multi when any is a list or holds several).
    let links = |v: &Val| match v {
        Val::Str(s) => only_links(s),
        Val::List(items) => !items.is_empty() && items.iter().all(|i| only_links(i)),
        _ => false,
    };
    if values.iter().all(|v| links(v)) {
        let multi = values.iter().any(|v| match v {
            Val::Str(s) => wikilinks(s).len() > 1,
            _ => true,
        });
        return Some((AttrType::Relation, multi));
    }
    let strings: Vec<&str> = values.iter().filter_map(|v| if let Val::Str(s) = v { Some(s.as_str()) } else { None }).collect();
    if strings.len() != values.len() {
        return text;
    }
    let parsed: Vec<Option<DateValue>> = strings.iter().map(|s| dates::parse(s, zone)).collect();
    if parsed.iter().all(Option::is_some) {
        let all = |f: fn(&DateValue) -> bool| parsed.iter().flatten().all(f);
        if all(|d| matches!(d, DateValue::Date(_))) {
            return Some((AttrType::Date, false));
        }
        if all(|d| matches!(d, DateValue::Date(_) | DateValue::DateTime(_))) {
            return Some((AttrType::DateTime, false));
        }
        if all(|d| matches!(d, DateValue::Range(..))) {
            return Some((AttrType::DateRange, false));
        }
        return text;
    }
    if parsed.iter().any(Option::is_some) {
        return text;
    }
    let mut distinct: Vec<String> = strings.iter().map(|s| fold(s.trim())).collect();
    distinct.sort();
    distinct.dedup();
    if distinct.len() <= 20 && distinct.len() * 2 < strings.len() && strings.iter().all(|s| !s.contains('\n')) {
        return Some((AttrType::Select, false));
    }
    text
}

/// D-1529 (3): whether an existing attribute of this kind holds every value without loss.
pub(crate) fn fits(attr: &AttrDef, values: &[&Val], zone: Tz) -> bool {
    let strings = || values.iter().map(|v| if let Val::Str(s) = v { Some(s.as_str()) } else { None }).collect::<Option<Vec<&str>>>();
    let dates = |f: fn(&DateValue) -> bool| strings().is_some_and(|s| s.iter().all(|x| dates::parse(x, zone).is_some_and(|d| f(&d))));
    let option = |s: &str| attr.options.iter().any(|o| fold(&o.label) == fold(s.trim()));
    match &attr.r#type {
        AttrType::Text | AttrType::LongText => true,
        AttrType::Number => values.iter().all(|v| matches!(v, Val::Num(_))),
        AttrType::Checkbox => values.iter().all(|v| matches!(v, Val::Bool(_))),
        AttrType::Date => dates(|d| matches!(d, DateValue::Date(_))),
        AttrType::DateTime => dates(|d| matches!(d, DateValue::Date(_) | DateValue::DateTime(_))),
        AttrType::DateRange => dates(|d| matches!(d, DateValue::Range(..))),
        AttrType::Select => strings().is_some_and(|s| s.iter().all(|x| option(x))),
        AttrType::MultiSelect => values.iter().all(|v| match v {
            Val::Str(s) => option(s),
            Val::List(items) => items.iter().all(|i| option(i)),
            _ => false,
        }),
        AttrType::Url | AttrType::Email => strings().is_some(),
        AttrType::Relation => values.iter().all(|v| match v {
            Val::Str(s) => only_links(s),
            Val::List(items) => items.iter().all(|i| only_links(i)),
            _ => false,
        }),
        _ => false,
    }
}

/// D-1527 (2): the merges of a select's values. `values`: every value as written, in source-path order. Returns the
/// proposals and, for the applied ones, folded value → the spelling written.
pub(crate) fn merges(values: &[&str], options: &[String], given: Option<&Merge>) -> (Vec<ValueMerge>, BTreeMap<String, String>) {
    let mut groups: Vec<(String, Vec<(&str, usize)>)> = Vec::new();
    for v in values {
        let key = fold(v.trim());
        let at = match groups.iter().position(|(k, _)| *k == key) {
            Some(i) => i,
            None => {
                groups.push((key, Vec::new()));
                groups.len() - 1
            }
        };
        match groups[at].1.iter_mut().find(|(w, _)| w == v) {
            Some(x) => x.1 += 1,
            None => groups[at].1.push((v, 1)),
        }
    }
    let mut out = Vec::new();
    let mut kept_by = BTreeMap::new();
    for (key, variants) in groups.into_iter().filter(|(_, v)| v.len() > 1) {
        let spelled = match given {
            Some(Merge::Keep { spellings }) => spellings.iter().find(|(k, _)| fold(k.trim()) == key).map(|(_, v)| v.clone()),
            _ => None,
        };
        let kept = spelled.unwrap_or_else(|| {
            let most = variants.iter().map(|(_, n)| *n).max().unwrap_or(0);
            let top: Vec<&str> = variants.iter().filter(|(_, n)| *n == most).map(|(v, _)| v.trim()).collect();
            let existing = top.iter().find(|v| options.iter().any(|o| o == *v));
            existing.or(top.first()).map(|v| v.to_string()).unwrap_or_default()
        });
        let applied = !matches!(given, Some(Merge::Off));
        if applied {
            kept_by.insert(key, kept.clone());
        }
        out.push(ValueMerge { variants: variants.iter().map(|(v, _)| v.to_string()).collect(), kept, applied });
    }
    (out, kept_by)
}

/// FR-IMP-08 AC-11: the items of a comma-separated value, trimmed; a comma inside `[[…]]` doesn't split.
pub(crate) fn split_items(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut depth = 0usize;
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let pair = |a: char| chars[i] == a && chars.get(i + 1) == Some(&a);
        if pair('[') {
            depth += 1;
            cur.push_str("[[");
            i += 2;
        } else if pair(']') && depth > 0 {
            depth -= 1;
            cur.push_str("]]");
            i += 2;
        } else if chars[i] == ',' && depth == 0 {
            out.push(std::mem::take(&mut cur));
            i += 1;
        } else {
            cur.push(chars[i]);
            i += 1;
        }
    }
    out.push(cur);
    out.into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// §5.1: a value that holds `, ` between two non-empty parts.
pub(crate) fn splittable(s: &str) -> bool {
    s.split(", ").filter(|p| !p.trim().is_empty()).count() >= 2
}

/// Why a file stem differs from its title (§5.1 `NameChange`, without `Suffix`).
pub(crate) fn name_changes(title: &str, stem: &str) -> Vec<NameChange> {
    let title = tegg_format::nfc(title);
    if title == stem {
        return Vec::new();
    }
    let replaced: String = title.chars().map(|c| if "/:\\*?\"<>|#^[]".contains(c) || c.is_control() { ' ' } else { c }).collect();
    let plain = replaced.split(' ').filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    let plain = plain.trim_matches(|c| c == ' ' || c == '.').to_string();
    if plain.is_empty() {
        return vec![NameChange::Empty];
    }
    let mut out = Vec::new();
    if stem.ends_with('_') && !plain.ends_with('_') {
        out.push(NameChange::Reserved);
    }
    if plain.len() > 200 {
        out.push(NameChange::Cut);
    }
    if plain != title {
        out.push(NameChange::Characters);
    }
    out
}

/// `@tegg/doc` `isGenericName` (trash-media R73), on a stem without Capacities' ` (n)` counter.
pub(crate) fn generic_name(stem: &str) -> bool {
    const WORDS: [&str; 10] = ["image", "img", "photo", "picture", "screenshot", "untitled", "scan", "document", "file", "download"];
    const PREFIXES: [&str; 9] = ["img", "dsc", "dscn", "pxl", "photo", "screenshot", "screen shot", "snímek obrazovky", "bildschirmfoto"];
    let s = fold(stem.trim());
    let base = match s.rfind(" (") {
        Some(i) if s.ends_with(')') && s[i + 2..s.len() - 1].chars().all(|c| c.is_ascii_digit()) && i + 3 < s.len() => s[..i].trim_end().to_string(),
        _ => s.clone(),
    };
    WORDS.contains(&base.as_str()) || base.starts_with("pasted image") || PREFIXES.iter().any(|p| base.starts_with(p)) || (!s.is_empty() && !s.chars().any(char::is_alphabetic))
}

/// The key of a new attribute's name before any check (D-1553): the name when it is a valid key, else derived.
pub(crate) fn candidate_key(name: &str) -> String {
    let n = tegg_format::nfc(name.trim());
    let valid = n.chars().all(|c| c.is_alphabetic() || c.is_numeric() || c == '-' || c == '_') && n.chars().next().is_some_and(char::is_alphabetic);
    if valid {
        n
    } else {
        tegg_schema::derive_attr_key(&n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::Europe::Prague;

    fn s(x: &str) -> Val {
        Val::Str(x.into())
    }

    #[test]
    fn kinds() {
        let kind = |v: &[Val]| infer(&v.iter().collect::<Vec<_>>(), Prague).map(|k| k.0.as_str().to_string());
        assert_eq!(kind(&[]), None);
        assert_eq!(kind(&[Val::Bool(true), Val::Bool(false)]).as_deref(), Some("checkbox"));
        assert_eq!(kind(&[Val::Num("1".into())]).as_deref(), Some("number"));
        assert_eq!(kind(&[s("2026-03-19T00:00:00.000Z")]).as_deref(), Some("date"));
        assert_eq!(kind(&[s("2026-03-19T00:00:00.000Z"), s("2026-04-07T19:46:20.601Z")]).as_deref(), Some("date-time"));
        assert_eq!(kind(&[s("2026-07-01 -> 2026-07-14")]).as_deref(), Some("date-range"));
        assert_eq!(kind(&[s("2026-03-19T00:00:00.000Z"), s("Jun 26")]).as_deref(), Some("text"));
        assert_eq!(kind(&[s("[[Jana]]")]).as_deref(), Some("relation"));
        let six = |v: [&str; 6]| v.iter().map(|x| s(x)).collect::<Vec<_>>();
        assert_eq!(kind(&six(["ENG", "eng", "ENG", "CZE", "CZE", "ENG"])).as_deref(), Some("select"));
        assert_eq!(kind(&six(["a", "b", "c", "d", "e", "f"])).as_deref(), Some("text"));
        assert_eq!(kind(&[s("E-Book"), s("Paper"), s("E-Book"), s("Paper")]).as_deref(), Some("text"), "2 of 4 is not fewer than half");
    }

    #[test]
    fn merges_names_and_splits() {
        let (m, kept) = merges(&["High", "Low", "HIgh"], &["High".to_string()], None);
        assert_eq!(m, [ValueMerge { variants: vec!["High".into(), "HIgh".into()], kept: "High".into(), applied: true }]);
        assert_eq!(kept.get("high").map(String::as_str), Some("High"));
        let (m, kept) = merges(&["ENG", "eng", "ENG"], &[], Some(&Merge::Off));
        assert!(!m[0].applied && kept.is_empty() && m[0].kept == "ENG");
        assert_eq!(split_items(" Jana ,Eva, [[Novák, Petr]]"), ["Jana", "Eva", "[[Novák, Petr]]"]);
        assert!(splittable("Jana, Tomáš") && !splittable("Jana") && !splittable("Jana, "));
        assert_eq!(name_changes("CON", "CON_"), [NameChange::Reserved]);
        assert_eq!(name_changes("???", "Untitled"), [NameChange::Empty]);
        assert_eq!(name_changes("1:1 Jana", "1 1 Jana"), [NameChange::Characters]);
        assert!(generic_name("image (3)") && generic_name("Untitled (44)") && generic_name("IMG_0042") && generic_name("2026-03-19") && !generic_name("Mapa řeky") && !generic_name("Náhled webu"));
        assert_eq!((candidate_key("peopleInvolved"), candidate_key("Datum konání"), candidate_key("!!!")), ("peopleInvolved".to_string(), "datum-konání".to_string(), String::new()));
        assert_eq!(wikilinks("a [[X]] b [[Y|z]]"), [("[[X]]", "X"), ("[[Y|z]]", "Y|z")]);
    }
}
