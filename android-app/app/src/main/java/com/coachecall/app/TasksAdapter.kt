package com.coachecall.app

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.coachecall.app.databinding.ItemTaskBinding

class TasksAdapter(
    private val tasks: List<TaskItem>,
    private val onStatusChange: (TaskItem, String) -> Unit
) : RecyclerView.Adapter<TasksAdapter.ViewHolder>() {

    inner class ViewHolder(val binding: ItemTaskBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
        ViewHolder(ItemTaskBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = tasks.size

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val task = tasks[position]
        with(holder.binding) {
            tvTaskTitle.text = task.title
            tvTaskStatus.text = task.status.replace("_", " ").replaceFirstChar { it.uppercase() }
            tvTaskDescription.text = task.description ?: ""
            tvTaskDescription.visibility = if (task.description.isNullOrBlank()) View.GONE else View.VISIBLE

            val metaParts = mutableListOf<String>()
            task.assignee?.let { metaParts.add("Assigned to ${it.name}") }
            task.dueDate?.let { metaParts.add("Due $it") }
            tvTaskMeta.text = metaParts.joinToString("  •  ")

            val isDone = task.status == "done"
            btnInProgress.visibility = if (isDone) View.GONE else View.VISIBLE
            btnDone.text = if (isDone) "Reopen" else "Mark Done"
            btnInProgress.setOnClickListener { onStatusChange(task, "in_progress") }
            btnDone.setOnClickListener { onStatusChange(task, if (isDone) "pending" else "done") }
        }
    }
}
