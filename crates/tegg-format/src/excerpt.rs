//! Link positions, block texts and the excerpt window (docs/contracts/ms4-links.md §2, D-277, D-302, D-303;
//! FR-LNK-01 AC-4). The TypeScript twin is `@tegg/doc` `excerptWindow` and `extract().blocks`; both follow the
//! shared corpus `tests/fixtures/format/excerpt/cases.json`.

use serde::{Deserialize, Serialize};

/// Where a link starts: 1-based line in the file, 0-based UTF-8 byte offset in that line (as `?at=`, ms3-shell §15.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct At {
    pub line: u32,
    pub byte: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlockKind {
    Paragraph,
    Heading,
    ListItem,
    TableRow,
    Quote,
    Callout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mark {
    Strong,
    Em,
    Code,
    Strike,
    Highlight,
}

/// A block's own inline content (§2.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Segment {
    Text { text: String, marks: Vec<Mark> },
    /// Index into `Extracted::links`; the chip text is filled in at query time.
    Link { link: u32, marks: Vec<Mark> },
}

/// One body block that contains at least one link (§2.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockText {
    pub kind: BlockKind,
    pub segments: Vec<Segment>,
}

/// The Rust form of `LinkTargetDto` (ms3-shell §11.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetKind {
    Note,
    Daily,
    DateMissing,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkTargetInfo {
    pub target: String,
    pub kind: TargetKind,
    pub path: Option<String>,
    pub title: Option<String>,
    pub r#type: Option<String>,
}

/// A rendered segment: a block's segments with each link's chip text filled in (§2.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RSeg {
    Text { text: String, marks: Vec<Mark> },
    Link { text: String, target: LinkTargetInfo, here: bool, marks: Vec<Mark> },
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Excerpt {
    pub segments: Vec<RSeg>,
    pub cut_start: bool,
    pub cut_end: bool,
}

/// §2.2: a block of at most `max` characters is shown whole. A longer one is cut: the window starts at most
/// `before` characters before the first `here` chip, just after whitespace, and holds at most `max` characters,
/// ending before whitespace; chips are never cut and whitespace at a cut is dropped (D-303). Characters are Unicode
/// scalar values of the rendered text, chips included.
pub fn window(rendered: &[RSeg], here: &[usize], max: usize, before: usize) -> Excerpt {
    // (char, segment index, inside a chip)
    let mut chars: Vec<(char, usize, bool)> = Vec::new();
    let mut seg_start: Vec<usize> = Vec::new();
    for (i, s) in rendered.iter().enumerate() {
        seg_start.push(chars.len());
        match s {
            RSeg::Text { text, .. } => chars.extend(text.chars().map(|c| (c, i, false))),
            RSeg::Link { text, .. } => chars.extend(text.chars().map(|c| (c, i, true))),
        }
    }
    let len = chars.len();
    if len <= max {
        return Excerpt { segments: rendered.to_vec(), cut_start: false, cut_end: false };
    }
    let first_here = here.iter().copied().filter(|&h| h < rendered.len()).min().map(|h| seg_start[h]).unwrap_or(0);
    let lo = first_here.saturating_sub(before);
    let mut start = first_here;
    for i in lo..=first_here {
        if i == 0 || (chars[i - 1].0.is_whitespace() && !chars[i - 1].2) {
            start = i;
            break;
        }
    }
    let mut end = len;
    if len - start > max {
        let limit = start + max;
        // The largest whitespace position at or before `limit` outside a chip; the text ends just before it.
        let mut cut = None;
        for j in (start + 1..=limit.min(len - 1)).rev() {
            if chars[j].0.is_whitespace() && !chars[j].2 {
                cut = Some(j);
                break;
            }
        }
        end = cut.unwrap_or(limit.min(len));
    }
    // Drop whitespace at the cuts.
    let mut s = start;
    while s < end && start > 0 && chars[s].0.is_whitespace() && !chars[s].2 {
        s += 1;
    }
    let mut e = end;
    while e > s && end < len && chars[e - 1].0.is_whitespace() && !chars[e - 1].2 {
        e -= 1;
    }
    let mut segments = Vec::new();
    for (i, seg) in rendered.iter().enumerate() {
        let a = seg_start[i];
        let b = if i + 1 < seg_start.len() { seg_start[i + 1] } else { len };
        let (from, to) = (a.max(s), b.min(e));
        if from >= to {
            continue;
        }
        match seg {
            RSeg::Text { marks, .. } => {
                let text: String = chars[from..to].iter().map(|c| c.0).collect();
                segments.push(RSeg::Text { text, marks: marks.clone() });
            }
            link => segments.push(link.clone()),
        }
    }
    Excerpt { segments, cut_start: s > 0, cut_end: e < len }
}
