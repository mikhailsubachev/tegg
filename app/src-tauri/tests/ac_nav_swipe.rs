//! v0.123 feedback (D-1511) AC test of the desktop shell (L4): FR-NAV-03 AC-14 "The macOS setting decides"
//! (docs/acceptance/app-shell.md; docs/contracts/ms3-shell.md §12.2): the shell command `nav_swipe_scroll` "is in the
//! command manifest and the main window's capability (bug v0.122)". Through the probe
//! `tegg_app_lib::acl_probe(window, command)` (D-570: Tauri's mock runtime with the app's real capabilities and command
//! manifest), the main window reaches the command and the capture window is refused. What the command answers
//! (`NSEvent.isSwipeTrackingFromScrollEventsEnabled`) is the machine's setting: it has no public seam and stays a
//! manual check (AC-14's [manual] part). Written from the AC and the contract only (D-61).

use tegg_app_lib::{acl_probe, AclProbe};

#[test]
fn fr_nav_03_ac14_the_main_window_may_call_nav_swipe_scroll() {
    assert_eq!(acl_probe("main", "nav_swipe_scroll"), AclProbe::Reached, "nav_swipe_scroll from the main window: in the manifest and allowed by its capability");
    // Positive and negative controls of the probe itself.
    assert_eq!(acl_probe("main", "nav_opened"), AclProbe::Reached, "nav_opened from main (control)");
    assert_eq!(acl_probe("capture", "note_read"), AclProbe::Refused, "note_read from capture (control)");
}

#[test]
fn fr_nav_03_ac14_the_capture_window_may_not_call_nav_swipe_scroll() {
    assert_eq!(acl_probe("main", "nav_swipe_scroll"), AclProbe::Reached, "nav_swipe_scroll exists and the main window reaches it");
    assert_eq!(acl_probe("capture", "nav_swipe_scroll"), AclProbe::Refused, "only the main window navigates: refused from capture (NFR-SEC-03)");
}
