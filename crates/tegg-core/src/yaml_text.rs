//! Shared helpers for the vault's hand-editable YAML files (`.tegg/vault.yml`, `.tegg/graph.yml`): the first
//! document of a text, and the quoting rule for fresh values (D-230; v1-graph §16.1 moved it here from settings5b).

use yaml_rust2::{Yaml, YamlLoader};

/// The first YAML document of `text`, or None when it doesn't parse or holds none.
pub(crate) fn top(text: &str) -> Option<Yaml> {
    YamlLoader::load_from_str(text).ok()?.into_iter().next()
}

/// A YAML scalar for a fresh value: plain when YAML reads it back as the same string, else double-quoted (D-230).
pub(crate) fn scalar(v: &str) -> String {
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
