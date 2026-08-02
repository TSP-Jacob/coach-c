package com.coachecall.app

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.coachecall.app.databinding.ItemFollowUpBinding

class FollowUpsAdapter(
    private val clients: List<Client>,
    private val onComplete: (Client) -> Unit
) : RecyclerView.Adapter<FollowUpsAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemFollowUpBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        ViewHolder(ItemFollowUpBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = clients.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val client = clients[position]
        with(holder.binding) {
            tvFollowUpName.text = client.name
            tvFollowUpDate.text = client.followUpDate ?: ""
            tvFollowUpNote.text = client.followUpNote ?: "No note"
            btnComplete.setOnClickListener { onComplete(client) }
        }
    }
}
