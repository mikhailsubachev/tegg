//! MS6 slice 6A AC test of the desktop shell (L4, `app-shell-test` step): the capture window's media command
//! (docs/acceptance/trash-media.md FR-ATT-01 AC-11 "the capture window gets only the commands it needs
//! (`capture_media_add`), never a vault read (NFR-SEC-03, D-553)"; docs/contracts/ms6-trash-media.md §5, D-620). Through
//! `tegg_app_lib::acl_probe` (D-570), as ac_capture_acl.rs (5B): `capture_media_add` is allowed from `capture` and not
//! from `main`; the main window's media and trash commands are refused from `capture` and allowed from `main`. A new file
//! rather than an extension of ac_capture_acl.rs (contract §9.3), so no existing AC test changes (TS-I3). Written from
//! the AC and the contract only (D-61).

use tegg_app_lib::{acl_probe, AclProbe};

#[test]
fn fr_att_01_ac11_the_capture_window_gets_only_capture_media_add() {
    assert_eq!(acl_probe("capture", "capture_media_add"), AclProbe::Reached, "capture_media_add from capture");
    assert_eq!(acl_probe("main", "capture_media_add"), AclProbe::Refused, "not a main-window command");
    let mut reached = Vec::new();
    for cmd in ["media_add", "media_add_paths", "media_pick", "media_open", "media_reveal", "trash_list", "object_trash", "trash_restore", "trash_delete", "trash_empty"] {
        if acl_probe("capture", cmd) != AclProbe::Refused {
            reached.push(cmd);
        }
    }
    assert!(reached.is_empty(), "refused from the capture window: {reached:?}");
    for cmd in ["media_add", "media_add_paths", "media_pick", "media_open", "media_reveal", "trash_list", "object_trash", "trash_restore", "trash_delete", "trash_empty"] {
        assert_eq!(acl_probe("main", cmd), AclProbe::Reached, "{cmd} from main");
    }
}
