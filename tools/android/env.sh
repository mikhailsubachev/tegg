# Slice AND-1 (D-2033, docs/contracts/android-shell.md §10.3): the Android build environment. Source it:
#   . tools/android/env.sh
# Every value can be set beforehand to override the default. Returns 3 (and prints what is missing) when the JDK, the
# SDK, the NDK or the Rust target is not installed; the gates' `android-check` step then fails, never skips.
: "${ANDROID_HOME:=/opt/homebrew/share/android-commandlinetools}"
: "${TEGG_NDK_VERSION:=28.2.13676358}"
: "${NDK_HOME:=$ANDROID_HOME/ndk/$TEGG_NDK_VERSION}"
if [ -z "${JAVA_HOME:-}" ]; then JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || true); fi
export ANDROID_HOME NDK_HOME JAVA_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME" ANDROID_NDK_HOME="$NDK_HOME"
_tegg_tc="$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin"
# API 30 is the APK's minSdk (D-2020).
: "${CC_aarch64_linux_android:=$_tegg_tc/aarch64-linux-android30-clang}"
: "${CXX_aarch64_linux_android:=$_tegg_tc/aarch64-linux-android30-clang++}"
: "${AR_aarch64_linux_android:=$_tegg_tc/llvm-ar}"
: "${CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER:=$_tegg_tc/aarch64-linux-android30-clang}"
export CC_aarch64_linux_android CXX_aarch64_linux_android AR_aarch64_linux_android CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER
case ":$PATH:" in *":$ANDROID_HOME/platform-tools:"*) ;; *) export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/build-tools/36.0.0:$JAVA_HOME/bin:$PATH" ;; esac
_tegg_missing=""
[ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ] || _tegg_missing="JDK 21"
[ -n "$_tegg_missing" ] || [ -d "$ANDROID_HOME/platforms/android-36" ] || _tegg_missing="Android SDK platform 36 in $ANDROID_HOME"
[ -n "$_tegg_missing" ] || [ -x "$CC_aarch64_linux_android" ] || _tegg_missing="NDK $TEGG_NDK_VERSION in $NDK_HOME"
[ -n "$_tegg_missing" ] || rustup target list --installed 2>/dev/null | grep -qx aarch64-linux-android || _tegg_missing="Rust target aarch64-linux-android (rustup target add aarch64-linux-android)"
unset _tegg_tc
if [ -n "$_tegg_missing" ]; then
  echo "android env: missing $_tegg_missing (see tools/android/env.sh)" >&2
  unset _tegg_missing
  return 3 2>/dev/null || exit 3
fi
unset _tegg_missing
