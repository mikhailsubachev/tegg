//! Regression test for the slice PIN QA review: a merge whose kept object has no `id` (D-1402) rewrote the merged-away
//! pin item whole, so its comments and unknown keys were lost (R131: "per-item unknown keys and every comment are kept
//! byte for byte", FR-FMT-07, D-1371). The item must change only its `id:` line (removed) and its `path:` value.

use tegg_core::pinned::{patch_text, read, PinPatch};

const HEAD: &str = "# Tegg sidebar pins (FR-HOM-02). Pin, unpin and reorder them in the sidebar.\nversion: 1\npins:\n";

fn merged(text: &str, id: Option<&str>) -> Option<String> {
    let f = read(text.as_bytes());
    patch_text(text, &f, &[PinPatch::Merged { from: "Pages/Plán (2).md".into(), from_id: Some("01JB5P00000000000000000011".into()), to: "Pages/Plán.md".into(), id: id.map(Into::into) }])
}

#[test]
fn bug_qapin_fr_fmt_07_merge_to_an_idless_object_keeps_the_items_other_bytes() {
    let text = format!("{HEAD}  - tag: offsite\n  # druhý plán\n  - id: 01JB5P00000000000000000011  # z Macu\n    x-note: ponech\n    path: Pages/Plán (2).md\n  - type: projekt\n");
    let out = merged(&text, None).expect("the merged-away item is patched");
    let want = format!("{HEAD}  - tag: offsite\n  # druhý plán\n  - path: Pages/Plán.md  # z Macu\n    x-note: ponech\n  - type: projekt\n");
    assert_eq!(out, want, "only the id line goes and the path changes; the comment and x-note stay");
}

#[test]
fn bug_qapin_fr_fmt_07_merge_with_id_on_an_inner_line_keeps_the_rest() {
    let text = format!("{HEAD}  - path: Pages/Plán (2).md\n    # poznámka\n    id: 01JB5P00000000000000000011\n    x-note: ponech\n");
    let out = merged(&text, None).expect("patched");
    assert_eq!(out, format!("{HEAD}  - path: Pages/Plán.md\n    # poznámka\n    x-note: ponech\n"), "id line removed, path value set, rest kept");
}

#[test]
fn bug_qapin_fr_fmt_07_merge_to_an_object_with_an_id_changes_only_the_two_values() {
    let text = format!("{HEAD}  - id: 01JB5P00000000000000000011\n    x-note: ponech\n    path: Pages/Plán (2).md\n");
    let out = merged(&text, Some("01JB5P00000000000000000010")).expect("patched");
    assert_eq!(out, format!("{HEAD}  - id: 01JB5P00000000000000000010\n    x-note: ponech\n    path: Pages/Plán.md\n"), "id and path values only");
}
