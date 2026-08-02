package com.coachecall.app

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.coachecall.app.databinding.ItemLeadBinding

class LeadsAdapter(
    private val leads: List<Lead>,
    private val onMarkContacted: (Lead) -> Unit
) : RecyclerView.Adapter<LeadsAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemLeadBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        ViewHolder(ItemLeadBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = leads.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val lead = leads[position]
        with(holder.binding) {
            tvLeadName.text = lead.name
            tvLeadStatus.text = lead.status.replaceFirstChar { it.uppercase() }
            tvLeadSource.text = "Source: ${lead.source.replace("_", " ").replaceFirstChar { it.uppercase() }}"
            tvLeadContact.text = listOfNotNull(lead.phone, lead.email).joinToString("  •  ").ifEmpty { "No contact info" }
            btnMarkContacted.visibility = if (lead.status == "new") android.view.View.VISIBLE else android.view.View.GONE
            btnMarkContacted.setOnClickListener { onMarkContacted(lead) }
        }
    }
}
