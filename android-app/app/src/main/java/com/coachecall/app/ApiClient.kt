package com.coachecall.app

import android.content.Context
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object ApiClient {

    private var service: CoachCApiService? = null

    fun getService(context: Context): CoachCApiService {
        return service ?: createService(context).also { service = it }
    }

    private fun createService(context: Context): CoachCApiService {
        val auth = AuthRepository.getInstance(context)

        val authInterceptor = Interceptor { chain ->
            val token = auth.getAccessToken()
            val request = if (token != null) {
                chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer $token")
                    .build()
            } else {
                chain.request()
            }
            chain.proceed(request)
        }

        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.NONE
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .authenticator(TokenAuthenticator(auth))
            .build()

        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL + "/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(CoachCApiService::class.java)
    }

    fun reset() { service = null }
}

/**
 * Reactive fallback alongside AuthRepository's proactive refresh: if a
 * request still comes back 401 (e.g. the proactive check was skipped, or the
 * token died between the check and the request landing), refresh once and
 * retry. OkHttp calls Authenticator on a background thread and expects a
 * blocking return, which is exactly what runBlocking over the suspend
 * refresh call is for here.
 */
private class TokenAuthenticator(private val auth: AuthRepository) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null // already retried once — give up
        val refreshToken = auth.getRefreshToken() ?: return null
        val newAccess = runBlocking { auth.refreshSession(refreshToken) }.getOrNull()?.accessToken ?: return null
        return response.request.newBuilder()
            .header("Authorization", "Bearer $newAccess")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) { count++; prior = prior.priorResponse }
        return count
    }
}
