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
    }

    companion object {
        const val CHANNEL_ASSISTANT = "coach_c_assistant"
    }
}
