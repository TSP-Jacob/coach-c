package com.coachecall.app

import android.content.Context
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
    @SerializedName("user") val user: SupabaseUser
)

data class SupabaseUser(
    @SerializedName("id") val id: String,
    @SerializedName("email") val email: String
)

class AuthRepository(context: Context) {

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "coach_c_auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
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
                    .apply()
                tokenResponse
            }
        }

    fun getAccessToken(): String? = prefs.getString(KEY_ACCESS_TOKEN, null)
    fun getUserId(): String? = prefs.getString(KEY_USER_ID, null)
    fun getUserEmail(): String? = prefs.getString(KEY_USER_EMAIL, null)
    fun isLoggedIn(): Boolean = getAccessToken() != null

    fun signOut() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USER_EMAIL = "user_email"

        @Volatile
        private var instance: AuthRepository? = null

        fun getInstance(context: Context): AuthRepository =
            instance ?: synchronized(this) {
                instance ?: AuthRepository(context.applicationContext).also { instance = it }
            }
    }
}
