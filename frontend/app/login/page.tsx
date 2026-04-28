"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      } else {
        // Sign up
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation required
          setInfo("Check your email to confirm your account, then log in.");
          setLoading(false);
          return;
        }
        // Create agent profile immediately (session available)
        const token = data.session.access_token;
        const res = await fetch(`${BASE}/api/agents/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ name, email, brokerage_id: "00000000-0000-0000-0000-000000000001" }),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(`Profile creation failed: ${msg}`);
        }
        router.replace("/");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Branding */}
        <div className="text-center mb-10">
          <h1 className="font-serif font-bold text-4xl text-charcoal tracking-tight">Coach-C</h1>
          <p className="text-xs text-muted mt-2 tracking-widest uppercase">by Propria Systems</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-warm-border p-8 space-y-6">

          {/* Tab toggle */}
          <div className="flex border-b border-warm-border">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); setInfo(""); }}
                className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-colors capitalize
                  ${mode === m
                    ? "border-brand text-brand"
                    : "border-transparent text-muted hover:text-charcoal"}`}
              >
                {m === "login" ? "Log in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Full name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full border border-warm-border px-3 py-2.5 text-sm text-charcoal bg-white focus:outline-none focus:border-brand transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@brokerage.com"
                className="w-full border border-warm-border px-3 py-2.5 text-sm text-charcoal bg-white focus:outline-none focus:border-brand transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-warm-border px-3 py-2.5 text-sm text-charcoal bg-white focus:outline-none focus:border-brand transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-brand bg-brand-light border border-brand/20 px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-2">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-charcoal text-white text-sm py-2.5 hover:bg-brand transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted mt-6">
          AI Sales Coach for Realtors
        </p>
      </div>
    </div>
  );
}
