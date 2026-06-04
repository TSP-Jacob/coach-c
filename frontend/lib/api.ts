import { supabase } from "./supabase";
import { getExtToken } from "./auth";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

async function authHeaders(): Promise<Record<string, string>> {
  if (SKIP_AUTH) return {};
  const extToken = getExtToken();
  if (extToken) return { Authorization: `Bearer ${extToken}` };
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
  calendar: {
    status: (agentId: string) =>
      req<{ connected: boolean; email: string | null }>(`/api/calendar/status?agent_id=${agentId}`),
    authUrl: (agentId: string) => `${BASE}/api/calendar/auth?agent_id=${agentId}`,
    disconnect: (agentId: string) =>
      req(`/api/calendar/disconnect?agent_id=${agentId}`, { method: "DELETE" }),
  },
  leads: {
    list: (agentId?: string, source?: string, status?: string) => {
      const p = new URLSearchParams();
      if (agentId) p.set("agent_id", agentId);
      if (source)  p.set("source", source);
      if (status)  p.set("status", status);
      return req<Lead[]>(`/api/leads/?${p}`);
    },
    update: (id: string, body: { status?: string; agent_id?: string; contact_method?: string }) =>
      req<Lead>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  calls: {
    list: (agentId?: string) => req<Call[]>(`/api/calls/${agentId ? `?agent_id=${agentId}` : ""}`),
    get: (id: string) => req<Call>(`/api/calls/${id}`),
    delete: (id: string) => req(`/api/calls/${id}`, { method: "DELETE" }),
    upload: async (form: FormData) => {
      const auth = await authHeaders();
      const res = await fetch(`${BASE}/api/calls/upload`, {
        method: "POST",
        headers: auth,
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  },
  agents: {
    list: () => req<Agent[]>(`/api/agents/`),
    get: (id: string) => req<Agent>(`/api/agents/${id}`),
    stats: (id: string) => req<AgentStats>(`/api/agents/${id}/stats`),
    getClient: (clientId: string) => req<Client>(`/api/agents/clients/${clientId}`),
    listClients: (agentId: string) => req<Client[]>(`/api/agents/${agentId}/clients`),
    createClient: (body: Partial<Client>) =>
      req<Client>(`/api/agents/clients`, { method: "POST", body: JSON.stringify(body) }),
    updateClient: (id: string, body: Partial<Client>) =>
      req<Client>(`/api/agents/clients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  notes: {
    list: (agentId?: string, clientId?: string) => {
      const p = new URLSearchParams();
      if (agentId)  p.set("agent_id", agentId);
      if (clientId) p.set("client_id", clientId);
      return req<Note[]>(`/api/notes/?${p}`);
    },
    create: (agentId: string, body: { content: string; client_id?: string }) =>
      req<Note>(`/api/notes/?agent_id=${agentId}`, { method: "POST", body: JSON.stringify(body) }),
    delete: (id: string) => req(`/api/notes/${id}`, { method: "DELETE" }),
  },
  chat: {
    send: (agentId: string, message: string, conversationId?: string, clientId?: string, timezone?: string) =>
      req<{ reply: string }>(`/api/chat/`, {
        method: "POST",
        body: JSON.stringify({
          agent_id: agentId, message, client_id: clientId,
          conversation_id: conversationId,
          timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }),
    history: (agentId: string, conversationId?: string) => {
      const p = conversationId ? `?conversation_id=${conversationId}` : "";
      return req<ChatMessage[]>(`/api/chat/history/${agentId}${p}`);
    },
    clear: (agentId: string, conversationId?: string) => {
      const p = conversationId ? `?conversation_id=${conversationId}` : "";
      return req(`/api/chat/history/${agentId}${p}`, { method: "DELETE" });
    },
  },
  organization: {
    get: () => req<OrgProfile>(`/api/organization/`),
    update: (body: Partial<OrgProfile>) =>
      req<OrgProfile>(`/api/organization/`, { method: "PATCH", body: JSON.stringify(body) }),
    listAll: () => req<OrgProfile[]>(`/api/organization/all`),
    updateById: (id: string, body: Partial<OrgProfile>) =>
      req<OrgProfile>(`/api/organization/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  consents: {
    list: (clientId: string) => req<Consent[]>(`/api/consents/?client_id=${clientId}`),
  },
  conversations: {
    list: (agentId: string) => req<Conversation[]>(`/api/conversations/?agent_id=${agentId}`),
    create: (agentId: string, title?: string) =>
      req<Conversation>(`/api/conversations/?agent_id=${agentId}`, {
        method: "POST",
        body: JSON.stringify({ title: title ?? "New conversation" }),
      }),
    rename: (id: string, title: string) =>
      req<Conversation>(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    delete: (id: string) => req(`/api/conversations/${id}`, { method: "DELETE" }),
  },
  billing: {
    // Stripe-hosted Customer Portal — manager sees invoices, pays, views history
    portal: () => req<{ url: string }>(`/api/billing/portal`, { method: "POST" }),
    // Admin reference list of managers (to know who to invoice in Stripe)
    listManagers: () => req<BillableManager[]>(`/api/billing/admin/managers`),
  },
};

export interface Call {
  id: string; agent_id: string; client_id?: string;
  call_date?: string; call_type?: string; duration_seconds?: number;
  status: string; overall_score?: number;
  transcript?: { utterances: Utterance[]; full_text: string };
  coaching_report?: CoachingReport;
  audio_url?: string;
  realtor_speaker?: string;
  clients?: { name: string };
  agents?: { name: string };
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
  client_status?: string; location?: string;
}

export interface ChatMessage {
  role: "user" | "assistant"; content: string; created_at: string;
}

export interface Conversation {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  agent_id: string;
  client_id?: string;
  content: string;
  created_at: string;
  clients?: { name: string };
}

export interface OrgProfile {
  id: string;
  name: string;
  primary_contact?: string;
  industry?: string;
  email?: string;
  agent_role?: string; // only present on GET /organization/
}

export interface Consent {
  id: string;
  client_id?: string;
  lead_id?: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  consent_text: string;
  sent_to_email?: string;
  created_at: string;
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export interface BillingCategorySingle {
  invoice_id: string | null;
  amount: number | null;       // dollars; null = not configured by admin
  currency: string;
  description: string | null;
  due_date: string | null;
  status: string | null;
  configured: boolean;
}

export interface BillingCategoryRecurring {
  amount: number | null;       // dollars/month; null = not configured
  currency: string;
  description: string | null;
  status: string;              // inactive | pending | active | past_due | canceled
  current_period_end: string | null;
  configured: boolean;
}

export interface UpcomingPayment {
  type: "single" | "recurring";
  amount: number | null;
  currency: string;
  due_date: string | null;
  description: string | null;
}

export interface PaidInvoice {
  id: string;
  type: "single" | "recurring";
  description: string | null;
  amount: number | null;
  currency: string;
  paid_at: string | null;
}

export interface MyBilling {
  single: BillingCategorySingle;
  recurring: BillingCategoryRecurring;
  upcoming: UpcomingPayment | null;
  history: PaidInvoice[];
}

export interface BillableManager {
  agent_id: string;
  name: string | null;
  email: string | null;
  recurring_amount: number | null;
  recurring_status: string;
}

export interface ManagerBillingConfig {
  agent_id: string;
  single: { amount: number | null; description: string | null; due_date: string | null };
  recurring: { amount: number | null; description: string | null; status: string };
}

export interface BillingConfigInput {
  single?: { amount: number | null; description?: string | null; due_date?: string | null };
  recurring?: { amount: number | null; description?: string | null };
}

export interface Lead {
  id: string;
  agent_id: string | null;
  name: string;
  phone?: string;
  email?: string;
  source: "call" | "home_value";
  status: "new" | "contacted" | "converted" | "lost";
  contact_method?: "call" | "text" | "email" | "in_person";
  contacted_at?: string;
  address?: string;
  city?: string;
  province?: string;
  property_type?: string;
  estimated_value?: number;
  timeline_to_sell?: string;
  call_id?: string;
  created_at: string;
}
