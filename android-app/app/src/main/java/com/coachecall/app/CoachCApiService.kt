package com.coachecall.app

import retrofit2.http.*

interface CoachCApiService {

    @GET("api/agents/me")
    suspend fun getMyProfile(): AgentProfile

    @GET("api/agents/{agentId}/stats")
    suspend fun getStats(@Path("agentId") agentId: String): AgentStats

    @GET("api/calls/")
    suspend fun getCalls(@Query("agent_id") agentId: String): List<CallSummary>

    @GET("api/calls/{callId}")
    suspend fun getCall(@Path("callId") callId: String): CallDetail

    @DELETE("api/calls/{callId}")
    suspend fun deleteCall(@Path("callId") callId: String)

    @GET("api/agents/{agentId}/clients")
    suspend fun getClients(@Path("agentId") agentId: String): List<Client>

    @POST("api/chat/")
    suspend fun chat(@Body request: ChatRequest): ChatResponse

    @GET("api/chat/history/{agentId}")
    suspend fun getChatHistory(
        @Path("agentId") agentId: String,
        @Query("limit") limit: Int = 50
    ): List<ChatMessage>

    @DELETE("api/chat/history/{agentId}")
    suspend fun clearChatHistory(@Path("agentId") agentId: String)

    @GET("api/leads/")
    suspend fun getLeads(): List<Lead>

    @PATCH("api/leads/{leadId}")
    suspend fun updateLead(@Path("leadId") leadId: String, @Body body: LeadUpdateRequest): Lead

    @GET("api/follow-ups/")
    suspend fun getFollowUps(): List<Client>

    @PATCH("api/follow-ups/{clientId}")
    suspend fun setFollowUp(@Path("clientId") clientId: String, @Body body: FollowUpSetRequest): Client

    @DELETE("api/follow-ups/{clientId}")
    suspend fun completeFollowUp(@Path("clientId") clientId: String)

    @GET("api/tasks/")
    suspend fun getTasks(): List<TaskItem>

    @PATCH("api/tasks/{taskId}")
    suspend fun updateTask(@Path("taskId") taskId: String, @Body body: TaskUpdateRequest): TaskItem
}
