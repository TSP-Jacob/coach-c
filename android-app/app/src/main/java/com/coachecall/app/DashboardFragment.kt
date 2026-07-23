package com.coachecall.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.coachecall.app.databinding.FragmentDashboardBinding
import kotlinx.coroutines.launch

class DashboardFragment : Fragment() {

    private var _binding: FragmentDashboardBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentDashboardBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.btnSignOut.setOnClickListener {
            (activity as? MainActivity)?.signOut()
        }

        loadData()
    }

    private fun loadData() {
        val auth = AuthRepository.getInstance(requireContext())
        val agentId = auth.getUserId() ?: return
        val api = ApiClient.getService(requireContext())

        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val profile = api.getMyProfile()
                binding.tvWelcome.text = "Welcome back, ${profile.name}"
                binding.tvBrokerage.text = profile.brokerageName ?: ""

                val stats = api.getStats(agentId)
                binding.tvTotalCalls.text = stats.totalCalls.toString()
                binding.tvAvgScore.text = stats.averageScore?.let { "%.0f".format(it) } ?: "—"

                val breakdown = stats.byType.entries.joinToString("\n") { (type, count) ->
                    "${type.replace("_", " ").replaceFirstChar { it.uppercase() }}: $count"
                }
                binding.tvCallBreakdown.text = breakdown.ifEmpty { "No calls yet" }

            } catch (e: Exception) {
                Toast.makeText(context, "Failed to load dashboard", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
