package com.coachecall.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class SupabaseTokenResponse(
    @SerializedName("access_token") val accessToken: String,
    @SerializedName("refresh_token") val refreshToken: String,
    @SerializedName("expires_in") val expiresIn: Long?,
    @SerializedName("user") val user: SupabaseUser
)

data class SupabaseUser(
    @SerializedName("id") val id: String,
    @SerializedName("email") val email: String
)

/** The refresh token itself is dead (expired/revoked/reused) — retrying won't help; the user must sign in again. */
class RefreshTokenInvalidException : Exception("Refresh token invalid")

class AuthRepository(context: Context) {

    private val appContext = context.applicationContext

    private val prefs = EncryptedSharedPreferences.create(
        appContext,
        "coach_c_auth",
        MasterKey.Builder(appContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val http = OkHttpClient()
    private val gson = Gson()
    private val supabaseUrl = BuildConfig.SUPABASE_URL
    private val anonKey = BuildConfig.SUPABASE_ANON_KEY

    suspend fun signIn(email: String, password: String): Result<SupabaseTokenResponse> =
        withContext(Dispatchers.IO) {
            runCatching {
                val body = gson.toJson(mapOf("email" to email, "password" to password))
                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/token?grant_type=password")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", anonKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = http.newCall(request).execute()
                val responseBody = response.body?.string() ?: error("Empty response")
                if (!response.isSuccessful) error("Login failed: ${response.code} $responseBody")

                val tokenResponse = gson.fromJson(responseBody, SupabaseTokenResponse::class.java)
                prefs.edit()
                    .putString(KEY_ACCESS_TOKEN, tokenResponse.accessToken)
                    .putString(KEY_REFRESH_TOKEN, tokenResponse.refreshToken)
                    .putString(KEY_USER_ID, tokenResponse.user.id)
                    .putString(KEY_USER_EMAIL, tokenResponse.user.email)
                    .putLong(KEY_EXPIRES_AT, System.currentTimeMillis() + (tokenResponse.expiresIn ?: 3600L) * 1000)
                    .remove(KEY_AGENT_ID) // resolved separately via /api/agents/me once signed in
                    .apply()
                tokenResponse
            }
        }

    /**
     * Returns a fresh access token, refreshing proactively if it's within
     * REFRESH_BUFFER_MS of expiring — so callers about to make an
     * authenticated request don't have to rely solely on reacting to a 401
     * after the fact. Returns null if there's no session, or if the refresh
     * token turned out to be definitively dead (session already cleared and
     * the user already notified in that case).
     */
    suspend fun ensureFreshAccessToken(): String? {
        val access = getAccessToken() ?: return null
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        if (expiresAt - System.currentTimeMillis() > REFRESH_BUFFER_MS) return access

        val refreshToken = getRefreshToken() ?: return access
        val refreshed = refreshSession(refreshToken)
        if (refreshed.isSuccess) return refreshed.getOrNull()?.accessToken

        // Transient (network) failure — keep using the still-around token;
        // the OkHttp Authenticator's reactive 401 retry is the fallback if
        // it's actually expired by the time a request goes out.
        return if (refreshed.exceptionOrNull() is RefreshTokenInvalidException) null else access
    }

    suspend fun refreshSession(refreshToken: String): Result<SupabaseTokenResponse> =
        withContext(Dispatchers.IO) {
            runCatching {
                val body = gson.toJson(mapOf("refresh_token" to refreshToken))
                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/token?grant_type=refresh_token")
                    .post(body.toRequestBody("application/json".toMediaType()))
                    .addHeader("apikey", anonKey)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = http.newCall(request).execute()
                if (response.code == 400 || response.code == 401) {
                    // Refresh token rejected outright (expired/revoked/reused)
                    // — not something a retry can fix. Clear the dead session
                    // now and tell the user, rather than waiting for the next
                    // API call to also fail the same way.
                    clearSession()
                    notifySignedOut()
                    throw RefreshTokenInvalidException()
                }
                val responseBody = response.body?.string() ?: error("Empty response")
                if (!response.isSuccessful) error("Refresh failed: ${response.code} $responseBody")

                val tokenResponse = gson.fromJson(responseBody, SupabaseTokenResponse::class.java)
                prefs.edit()
                    .putString(KEY_ACCESS_TOKEN, tokenResponse.accessToken)
                    .putString(KEY_REFRESH_TOKEN, tokenResponse.refreshToken)
                    .putLong(KEY_EXPIRES_AT, System.currentTimeMillis() + (tokenResponse.expiresIn ?: 3600L) * 1000)
                    .apply()
                tokenResponse
            }
        }

    fun getAccessToken(): String? = prefs.getString(KEY_ACCESS_TOKEN, null)
    fun getRefreshToken(): String? = prefs.getString(KEY_REFRESH_TOKEN, null)
    fun getUserId(): String? = prefs.getString(KEY_USER_ID, null)
    fun getUserEmail(): String? = prefs.getString(KEY_USER_EMAIL, null)
    fun isLoggedIn(): Boolean = getAccessToken() != null

    // The real agents.id (distinct from the Supabase auth user id above) —
    // resolved once via /api/agents/me right after sign-in and cached here,
    // since every other endpoint (stats, clients, calls, chat) is keyed by
    // agents.id, not the auth uid.
    fun getAgentId(): String? = prefs.getString(KEY_AGENT_ID, null)
    fun saveAgentId(agentId: String) { prefs.edit().putString(KEY_AGENT_ID, agentId).apply() }

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    /** Best-effort server-side revoke, local scope only — must never sign the
     * user out of any other device (web, or the call-recorder app), only this
     * one. Falls back to a purely local clear if the revoke call fails. */
    suspend fun signOut() = withContext(Dispatchers.IO) {
        val access = getAccessToken()
        if (access != null) {
            runCatching {
                val request = Request.Builder()
                    .url("$supabaseUrl/auth/v1/logout?scope=local")
                    .post("".toRequestBody(null))
                    .addHeader("apikey", anonKey)
                    .addHeader("Authorization", "Bearer $access")
                    .build()
                http.newCall(request).execute().close()
            }
        }
        clearSession()
    }

    private fun notifySignedOut() {
        if (ContextCompat.checkSelfPermission(appContext, android.Manifest.permission.POST_NOTIFICATIONS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return

        val openApp = Intent(appContext, LoginActivity::class.java)
            .apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
        val pendingIntent = PendingIntent.getActivity(
            appContext, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(appContext, App.CHANNEL_AUTH)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Signed out of Coach-C")
            .setContentText("Sign back in to keep using the app.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        (appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID_SIGNED_OUT, notification)
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USER_EMAIL = "user_email"
        private const val KEY_AGENT_ID = "agent_id"
        private const val KEY_EXPIRES_AT = "expires_at"
        private const val REFRESH_BUFFER_MS = 10 * 60 * 1000L // refresh if expiring within 10 minutes
        private const val NOTIF_ID_SIGNED_OUT = 3001

        @Volatile
        private var instance: AuthRepository? = null

        fun getInstance(context: Context): AuthRepository =
            instance ?: synchronized(this) {
                instance ?: AuthRepository(context.applicationContext).also { instance = it }
            }
    }
}
