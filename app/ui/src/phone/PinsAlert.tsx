// Slice AND-3 (android-edit §2.4 row 14; FR-HOM-02 AC-33, FR-SYN-03 AC-42): `Pin` / `Unpin` run from `More actions`
// while the drawer, which holds the Pinned section and its alert, is closed. The section's alert (pinned.md's
// `pinned.changedOutside`, `pinned.saveFailed`) is shown here instead, where the phone's notices are.
import { usePins } from '../pinned/store';

export function PinsAlert({ drawerOpen }: { drawerOpen: boolean }) {
  const { alert } = usePins();
  if (!alert || drawerOpen) return null;
  return <div role="alert" className="phone-notice phone-pins-alert">{alert.text}</div>;
}
