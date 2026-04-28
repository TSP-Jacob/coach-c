import { supabase } from "./supabase";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

async function authHeaders(): Promise<Record<string, string>> {
  if (SKIP_AUTH) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined;
  const isFormData = init?.body instanceof FormData;
  const auth = await authHeaders();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...(hasBody && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...auth,
      ...init?.headers,
    },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  calls: {
    list: (agentId?: string) => req<Call[]>(`/api/calls/${agentId ? `?agent_id=${agentId}` : ""}`),
    get: (id: string) => req<Call>(`/api/calls/${id}`),
    delete: (id: string) => req(`/api/calls/${id}`, { method: "DELETE" }),
    upload: async (form: FormData) => {
      const auth = await authHeaders();
      return fetch(`${BASE}/api/calls/upload`, {
        method: "POST",
        headers: auth,
        body: form,
      }).then((r) => r.json());
    },
  },
  agents: {
    get: (id: string) => req<Agent>(`/api/agents/${id}`),
    stats: (id: string) => req<AgentStats>(`/api/agents/${id}/stats`),
    listClients: (agentId: string) => req<Client[]>(`/api/agents/${agentId}/clients`),
    createClient: (body: Partial<Client>) =>
      req<Client>(`/api/agents/clients`, { method: "POST", body: JSON.stringify(body) }),
    updateClient: (id: string, body: Partial<Client>) =>
      req<Client>(`/api/agents/clients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  chat: {
    send: (agentId: string, message: string, clientId?: string, timezone?: string) =>
      req<{ reply: string }>(`/api/chat/`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId, message, client_id: clientId, timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }),
      }),
    history: (agentId: string) => req<ChatMessage[]>(`/api/chat/history/${agentId}`),
    clear: (agentId: string) => req(`/api/chat/history/${agentId}`, { method: "DELETE" }),
  },
};

export interface Call {
  id: string; agent_id: string; client_id?: string;
  call_date?: string; call_type?: string; duration_seconds?: number;
  status: string; overall_score?: number;
  transcript?: { utterances: Utterance[]; full_text: string };
  coaching_report?: CoachingReport;
  realtor_speaker?: string;
  clients?: { name: string };
  created_at: string; updated_at?: string;
}

export interface Utterance {
  speaker: string; text: string; start_ms: number; end_ms: number;
}

export interface CoachingReport {
  overall_score: number; summary: string;
  strengths: string[]; priority_focus: string;
  improvements: { principle: string; observation: string; suggestion: string }[];
  principle_scores: Record<string, { score: number; comment: string }>;
}

export interface Agent {
  id: string; name: string; email: string; brokerage_id: string;
  brokerages?: { name: string };
}

export interface AgentStats {
  total_calls: number; average_score: number | null;
  by_type: Record<string, number>;
}

export interface Client {
  id: string; agent_id: string; name: string;
  phone?: string; email?: string; type: string; notes?: string;
}

export interface ChatMessage {
  role: "user" | "assistant"; content: string; created_at: string;
}
