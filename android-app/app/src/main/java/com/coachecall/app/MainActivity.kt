package com.coachecall.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.coachecall.app.databinding.ActivityMainBinding

/**
 * This app is a thin shell: it just shows the real Coach-C site in a
 * WebView, so the phone experience is always exactly what's live on the
 * web — no separate app release needed for UI/feature changes. See
 * project_coachc_dashboard_app memory for why this replaced an earlier
 * native reimplementation (which kept drifting from the backend's actual
 * behavior — five real bugs found in one session).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val webUrlHost = Uri.parse(BuildConfig.WEB_URL).host

    private var pendingPermissionRequest: PermissionRequest? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val micPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val request = pendingPermissionRequest
        pendingPermissionRequest = null
        if (request == null) return@registerForActivityResult
        if (granted) request.grant(request.resources) else request.deny()
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        filePathCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        filePathCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupWebView()
        if (savedInstanceState == null) {
            binding.webView.loadUrl(BuildConfig.WEB_URL)
        }

        binding.swipeRefresh.setOnRefreshListener { binding.webView.reload() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) binding.webView.goBack() else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun setupWebView() {
        val webView = binding.webView
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true // Supabase session persistence lives here
        settings.mediaPlaybackRequiresUserGesture = false
        settings.userAgentString = "${settings.userAgentString} CoachCAndroidApp/${BuildConfig.VERSION_NAME}"

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                return when (uri.scheme) {
                    "http", "https" -> {
                        if (uri.host == webUrlHost) {
                            false // same site — let the WebView load it normally
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                            true
                        }
                    }
                    "mailto", "tel" -> {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    }
                    else -> false
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                binding.progressBar.visibility = View.GONE
                binding.swipeRefresh.isRefreshing = false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Bridges the web page's own getUserMedia() mic prompt (used by
            // lib/voiceClient.ts and the Notes dictation feature) to this
            // app's runtime RECORD_AUDIO permission.
            override fun onPermissionRequest(request: PermissionRequest) {
                val needsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!needsAudio) { request.deny(); return }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(request.resources)
                } else {
                    pendingPermissionRequest = request
                    micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            // target="_blank" links open a new WebView by default, which
            // would otherwise just silently do nothing — hand the URL back
            // to our single WebView instead.
            override fun onCreateWindow(
                view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message
            ): Boolean {
                val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
                val redirectWebView = WebView(this@MainActivity)
                redirectWebView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                        view.loadUrl(request.url.toString())
                        return true
                    }
                }
                transport.webView = redirectWebView
                resultMsg.sendToTarget()
                return true
            }

            override fun onShowFileChooser(
                webView: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?
            ): Boolean {
                filePathCallback = callback
                fileChooserLauncher.launch("*/*")
                return true
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        binding.webView.restoreState(savedInstanceState)
    }

    // Required WebView lifecycle pass-through — without this, the WebView's
    // internal Chromium media pipeline never gets a proper "resumed" signal
    // from the Activity, which reproducibly breaks getUserMedia() audio
    // capture (NotReadableError) even on a fresh launch. See
    // https://developer.android.com/reference/android/webkit/WebView#onResume().
    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onPause() {
        binding.webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }
}
