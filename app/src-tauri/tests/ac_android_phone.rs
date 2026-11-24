//! Slice AND-2, L1 (Mac host): docs/acceptance/android-phone.md NFR-SEC-01 AC-4 "The system opens web links; Tegg makes
//! no connection" (AP-2056 → D-2420), the scheme check of `android_open_url` through docs/contracts/android-phone.md
//! §4.4: `tegg_app_lib::phone::open_url_allowed` is true exactly when the trimmed URL parses and its scheme,
//! case-insensitive, is `http`, `https`, `mailto` or `tel`. The same table as the TS twin `openUrlAllowed`
//! (app/test/android_phone.ac.test.ts). The device half is app/e2e-android/android_phone.ac.test.ts.
//! Written from the ACs and the contract only (D-61).

use tegg_app_lib::phone::open_url_allowed;

const TABLE: &[(&str, bool)] = &[
    ("https://example.org/čeština", true),
    ("http://example.org/", true),
    ("HTTPS://EXAMPLE.ORG/A", true),
    ("  https://example.org/x  ", true),
    ("mailto:eva@example.org", true),
    ("MailTo:eva@example.org", true),
    ("tel:+420123456789", true),
    ("javascript:alert(1)", false),
    ("JavaScript:alert(1)", false),
    ("file:///etc/hosts", false),
    ("data:text/html,x", false),
    ("content://media/1", false),
    ("intent://scan/#Intent;scheme=zxing;end", false),
    ("ftp://example.org/", false),
    ("/relative/path", false),
    ("relative.md", false),
    ("", false),
    ("   ", false),
    ("https//missing-colon", false),
];

#[test]
fn nfr_sec_01_ac4_external_links_leave_through_the_system() {
    let wrong: Vec<String> = TABLE.iter().filter(|(u, want)| open_url_allowed(u) != *want).map(|(u, want)| format!("{u:?} → {}", !want)).collect();
    assert!(wrong.is_empty(), "open_url_allowed accepts exactly http, https, mailto and tel (trimmed, case-insensitive); wrong: {wrong:?}");
}
