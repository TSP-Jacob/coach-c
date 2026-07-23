package com.coachecall.app

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.KeyEvent

/**
 * Detects a double-press of the power/lock button within 500ms and launches
 * the voice assistant overlay. Requires the user to grant accessibility permission.
 */
class AssistantTriggerService : AccessibilityService() {

    private var lastPressTime = 0L

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_POWER && event.action == KeyEvent.ACTION_DOWN) {
            val now = System.currentTimeMillis()
            if (now - lastPressTime <= DOUBLE_PRESS_WINDOW_MS) {
                launchAssistant()
                lastPressTime = 0L
            } else {
                lastPressTime = now
            }
        }
        return false // don't consume the event — let the system handle it too
    }

    private fun launchAssistant() {
        val intent = Intent(this, AssistantActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) = Unit
    override fun onInterrupt() = Unit

    companion object {
        private const val DOUBLE_PRESS_WINDOW_MS = 500L
    }
}
