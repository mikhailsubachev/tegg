//! MS5 slice 5B AC test of the desktop shell (L4, `app-shell-test` step): NFR-SEC-03 AC-2 "Refused calls"
//! (docs/acceptance/capture.md; docs/contracts/ms5-capture.md §2.1, D-552, D-553). Through Tauri's mock runtime with the
//! capture window's label, `note_read`, `note_write`, `index_switcher`, `index_search` (the AC's `search`), `index_list`
//! and `vault_open` are refused by the ACL and reach no command function; the capture commands are allowed from
//! `capture`, and the main window's commands from `main`. The probe `tegg_app_lib::acl_probe(window, command)` runs one
//! invoke through `tauri::test::mock_builder` with the app's capabilities (see the red-test points, AP-50x: the contract
//! names the mechanism, not the entry point). Written from the AC and the contract only (D-61).

use tegg_app_lib::{acl_probe, AclProbe};

#[test]
fn nfr_sec_03_ac2_the_capture_window_cannot_read_or_write_notes() {
    let mut reached = Vec::new();
    for cmd in ["note_read", "note_write", "index_switcher", "index_search", "index_list", "vault_open"] {
        if acl_probe("capture", cmd) != AclProbe::Refused {
            reached.push(cmd);
        }
    }
    assert!(reached.is_empty(), "refused by the ACL from the capture window, no command function reached: {reached:?}");
}

#[test]
fn nfr_sec_03_ac2_more_main_window_commands_are_refused_from_capture() {
    let mut reached = Vec::new();
    for cmd in ["inbox_list", "vault_settings", "vault_settings_patch", "note_create", "note_trash", "index_tags", "link_resolve", "ui_state_set", "open_external", "app_quit"] {
        if acl_probe("capture", cmd) != AclProbe::Refused {
            reached.push(cmd);
        }
    }
    assert!(reached.is_empty(), "only §2.2's commands are allowed from capture: {reached:?}");
    // The capture commands are allowed there, and the main window keeps its commands (positive controls).
    assert_eq!(acl_probe("capture", "capture_context"), AclProbe::Reached, "capture_context from capture");
    assert_eq!(acl_probe("main", "note_read"), AclProbe::Reached, "note_read from main");
    assert_eq!(acl_probe("main", "capture_ready"), AclProbe::Refused, "capture_ready isn't a main-window command");
}
