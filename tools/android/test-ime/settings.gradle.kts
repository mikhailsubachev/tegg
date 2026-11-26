// Slice AND-3 (docs/contracts/android-edit.md §16.2; D-2519, CP-13 → D-2539): the test input method, a Gradle project
// of its own. Emulator only; the product's Gradle project (app/src-tauri/gen/android) never references it, and apk-check
// refuses its classes in a product APK (§16.3).
rootProject.name = "tegg-test-ime"
