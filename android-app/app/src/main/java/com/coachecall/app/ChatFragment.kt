package com.coachecall.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.coachecall.app.databinding.FragmentChatBinding
import kotlinx.coroutines.launch

class ChatFragment : Fragment() {

    private var _binding: FragmentChatBinding? = null
    private val binding get() = _binding!!
    private val messages = mutableListOf<ChatMessage>()
    private lateinit var adapter: ChatAdapter

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentChatBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        adapter = ChatAdapter(messages)
        binding.recyclerChat.layoutManager = LinearLayoutManager(requireContext()).apply {
            stackFromEnd = true
        }
        binding.recyclerChat.adapter = adapter

        binding.btnSend.setOnClickListener { sendMessage() }

        loadHistory()
    }

    private fun loadHistory() {
        val auth = AuthRepository.getInstance(requireContext())
        val agentId = auth.getAgentId() ?: return
        val api = ApiClient.getService(requireContext())

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val history = api.getChatHistory(agentId)
                messages.clear()
                messages.addAll(history)
                adapter.notifyDataSetChanged()
                scrollToBottom()
            } catch (_: Exception) {}
        }
    }

    private fun sendMessage() {
        val text = binding.etMessage.text.toString().trim()
        if (text.isEmpty()) return

        val auth = AuthRepository.getInstance(requireContext())
        val agentId = auth.getAgentId() ?: return
        val api = ApiClient.getService(requireContext())

        binding.etMessage.setText("")
        val userMsg = ChatMessage(null, agentId, "user", text, null)
        messages.add(userMsg)
        adapter.notifyItemInserted(messages.size - 1)
        scrollToBottom()

        binding.btnSend.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val response = api.chat(ChatRequest(agentId, text))
                val assistantMsg = ChatMessage(null, agentId, "assistant", response.reply, null)
                messages.add(assistantMsg)
                adapter.notifyItemInserted(messages.size - 1)
                scrollToBottom()
            } catch (e: Exception) {
                Toast.makeText(context, "Failed to send message", Toast.LENGTH_SHORT).show()
            } finally {
                binding.btnSend.isEnabled = true
            }
        }
    }

    private fun scrollToBottom() {
        if (messages.isNotEmpty()) {
            binding.recyclerChat.scrollToPosition(messages.size - 1)
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
