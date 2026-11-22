//! Lucide icon names (docs/contracts/v1-cards.md §2.4; cards.md R215; D-1955, D-1958, D-1991).
//!
//! Compile-only stub for slice OC's red tests (D-61): the signatures of the contract, no data. `resolve_icon` resolves
//! nothing; the build replaces this file with the bundled Lucide 0.460.0 data (`include_str!`).

/// Stub: empty (the build sets `"0.460.0"`).
pub const LUCIDE_VERSION: &str = "";

/// One element of a Lucide icon node: the SVG tag and its attributes in file order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconEl {
    pub tag: String,
    pub attrs: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedIcon {
    pub name: &'static str,
    pub node: &'static [IconEl],
}

/// D-1955: the name itself when it is a Lucide 0.460 name, else its alias target; None for anything else. Stub: None.
pub fn resolve_icon(_name: &str) -> Option<ResolvedIcon> {
    None
}

/// types.md R14's 24 names (the list `ICONS` held), kept only to test D-1955.
pub const OLD_ICON_NAMES: [&str; 24] = [""; 24];
