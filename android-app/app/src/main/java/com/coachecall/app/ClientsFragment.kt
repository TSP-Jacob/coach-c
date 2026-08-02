package com.coachecall.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.coachecall.app.databinding.FragmentClientsBinding
import kotlinx.coroutines.launch

class ClientsFragment : Fragment() {

    private var _binding: FragmentClientsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentClientsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.recyclerClients.layoutManager = LinearLayoutManager(requireContext())
        loadClients()
    }

    private fun loadClients() {
        val auth = AuthRepository.getInstance(requireContext())
        val agentId = auth.getAgentId() ?: return
        val api = ApiClient.getService(requireContext())

        binding.progressBar.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val clients = api.getClients(agentId)
                binding.progressBar.visibility = View.GONE
                binding.tvEmpty.visibility = if (clients.isEmpty()) View.VISIBLE else View.GONE
                binding.recyclerClients.adapter = ClientsAdapter(clients)
            } catch (e: Exception) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(context, "Failed to load clients", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
