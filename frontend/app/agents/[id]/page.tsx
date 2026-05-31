"use client";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, Agent, AgentStats, Call, Client } from "@/lib/api";
import ScoreBadge from "@/components/ScoreBadge";
import Link from "next/link";
import { Phone, Plus, ChevronRight, Calendar, CheckCircle, XCircle, Loader2, ExternalLink, Copy, Check } from "lucide-react";
import ClientForm from "@/components/ClientForm";

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function CalendarTab({ agentId }: { agentId: string }) {
  const [status,    setStatus]    = useState<{ connected: boolean; email: string | null } | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [copied,    setCopied]    = useState<string | null>(null);

  useEffect(() => {
    api.calendar.status(agentId)
      .then(setStatus)
      .catch(() => setStatus({ connected: false, email: null }))
      .finally(() => setLoading(false));
  }, [agentId]);

  const availabilityUrl = `${BACKEND}/api/calendar/availability?agent_id=${agentId}`;
  const bookingUrl      = `${BACKEND}/api/calendar/book`;

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const disconnect = async () => {
    await api.calendar.disconnect(agentId);
    setStatus({ connected: false, email: null });
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-muted p-6">
      <Loader2 size={14} className="animate-spin" /> Checking calendar…
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Connection card */}
      <div className="bg-white border border-warm-border p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar size={20} className="text-brand shrink-0" />
            <div>
              <p className="text-sm font-medium text-charcoal">Google Calendar</p>
              <p className="text-xs text-muted mt-0.5">
                {status?.connected
                  ? `Connected as ${status.email}`
                  : "Not connected — connect to allow Bland AI to check availability and book meetings."}
              </p>
            </div>
          </div>
          {status?.connected
            ? <CheckCircle size={18} className="text-green-600 shrink-0" />
            : <XCircle    size={18} className="text-muted shrink-0" />
          }
        </div>

        {status?.connected ? (
          <button
            onClick={disconnect}
            className="text-xs border border-warm-border px-4 py-2 text-muted hover:text-brand hover:border-brand transition-colors"
          >
            Disconnect Google Calendar
          </button>
        ) : (
          <a
            href={`${BACKEND}/api/calendar/auth?agent_id=${agentId}`}
            className="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 hover:opacity-90 transition-opacity"
          >
            <Calendar size={14} /> Connect Google Calendar
          </a>
        )}
      </div>

      {/* Bland AI tool config — shown once connected */}
      {status?.connected && (
        <div className="bg-white border border-warm-border p-6 space-y-5">
          <div>
            <p className="text-sm font-medium text-charcoal mb-1">Bland AI Tool Configuration</p>
            <p className="text-xs text-muted">
              Add these two tools to your Bland AI agent in the Bland dashboard under{" "}
              <strong>Agent → Tools</strong>. The AI will call them during calls to check
              availability and book meetings.
            </p>
          </div>

          {/* Tool 1 — Check Availability */}
          <div className="space-y-2">
            <p className="text-[10px] tracking-widest uppercase text-muted">Tool 1 — Check Availability</p>
            <div className="bg-cream border border-warm-border p-3 font-mono text-xs text-charcoal leading-relaxed whitespace-pre-wrap break-all">
{`{
  "name": "check_availability",
  "description": "Check the agent's available meeting slots. Call this when the client wants to book a meeting.",
  "speech": "Let me check my calendar for you…",
  "url": "${availabilityUrl}&date={{date}}",
  "method": "GET",
  "headers": { "x-bland-key": "YOUR_BLAND_CALENDAR_KEY" },
  "input_schema": {
    "date": {
      "type": "string",
      "description": "Date to check in YYYY-MM-DD format. Use today's date if not specified."
    }
  }
}`}
            </div>
            <button
              onClick={() => copy(availabilityUrl, "avail")}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-brand transition-colors"
            >
              {copied === "avail" ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              {copied === "avail" ? "Copied!" : "Copy availability URL"}
            </button>
          </div>

          {/* Tool 2 — Book Meeting */}
          <div className="space-y-2">
            <p className="text-[10px] tracking-widest uppercase text-muted">Tool 2 — Book Meeting</p>
            <div className="bg-cream border border-warm-border p-3 font-mono text-xs text-charcoal leading-relaxed whitespace-pre-wrap break-all">
{`{
  "name": "book_meeting",
  "description": "Book a meeting on the agent's Google Calendar. Call this after the client confirms a time slot.",
  "speech": "Perfect, I'm booking that in right now…",
  "url": "${bookingUrl}",
  "method": "POST",
  "headers": {
    "x-bland-key": "YOUR_BLAND_CALENDAR_KEY",
    "Content-Type": "application/json"
  },
  "body": {
    "agent_id": "${agentId}",
    "client_name": "{{client_name}}",
    "client_phone": "{{client_phone}}",
    "start_iso": "{{start_iso}}",
    "duration_minutes": 30,
    "notes": "{{call_summary}}"
  }
}`}
            </div>
            <button
              onClick={() => copy(bookingUrl, "book")}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-brand transition-colors"
            >
              {copied === "book" ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              {copied === "book" ? "Copied!" : "Copy booking URL"}
            </button>
          </div>

          <div className="border-t border-warm-border pt-4">
            <p className="text-[10px] tracking-widest uppercase text-muted mb-2">Setup checklist</p>
            <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
              <li>Add <code className="bg-cream px-1">BLAND_CALENDAR_KEY</code> to your Coach-C backend environment (Railway)</li>
              <li>Replace <code className="bg-cream px-1">YOUR_BLAND_CALENDAR_KEY</code> in both tools with that same value</li>
              <li>Paste each tool JSON into Bland AI → Agent → Tools → Add Tool</li>
              <li>Update your Bland agent's system prompt to mention it can check availability and book meetings</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgentDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [agent,  setAgent]  = useState<Agent | null>(null);
  const [stats,  setStats]  = useState<AgentStats | null>(null);
  const [calls,  setCalls]  = useState<Call[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showClientForm, setShowClientForm] = useState(false);
  const [tab, setTab] = useState<"calls" | "clients" | "calendar">(
    searchParams.get("calendar") ? "calendar" : "clients"
  );

  const load = () => Promise.all([
    api.agents.get(id).then(setAgent),
    api.agents.stats(id).then(setStats),
    api.calls.list(id).then(setCalls),
    api.agents.listClients(id).then(setClients),
  ]);

  useEffect(() => { load(); }, [id]);

  if (!agent) return <p className="text-sm text-gray-400 p-6">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-5">
        <div className="w-14 h-14 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-xl">
          {agent.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="text-sm text-gray-400">{agent.email} · {agent.brokerages?.name}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Calls", value: String(stats?.total_calls ?? 0) },
          { label: "Avg Score",   value: stats?.average_score != null ? `${stats.average_score}/100` : "—" },
          { label: "Clients",     value: String(clients.length) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(["clients", "calls", "calendar"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors capitalize flex items-center gap-1.5
              ${tab === t ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t === "calendar" && <Calendar size={13} />}
            {t}
          </button>
        ))}
      </div>

      {/* Calls tab */}
      {tab === "calls" && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
          {calls.length === 0 && <p className="text-sm text-gray-400 p-5">No calls yet.</p>}
          {calls.map(call => (
            <Link key={call.id} href={`/calls/${call.id}`}
              className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <div>
                <p className="font-medium text-sm">{call.clients?.name ?? "No client linked"}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {call.call_type?.replace("_", " ") ?? "Unclassified"} ·{" "}
                  {call.duration_seconds ? `${Math.round(call.duration_seconds / 60)}m` : "—"} ·{" "}
                  {new Date(call.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ScoreBadge score={call.overall_score} status={call.status} />
                <ChevronRight size={14} className="text-gray-300" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Clients tab */}
      {tab === "clients" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowClientForm(true)}
              className="flex items-center gap-2 bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark transition-colors">
              <Plus size={14} /> Add Client
            </button>
          </div>
          {showClientForm && (
            <ClientForm agentId={id} onSuccess={() => { setShowClientForm(false); load(); }} onCancel={() => setShowClientForm(false)} />
          )}
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {clients.length === 0 && <p className="text-sm text-gray-400 p-5">No clients yet.</p>}
            {clients.map(client => (
              <div key={client.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-sm">{client.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {client.type} · {client.phone ?? client.email ?? "No contact info"}
                  </p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  client.type === "buyer"  ? "bg-blue-50 text-blue-600" :
                  client.type === "seller" ? "bg-orange-50 text-orange-600" :
                  "bg-purple-50 text-purple-600"
                }`}>{client.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calendar tab */}
      {tab === "calendar" && <CalendarTab agentId={id} />}
    </div>
  );
}
