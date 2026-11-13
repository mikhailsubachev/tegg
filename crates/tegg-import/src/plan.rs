//! §5.1, §5.4: the plan DTO and the comparison of plans.
pub use crate::dto::*;

use crate::layout::without_zip;

impl Plan {
    /// §5.4: the plan without what depends on the machine or the container.
    pub fn normalized(&self) -> Plan {
        let mut p = self.clone();
        p.source.kind = SourceKind::Folder;
        p.source.size = None;
        p.source.name = without_zip(&p.source.name).to_string();
        for u in &mut p.source.unreadable {
            if u.entry.len() > 1 && u.entry.starts_with('#') && u.entry[1..].chars().all(|c| c.is_ascii_digit()) {
                u.entry = "#".to_string();
            }
        }
        if let PlanTarget::NewVault { parent, .. } = &mut p.target {
            parent.clear();
        }
        p.needed_bytes = 0;
        p.stamps = Stamps::default();
        p
    }
    /// `self.normalized() == other.normalized()`.
    pub fn same_as(&self, other: &Plan) -> bool {
        self.normalized() == other.normalized()
    }
}

impl LinkOutcome {
    /// R147: the outcomes counted as imported.
    pub fn imported(&self) -> bool {
        matches!(self, LinkOutcome::Resolved | LinkOutcome::DateMention | LinkOutcome::Attachment | LinkOutcome::External)
    }
}
