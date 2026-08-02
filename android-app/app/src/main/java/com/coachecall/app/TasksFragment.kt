package com.coachecall.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.coachecall.app.databinding.FragmentTasksBinding
import kotlinx.coroutines.launch

class TasksFragment : Fragment() {

    private var _binding: FragmentTasksBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentTasksBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.recyclerTasks.layoutManager = LinearLayoutManager(requireContext())
        loadTasks()
    }

    private fun loadTasks() {
        val api = ApiClient.getService(requireContext())
        binding.progressBar.visibility = View.VISIBLE
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val tasks = api.getTasks()
                binding.progressBar.visibility = View.GONE
                binding.tvEmpty.visibility = if (tasks.isEmpty()) View.VISIBLE else View.GONE
                binding.recyclerTasks.adapter = TasksAdapter(tasks) { task, status -> updateStatus(task, status) }
            } catch (e: Exception) {
                binding.progressBar.visibility = View.GONE
                Toast.makeText(context, "Failed to load tasks", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateStatus(task: TaskItem, status: String) {
        val api = ApiClient.getService(requireContext())
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                api.updateTask(task.id, TaskUpdateRequest(status = status))
                loadTasks()
            } catch (e: Exception) {
                Toast.makeText(context, "Failed to update task", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
