package com.coachecall.app

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.coachecall.app.databinding.ItemMessageUserBinding
import com.coachecall.app.databinding.ItemMessageAssistantBinding

class ChatAdapter(private val messages: List<ChatMessage>) :
    RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val VIEW_USER = 0
        private const val VIEW_ASSISTANT = 1
    }

    override fun getItemViewType(position: Int) =
        if (messages[position].role == "user") VIEW_USER else VIEW_ASSISTANT

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == VIEW_USER) {
            UserMessageViewHolder(ItemMessageUserBinding.inflate(inflater, parent, false))
        } else {
            AssistantMessageViewHolder(ItemMessageAssistantBinding.inflate(inflater, parent, false))
        }
    }

    override fun getItemCount() = messages.size

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val msg = messages[position]
        when (holder) {
            is UserMessageViewHolder -> holder.binding.tvMessage.text = msg.content
            is AssistantMessageViewHolder -> holder.binding.tvMessage.text = msg.content
        }
    }

    inner class UserMessageViewHolder(val binding: ItemMessageUserBinding) :
        RecyclerView.ViewHolder(binding.root)

    inner class AssistantMessageViewHolder(val binding: ItemMessageAssistantBinding) :
        RecyclerView.ViewHolder(binding.root)
}
