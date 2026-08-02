package com.coachecall.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.ActionBarDrawerToggle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.coachecall.app.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var auth: AuthRepository

    // The persistent "Ask Coach-C" notification is a microphone-type
    // foreground service — Android 14 throws a SecurityException and kills
    // the app outright if we try to start it without RECORD_AUDIO already
    // granted (confirmed on a real device: this crashed on every launch
    // since the app never actually requested it). Request it, and only
    // start the service if it's actually granted; declining just means that
    // one quick-access notification doesn't appear, nothing else breaks.
    private val micPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results[Manifest.permission.RECORD_AUDIO] == true) {
            AssistantNotificationService.start(this)
        }
    }

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

        setSupportActionBar(binding.toolbar)
        val toggle = ActionBarDrawerToggle(
            this, binding.drawerLayout, binding.toolbar,
            R.string.drawer_open, R.string.drawer_close
        )
        binding.drawerLayout.addDrawerListener(toggle)
        toggle.syncState()

        binding.navView.setNavigationItemSelectedListener { item ->
            if (item.itemId == R.id.nav_sign_out) {
                signOut()
                return@setNavigationItemSelectedListener true
            }
            val fragment: Fragment? = when (item.itemId) {
                R.id.nav_dashboard -> DashboardFragment()
                R.id.nav_leads -> LeadsFragment()
                R.id.nav_calls -> CallsFragment()
                R.id.nav_clients -> ClientsFragment()
                R.id.nav_follow_ups -> FollowUpsFragment()
                R.id.nav_tasks -> TasksFragment()
                R.id.nav_chat -> ChatFragment()
                else -> null
            }
            if (fragment != null) {
                showFragment(fragment, item.title.toString())
                item.isChecked = true
            }
            binding.drawerLayout.closeDrawer(GravityCompat.START)
            true
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            AssistantNotificationService.start(this)
        } else {
            val toRequest = mutableListOf(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                toRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            micPermissionLauncher.launch(toRequest.toTypedArray())
        }

        // Refresh the token ahead of expiry, and gate the drawer's optional
        // sections by the agent's feature flags (same defaults/keys as the
        // web Sidebar). If agentId is already cached this runs in the
        // background and the dashboard shows immediately; if it's NOT
        // cached yet (older session, or the very first launch after
        // sign-in), every fragment needs it before their own data calls can
        // work at all, so first paint waits on this instead of racing it —
        // confirmed on a real device that showing the fragment first meant
        // it read a still-null agentId and silently gave up before this
        // finished resolving it.
        val hadAgentId = auth.getAgentId() != null
        if (hadAgentId && savedInstanceState == null) {
            showFragment(DashboardFragment(), "Dashboard")
            binding.navView.setCheckedItem(R.id.nav_dashboard)
        }
        lifecycleScope.launch {
            auth.ensureFreshAccessToken()
            val profileResult = runCatching { ApiClient.getService(this@MainActivity).getMyProfile() }
            profileResult.onFailure { android.util.Log.e("MainActivity", "getMyProfile failed", it) }
            val profile = profileResult.getOrNull()
            if (profile != null) {
                if (auth.getAgentId() == null) auth.saveAgentId(profile.id)
                applyFeatureFlags(profile.featureFlags)
            }
            if (!hadAgentId && savedInstanceState == null) {
                showFragment(DashboardFragment(), "Dashboard")
                binding.navView.setCheckedItem(R.id.nav_dashboard)
            }
        }
    }

    private fun applyFeatureFlags(flags: Map<String, Boolean>?) {
        val menu = binding.navView.menu
        menu.findItem(R.id.nav_leads)?.isVisible = flags?.get("leads") != false
        menu.findItem(R.id.nav_follow_ups)?.isVisible = flags?.get("follow_ups") != false
        menu.findItem(R.id.nav_tasks)?.isVisible = flags?.get("tasks") != false
        menu.findItem(R.id.nav_chat)?.isVisible = flags?.get("voice_assistant") != false
    }

    private fun showFragment(fragment: Fragment, title: String) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .commit()
        supportActionBar?.title = title
    }

    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }

    fun signOut() {
        AssistantNotificationService.stop(this)
        lifecycleScope.launch {
            auth.signOut()
            ApiClient.reset()
            startActivity(Intent(this@MainActivity, LoginActivity::class.java))
            finish()
        }
    }
}
