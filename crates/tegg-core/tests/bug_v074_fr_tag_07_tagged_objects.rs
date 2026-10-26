//! Regression test for the owner's report on preview v0.74 (first on v0.70): on the 20,000-note reference vault, All tags ›
//! the first tag showed `0 objects of 0 types` and the pages opened afterwards stayed empty for ~50 s. All tags computed
//! `<m> tagged objects` with one `tag_objects` read per tag (802 on that vault, each copying every indexed object under
//! the index lock). The count is one core read, `Core::tagged_objects()` (D-784, docs/contracts/ms4-tags.md §1.6):
//! distinct indexed objects with an occurrence of any tag (R80: 11; templates and the trash don't count). FR-TAG-07 AC-1,
//! D-721. The L5 part is app/webkit/bug_v074_fr_tag_07_all_tags_summary_is_one_read.test.ts.

mod common;
mod tags4d_setup;

use std::collections::BTreeSet;

use common::sandbox;
use tags4d_setup::*;

#[test]
fn bug_v074_fr_tag_07_tagged_objects_is_one_read() {
    let sb = sandbox();
    let root = tags_vault(&sb);
    let core = open(&root, &sb.dirs, false);
    assert_eq!(core.tagged_objects(), 11, "R80: 11 distinct tagged objects (D-721)");
    let distinct: BTreeSet<String> = core.tag_rows().iter().flat_map(|r| core.tag_objects(&r.key)).map(|o| o.path).collect();
    assert_eq!(core.tagged_objects(), distinct.len(), "equal to the distinct paths over every tag's objects");
}
