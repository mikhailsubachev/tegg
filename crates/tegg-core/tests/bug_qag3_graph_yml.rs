//! QA review of slice G3 (graph presets in `.tegg/graph.yml`, R118 write rules, contract v1-graph §16.1, §16.10):
//! regression tests for writes that produced invalid or different YAML (FR-GRP-02, FR-FMT-07, NFR-REL-02; D-1122,
//! D-1124).
//!
//! - Comment lines inside an item or a key's block value behave like blank lines: only content lines end a range, so
//!   a comment shallower than the item or key column no longer cuts the item (Delete) or the list (Update) short.
//!   Comments after an item's or key's last content line stay outside it.
//! - A missing `version` goes after a UTF-8 BOM, leading `%` directives and a `---` line; a file with more than one
//!   document is not patched (every write refused with `Unreadable`, D-1122).
//! - The safety net: every write is parsed back first; anything but the intended change (an alias left without its
//!   anchor, …) is refused with `Unreadable` and nothing is written.

mod common;
mod graph_presets_setup;
mod graph_setup;

use common::*;
use graph_presets_setup::*;
use graph_setup::open;
use tegg_core::{Core, CoreError, GraphPreset, GraphPresets, PresetError, PresetOp, PresetsState};

fn apply_fresh(core: &Core, op: PresetOp) -> Result<GraphPresets, CoreError> {
    let base = core.graph_presets().version;
    core.graph_presets_apply(base, op)
}

/// Applies `op` on `start` as `.tegg/graph.yml` and returns the file afterwards (and the result).
fn run(start: &str, op: PresetOp) -> (Result<GraphPresets, CoreError>, String) {
    let sb = sandbox();
    let root = vault_with(&sb, Some(start.as_bytes()));
    let core = open(&root, &sb.dirs);
    let r = apply_fresh(&core, op);
    (r, disk_s(&root, YML).unwrap_or_default())
}

fn assert_written(start: &str, op: PresetOp, want: &str, what: &str) {
    let (r, after) = run(start, op);
    assert!(r.is_ok(), "{what}: answered {r:?}");
    assert_eq!(after, want, "{what}: the file afterwards");
    let p = r.unwrap_or_else(|_| unreachable!());
    assert_eq!(p.state, PresetsState::Ok, "{what}: the written file reads as Ok");
}

fn assert_refused(start: &str, op: PresetOp, what: &str) {
    let (r, after) = run(start, op);
    assert!(matches!(r, Err(CoreError::Preset(PresetError::Unreadable))), "{what}: refused with Unreadable, got {r:?}");
    assert_eq!(after, start, "{what}: nothing written");
}

fn preset(name: &str, t: &[&str], k: &[&str]) -> GraphPreset {
    GraphPreset { name: name.into(), hidden_types: strs(t), hidden_kinds: strs(k) }
}

// ------------------------------------------------------------------------------------------------ comment lines

const REPRO_1: &str = "version: 1\npresets:\n  - name: A\n#    hidden-types: [tag]\n    hidden-kinds: []\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n";

#[test]
fn bug_qag3_fr_grp_02_delete_keeps_an_item_whole_across_a_shallow_comment() {
    assert_written(REPRO_1, delete("A"), "version: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n", "delete A");
    // Update and rename of the same item stay valid too.
    assert_written(
        REPRO_1,
        update("A", &["tag"], &[]),
        "version: 1\npresets:\n  - name: A\n#    hidden-types: [tag]\n    hidden-kinds: []\n    hidden-types: [tag]\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n",
        "update A",
    );
}

const REPRO_2: &str = "version: 1\npresets:\n  - name: A\n    hidden-types:\n      - tag\n    #  - page\n      - kniha\n    hidden-kinds: []\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n";

#[test]
fn bug_qag3_fr_grp_02_update_replaces_a_block_list_across_a_comment_at_the_key_column() {
    let sb = sandbox();
    let root = vault_with(&sb, Some(REPRO_2.as_bytes()));
    let core = open(&root, &sb.dirs);
    assert_eq!(core.graph_presets().presets[0], preset("A", &["tag", "kniha"], &[]), "the block list reads across the comment");
    let r = apply_fresh(&core, update("A", &["page"], &[]));
    assert!(r.is_ok(), "update A answered {r:?}");
    assert_eq!(
        disk_s(&root, YML).unwrap_or_default(),
        "version: 1\npresets:\n  - name: A\n    hidden-types: [page]\n    hidden-kinds: []\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n",
        "the whole block list, with the comment between its entries, becomes one flow line"
    );
}

#[test]
fn bug_qag3_fr_grp_02_comments_after_the_last_content_line_stay() {
    // The rule for trailing comments: after an item's last content line they belong to what follows.
    let start = "version: 1\npresets:\n  - name: A\n    hidden-types: []\n    hidden-kinds: []\n    # about the next one\n  - name: B\n    hidden-types:\n      - tag\n      # end of the list\n    hidden-kinds: []\n";
    assert_written(
        start,
        delete("A"),
        "version: 1\npresets:\n    # about the next one\n  - name: B\n    hidden-types:\n      - tag\n      # end of the list\n    hidden-kinds: []\n",
        "delete A",
    );
    assert_written(
        start,
        update("B", &["page"], &[]),
        "version: 1\npresets:\n  - name: A\n    hidden-types: []\n    hidden-kinds: []\n    # about the next one\n  - name: B\n    hidden-types: [page]\n      # end of the list\n    hidden-kinds: []\n",
        "update B",
    );
}

// ------------------------------------------------------------------------------------------------ the version line

const ITEM_A: &str = "presets:\n  - name: A\n    hidden-types: []\n    hidden-kinds: []\n";

#[test]
fn bug_qag3_fr_grp_02_version_goes_after_a_document_start_and_directives() {
    assert_written(&format!("---\n{ITEM_A}"), rename("A", "B"), "---\nversion: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n", "after ---");
    assert_written(
        &format!("%YAML 1.2\n---\n# h\n{ITEM_A}"),
        rename("A", "B"),
        "%YAML 1.2\n---\n# h\nversion: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n",
        "after %YAML, --- and the comment",
    );
}

#[test]
fn bug_qag3_fr_grp_02_version_goes_after_a_bom() {
    assert_written(
        &format!("\u{FEFF}# h\n{ITEM_A}"),
        rename("A", "B"),
        "\u{FEFF}# h\nversion: 1\npresets:\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n",
        "BOM, comment",
    );
    assert_written(&format!("\u{FEFF}{ITEM_A}"), delete("A"), "\u{FEFF}version: 1\npresets: []\n", "BOM, then presets");
}

#[test]
fn bug_qag3_fr_grp_02_a_file_with_several_documents_is_never_patched() {
    for start in [format!("version: 1\n{ITEM_A}---\nother: 1\n"), format!("version: 1\n{ITEM_A}...\n"), format!("---\nversion: 1\n{ITEM_A}---\n")] {
        let sb = sandbox();
        let root = vault_with(&sb, Some(start.as_bytes()));
        let core = open(&root, &sb.dirs);
        let read = core.graph_presets();
        assert_eq!(read.state, PresetsState::Ok, "{start:?}: listed (D-1122)");
        assert_eq!(read.presets, vec![preset("A", &[], &[])], "{start:?}: lists A");
        for op in [save("C", &[], &[]), update("A", &["tag"], &[]), rename("A", "B"), delete("A")] {
            assert_refused(&start, op.clone(), &format!("{start:?} {op:?}"));
        }
    }
}

// ------------------------------------------------------------------------------------------------ parse-back check

#[test]
fn bug_qag3_fr_grp_02_a_write_that_breaks_an_alias_is_refused() {
    let start = "version: 1\npresets:\n  - name: A\n    hidden-types: &t [tag]\n    hidden-kinds: []\n  - name: B\n    hidden-types: *t\n    hidden-kinds: []\n";
    assert_refused(start, delete("A"), "delete A (B's alias loses its anchor)");
    assert_refused(start, update("A", &["page"], &[]), "update A (the anchor is replaced)");
    assert_written(
        start,
        update("B", &["page"], &[]),
        "version: 1\npresets:\n  - name: A\n    hidden-types: &t [tag]\n    hidden-kinds: []\n  - name: B\n    hidden-types: [page]\n    hidden-kinds: []\n",
        "update B (the alias itself is replaced)",
    );
}

#[test]
fn bug_qag3_fr_grp_02_presets_null_is_refused() {
    assert_refused("version: 1\npresets: ~\n", save("A", &[], &[]), "presets: ~");
    assert_refused("version: 1\npresets: null\n", save("A", &[], &[]), "presets: null");
}

#[test]
fn bug_qag3_fr_grp_02_a_flow_item_makes_every_write_refused() {
    // D-1122: a `- {name: x}` item can't be patched by lines, so no write touches the file.
    let start = "version: 1\npresets:\n  - {name: A, hidden-types: [], hidden-kinds: []}\n  - name: B\n    hidden-types: []\n    hidden-kinds: []\n";
    for op in [save("C", &[], &[]), update("B", &["tag"], &[]), rename("B", "D"), delete("B"), delete("A")] {
        assert_refused(start, op.clone(), &format!("{op:?}"));
    }
}

#[test]
fn bug_qag3_fr_grp_02_a_quoted_key_is_patched() {
    // A quoted key the scanner finds is patched (only one it can't find is refused, D-1122).
    let start = "version: 1\npresets:\n  - \"name\": A\n    'hidden-types': [tag]\n    hidden-kinds: []\n";
    assert_written(start, rename("A", "B"), "version: 1\npresets:\n  - \"name\": B\n    'hidden-types': [tag]\n    hidden-kinds: []\n", "rename");
    assert_written(start, update("A", &["page"], &[]), "version: 1\npresets:\n  - \"name\": A\n    'hidden-types': [page]\n    hidden-kinds: []\n", "update");
}

#[test]
fn bug_qag3_fr_grp_02_a_key_the_scanner_misses_is_refused() {
    // YAML reads `hidden-types` (a tagged key) but the line scanner can't find it: refused, never written twice.
    let start = "version: 1\npresets:\n  - name: A\n    !!str hidden-types: [tag]\n    hidden-kinds: []\n";
    let sb = sandbox();
    let root = vault_with(&sb, Some(start.as_bytes()));
    let core = open(&root, &sb.dirs);
    assert_eq!(core.graph_presets().presets, vec![preset("A", &["tag"], &[])], "listed");
    assert_refused(start, update("A", &["page"], &[]), "update A");
}
