package com.coachecall.app

import android.animation.ObjectAnimator
import android.animation.AnimatorSet
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.coachecall.app.databinding.ActivityAssistantBinding
import kotlinx.coroutines.launch
import java.util.Locale

class AssistantActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAssistantBinding
    private var tts: TextToSpeech? = null
    private var recognizer: SpeechRecognizer? = null
    private val dismissHandler = Handler(Looper.getMainLooper())
    private var pulseAnimator: AnimatorSet? = null

    private val dismissRunnable = Runnable { finish() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAssistantBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.root.setOnClickListener { finish() }

        startPulse()
        initTts()
    }

    private fun initTts() {
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.language = Locale.getDefault()
                val auth = AuthRepository.getInstance(this)
                val name = auth.getUserEmail()?.substringBefore("@") ?: "there"
                speak("Hello $name, what would you like to know?") {
                    startListening()
                }
            }
        }
    }

    private fun speak(text: String, onDone: (() -> Unit)? = null) {
        binding.tvStatus.text = text
        val utteranceId = System.currentTimeMillis().toString()
        tts?.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
            override fun onStart(id: String) {}
            override fun onDone(id: String) { if (id == utteranceId) onDone?.invoke() }
            override fun onError(id: String) { onDone?.invoke() }
        })
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
    }

    private fun startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            binding.tvStatus.text = "Voice recognition not available"
            scheduleDismiss(3000)
            return
        }

        binding.tvStatus.text = "Listening…"
        recognizer = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                val matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                val query = matches?.firstOrNull()
                if (!query.isNullOrBlank()) {
                    binding.tvStatus.text = "\"$query\""
                    queryAssistant(query)
                } else {
                    speak("I didn't catch that. Tap to try again.")
                    scheduleDismiss(4000)
                }
            }

            override fun onError(error: Int) {
                binding.tvStatus.text = "Couldn't hear you. Tap to dismiss."
                scheduleDismiss(3000)
            }

            override fun onReadyForSpeech(params: Bundle) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray) {}
            override fun onEndOfSpeech() { binding.tvStatus.text = "Thinking…" }
            override fun onPartialResults(partialResults: Bundle) {}
            override fun onEvent(eventType: Int, params: Bundle) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        recognizer?.startListening(intent)
    }

    private fun queryAssistant(query: String) {
        val auth = AuthRepository.getInstance(this)
        val agentId = auth.getUserId() ?: return
        val api = ApiClient.getService(this)

        lifecycleScope.launch {
            try {
                val response = api.chat(ChatRequest(agentId, query))
                speak(response.reply)
                scheduleDismiss(10000)
            } catch (e: Exception) {
                speak("Sorry, I couldn't reach Coach-C right now.")
                scheduleDismiss(4000)
            }
        }
    }

    private fun scheduleDismiss(delayMs: Long) {
        dismissHandler.removeCallbacks(dismissRunnable)
        dismissHandler.postDelayed(dismissRunnable, delayMs)
    }

    private fun startPulse() {
        fun looping(animator: ObjectAnimator) = animator.apply {
            duration = 1200
            repeatCount = ObjectAnimator.INFINITE
            repeatMode = ObjectAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
        }
        val scaleX = looping(ObjectAnimator.ofFloat(binding.orbView, View.SCALE_X, 1f, 1.15f))
        val scaleY = looping(ObjectAnimator.ofFloat(binding.orbView, View.SCALE_Y, 1f, 1.15f))
        val alpha  = looping(ObjectAnimator.ofFloat(binding.orbView, View.ALPHA, 0.8f, 1f))
        pulseAnimator = AnimatorSet().apply {
            playTogether(scaleX, scaleY, alpha)
            start()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        dismissHandler.removeCallbacks(dismissRunnable)
        pulseAnimator?.cancel()
        recognizer?.destroy()
        tts?.shutdown()
    }
}
