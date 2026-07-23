package com.coachecall.app

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.coachecall.app.databinding.ItemClientBinding

class ClientsAdapter(
    private val clients: List<Client>
) : RecyclerView.Adapter<ClientsAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemClientBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        ViewHolder(ItemClientBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = clients.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val client = clients[position]
        with(holder.binding) {
            tvClientName.text = client.name
            tvClientType.text = client.type?.replaceFirstChar { it.uppercase() } ?: "—"
            tvClientPhone.text = client.phone ?: "No phone"
            tvClientEmail.text = client.email ?: "No email"
        }
    }
}
