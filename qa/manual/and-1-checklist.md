# AND-1 owner checks (Android shell)

slice: AND-1
checked by: owner (not yet run)

These need the owner's phone or Google account, so Claude could not run them (D-62: Claude uses generated vaults only
and never the owner's accounts). They are the open items of spike AND-0 (`spikes/android/FINDINGS.md`) and the owner
checks OC-1…OC-4 of `docs/acceptance/android-shell.md`. Record the results below each item (counts and timings only).

## Getting the APK onto the phone

1. Create the signing key once and keep it outside the repository, with a backup (D-2021; losing it means the next APK
   can't update the installed one):
   `keytool -genkeypair -keystore ~/.config/tegg/tegg-release.jks -alias tegg -keyalg RSA -keysize 4096 -validity 10000`
   and `~/.config/tegg/android-signing.properties` (mode 600) with `storeFile`, `storePassword`, `keyAlias`,
   `keyPassword`.
2. `cd app && npm run app:release -- <version>` builds `Tegg.app` and `Tegg-<version>.apk`
   (`src-tauri/target/release/bundle/release/`).
3. Copy the APK to the phone and install it (allow installs from that source when Android asks).

## OC-1 Install and access

- [ ] Starts on the permission screen; `Open settings` opens "All files access" for Tegg; back in Tegg it moves on.
- [ ] A copy of a generated vault (`cargo run --release --manifest-path tools/gen-vault/Cargo.toml -- --seed 1
      --small-images --out <dir>`, copied to `Documents/` on the phone) is listed under `Vaults on this phone` and opens.
- [ ] Time to `index-idle` (first open): ___ s. Time to reopen after a restart: ___ s. Note open: ___ ms.
      (Emulator, for comparison: first open ~9 s for 7,200 objects in shared storage; cold restart to Inbox ~2.5 s.)

## OC-2 Typing with Gboard (desktop layout; findings go to AND-3's ACs)

- [ ] Czech diacritics, autocorrect and suggestions in a note body.
- [ ] Enter in a list, backspace at the start of a block.
- [ ] The file's diff (on the Mac after sync) shows only the typed text and `modified`.

## OC-3 The separate Drive sync app (D-2004)

- [ ] It syncs `.tegg/` and `.trash/`.
- [ ] It does not upload Tegg's temporary files (`.<name>.tegg-tmp`).
- [ ] Its conflict copies are named: ___
- [ ] After editing a note in Tegg, the sync app uploads the new content (AND-1 found that Android's storage layer can
      show other apps a stale copy of a file whose name is in NFD bytes; see the PR's open points).

## OC-4 Drive API (input for AND-4)

- [ ] Sign-in with the full `drive` scope on the owner's own Google Cloud project; token lifetime: ___
- [ ] The change list works for the vault folder.
- [ ] The Mac client uploads Tegg's atomic writes as: an update of the same file / a delete and a create (circle one).
