//! The JSON shape of a `TextOp`, as `@tegg/doc` `TextOp` (ms4-jobs §2.3): for `job:transform`, the test transformer
//! and the crash journal.

use serde_json::{json, Value};

use crate::TextOp;

pub fn op_json(op: &TextOp) -> Value {
    match op {
        TextOp::RetargetLinks { from_path, from_stem, from_title, to_path, to_stem, to_title, paths } => json!({
            "op": "retarget-links", "fromPath": from_path, "fromStem": from_stem, "fromTitle": from_title,
            "toPath": to_path, "toStem": to_stem, "toTitle": to_title, "paths": paths,
        }),
        TextOp::SetTitle { title, now } => json!({ "op": "set-title", "title": title, "now": now }),
        TextOp::SetReview { value, now } => json!({ "op": "set-review", "value": value, "now": now }),
        TextOp::SetType { r#type, now } => json!({ "op": "set-type", "type": r#type, "now": now }),
        TextOp::AddTags { tags, now } => json!({ "op": "add-tags", "tags": tags, "now": now }),
        TextOp::AppendLink { target, now } => json!({ "op": "append-link", "target": target, "now": now }),
        TextOp::AppendLinkTo { to_path, to_title, paths, now } => json!({ "op": "append-link-to", "toPath": to_path, "toTitle": to_title, "paths": paths, "now": now }),
        // ms4-tags §4.2 (4D-lite).
        TextOp::RenameTag { key, to } => json!({ "op": "rename-tag", "key": key, "to": to }),
        TextOp::RemoveTag { key } => json!({ "op": "remove-tag", "key": key }),
        TextOp::MergeInto { others, now } => json!({
            "op": "merge-into",
            "others": others.iter().map(|o| json!({ "path": o.path, "title": o.title, "text": o.text })).collect::<Vec<_>>(),
            "now": now,
        }),
        TextOp::Replace { text } => json!({ "op": "replace", "text": text }),
        // ms4-jobs §14.4 (4E-1): the `@tegg/doc` shapes.
        TextOp::MapProperties { map, labels } => json!({
            "op": "map-properties",
            "map": map.iter().map(|(from, to)| json!({ "from": from, "to": to })).collect::<Vec<_>>(),
            "labels": labels.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect::<serde_json::Map<String, Value>>(),
        }),
        TextOp::KeepTargets { from_path, to_path, paths } => json!({ "op": "keep-targets", "fromPath": from_path, "toPath": to_path, "paths": paths }),
        TextOp::ChangeType { r#type, now, id } => json!({ "op": "change-type", "type": r#type, "now": now, "id": id }),
        TextOp::HoldTargets { from_path, to_path, paths } => json!({ "op": "hold-targets", "fromPath": from_path, "toPath": to_path, "paths": paths }),
        TextOp::Relink { moves, paths, files } => json!({ "op": "relink", "moves": moves.iter().map(|(f, t)| json!({ "from": f, "to": t })).collect::<Vec<_>>(), "paths": &**paths, "files": &**files }),
        // ms4-jobs §14.9.2 (4E-2).
        TextOp::RemoveKey { key } => json!({ "op": "remove-key", "key": key }),
    }
}

pub fn op_from_json(v: &Value) -> Option<TextOp> {
    let s = |k: &str| v[k].as_str().map(str::to_string);
    match v["op"].as_str()? {
        "retarget-links" => Some(TextOp::RetargetLinks {
            from_path: s("fromPath")?,
            from_stem: s("fromStem")?,
            from_title: s("fromTitle")?,
            to_path: s("toPath")?,
            to_stem: s("toStem")?,
            to_title: s("toTitle")?,
            paths: v["paths"].as_array()?.iter().filter_map(|p| p.as_str().map(str::to_string)).collect(),
        }),
        "set-title" => Some(TextOp::SetTitle { title: s("title")?, now: s("now")? }),
        "set-review" => Some(TextOp::SetReview { value: s("value")?, now: s("now")? }),
        "set-type" => Some(TextOp::SetType { r#type: s("type")?, now: s("now")? }),
        "add-tags" => Some(TextOp::AddTags { tags: v["tags"].as_array()?.iter().filter_map(|t| t.as_str().map(str::to_string)).collect(), now: s("now")? }),
        "append-link" => Some(TextOp::AppendLink { target: s("target")?, now: s("now")? }),
        "append-link-to" => Some(TextOp::AppendLinkTo {
            to_path: s("toPath")?,
            to_title: s("toTitle")?,
            paths: v["paths"].as_array()?.iter().filter_map(|p| p.as_str().map(str::to_string)).collect(),
            now: s("now")?,
        }),
        "rename-tag" => Some(TextOp::RenameTag { key: s("key")?, to: s("to")? }),
        "remove-tag" => Some(TextOp::RemoveTag { key: s("key")? }),
        "merge-into" => Some(TextOp::MergeInto {
            others: v["others"]
                .as_array()?
                .iter()
                .filter_map(|o| Some(crate::MergeOther { path: o["path"].as_str()?.to_string(), title: o["title"].as_str()?.to_string(), text: o["text"].as_str()?.to_string() }))
                .collect(),
            now: s("now")?,
        }),
        "replace" => Some(TextOp::Replace { text: s("text")? }),
        "map-properties" => Some(TextOp::MapProperties {
            map: v["map"].as_array()?.iter().filter_map(|m| Some((m["from"].as_str()?.to_string(), m["to"].as_str()?.to_string()))).collect(),
            labels: v["labels"].as_object()?.iter().filter_map(|(k, l)| Some((k.clone(), l.as_str()?.to_string()))).collect(),
        }),
        "keep-targets" => Some(TextOp::KeepTargets {
            from_path: s("fromPath")?,
            to_path: s("toPath")?,
            paths: v["paths"].as_array()?.iter().filter_map(|p| p.as_str().map(str::to_string)).collect(),
        }),
        "relink" => Some(TextOp::Relink {
            moves: std::sync::Arc::new(v["moves"].as_array()?.iter().filter_map(|m| Some((m["from"].as_str()?.to_string(), m["to"].as_str()?.to_string()))).collect()),
            paths: std::sync::Arc::new(v["paths"].as_array()?.iter().filter_map(|p| p.as_str().map(str::to_string)).collect()),
            files: std::sync::Arc::new(v["files"].as_array().map(|a| a.iter().filter_map(|p| p.as_str().map(str::to_string)).collect()).unwrap_or_default()),
        }),
        "hold-targets" => Some(TextOp::HoldTargets {
            from_path: s("fromPath")?,
            to_path: s("toPath")?,
            paths: v["paths"].as_array()?.iter().filter_map(|p| p.as_str().map(str::to_string)).collect(),
        }),
        "remove-key" => Some(TextOp::RemoveKey { key: s("key")? }),
        "change-type" => Some(TextOp::ChangeType { r#type: s("type")?, now: v["now"].as_str().map(str::to_string), id: v["id"].as_str().map(str::to_string) }),
        _ => None,
    }
}
