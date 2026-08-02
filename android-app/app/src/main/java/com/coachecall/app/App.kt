package com.coachecall.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class App : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java)

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ASSISTANT,
                "Coach-C Assistant",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Quick access to your AI assistant" }
        )

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_AUTH,
                "Sign-In Status",
                NotificationManager.IMPORTANCE_HIGH
            ).apply { description = "Alerts you when you've been signed out and need to sign back in" }
        )
    }

    companion object {
        const val CHANNEL_ASSISTANT = "coach_c_assistant"
        const val CHANNEL_AUTH = "coach_c_auth"
    }
}
