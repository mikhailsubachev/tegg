//! A source note: its frontmatter as values (ported from the S5 spike, `plan.rs`), and the `import-scan` answer of
//! `@tegg/doc` (§7.1), which is the one reader of links, number characters and nested values (D-1551).

use serde::Deserialize;
use yaml_rust2::{Yaml, YamlLoader};

use crate::{LinkForm, LinkPlace};

// ------------------------------------------------------------------------------------------------ import-scan

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanDto {
    pub frontmatter: FmState,
    pub links: Vec<ScannedLink>,
    #[serde(default)]
    pub numbers: Vec<NumberRaw>,
    #[serde(default)]
    pub nested: Vec<String>,
    #[serde(default)]
    pub invisible: Invisible,
    #[serde(default)]
    pub crlf: bool,
}
#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct FmState {
    pub ok: bool,
    #[serde(default)]
    pub line: u32,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedLink {
    pub n: u32,
    pub line: u32,
    pub place: LinkPlace,
    pub form: LinkForm,
    pub written: String,
    pub target: String,
    pub external: bool,
    pub text: String,
    pub simplified: bool,
    #[serde(default)]
    pub alias_safe: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub(crate) struct NumberRaw {
    pub key: String,
    pub item: Option<u32>,
    pub raw: String,
}
#[derive(Clone, Copy, Debug, Default, Deserialize)]
pub(crate) struct Invisible {
    pub u200b: usize,
    pub ufeff: usize,
    pub u200c: usize,
    pub u200d: usize,
}

// ------------------------------------------------------------------------------------------------ frontmatter

/// A frontmatter value as the planner reads it. Numbers keep their source characters (§7.1).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Val {
    Null,
    Bool(bool),
    Num(String),
    Str(String),
    List(Vec<String>),
    /// No `FmValue` form: copied as stored.
    Nested,
}
impl Val {
    pub fn is_null(&self) -> bool {
        matches!(self, Val::Null)
    }
    /// A scalar as text (a title given as a number, a status written as `true`).
    pub fn scalar(&self) -> Option<String> {
        match self {
            Val::Str(s) | Val::Num(s) => Some(s.clone()),
            Val::Bool(b) => Some(b.to_string()),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum FmError {
    /// No frontmatter block.
    None,
    /// Not valid YAML, or not a mapping: 1-based line in the file.
    Yaml(u32),
}

/// The frontmatter's inner text and the body (a BOM before `---` is skipped; LF or CRLF).
pub(crate) fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let t = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let Some(rest) = t.strip_prefix("---\n").or_else(|| t.strip_prefix("---\r\n")) else { return (None, t) };
    let mut pos = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return (Some(&rest[..pos]), &rest[pos + line.len()..]);
        }
        pos += line.len();
    }
    (None, t)
}

/// The top-level entries in file order. `numbers` / `nested`: the scan's answer (empty when there is none, e.g. at
/// scan time: then a number is its YAML text).
pub(crate) fn frontmatter(text: &str, scan: Option<&ScanDto>) -> Result<Vec<(String, Val)>, FmError> {
    let (Some(fm), _) = split_frontmatter(text) else { return Err(FmError::None) };
    let docs = YamlLoader::load_from_str(fm).map_err(|e| FmError::Yaml(e.marker().line() as u32 + 1))?;
    let hash = match docs.into_iter().next() {
        Some(Yaml::Hash(h)) => h,
        None | Some(Yaml::Null) => return Ok(Vec::new()),
        Some(_) => return Err(FmError::Yaml(2)),
    };
    let mut out: Vec<(String, Val)> = Vec::new();
    for (k, v) in hash {
        let Some(key) = yaml_scalar(&k) else { continue };
        let key = tegg_format::nfc(&key);
        if out.iter().any(|(x, _)| *x == key) {
            continue;
        }
        let nested = scan.is_some_and(|s| s.nested.iter().any(|n| tegg_format::nfc(n) == key));
        let val = if nested { Val::Nested } else { value(&key, &v, scan) };
        out.push((key, val));
    }
    Ok(out)
}

fn yaml_scalar(y: &Yaml) -> Option<String> {
    match y {
        Yaml::String(s) | Yaml::Real(s) => Some(s.clone()),
        Yaml::Integer(i) => Some(i.to_string()),
        Yaml::Boolean(b) => Some(b.to_string()),
        _ => None,
    }
}

fn value(key: &str, v: &Yaml, scan: Option<&ScanDto>) -> Val {
    match v {
        Yaml::Null => Val::Null,
        Yaml::Boolean(b) => Val::Bool(*b),
        Yaml::Integer(_) | Yaml::Real(_) => {
            let raw = scan.and_then(|s| s.numbers.iter().find(|n| n.item.is_none() && tegg_format::nfc(&n.key) == key)).map(|n| n.raw.clone());
            Val::Num(raw.or_else(|| yaml_scalar(v)).unwrap_or_default())
        }
        Yaml::String(s) => Val::Str(clean(s)),
        Yaml::Array(items) => {
            let strings: Option<Vec<String>> = items.iter().map(|i| if let Yaml::String(s) = i { Some(clean(s)) } else { None }).collect();
            strings.map(Val::List).unwrap_or(Val::Nested)
        }
        _ => Val::Nested,
    }
}

/// The `type:` value of a note whose frontmatter isn't valid YAML, read from its line (so the note still counts
/// under its source type).
pub(crate) fn type_line(text: &str) -> Option<String> {
    let (fm, _) = split_frontmatter(text);
    let fm = fm?;
    let line = fm.lines().find(|l| l.starts_with("type:"))?;
    let v = line["type:".len()..].trim();
    let v = v.strip_prefix('\'').and_then(|x| x.strip_suffix('\'')).or_else(|| v.strip_prefix('"').and_then(|x| x.strip_suffix('"'))).unwrap_or(v);
    let v = tegg_format::nfc(v.trim());
    (!v.is_empty()).then_some(v)
}

// ------------------------------------------------------------------------------------------------ clean-up (FR-IMP-17)

fn pictographic(c: char) -> bool {
    matches!(c as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF | 0x2190..=0x21FF | 0x2300..=0x23FF | 0x3030 | 0x303D | 0x3297 | 0x3299 | 0xA9 | 0xAE)
}

/// Without U+200B and U+FEFF, and without U+200C / U+200D that aren't inside an emoji sequence (the rule `@tegg/doc`
/// applies to bodies, for titles and attribute values).
pub(crate) fn strip_invisible(s: &str) -> String {
    if !s.contains(['\u{200B}', '\u{FEFF}', '\u{200C}', '\u{200D}']) {
        return s.to_string();
    }
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    for (i, c) in chars.iter().enumerate() {
        match c {
            '\u{200B}' | '\u{FEFF}' => {}
            '\u{200C}' | '\u{200D}' => {
                let next = chars.get(i + 1).is_some_and(|n| pictographic(*n));
                let before = chars[..i].iter().rev().find(|p| !matches!(**p as u32, 0xFE0F | 0x1F3FB..=0x1F3FF));
                if next && before.is_some_and(|p| pictographic(*p)) {
                    out.push(*c);
                }
            }
            _ => out.push(*c),
        }
    }
    out
}

/// A string value as the import keeps it: invisible characters removed, NFC.
pub(crate) fn clean(s: &str) -> String {
    tegg_format::nfc(&strip_invisible(s))
}

/// A title: cleaned and trimmed (FR-IMP-11 AC-2, FR-IMP-17 AC-1).
pub(crate) fn clean_title(s: &str) -> String {
    clean(s).trim().to_string()
}

// ------------------------------------------------------------------------------------------------ paths

/// `../Tasks/x.md` from the note at `note` (a path inside the space); `None` when it leaves the space.
pub(crate) fn join_relative(note: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = note.split('/').collect();
    parts.pop();
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

/// A destination without its `#fragment` or `?query`.
pub(crate) fn destination_path(target: &str) -> &str {
    let end = target.find(['#', '?']).unwrap_or(target.len());
    &target[..end]
}

/// The file name of a path.
pub(crate) fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}
/// The folder of a path (empty at the top).
pub(crate) fn folder_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}
/// `(stem, extension with its dot)`; a name without a dot, or a dotfile, has no extension.
pub(crate) fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// NFC and lower case: how names are compared (FR-FMT-12, D-291).
pub(crate) fn fold(s: &str) -> String {
    tegg_format::nfc(s).to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_values_keep_order_and_kinds() {
        let text = "\u{feff}---\ntype: 'Book'\ntitle: Kniha\u{200b}\npages: 100\nok: true\nnic: null\ntags: [a, b]\nmap:\n  a: 1\nmixed: [1, x]\n---\n\nText.\n";
        let fm = frontmatter(text, None).unwrap();
        let keys: Vec<&str> = fm.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["type", "title", "pages", "ok", "nic", "tags", "map", "mixed"]);
        assert_eq!(fm[1].1, Val::Str("Kniha".into()));
        assert_eq!(fm[2].1, Val::Num("100".into()));
        assert_eq!(fm[3].1, Val::Bool(true));
        assert_eq!(fm[4].1, Val::Null);
        assert_eq!(fm[5].1, Val::List(vec!["a".into(), "b".into()]));
        assert_eq!((fm[6].1.clone(), fm[7].1.clone()), (Val::Nested, Val::Nested));
        assert_eq!(frontmatter("No frontmatter.\n", None), Err(FmError::None));
        assert!(matches!(frontmatter("---\ntype: 'Page'\ntitle: [unclosed\n---\n", None), Err(FmError::Yaml(_))));
        assert_eq!(type_line("---\ntype: 'Page'\ntitle: [unclosed\n---\n").as_deref(), Some("Page"));
    }

    #[test]
    fn invisible_characters_and_emoji_joiners() {
        assert_eq!(strip_invisible("Pl\u{200b}an\u{feff}"), "Plan");
        assert_eq!(strip_invisible("slovo\u{200c}slovo spoj\u{200d}ka"), "slovoslovo spojka");
        assert_eq!(strip_invisible("👩\u{200d}💻"), "👩\u{200d}💻");
        assert_eq!(clean_title("  Jana \u{200b}"), "Jana");
    }

    #[test]
    fn relative_paths() {
        assert_eq!(join_relative("Pages/a.md", "../Tasks/x.md").as_deref(), Some("Tasks/x.md"));
        assert_eq!(join_relative("Pages/a.md", "./Media/x.png").as_deref(), Some("Pages/Media/x.png"));
        assert_eq!(join_relative("Pages/a.md", "../../Work/x.md"), None);
        assert_eq!(split_ext("Mapa řeky.jpeg"), ("Mapa řeky", ".jpeg"));
        assert_eq!(split_ext("LICENSE"), ("LICENSE", ""));
        assert_eq!(destination_path("../a.md#část"), "../a.md");
    }
}
