"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { IndustryMode, DEFAULT_MODE, normalizeMode } from "./industry";

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
  follow_ups: true,
  tasks: true,
  mobile_app: true,
};

function mergeFeatures(f?: Features | null): Features {
  return { ...FEATURE_DEFAULTS, ...(f || {}) };
}

interface AuthCtx {
  session: Session | null;
  agentId: string | null;
  role: string | null;
  features: Features;
  industryMode: IndustryMode;
  loading: boolean;
  // Resolves true if it already navigated away (SSO users get redirected to
  // the portal) — the caller should only navigate itself when this is
  // false, or the two navigations race and it looks like sign-out silently
  // failed on the first click.
  signOut: () => Promise<boolean>;
}

const AuthContext = createContext<AuthCtx>({
  session: null, agentId: null, role: null, features: FEATURE_DEFAULTS,
  industryMode: DEFAULT_MODE, loading: true,
  signOut: async () => false,
});

async function fetchAgent(token: string): Promise<{ id: string | null; role: string | null; features: Features; industryMode: IndustryMode }> {
  try {
    const res = await fetch(`${BASE}/api/agents/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { id: null, role: null, features: FEATURE_DEFAULTS, industryMode: DEFAULT_MODE };
    const data = await res.json();
    return {
      id: data.id ?? null,
      role: data.role ?? null,
      features: mergeFeatures(data.feature_flags),
      industryMode: normalizeMode(data.brokerages?.industry_mode),
    };
  } catch {
    return { id: null, role: null, features: FEATURE_DEFAULTS, industryMode: DEFAULT_MODE };
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
  const [industryMode, setIndustryMode] = useState<IndustryMode>(DEFAULT_MODE);
  const [loading, setLoading] = useState(!SKIP_AUTH);

  useEffect(() => {
    if (SKIP_AUTH) return;

    // Read token from URL params and persist it, then use it directly.
    const urlToken = new URLSearchParams(window.location.search).get("token");
    if (urlToken) sessionStorage.setItem("ext_token", urlToken);

    const extToken = urlToken || getExtToken();
    if (extToken) {
      fetchAgent(extToken).then(({ id, role, features, industryMode }) => {
        setAgentId(id);
        setRole(role);
        setFeatures(features);
        setIndustryMode(industryMode);
        setLoading(false);
      });
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.access_token) {
        const { id, role, features, industryMode } = await fetchAgent(session.access_token);
        setAgentId(id);
        setRole(role);
        setFeatures(features);
        setIndustryMode(industryMode);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, session) => {
      setSession(session);
      if (session?.access_token) {
        const { id, role, features, industryMode } = await fetchAgent(session.access_token);
        setAgentId(id);
        setRole(role);
        setFeatures(features);
        setIndustryMode(industryMode);
      } else {
        setAgentId(null);
        setRole(null);
        setFeatures(FEATURE_DEFAULTS);
        setIndustryMode(DEFAULT_MODE);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      session, agentId, role, features, industryMode, loading,
      signOut: async () => {
      if (typeof window === "undefined") { await supabase.auth.signOut(); return false; }

      // Only OLD-style SSO arrivals (no refresh_token, so /auth fell back to
      // storing a raw bearer token) carry an ext_token — those still have a
      // separate persistent session on the portal origin that needs its own
      // sign-out signal. Everyone else (direct logins, and SSO arrivals that
      // got a real Supabase session via setSession()) just has a normal
      // session on this origin.
      const ssoToken = sessionStorage.getItem("ext_token");

      // scope=local revokes only THIS session's refresh token — not every
      // session for the user. Signing out of the browser must never sign
      // the user out of the Android app (or any other device); each stays
      // signed in until it's explicitly signed out on that device.
      try {
        if (ssoToken) {
          await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
            method: "POST",
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${ssoToken}` },
          });
        } else {
          await supabase.auth.signOut({ scope: "local" });
        }
      } catch { /* best effort — local clear below still runs */ }

      // Clear this origin's state.
      sessionStorage.removeItem("ext_token");
      await supabase.auth.signOut();
      setSession(null);
      setAgentId(null);
      setRole(null);

      // The old-style SSO user's persistent session lives on the portal
      // origin, which we can only clear by handing control back there with
      // a sign-out signal. window.location.href doesn't block, so the
      // caller must NOT also navigate itself here — racing a client-side
      // router.replace against this full-page navigation is exactly what
      // made "Sign Out" look like it needed a second click to work.
      if (ssoToken) {
        window.location.href = `${PORTAL_URL}/login?signedout=1`;
        return true;
      }
      return false;
    },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
