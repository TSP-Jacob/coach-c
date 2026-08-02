package com.coachecall.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.coachecall.app.databinding.FragmentLeadsBinding
import kotlinx.coroutines.launch

class LeadsFragment : Fragment() {

    private var _binding: FragmentLeadsBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentLeadsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.recyclerLeads.layoutManager = LinearLayoutManager(requireContext())
        loadLeads()
    }

    private fun loadLeads() {
        val api = ApiClient.getService(requireContext())
        binding.progressBar.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val leads = api.getLeads()
                binding.progressBar.visibility = View.GONE
                binding.tvEmpty.visibility = if (leads.isEmpty()) View.VISIBLE else View.GONE
                binding.recyclerLeads.adapter = LeadsAdapter(leads) { lead -> markContacted(lead) }
            } catch (e: Exception) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(context, "Failed to load leads", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun markContacted(lead: Lead) {
        val api = ApiClient.getService(requireContext())
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                api.updateLead(lead.id, LeadUpdateRequest(contactMethod = "call"))
                loadLeads()
            } catch (e: Exception) {
                Toast.makeText(context, "Failed to update lead", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
