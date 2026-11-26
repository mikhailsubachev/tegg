// Slice AND-3 (docs/contracts/android-edit.md §16.2; D-2519, CP-13 → D-2539): the LA layer's keyboard. Each ordered
// broadcast `app.tegg.testime.CMD` runs one InputConnection call on the focused field and answers with result data
// `ok` (`started` for `type`, the count for `stop`), `no-connection` when no field has the connection, or `bad-op`.
// Text arrives base64 (UTF-8), so NFD and other code points reach the field unchanged. Emulator only: apk-check
// refuses this package's classes and any InputMethod service in a product APK (§16.3).
package app.tegg.testime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Base64
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup

class TestIme : InputMethodService() {
    private val thread = HandlerThread("tegg-test-ime").apply { start() }
    private val handler = Handler(thread.looper)

    /** The running `type`: the code points left, and how many were committed. */
    @Volatile private var typing: Typing? = null

    private class Typing(val points: IntArray, val interval: Long) {
        @Volatile var next = 0
        @Volatile var stopped = false
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            resultData = try {
                run(intent)
            } catch (e: Exception) {
                "error: ${e.javaClass.simpleName}: ${e.message}"
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        registerReceiver(receiver, IntentFilter(ACTION), RECEIVER_EXPORTED)
    }

    override fun onDestroy() {
        typing?.stopped = true
        unregisterReceiver(receiver)
        thread.quitSafely()
        super.onDestroy()
    }

    /** An empty, 1 px input view: the page keeps (almost) the whole screen, and the system still counts a keyboard. */
    override fun onCreateInputView(): View = View(this).apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1) }

    override fun onEvaluateFullscreenMode(): Boolean = false

    private fun text(intent: Intent): String = String(Base64.decode(intent.getStringExtra("b64") ?: "", Base64.DEFAULT), Charsets.UTF_8)

    private fun run(intent: Intent): String {
        val op = intent.getStringExtra("op") ?: return "bad-op"
        if (op == "stop") {
            val t = typing ?: return "0"
            t.stopped = true
            typing = null
            return t.next.toString()
        }
        val ic = currentInputConnection ?: return "no-connection"
        val int = { k: String, d: Int -> intent.getIntExtra(k, d) }
        when (op) {
            "compose" -> ic.setComposingText(text(intent), int("cursor", 1))
            "commit" -> ic.commitText(text(intent), int("cursor", 1))
            "finish" -> ic.finishComposingText()
            "region" -> ic.setComposingRegion(int("start", 0), int("end", 0))
            "delete" -> ic.deleteSurroundingText(int("before", 0), int("after", 0))
            "select" -> ic.setSelection(int("start", 0), int("end", 0))
            "key" -> {
                val code = int("code", 0)
                val t = SystemClock.uptimeMillis()
                ic.sendKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
                ic.sendKeyEvent(KeyEvent(t, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0))
            }
            "type" -> {
                typing?.stopped = true
                val t = Typing(text(intent).codePoints().toArray(), int("interval", 100).toLong().coerceAtLeast(1))
                typing = t
                handler.post(object : Runnable {
                    override fun run() {
                        if (t.stopped || t.next >= t.points.size) return
                        val c = currentInputConnection ?: return
                        c.commitText(String(Character.toChars(t.points[t.next])), 1)
                        t.next++
                        handler.postDelayed(this, t.interval)
                    }
                })
                return "started"
            }
            else -> return "bad-op"
        }
        return "ok"
    }

    companion object {
        const val ACTION = "app.tegg.testime.CMD"
    }
}
