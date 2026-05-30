"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, Agent, AgentStats, Call, Client } from "@/lib/api";
import ScoreBadge from "@/components/ScoreBadge";
import Link from "next/link";
import { Phone, Plus, ChevronRight } from "lucide-react";
import ClientForm from "@/components/ClientForm";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showClientForm, setShowClientForm] = useState(false);
  const [tab, setTab] = useState<"calls" | "clients">("clients");

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
          {agent.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <p className="text-sm text-gray-400">{agent.email} · {agent.brokerages?.name}</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Calls", value: String(stats?.total_calls ?? 0) },
          { label: "Avg Score", value: stats?.average_score != null ? `${stats.average_score}/100` : "—" },
          { label: "Clients", value: String(clients.length) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(["calls", "clients"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors capitalize
              ${tab === t ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
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
            {clients.length === 0 && <p className="text-sm text-gray-400 p-5">No clients yet. Add one to enable RAG context in calls and chat.</p>}
            {clients.map(client => (
              <div key={client.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-sm">{client.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {client.type} · {client.phone ?? client.email ?? "No contact info"}
                  </p>
                  {client.notes && (
                    <p className="text-xs text-gray-400 mt-1 italic truncate max-w-md">{client.notes.slice(0, 100)}…</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  client.type === "buyer" ? "bg-blue-50 text-blue-600" :
                  client.type === "seller" ? "bg-orange-50 text-orange-600" :
                  "bg-purple-50 text-purple-600"
                }`}>{client.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
