#!/bin/sh
# Slice AND-1 (D-2032, docs/contracts/android-shell.md §10.2): the throwaway key that signs the test APK. Creates it once
# in .verify/android/ (ignored by git) and prints the properties file the Gradle project reads (TEGG_ANDROID_SIGNING).
# Never used for a release: the release reads the owner's own key (D-2021).
set -e
here=$(cd "$(dirname "$0")/../.." && pwd)
dir="$here/.verify/android"
props="$dir/test-signing.properties"
if [ ! -f "$props" ]; then
  mkdir -p "$dir"
  "${JAVA_HOME:?source tools/android/env.sh first}/bin/keytool" -genkeypair -keystore "$dir/test.keystore" -storepass tegg-test -keypass tegg-test \
    -alias tegg-test -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Tegg Test, O=Tegg" >/dev/null 2>&1
  printf 'storeFile=%s\nstorePassword=tegg-test\nkeyAlias=tegg-test\nkeyPassword=tegg-test\n' "$dir/test.keystore" > "$props"
  chmod 600 "$props"
fi
echo "$props"
