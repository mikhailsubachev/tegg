// Slice AND-1 (D-2016, D-2018, D-2037; docs/contracts/android-shell.md §6): "All files access" for the vault folder in
// shared storage, the system page that grants it, and the app's private files folder for machine-local data.
package app.tegg.android

import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class TeggStoragePlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        super.load(webView)
        // The test APK is debuggable (CP-6 → D-2041); the LA layer drives its page over DevTools (CP-4 → D-2039).
        // The release APK is not debuggable, so this never runs there.
        if ((activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
    }

    @Command
    fun access(invoke: Invoke) {
        val ret = JSObject()
        ret.put("granted", Environment.isExternalStorageManager())
        ret.put("sharedRoot", Environment.getExternalStorageDirectory().absolutePath)
        invoke.resolve(ret)
    }

    @Command
    fun filesDir(invoke: Invoke) {
        val ret = JSObject()
        ret.put("path", activity.filesDir.absolutePath)
        invoke.resolve(ret)
    }

    @Command
    fun openSettings(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + activity.packageName))
        activity.startActivity(intent)
        invoke.resolve(JSObject())
    }
}
