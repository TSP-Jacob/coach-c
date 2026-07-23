package com.coachecall.app

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that shows a persistent notification with a mic button.
 * This is the fallback trigger for the voice assistant when accessibility
 * permission has not been granted.
 */
class AssistantNotificationService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val assistantIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, AssistantActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, App.CHANNEL_ASSISTANT)
            .setContentTitle("Coach-C")
            .setContentText("Tap the mic to ask your AI assistant")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .addAction(
                android.R.drawable.ic_btn_speak_now,
                "Ask Coach-C",
                assistantIntent
            )
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AssistantNotificationService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AssistantNotificationService::class.java))
        }
    }
}
