//! D-847: tegg-core's `widens` (the R101 mapping's rule, 4E-1) is board E2's table as tests/fixtures/types/widen.json
//! holds it; `@tegg/schema`'s `widerTypes` is checked against the same file (packages/schema/test/widen_table.test.ts).

use tegg_schema::{AttrDef, AttrType};

fn def(t: &str) -> AttrDef {
    AttrDef { key: "k".into(), name: "K".into(), r#type: AttrType::parse(t), default: None, required: false, options: Vec::new(), to: None, multiple: false, description: None, built_in: false }
}

#[test]
fn widen_table_rust_matches_the_shared_fixture() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/types/widen.json");
    let table: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let types: Vec<&String> = table.keys().filter(|k| !k.starts_with('_')).collect();
    for from in &types {
        let want: Vec<&str> = table[from.as_str()].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        for to in &types {
            if from == to {
                continue;
            }
            assert_eq!(tegg_core::widens(&def(from), &def(to)), want.contains(&to.as_str()), "{from} → {to}");
        }
    }
}
