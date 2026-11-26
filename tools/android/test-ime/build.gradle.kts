// Slice AND-3 (docs/contracts/android-edit.md §16.2): `app.tegg.testime`, one InputMethodService, minSdk 30, targetSdk 35,
// debug-signed. The plugin versions are the product's (app/src-tauri/gen/android/build.gradle.kts), so the build uses
// the same cached artifacts. Built by tools/android/test-ime.sh into .verify/android/test-ime.apk.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

apply(plugin = "com.android.application")
apply(plugin = "org.jetbrains.kotlin.android")

repositories {
    google()
    mavenCentral()
}

configure<com.android.build.gradle.AppExtension> {
    compileSdkVersion(36)
    namespace = "app.tegg.testime"
    defaultConfig {
        applicationId = "app.tegg.testime"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

configure<org.jetbrains.kotlin.gradle.dsl.KotlinAndroidProjectExtension> {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
