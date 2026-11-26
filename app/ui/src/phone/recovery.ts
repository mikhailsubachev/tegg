// Slice AND-3 (docs/contracts/android-edit.md §4.5, §11.2; FR-EDT-08 AC-17, D-2511, CP-4): edits the phone couldn't
// write when the app went to the background are kept as a private copy (`<files_dir>/recovery/<key>.json`, machine-
// local, never in the vault) and offered when that note next opens.
import { ipc } from '../ipc/client';
import type { RecoveryDto } from '../ipc/recovery';
import type { VersionDto } from '../ipc/types';
import { localIso } from '../zone';

/** Lower-case hex SHA-256 of `vault + "\0" + NFC(path)` (the Rust twin `recovery_key` gives the same). */
export async function recoveryKey(vault: string, path: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${vault}\u0000${path.normalize('NFC')}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Keeps the open note's unwritten edits on the phone (§11.2); nothing is written to the vault. */
export function keepForRecovery(o: { vault: string; path: string; id: string | null; title: string; text: string; base: VersionDto | null }): Promise<void> {
  const copy: RecoveryDto = { ...o, path: o.path.normalize('NFC'), savedAt: localIso(Date.now()) };
  return ipc.androidRecoveryPut(copy).catch(() => {});
}

/** The copy kept for `path` in the open vault, or null. */
export function takeRecovery(path: string): Promise<RecoveryDto | null> {
  return ipc.androidRecoveryGet(path.normalize('NFC')).catch(() => null);
}

/** Drops the copy for `path` (after a banner choice, a successful write or `Discard`). */
export function dropRecovery(path: string): Promise<void> {
  return ipc.androidRecoveryDrop(path.normalize('NFC')).catch(() => {});
}
