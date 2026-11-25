//! Slice AND-3, L1 (Mac host): docs/acceptance/android-edit.md FR-EDT-08 AC-17 "Edits that can't be written are kept on
//! the phone" (AP-2076 → D-2511; CP-4 → D-2530), the recovery copy's file key, through docs/contracts/android-edit.md
//! §4.5: `tegg_app_lib::phone::recovery_key(vault, path)` is the lower-case hex SHA-256 of `vault + "\u{0}" +
//! NFC(path)`, compiled on every target, with the same table as the UI's `recoveryKey` (app/test/android_edit.ac.test.ts).
//! The keys were computed outside the code under test (Node's SHA-256). Written from the ACs and the contract only (D-61).

use tegg_app_lib::phone::recovery_key;

const TABLE: &[(&str, &str, &str)] = &[
    ("/storage/emulated/0/Documents/Editor", "Pages/Psaní.md", "655e2a827b9370ea38a2ab82674199966207f31a5433ccad1d30335025366f11"),
    ("/storage/emulated/0/Documents/Editor", "Pages/Psani\u{301}.md", "655e2a827b9370ea38a2ab82674199966207f31a5433ccad1d30335025366f11"),
    ("/storage/emulated/0/Documents/Knihovna", "Quick Notes/Nákup.md", "41b825973694c5caff136049046eb901b512b3be9e6361660804be7b8a8ae024"),
    ("/storage/emulated/0/Documents/Editor", "Daily/2026-10-14.md", "c4bad6a080873f1aa3ad53958f490892235598a92a4f153cab7ec7642ebe73f5"),
];

#[test]
fn fr_edt_08_ac17_recovery_key_table() {
    let got: Vec<String> = TABLE.iter().map(|(v, p, _)| recovery_key(v, p)).collect();
    let want: Vec<String> = TABLE.iter().map(|(_, _, k)| k.to_string()).collect();
    assert_eq!(got, want, "recovery_key: lower-case hex SHA-256 of vault + NUL + NFC(path)");
}
