package com.coachecall.app

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.coachecall.app.databinding.ActivityMainBinding
import com.google.android.material.bottomnavigation.BottomNavigationView

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var auth: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        auth = AuthRepository.getInstance(this)

        if (!auth.isLoggedIn()) {
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }

        if (savedInstanceState == null) {
            showFragment(DashboardFragment())
        }

        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_dashboard -> { showFragment(DashboardFragment()); true }
                R.id.nav_calls -> { showFragment(CallsFragment()); true }
                R.id.nav_clients -> { showFragment(ClientsFragment()); true }
                R.id.nav_chat -> { showFragment(ChatFragment()); true }
                else -> false
            }
        }

        AssistantNotificationService.start(this)
    }

    private fun showFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .commit()
    }

    fun signOut() {
        AssistantNotificationService.stop(this)
        ApiClient.reset()
        auth.signOut()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}
