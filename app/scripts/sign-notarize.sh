#!/bin/sh
# AR-08 / S3-QA AC-5: Developer ID signing + notarization of the app DMG (moved from the S3 spike, D-1367).
# Needs (owner-provided, never committed): a "Developer ID Application" certificate in the
# login keychain and a notarytool keychain profile created once with
#   xcrun notarytool store-credentials tegg-notary --apple-id <id> --team-id <team>
# Usage: scripts/sign-notarize.sh "Developer ID Application: Name (TEAMID)" [profile]
set -eu
IDENTITY="${1:?signing identity}"
PROFILE="${2:-tegg-notary}"
cd "$(dirname "$0")/.."
APPLE_SIGNING_IDENTITY="$IDENTITY" npx tauri build --bundles app,dmg \
  --config "{\"bundle\":{\"macOS\":{\"signingIdentity\":\"$IDENTITY\"}}}"
DMG=$(ls src-tauri/target/release/bundle/dmg/*.dmg | head -1)
codesign --sign "$IDENTITY" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature -v "$DMG"
echo "OK: $DMG is signed, notarized and stapled. Copy it to a second Mac to check it opens."
