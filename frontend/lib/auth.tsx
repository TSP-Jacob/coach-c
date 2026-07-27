"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const DEMO_AGENT_ID = process.env.NEXT_PUBLIC_DEMO_AGENT_ID || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Chardin portal that owns the persistent login session for SSO users.
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "https://www.chardinsystems.com";

export function getExtToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("ext_token");
}

export type Features = Record<string, boolean>;

// Client-side defaults, mirrored from the backend's FEATURE_DEFAULTS. These
// apply until /api/agents/me responds, and fill in any key the server omits —
// so call coaching stays hidden by default even if the backend/DB haven't been
// updated yet.
export const FEATURE_DEFAULTS: Features = {
  call_coaching: false,
  leads: true,
  voice_assistant: true,
  notes: true,
};

function mergeFeatures(f?: Features | null): Features {
  return { ...FEATURE_DEFAULTS, ...(f || {}) };
}

interface AuthCtx {
  session: Session | null;
  agentId: string | null;
  role: string | null;
  features: Features;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  session: null, agentId: null, role: null, features: FEATURE_DEFAULTS, loading: true,
  signOut: async () => {},
});

async function fetchAgent(token: string): Promise<{ id: string | null; role: string | null; features: Features }> {
  try {
    const res = await fetch(`${BASE}/api/agents/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { id: null, role: null, features: FEATURE_DEFAULTS };
    const data = await res.json();
    return { id: data.id ?? null, role: data.role ?? null, features: mergeFeatures(data.feature_flags) };
  } catch {
    return { id: null, role: null, features: FEATURE_DEFAULTS };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [agentId, setAgentId] = useState<string | null>(SKIP_AUTH ? DEMO_AGENT_ID : null);
  const [role, setRole] = useState<string | null>(null);
  // In SKIP_AUTH dev mode, turn everything on (including coaching) so the full
  // UI is visible without a backend.
  const [features, setFeatures] = useState<Features>(
    SKIP_AUTH ? { ...FEATURE_DEFAULTS, call_coaching: true } : FEATURE_DEFAULTS
  );
  const [loading, setLoading] = useState(!SKIP_AUTH);

  useEffect(() => {
    if (SKIP_AUTH) return;

    // Read token from URL params and persist it, then use it directly.
    const urlToken = new URLSearchParams(window.location.search).get("token");
    if (urlToken) sessionStorage.setItem("ext_token", urlToken);

    const extToken = urlToken || getExtToken();
    if (extToken) {
      fetchAgent(extToken).then(({ id, role, features }) => {
        setAgentId(id);
        setRole(role);
        setFeatures(features);
        setLoading(false);
      });
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.access_token) {
        const { id, role, features } = await fetchAgent(session.access_token);
        setAgentId(id);
        setRole(role);
        setFeatures(features);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, session) => {
      setSession(session);
      if (session?.access_token) {
        const { id, role, features } = await fetchAgent(session.access_token);
        setAgentId(id);
        setRole(role);
        setFeatures(features);
      } else {
        setAgentId(null);
        setRole(null);
        setFeatures(FEATURE_DEFAULTS);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      session, agentId, role, features, loading,
      signOut: async () => {
      if (typeof window === "undefined") { await supabase.auth.signOut(); return; }

      // SSO users (arrived from the Chardin portal) carry an ext_token but have
      // no Supabase session on this origin; direct Coach-C users have a session.
      const ssoToken = sessionStorage.getItem("ext_token");

      // Revoke server-side so the refresh token can't be reused (best effort).
      try {
        if (ssoToken) {
          await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=global`, {
            method: "POST",
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ssoToken}` },
          });
        } else {
          await supabase.auth.signOut({ scope: "global" });
        }
      } catch { /* best effort — local clear below still runs */ }

      // Clear this origin's state.
      sessionStorage.removeItem("ext_token");
      await supabase.auth.signOut();
      setSession(null);
      setAgentId(null);
      setRole(null);

      // The SSO user's persistent session lives on the portal origin, which we
      // can only clear by handing control back there with a sign-out signal.
      if (ssoToken) {
        window.location.href = `${PORTAL_URL}/login?signedout=1`;
      }
    },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
