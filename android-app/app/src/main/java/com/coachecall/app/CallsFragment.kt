package com.coachecall.app

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.coachecall.app.databinding.FragmentCallsBinding
import kotlinx.coroutines.launch

class CallsFragment : Fragment() {

    private var _binding: FragmentCallsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentCallsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.recyclerCalls.layoutManager = LinearLayoutManager(requireContext())
        loadCalls()
    }

    private fun loadCalls() {
        val auth = AuthRepository.getInstance(requireContext())
        val agentId = auth.getUserId() ?: return
        val api = ApiClient.getService(requireContext())

        binding.progressBar.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val calls = api.getCalls(agentId)
                binding.progressBar.visibility = View.GONE
                binding.tvEmpty.visibility = if (calls.isEmpty()) View.VISIBLE else View.GONE
                binding.recyclerCalls.adapter = CallsAdapter(calls) { call ->
                    val intent = Intent(requireContext(), CallDetailActivity::class.java)
                    intent.putExtra("call_id", call.id)
                    startActivity(intent)
                }
            } catch (e: Exception) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(context, "Failed to load calls", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
