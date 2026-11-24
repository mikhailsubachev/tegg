// Slice AND-1 (D-2016, D-2018, D-2037; docs/contracts/android-shell.md §6): "All files access" for the vault folder in
// shared storage, the system page that grants it, and the app's private files folder for machine-local data.
// Slice AND-2 (docs/contracts/android-phone.md §5; D-2429…D-2432, D-2444): the window seen by the page: safe-area
// insets and the keyboard, system Back, the bar icons, night mode and the font size, and links opened in other apps.
package app.tegg.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentCallbacks
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.math.ceil
import kotlin.math.roundToInt

@InvokeArg
class WindowArgs {
    var dark: Boolean = false
}

@InvokeArg
class OpenUrlArgs {
    var url: String = ""
}

@TauriPlugin
class TeggStoragePlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private var insets = Insets(0, 0, 0, 0)
    private var keyboard = false

    private data class Insets(val top: Int, val bottom: Int, val left: Int, val right: Int)

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        // The test APK is debuggable (CP-6 → D-2041); the LA layer drives its page over DevTools (CP-4 → D-2039).
        // The release APK is not debuggable, so this never runs there.
        if ((activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        watchInsets()
        watchBack()
        watchConfiguration()
        applyConfiguration(activity.resources.configuration)
    }

    // ------------------------------------------------------------ §5.1 insets and the keyboard (CP-1 → D-2429)

    private fun watchInsets() {
        val content = activity.findViewById<View>(android.R.id.content) ?: return
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, all ->
            val bars = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = all.getInsets(WindowInsetsCompat.Type.ime())
            val imeShown = all.isVisible(WindowInsetsCompat.Type.ime())
            // The WebView ends at the keyboard's top, so the page's layout viewport shrinks.
            view.setPadding(0, 0, 0, if (imeShown) ime.bottom else 0)
            val d = activity.resources.displayMetrics.density
            // The WebView rounds its layout viewport up to whole CSS px (2400 device px at 2.625 → 915, not 914.29),
            // so its bottom and right edges lie up to 1 CSS px past the screen. A bottom or right bar's inset adds that
            // overhang, and every inset rounds up, so nothing ends under a bar (FR-UX-04 AC-3).
            val win = activity.windowManager.currentWindowMetrics.bounds
            val h = (win.height() - if (imeShown) ime.bottom else 0) / d
            val w = win.width() / d
            insets = Insets(
                ceil(bars.top / d).toInt(),
                if (imeShown || bars.bottom == 0) 0 else ceil(bars.bottom / d + (ceil(h) - h)).toInt(),
                ceil(bars.left / d).toInt(),
                if (bars.right == 0) 0 else ceil(bars.right / d + (ceil(w) - w)).toInt(),
            )
            keyboard = imeShown
            push("{insets:${insetsJs()},keyboard:$keyboard}")
            all
        }
        // With an animation callback the content view gets the keyboard's end state when its animation starts, not
        // when it ends, so the page fits the keyboard at once (FR-UX-04 AC-4, D-2467).
        ViewCompat.setWindowInsetsAnimationCallback(content, object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_STOP) {
            override fun onProgress(insets: WindowInsetsCompat, running: MutableList<WindowInsetsAnimationCompat>) = insets
        })
        content.requestApplyInsets()
    }

    private fun insetsJs() = "{top:${insets.top},bottom:${insets.bottom},left:${insets.left},right:${insets.right}}"

    /** §6.1 (CP-2 → D-2430): the page's bridge `window.__TEGG_NATIVE__.receive('window', …)`. */
    private fun push(state: String) {
        val w = webView ?: return
        w.post { w.evaluateJavascript("window.__TEGG_NATIVE__ && window.__TEGG_NATIVE__.receive('window', $state)", null) }
    }

    // ------------------------------------------------------------ §5.3 system Back (CP-3 → D-2431)

    private fun watchBack() {
        val a = activity as? AppCompatActivity ?: return
        // Added after Tauri's AppPlugin, so it runs first.
        a.onBackPressedDispatcher.addCallback(a, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val w = webView
                if (w == null) {
                    activity.moveTaskToBack(true)
                    return
                }
                w.evaluateJavascript("window.__TEGG_NATIVE__ ? window.__TEGG_NATIVE__.back() : false") { r ->
                    if (r != "true") activity.moveTaskToBack(true)
                }
            }
        })
    }

    // ------------------------------------------------------------ §5.4 night mode and the font size (D-2444)

    private fun watchConfiguration() {
        activity.registerComponentCallbacks(object : ComponentCallbacks {
            override fun onConfigurationChanged(c: Configuration) = applyConfiguration(c)
            @Deprecated("not used") override fun onLowMemory() {}
        })
    }

    private fun systemDark(c: Configuration) = (c.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    private fun applyConfiguration(c: Configuration) {
        val w = webView ?: return
        w.post { w.settings.textZoom = (c.fontScale * 100).roundToInt() }
        push("{systemDark:${systemDark(c)},fontScale:${c.fontScale}}")
    }

    // ------------------------------------------------------------ commands

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

    /** §5.2 (CP-4 → D-2432): the bar icons for the resolved theme, then the window state. */
    @Command
    fun window(invoke: Invoke) {
        val dark = invoke.parseArgs(WindowArgs::class.java).dark
        activity.runOnUiThread {
            val c = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            c.isAppearanceLightStatusBars = !dark
            c.isAppearanceLightNavigationBars = !dark
            val cfg = activity.resources.configuration
            val ret = JSObject()
            val i = JSObject()
            i.put("top", insets.top); i.put("bottom", insets.bottom); i.put("left", insets.left); i.put("right", insets.right)
            ret.put("insets", i)
            ret.put("keyboard", keyboard)
            ret.put("systemDark", systemDark(cfg))
            ret.put("fontScale", cfg.fontScale.toDouble())
            invoke.resolve(ret)
        }
    }

    /** §5.5 (D-2420): `ACTION_VIEW` for http, https, mailto and tel only; no connection of Tegg's own. */
    @Command
    fun openUrl(invoke: Invoke) {
        val url = invoke.parseArgs(OpenUrlArgs::class.java).url.trim()
        val scheme = Uri.parse(url).scheme?.lowercase()
        if (scheme !in setOf("http", "https", "mailto", "tel")) {
            invoke.reject("refused scheme", "Unsupported")
            return
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            invoke.resolve(JSObject())
        } catch (e: ActivityNotFoundException) {
            invoke.reject("no app opens this link", "NoHandler")
        }
    }
}
