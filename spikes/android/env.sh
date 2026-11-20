# AND-0 spike: environment for Android builds (source it). Throwaway.
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export ANDROID_NDK_HOME=$NDK_HOME
export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH
TC=$NDK_HOME/toolchains/llvm/prebuilt/darwin-x86_64/bin
export CC_aarch64_linux_android=$TC/aarch64-linux-android26-clang
export AR_aarch64_linux_android=$TC/llvm-ar
export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$TC/aarch64-linux-android26-clang
