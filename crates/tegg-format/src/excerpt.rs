//! Link positions, block texts and the excerpt window (docs/contracts/ms4-links.md §2, D-277; FR-LNK-01 AC-4).
//!
//! STUB (MS4 slice 4A red tests, TS-I1): the types are the contract's; `window` returns a deliberately wrong result
//! (an empty excerpt) until 4A is built. `Link::at`, `Link::block` and `Extracted::blocks` (§2.1) are added with the
//! implementation; the AC tests read them through `Debug`, so they compile before the fields exist.

/// Where a link starts: 1-based line in the file, 0-based UTF-8 byte offset in that line (as `?at=`, ms3-shell §15.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct At {
    pub line: u32,
    pub byte: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Paragraph,
    Heading,
    ListItem,
    TableRow,
    Quote,
    Callout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    Strong,
    Em,
    Code,
    Strike,
    Highlight,
}

/// A block's own inline content (§2.1).
#[derive(Debug, Clone, PartialEq)]
pub enum Segment {
    Text { text: String, marks: Vec<Mark> },
    /// Index into `Extracted::links`; the chip text is filled in at query time.
    Link { link: u32, marks: Vec<Mark> },
}

/// One body block that contains at least one link (§2.1).
#[derive(Debug, Clone, PartialEq)]
pub struct BlockText {
    pub kind: BlockKind,
    pub segments: Vec<Segment>,
}

/// The Rust form of `LinkTargetDto` (ms3-shell §11.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    Note,
    Daily,
    DateMissing,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkTargetInfo {
    pub target: String,
    pub kind: TargetKind,
    pub path: Option<String>,
    pub title: Option<String>,
    pub r#type: Option<String>,
}

/// A rendered segment: a block's segments with each link's chip text filled in (§2.2).
#[derive(Debug, Clone, PartialEq)]
pub enum RSeg {
    Text { text: String, marks: Vec<Mark> },
    Link { text: String, target: LinkTargetInfo, here: bool, marks: Vec<Mark> },
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Excerpt {
    pub segments: Vec<RSeg>,
    pub cut_start: bool,
    pub cut_end: bool,
}

/// §2.2: at most `max` characters, at most `before` characters before the first `here` chip, cut at whitespace.
/// STUB: returns an empty excerpt.
pub fn window(rendered: &[RSeg], here: &[usize], max: usize, before: usize) -> Excerpt {
    let _ = (rendered, here, max, before);
    Excerpt::default()
}
