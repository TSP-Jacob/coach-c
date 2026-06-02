"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";
const DEMO_AGENT_ID = process.env.NEXT_PUBLIC_DEMO_AGENT_ID || "";

export function getExtToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem("ext_token");
}

interface AuthCtx {
  session: Session | null;
  agentId: string | null;
  role: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  session: null, agentId: null, role: null, loading: true,
  signOut: async () => {},
});

async function fetchAgent(token: string): Promise<{ id: string | null; role: string | null }> {
  try {
    const res = await fetch(`${BASE}/api/agents/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { id: null, role: null };
    const data = await res.json();
    return { id: data.id ?? null, role: data.role ?? null };
  } catch {
    return { id: null, role: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [agentId, setAgentId] = useState<string | null>(SKIP_AUTH ? DEMO_AGENT_ID : null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(!SKIP_AUTH);

  useEffect(() => {
    if (SKIP_AUTH) return;

    // Read token from URL params and persist it, then use it directly.
    const urlToken = new URLSearchParams(window.location.search).get("token");
    if (urlToken) sessionStorage.setItem("ext_token", urlToken);

    const extToken = urlToken || getExtToken();
    if (extToken) {
      fetchAgent(extToken).then(({ id, role }) => {
        setAgentId(id);
        setRole(role);
        setLoading(false);
      });
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.access_token) {
        const { id, role } = await fetchAgent(session.access_token);
        setAgentId(id);
        setRole(role);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_, session) => {
      setSession(session);
      if (session?.access_token) {
        const { id, role } = await fetchAgent(session.access_token);
        setAgentId(id);
        setRole(role);
      } else {
        setAgentId(null);
        setRole(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      session, agentId, role, loading,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
