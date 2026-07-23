package com.coachecall.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.coachecall.app.databinding.ActivityLoginBinding
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var auth: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        auth = AuthRepository.getInstance(this)

        if (auth.isLoggedIn()) {
            goToMain()
            return
        }

        binding.btnSignIn.setOnClickListener {
            val email = binding.etEmail.text.toString().trim()
            val password = binding.etPassword.text.toString()

            if (email.isEmpty() || password.isEmpty()) {
                Toast.makeText(this, "Please enter your email and password", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            setLoading(true)
            lifecycleScope.launch {
                auth.signIn(email, password)
                    .onSuccess { goToMain() }
                    .onFailure {
                        setLoading(false)
                        Toast.makeText(
                            this@LoginActivity,
                            "Sign in failed: ${it.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.btnSignIn.isEnabled = !loading
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
