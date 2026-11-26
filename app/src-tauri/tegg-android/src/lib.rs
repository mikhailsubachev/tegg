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

    /// android-phone §2.2 (D-2432): the window as the plugin sees it; insets in CSS px.
    #[derive(Deserialize, Clone, Debug)]
    #[serde(rename_all = "camelCase")]
    pub struct WindowState {
        pub insets: Insets,
        pub keyboard: bool,
        pub system_dark: bool,
        pub font_scale: f64,
    }

    #[derive(Deserialize, Clone, Debug)]
    pub struct Insets {
        pub top: f64,
        pub bottom: f64,
        pub left: f64,
        pub right: f64,
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
        /// android-phone §5.5 (D-2420): `ACTION_VIEW` for an allowed URL. `Err("NoHandler")` when no app takes it.
        pub fn open_url(&self, url: &str) -> Result<(), String> {
            self.0
                .run_mobile_plugin::<Empty>("openUrl", serde_json::json!({ "url": url }))
                .map(|_| ())
                .map_err(|e| if e.to_string().contains("NoHandler") { "NoHandler".into() } else { e.to_string() })
        }
        /// android-edit §6.1 (CP-5 → D-2531): `showSoftInput` / `hideSoftInputFromWindow` for the WebView.
        pub fn ime(&self, show: bool) -> Result<(), String> {
            self.0.run_mobile_plugin::<Empty>("ime", serde_json::json!({ "show": show })).map(|_| ()).map_err(|e| e.to_string())
        }
        /// android-phone §5.2 (D-2432): the bar icons for the resolved theme, then the window state.
        pub fn window(&self, dark: bool) -> Result<WindowState, String> {
            self.0.run_mobile_plugin::<WindowState>("window", serde_json::json!({ "dark": dark })).map_err(|e| e.to_string())
        }
    }
}

#[cfg(target_os = "android")]
pub use android::{Access, Insets, TeggAndroid, WindowState};

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
