package com.coachecall.app

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.coachecall.app.databinding.ItemCallBinding

class CallsAdapter(
    private val calls: List<CallSummary>,
    private val onClick: (CallSummary) -> Unit
) : RecyclerView.Adapter<CallsAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemCallBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        ViewHolder(ItemCallBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = calls.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val call = calls[position]
        with(holder.binding) {
            tvClientName.text = call.clientName ?: "Unknown Client"
            tvCallType.text = call.callType?.replace("_", " ")?.replaceFirstChar { it.uppercase() } ?: "Unknown"
            tvStatus.text = call.status.replaceFirstChar { it.uppercase() }
            tvScore.text = call.overallScore?.let { "$it/100" } ?: "—"
            tvDate.text = call.callDate?.take(10) ?: ""
            val mins = (call.durationSeconds ?: 0) / 60
            val secs = (call.durationSeconds ?: 0) % 60
            tvDuration.text = "%d:%02d".format(mins, secs)
            root.setOnClickListener { onClick(call) }
        }
    }
}
