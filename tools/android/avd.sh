#!/bin/sh
# Slice AND-1 (D-2031, docs/contracts/android-shell.md §10.3): the headless emulator of the LA layer.
#   tools/android/avd.sh up     create the AVD tegg-and-35 once, boot it headless, wait for the boot to complete
#   tools/android/avd.sh down   stop it
set -e
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
AVD=tegg-and-35
IMAGE="system-images;android-35;google_apis;arm64-v8a"
case "$1" in
  up)
    if ! "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd -c 2>/dev/null | grep -qx "$AVD" && ! avdmanager list avd -c 2>/dev/null | grep -qx "$AVD"; then
      echo no | (avdmanager create avd -n "$AVD" -k "$IMAGE" -d pixel_6 2>/dev/null || "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d pixel_6) >/dev/null
      cfg="$HOME/.android/avd/$AVD.avd/config.ini"
      [ -f "$cfg" ] && { grep -v '^hw.ramSize' "$cfg" > "$cfg.tmp"; echo 'hw.ramSize=4096' >> "$cfg.tmp"; mv "$cfg.tmp" "$cfg"; }
    fi
    if ! adb devices | grep -q '^emulator-'; then
      nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot-save -gpu swiftshader_indirect >/dev/null 2>&1 &
    fi
    adb wait-for-device
    i=0
    until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
      i=$((i + 1)); [ $i -gt 180 ] && { echo "avd: $AVD did not boot in 180 s" >&2; exit 1; }
      sleep 1
    done
    ;;
  down)
    adb emu kill >/dev/null 2>&1 || true
    ;;
  *) echo "usage: avd.sh up|down" >&2; exit 2 ;;
esac
