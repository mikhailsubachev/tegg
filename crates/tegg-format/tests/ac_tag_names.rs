//! MS4 slice 4D-lite AC test (L1 twin, Rust side): `tegg_format::tag_name` gives the same result as `@tegg/doc`
//! `tagName` for every row of the shared table tests/fixtures/format/tags/names.json (docs/contracts/ms4-tags.md §2;
//! docs/acceptance/tags.md FR-TAG-03 AC-3, D-696, D-712; FR-TAG-10 AC-1 for `/`). The planner's refusal of a rename
//! (`JobError::InvalidName`) uses this function. Written from the AC and the contract only (D-61).

use std::path::PathBuf;

use tegg_format::{tag_name, TagName, TagNameError};

fn table() -> Vec<serde_json::Value> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/format/tags/names.json");
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(p).expect("setup: names.json")).expect("setup: JSON");
    v["rows"].as_array().expect("setup: rows").clone()
}

#[test]
fn fr_tag_03_ac3_tag_name_matches_the_shared_table() {
    let rows = table();
    assert!(rows.len() >= 20, "the shared table is read");
    let mut bad = Vec::new();
    for r in rows {
        let input = r["input"].as_str().unwrap_or_default();
        let want: Result<TagName, TagNameError> = if r["ok"].as_bool() == Some(true) {
            Ok(TagName { name: r["name"].as_str().unwrap_or_default().into(), key: r["key"].as_str().unwrap_or_default().into() })
        } else {
            Err(match r["error"].as_str() {
                Some("empty") => TagNameError::Empty,
                Some("space") => TagNameError::Space,
                Some("digits") => TagNameError::Digits,
                _ => TagNameError::Char(r["char"].as_str().and_then(|c| c.chars().next()).unwrap_or('?')),
            })
        };
        let got = tag_name(input);
        if got != want {
            bad.push(format!("{input:?}: want {want:?}, got {got:?}"));
        }
    }
    assert!(bad.is_empty(), "tag_name per row (D-696, D-712):\n{}", bad.join("\n"));
}

#[test]
fn fr_tag_10_ac1_slash_is_part_of_one_flat_name() {
    assert_eq!(tag_name("a/b"), Ok(TagName { name: "a/b".into(), key: "a/b".into() }), "a/b is one name (D-40)");
    assert_eq!(tag_name("#x/y"), Ok(TagName { name: "x/y".into(), key: "x/y".into() }), "#x/y: one leading # dropped");
    assert_eq!(tag_name("C++").map_err(|e| e.as_str()), Err("char"), "C++ is refused");
}
