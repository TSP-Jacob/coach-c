package com.coachecall.app

import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import com.coachecall.app.databinding.ActivityCallDetailBinding
import kotlinx.coroutines.launch

class CallDetailActivity : AppCompatActivity() {

    private lateinit var binding: ActivityCallDetailBinding
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCallDetailBinding.inflate(layoutInflater)
        setContentView(binding.root)

        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = "Call Detail"

        val callId = intent.getStringExtra("call_id") ?: run { finish(); return }
        loadCall(callId)
    }

    private fun loadCall(callId: String) {
        val api = ApiClient.getService(this)
        binding.progressBar.visibility = View.VISIBLE

        lifecycleScope.launch {
            try {
                val call = api.getCall(callId)
                binding.progressBar.visibility = View.GONE
                bindCall(call)
            } catch (e: Exception) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(this@CallDetailActivity, "Failed to load call", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun bindCall(call: CallDetail) {
        binding.tvClientName.text = call.clientName ?: "Unknown Client"
        binding.tvCallType.text = call.callType?.replace("_", " ")?.replaceFirstChar { it.uppercase() } ?: "—"
        binding.tvDate.text = call.callDate?.take(10) ?: "—"
        binding.tvScore.text = call.overallScore?.let { "$it / 100" } ?: "—"

        val report = call.coachingReport
        if (report != null) {
            binding.tvSummary.text = report.summary ?: ""
            binding.tvStrengths.text = report.strengths?.joinToString("\n") { "• $it" } ?: ""
            binding.tvImprovements.text = report.improvements?.joinToString("\n") { "• $it" } ?: ""
            binding.tvPriorityFocus.text = report.priorityFocus ?: ""
        } else {
            binding.coachingCard.visibility = View.GONE
        }

        val fullText = call.transcript?.fullText
        if (!fullText.isNullOrBlank()) {
            binding.tvTranscript.text = fullText
        } else {
            binding.transcriptCard.visibility = View.GONE
        }

        val audioUrl = call.audioUrl
        if (!audioUrl.isNullOrBlank()) {
            setupPlayer(audioUrl)
        } else {
            binding.playerView.visibility = View.GONE
        }
    }

    private fun setupPlayer(url: String) {
        player = ExoPlayer.Builder(this).build().also { exo ->
            binding.playerView.player = exo
            exo.setMediaItem(MediaItem.fromUri(url))
            exo.prepare()
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
        player = null
    }
}
