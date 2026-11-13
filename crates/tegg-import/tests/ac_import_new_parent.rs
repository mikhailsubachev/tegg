//! Slice I2's engine change (D-1581, amends D-1537, D-1575 and v1-import §5's `TargetNotWritable`): a new vault's
//! parent folder that doesn't exist is accepted when **its own parent** exists, is a folder and is writable (one missing
//! level only). `plan` creates nothing; `start` creates that one folder (`create_dir`) just before the vault.
//! Interface docs/contracts/v1-import-window.md §2.3 ("A missing parent") and docs/contracts/v1-import.md §5, §9.5.
//! Written from the contracts only (D-61). No AC key: the test is named after its decision, as the contract asks.
mod common;

use common::*;
use tegg_import::{Control, ImportError, Mapping, PlanTarget, Target};

#[test]
fn d_1581_missing_parent_is_created_at_start() {
    let sb = sandbox();
    let env = ok!(env(&sb), "the test environment (NodeTransformer)");
    // `<tmp>/Documents` exists; `<tmp>/Documents/Tegg` doesn't (the default place on a fresh machine, D-1581).
    let documents = sb.base.join("Documents");
    std::fs::create_dir_all(&documents).expect("setup: Documents");
    let parent = documents.join("Tegg");
    assert_setup(!parent.exists(), "Documents/Tegg doesn't exist yet");
    let src = source(&sb, "c01-spaces");
    let scan = ok!(scan_of(&src, &env), "scan of c01-spaces");
    let before = snapshot(&sb.base);

    // plan: accepted, nothing created.
    let target = Target::NewVault { parent: parent.clone(), name: VAULT_NAME.to_string() };
    let plan = ok!(plan_of(&scan, SPACE, &target, &Mapping::default(), &env), "plan with a missing parent one level deep (D-1581)");
    assert_eq!(
        plan.target,
        PlanTarget::NewVault { parent: parent.to_string_lossy().into_owned(), name: VAULT_NAME.to_string() },
        "the plan names the missing parent as given"
    );
    assert!(!parent.exists(), "plan creates nothing: Documents/Tegg is still missing");
    assert_eq!(touched(&before, &snapshot(&sb.base)), set(&[]), "plan writes nothing anywhere (FR-SYN-06 AC-45)");

    // start: creates `Tegg/` and the vault in it.
    let report = ok!(run_plan(plan, &scan, &target, &env), "start");
    assert_eq!(report.phase, tegg_jobs::Phase::Done, "the import ends done: {:?}", report.error);
    assert!(parent.is_dir(), "start created Documents/Tegg");
    let vault = parent.join(VAULT_NAME);
    assert_eq!(report.vault.as_deref(), Some(vault.as_path()), "the vault is Documents/Tegg/{VAULT_NAME}");
    assert!(vault.join(".tegg/vault.yml").is_file(), "the new vault has .tegg/vault.yml");
    assert!(vault.join(REPORT).is_file(), "the new vault has its report Page");
    let in_documents: Vec<String> = std::fs::read_dir(&documents).expect("read Documents").map(|e| e.expect("entry").file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(in_documents, vec!["Tegg".to_string()], "only Tegg/ was created in Documents");

    // Two missing levels are still refused, and nothing is created.
    let deep = sb.base.join("Chybí").join("Tegg");
    let r = tegg_import::plan(&scan, SPACE, &Target::NewVault { parent: deep.clone(), name: VAULT_NAME.to_string() }, &Mapping::default(), &env, &Control::default());
    let err = r.err();
    assert!(matches!(err, Some(ImportError::TargetNotWritable)), "two missing levels: TargetNotWritable, got {err:?}");
    assert!(!sb.base.join("Chybí").exists(), "the refused plan created nothing");
}
