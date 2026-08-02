package com.coachecall.app

import com.google.gson.annotations.SerializedName

data class AgentProfile(
    val id: String,
    val name: String,
    val email: String,
    @SerializedName("brokerage_id") val brokerageId: String?,
    @SerializedName("brokerage_name") val brokerageName: String?,
    @SerializedName("avatar_url") val avatarUrl: String?,
    @SerializedName("feature_flags") val featureFlags: Map<String, Boolean>?
)

data class AgentStats(
    @SerializedName("total_calls") val totalCalls: Int,
    @SerializedName("average_score") val averageScore: Double?,
    @SerializedName("by_type") val byType: Map<String, Int>
)

data class CallSummary(
    val id: String,
    @SerializedName("agent_id") val agentId: String,
    @SerializedName("client_id") val clientId: String?,
    @SerializedName("client_name") val clientName: String?,
    @SerializedName("call_date") val callDate: String?,
    @SerializedName("duration_seconds") val durationSeconds: Int?,
    val status: String,
    @SerializedName("call_type") val callType: String?,
    @SerializedName("overall_score") val overallScore: Int?,
    @SerializedName("audio_url") val audioUrl: String?
)

data class CallDetail(
    val id: String,
    @SerializedName("agent_id") val agentId: String,
    @SerializedName("client_id") val clientId: String?,
    @SerializedName("client_name") val clientName: String?,
    @SerializedName("call_date") val callDate: String?,
    @SerializedName("duration_seconds") val durationSeconds: Int?,
    val status: String,
    @SerializedName("call_type") val callType: String?,
    @SerializedName("overall_score") val overallScore: Int?,
    @SerializedName("audio_url") val audioUrl: String?,
    val transcript: TranscriptData?,
    @SerializedName("coaching_report") val coachingReport: CoachingReport?
)

data class TranscriptData(
    @SerializedName("full_text") val fullText: String?,
    val utterances: List<Utterance>?
)

data class Utterance(
    val speaker: String,
    val text: String,
    val start: Long?,
    val end: Long?
)

data class CoachingReport(
    val summary: String?,
    val strengths: List<String>?,
    val improvements: List<String>?,
    @SerializedName("priority_focus") val priorityFocus: String?,
    @SerializedName("principle_scores") val principleScores: Map<String, Int>?
)

data class Client(
    val id: String,
    @SerializedName("agent_id") val agentId: String?,
    val name: String,
    val phone: String?,
    val email: String?,
    val type: String?,
    val notes: String?,
    @SerializedName("created_at") val createdAt: String?,
    @SerializedName("follow_up_date") val followUpDate: String?,
    @SerializedName("follow_up_note") val followUpNote: String?
)

data class FollowUpSetRequest(
    @SerializedName("follow_up_date") val followUpDate: String,
    @SerializedName("follow_up_note") val followUpNote: String? = null
)

data class Lead(
    val id: String,
    @SerializedName("agent_id") val agentId: String?,
    val name: String,
    val phone: String?,
    val email: String?,
    val source: String,
    val status: String,
    @SerializedName("contact_method") val contactMethod: String?,
    @SerializedName("contacted_at") val contactedAt: String?,
    val address: String?,
    val city: String?,
    val province: String?,
    @SerializedName("property_type") val propertyType: String?,
    @SerializedName("estimated_value") val estimatedValue: Double?,
    @SerializedName("timeline_to_sell") val timelineToSell: String?,
    @SerializedName("created_at") val createdAt: String?
)

data class LeadUpdateRequest(
    val status: String? = null,
    @SerializedName("agent_id") val agentId: String? = null,
    @SerializedName("contact_method") val contactMethod: String? = null
)

data class TaskAgentRef(val id: String, val name: String)

data class TaskItem(
    val id: String,
    @SerializedName("brokerage_id") val brokerageId: String?,
    @SerializedName("assigned_to") val assignedTo: String?,
    @SerializedName("created_by") val createdBy: String?,
    val title: String,
    val description: String?,
    val status: String,
    @SerializedName("due_date") val dueDate: String?,
    @SerializedName("completed_at") val completedAt: String?,
    @SerializedName("created_at") val createdAt: String?,
    val assignee: TaskAgentRef?,
    val creator: TaskAgentRef?
)

data class TaskUpdateRequest(
    val status: String? = null,
    val title: String? = null,
    val description: String? = null,
    @SerializedName("due_date") val dueDate: String? = null,
    @SerializedName("assigned_to") val assignedTo: String? = null
)

data class ChatMessage(
    val id: String?,
    @SerializedName("agent_id") val agentId: String?,
    val role: String,
    val content: String,
    @SerializedName("created_at") val createdAt: String?
)

data class ChatRequest(
    @SerializedName("agent_id") val agentId: String,
    val message: String
)

data class ChatResponse(
    val reply: String
)
