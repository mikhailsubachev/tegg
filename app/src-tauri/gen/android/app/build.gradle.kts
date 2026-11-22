import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// Slice AND-1 (D-2019…D-2021, D-2041; docs/contracts/android-shell.md §8): the release signing key comes from the file
// named by TEGG_ANDROID_SIGNING (never inside the repository); the test APK is the release variant made debuggable by the
// Gradle property `teggDebuggable` (ORG_GRADLE_PROJECT_teggDebuggable=true, set only by `npm run app:android-test`).
val teggSigning = Properties().apply {
    val path = System.getenv("TEGG_ANDROID_SIGNING")
    if (!path.isNullOrBlank() && file(path).exists()) {
        file(path).inputStream().use { load(it) }
    }
}
val teggDebuggable = (findProperty("teggDebuggable") as? String) == "true"

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "app.tegg.desktop"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // D-2019: the release APK is app.tegg.preview (as Tegg.app), the test APK app.tegg.desktop.
        applicationId = System.getenv("TEGG_ANDROID_APP_ID") ?: "app.tegg.desktop"
        minSdk = 30
        targetSdk = 35
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            if (teggSigning.getProperty("storeFile") != null) {
                storeFile = file(teggSigning.getProperty("storeFile"))
                storePassword = teggSigning.getProperty("storePassword")
                keyAlias = teggSigning.getProperty("keyAlias")
                keyPassword = teggSigning.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (teggSigning.getProperty("storeFile") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isDebuggable = teggDebuggable
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
