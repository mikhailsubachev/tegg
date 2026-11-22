#!/bin/sh
# Slice AND-1 (D-2031, docs/contracts/android-shell.md §10.3): the headless emulator of the LA layer.
# Slice AND-2 (D-2082, docs/contracts/android-phone.md §13.3): a fixed pixel_7 profile (CSS 411 × 914 at 2.625), gesture
# navigation, auto-rotate off. An AVD of another profile is recreated.
#   tools/android/avd.sh up     create the AVD tegg-and-35 once, boot it headless, wait for the boot to complete
#   tools/android/avd.sh down   stop it
set -e
here=$(cd "$(dirname "$0")" && pwd)
. "$here/env.sh"
AVD=tegg-and-35
IMAGE="system-images;android-35;google_apis;arm64-v8a"
DEVICE=pixel_7
avdmgr() { avdmanager "$@" 2>/dev/null || "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" "$@"; }
case "$1" in
  up)
    cfg="$HOME/.android/avd/$AVD.avd/config.ini"
    if [ -f "$cfg" ] && ! grep -qx "hw.device.name=$DEVICE" "$cfg"; then
      adb emu kill >/dev/null 2>&1 || true
      sleep 2
      avdmgr delete avd -n "$AVD" >/dev/null || true
    fi
    if ! "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd -c 2>/dev/null | grep -qx "$AVD" && ! avdmanager list avd -c 2>/dev/null | grep -qx "$AVD"; then
      echo no | avdmgr create avd -n "$AVD" -k "$IMAGE" -d "$DEVICE" >/dev/null
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
    adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural >/dev/null 2>&1 || true
    adb shell settings put system accelerometer_rotation 0 >/dev/null 2>&1 || true
    ;;
  down)
    adb emu kill >/dev/null 2>&1 || true
    ;;
  *) echo "usage: avd.sh up|down" >&2; exit 2 ;;
esac
