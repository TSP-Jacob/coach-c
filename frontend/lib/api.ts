import { supabase } from "./supabase";
import { getExtToken } from "./auth";
import { IndustryMode } from "./industry";

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

/** Bearer token (SSO ext token or Supabase session) for non-fetch transports
 *  like the voice WebSocket, which can't send an Authorization header. */
export async function getAuthToken(): Promise<string | null> {
  const extToken = getExtToken();
  if (extToken) return extToken;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** ws(s):// base derived from the REST API URL. */
export function wsBase(): string {
  return BASE.replace(/^http/, "ws");
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
    list: (agentId?: string, source?: string, status?: string, brokerageId?: string) => {
      const p = new URLSearchParams();
      if (agentId)     p.set("agent_id", agentId);
      if (source)      p.set("source", source);
      if (status)      p.set("status", status);
      if (brokerageId) p.set("brokerage_id", brokerageId);
      return req<Lead[]>(`/api/leads/?${p}`);
    },
    update: (id: string, body: { status?: string; agent_id?: string; contact_method?: string }) =>
      req<Lead>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  },
  app: {
    androidDownload: (app: "recorder" | "dashboard" = "recorder") =>
      req<{ url: string }>(`/api/app/android/download?app=${app}`),
  },
  dashboard: {
    overview: () => req<DashboardOverview>(`/api/dashboard/overview`),
  },
  followUps: {
    list: (agentId?: string) =>
      req<Client[]>(`/api/follow-ups/${agentId ? `?agent_id=${agentId}` : ""}`),
    set: (clientId: string, followUpDate: string, note?: string) =>
      req<Client>(`/api/follow-ups/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({ follow_up_date: followUpDate, follow_up_note: note }),
      }),
    complete: (clientId: string) =>
      req<{ completed: boolean }>(`/api/follow-ups/${clientId}`, { method: "DELETE" }),
  },
  tasks: {
    list: (assignedTo?: string, status?: string) => {
      const p = new URLSearchParams();
      if (assignedTo) p.set("assigned_to", assignedTo);
      if (status)     p.set("status", status);
      return req<Task[]>(`/api/tasks/?${p}`);
    },
    create: (body: { assigned_to: string; title: string; description?: string; due_date?: string }) =>
      req<Task>(`/api/tasks/`, { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<{ status: string; title: string; description: string; due_date: string; assigned_to: string }>) =>
      req<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    remove: (id: string) => req(`/api/tasks/${id}`, { method: "DELETE" }),
  },
  calls: {
    list: (agentId?: string) => req<Call[]>(`/api/calls/${agentId ? `?agent_id=${agentId}` : ""}`),
    get: (id: string) => req<Call>(`/api/calls/${id}`),
    delete: (id: string) => req(`/api/calls/${id}`, { method: "DELETE" }),
    insights: () => req<CoachingInsights>(`/api/calls/insights/me`),
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
    list: (brokerageId?: string) =>
      req<Agent[]>(`/api/agents/${brokerageId ? `?brokerage_id=${brokerageId}` : ""}`),
    get: (id: string) => req<Agent>(`/api/agents/${id}`),
    stats: (id: string) => req<AgentStats>(`/api/agents/${id}/stats`),
    // Organization-wide performance overview (managers + admins)
    team: () => req<TeamMember[]>(`/api/agents/team`),
    // Admin team management
    listAll: () => req<AdminAgent[]>(`/api/agents/all`),
    updateRole: (id: string, role: string) =>
      req<{ ok: boolean; role: string }>(`/api/agents/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    // Admin: reassign an agent to a different organization
    updateOrganization: (id: string, brokerageId: string) =>
      req<{ ok: boolean; brokerage_id: string; brokerage_name: string }>(
        `/api/agents/${id}/organization`, { method: "PATCH", body: JSON.stringify({ brokerage_id: brokerageId }) }),
    // Admin: toggle a single per-user feature flag
    updateFeature: (id: string, feature: string, enabled: boolean) =>
      req<{ ok: boolean; features: Record<string, boolean> }>(
        `/api/agents/${id}/features`, { method: "PATCH", body: JSON.stringify({ feature, enabled }) }),
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
    // One rolling history per agent, shared by the voice + text assistant.
    send: (agentId: string, message: string, clientId?: string, timezone?: string) =>
      req<{ reply: string }>(`/api/chat/`, {
        method: "POST",
        body: JSON.stringify({
          agent_id: agentId, message, client_id: clientId,
          timezone: timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      }),
    history: (agentId: string) => req<ChatMessage[]>(`/api/chat/history/${agentId}`),
    clear: (agentId: string) => req(`/api/chat/history/${agentId}`, { method: "DELETE" }),
  },
  organization: {
    get: () => req<OrgProfile>(`/api/organization/`),
    update: (body: Partial<OrgProfile>) =>
      req<OrgProfile>(`/api/organization/`, { method: "PATCH", body: JSON.stringify(body) }),
    listAll: () => req<OrgProfile[]>(`/api/organization/all`),
    create: (name: string) =>
      req<OrgProfile>(`/api/organization/`, { method: "POST", body: JSON.stringify({ name }) }),
    updateById: (id: string, body: Partial<OrgProfile>) =>
      req<OrgProfile>(`/api/organization/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    setupStatus: (id: string) => req<OrgSetupStatus>(`/api/organization/${id}/setup-status`),
    createPhoneAgent: (orgId: string, body: { agent_id: string; name: string; base_url: string }) =>
      req<PhoneAgentDeployment>(`/api/organization/${orgId}/phone-agents`, { method: "POST", body: JSON.stringify(body) }),
    updatePhoneAgent: (orgId: string, id: string, body: Partial<{ agent_id: string; name: string; base_url: string }>) =>
      req<PhoneAgentDeployment>(`/api/organization/${orgId}/phone-agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    deletePhoneAgent: (orgId: string, id: string) =>
      req(`/api/organization/${orgId}/phone-agents/${id}`, { method: "DELETE" }),
  },
  phoneNumbers: {
    list: () => req<PhoneNumber[]>(`/api/phone-numbers/`),
    create: (body: { number: string; brokerage_id: string; label?: string; forward_to?: string }) =>
      req<PhoneNumber>(`/api/phone-numbers/`, { method: "POST", body: JSON.stringify(body) }),
    remove: (id: string) => req(`/api/phone-numbers/${id}`, { method: "DELETE" }),
  },
  consents: {
    list: (clientId: string) => req<Consent[]>(`/api/consents/?client_id=${clientId}`),
  },
  billing: {
    // Stripe-hosted Customer Portal — manager sees invoices, pays, views history
    portal: () => req<{ url: string }>(`/api/billing/portal`, { method: "POST" }),
    // Admin reference list of managers (to know who to invoice in Stripe)
    listManagers: () => req<BillableManager[]>(`/api/billing/admin/managers`),
    // Admin: pre-create Stripe customers for all managers (idempotent)
    syncCustomers: () =>
      req<{ synced: number; total: number }>(`/api/billing/admin/sync-customers`, { method: "POST" }),
  },
  liveCalls: {
    list: () => req<{ calls: LiveCall[]; configured: boolean; error?: string }>(`/api/live-calls/`),
    // No REST call for the stream itself — it's a WebSocket, built the same
    // way the voice assistant's is (see components/VoiceAssistant.tsx):
    // `${wsBase()}/api/live-calls/${callSid}/stream`, authenticated in-band
    // via getAuthToken(), same as everywhere else a raw socket needs a JWT.
  },
};

export interface LiveCall {
  callSid: string;
  callerFrom: string | null;
  startedAt: string;
  takeoverActive: boolean;
}

export interface Call {
  id: string; agent_id: string; client_id?: string;
  call_date?: string; call_type?: string; duration_seconds?: number;
  status: string; overall_score?: number; direction?: string;
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
  feature_flags?: Record<string, boolean>;
}

export interface AdminAgent {
  id: string; name: string; email: string;
  role: "admin" | "manager" | "employee";
  brokerage_id: string;
  brokerages?: { name: string } | null;
  feature_flags?: Record<string, boolean>;
}

export interface TeamMember {
  id: string; name: string; email: string;
  role: "admin" | "manager" | "employee";
  total_calls: number;
  average_score: number | null;
}

export interface CoachingInsights {
  needs_review_count: number;
  needs_review_ids: string[];
  top_strength: string | null;
  top_improvement: string | null;
  recent_trend: "up" | "down" | "steady";
  total_complete: number;
}

export interface AgentStats {
  total_calls: number; average_score: number | null;
  by_type: Record<string, number>;
}

export interface Client {
  id: string; agent_id: string; name: string;
  phone?: string; email?: string; type: string; notes?: string;
  client_status?: string; location?: string;
  follow_up_date?: string; follow_up_note?: string;
  created_at?: string;
}

export interface ChatMessage {
  role: "user" | "assistant"; content: string; created_at: string;
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
  industry_mode?: IndustryMode;
  email?: string;
  agent_role?: string; // only present on GET /organization/
}

export interface PhoneAgentDeployment {
  id: string;
  brokerage_id: string;
  agent_id: string | null;
  name: string;
  base_url: string;
  created_at: string;
  updated_at?: string;
  agents?: { name: string } | null;
  agent_valid?: boolean;
  reachable?: boolean | null;
  health_error?: string | null;
}

export interface OrgSetupPhoneNumber {
  id: string;
  number: string;
  label?: string | null;
  active: boolean;
  forward_to?: string | null;
  expected_webhook: string;
  twilio_checked: boolean;
  twilio_found?: boolean | null;
  twilio_voice_url?: string | null;
  twilio_matches: boolean;
  twilio_error?: string | null;
}

export interface OrgSetupStatus {
  brokerage: { id: string; name: string; industry_mode_set: boolean };
  team: { total_agents: number; admin_or_manager_count: number; ok: boolean };
  phone_numbers: OrgSetupPhoneNumber[];
  phone_agents: PhoneAgentDeployment[];
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

export interface PhoneNumber {
  id: string;
  number: string;
  brokerage_id: string;
  agent_id: string | null;
  label: string | null;
  provider: string;
  forward_to: string | null;
  active: boolean;
  created_at: string;
  brokerages?: { name: string } | null;
  agents?: { name: string } | null;
}

export interface DashboardOverview {
  new_leads_count: number;
  follow_ups_count: number;
  overdue_follow_ups_count: number;
  overview: string;
}

export interface Task {
  id: string;
  brokerage_id: string;
  assigned_to: string;
  created_by: string | null;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "done";
  due_date?: string;
  completed_at?: string;
  created_at: string;
  updated_at?: string;
  assignee?: { id: string; name: string };
  creator?: { id: string; name: string };
}

export interface Lead {
  id: string;
  agent_id: string | null;
  client_id?: string | null;
  name: string;
  phone?: string;
  email?: string;
  source: "call" | "home_value" | "assistant";
  status: "new" | "contacted" | "converted" | "lost";
  contact_method?: "call" | "text" | "email" | "in_person";
  contacted_at?: string;
  address?: string;
  city?: string;
  province?: string;
  property_type?: string;
  estimated_value?: number;
  timeline_to_sell?: string;
  job_date?: string;
  job_description?: string;
  call_id?: string;
  created_at: string;
}
