//! docs/contracts/android-shell.md §6 (D-2018): the Kotlin side of the Android shell. On other targets the plugin
//! registers nothing and `TeggAndroid` is never managed.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

#[cfg(target_os = "android")]
mod android {
    use serde::Deserialize;
    use tauri::plugin::PluginHandle;
    use tauri::Runtime;

    /// The Kotlin plugin `app.tegg.android.TeggStoragePlugin`.
    pub struct TeggAndroid<R: Runtime>(pub(crate) PluginHandle<R>);

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Access {
        pub granted: bool,
        pub shared_root: String,
    }

    #[derive(Deserialize)]
    struct PathResp {
        path: String,
    }

    #[derive(Deserialize)]
    struct Empty {}

    impl<R: Runtime> TeggAndroid<R> {
        /// `Environment.isExternalStorageManager()` and `getExternalStorageDirectory()`.
        pub fn access(&self) -> Result<Access, String> {
            self.0.run_mobile_plugin::<Access>("access", ()).map_err(|e| e.to_string())
        }
        /// `Context.getFilesDir()` (CP-2 → D-2037).
        pub fn files_dir(&self) -> Result<String, String> {
            self.0.run_mobile_plugin::<PathResp>("filesDir", ()).map(|r| r.path).map_err(|e| e.to_string())
        }
        /// Opens the system's "All files access" page for this app.
        pub fn open_settings(&self) -> Result<(), String> {
            self.0.run_mobile_plugin::<Empty>("openSettings", ()).map(|_| ()).map_err(|e| e.to_string())
        }
    }
}

#[cfg(target_os = "android")]
pub use android::{Access, TeggAndroid};

/// The plugin; on Android its setup manages `TeggAndroid`.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("tegg-android")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("app.tegg.android", "TeggStoragePlugin")?;
                _app.manage(android::TeggAndroid(handle));
            }
            Ok(())
        })
        .build()
}
