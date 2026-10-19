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
        _ => None,
    }
}
