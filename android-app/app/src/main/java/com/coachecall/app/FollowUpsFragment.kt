package com.coachecall.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.coachecall.app.databinding.FragmentFollowUpsBinding
import kotlinx.coroutines.launch

class FollowUpsFragment : Fragment() {

    private var _binding: FragmentFollowUpsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentFollowUpsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.recyclerFollowUps.layoutManager = LinearLayoutManager(requireContext())
        loadFollowUps()
    }

    private fun loadFollowUps() {
        val api = ApiClient.getService(requireContext())
        binding.progressBar.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val followUps = api.getFollowUps()
                binding.progressBar.visibility = View.GONE
                binding.tvEmpty.visibility = if (followUps.isEmpty()) View.VISIBLE else View.GONE
                binding.recyclerFollowUps.adapter = FollowUpsAdapter(followUps) { client -> complete(client) }
            } catch (e: Exception) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(context, "Failed to load follow-ups", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun complete(client: Client) {
        val api = ApiClient.getService(requireContext())
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                api.completeFollowUp(client.id)
                loadFollowUps()
            } catch (e: Exception) {
                Toast.makeText(context, "Failed to update follow-up", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
