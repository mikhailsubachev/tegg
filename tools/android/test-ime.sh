#!/bin/sh
# Slice AND-3 (D-2519, CP-13 → D-2539; docs/contracts/android-edit.md §16.2): the LA layer's test input method.
#   tools/android/test-ime.sh build     builds tools/android/test-ime into .verify/android/test-ime.apk (debug-signed)
#   tools/android/test-ime.sh install   installs it on the running emulator, enables it and makes it the keyboard
#   tools/android/test-ime.sh restore   sets the emulator's default keyboard back
# Emulator only: the product's Gradle project never references it, and apk-check refuses it in a product APK (§16.3).
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
. "$here/env.sh"
ID=app.tegg.testime
SERVICE=$ID/.TestIme
OUT="$repo/.verify/android/test-ime.apk"
case "$1" in
  build)
    mkdir -p "$(dirname "$OUT")"
    (cd "$here/test-ime" && sh ./gradlew --quiet --no-configuration-cache assembleDebug)
    cp "$here/test-ime/build/outputs/apk/debug/tegg-test-ime-debug.apk" "$OUT"
    ;;
  install)
    [ -f "$OUT" ] || { echo "test-ime: $OUT is missing; run test-ime.sh build first" >&2; exit 1; }
    adb install -r -t "$OUT" >/dev/null
    adb shell ime enable "$SERVICE" >/dev/null
    adb shell ime set "$SERVICE" >/dev/null
    ;;
  restore)
    adb shell ime reset >/dev/null 2>&1 || true
    ;;
  *) echo "usage: test-ime.sh build|install|restore" >&2; exit 2 ;;
esac
