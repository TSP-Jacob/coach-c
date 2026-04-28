"use client";
import { useEffect, useState } from "react";
import { api, Agent, AgentStats } from "@/lib/api";
import { Users, TrendingUp, Phone } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

interface AgentRow {
  agent: Agent;
  stats: AgentStats | null;
}

export default function AgentsPage() {
  const { agentId } = useAuth();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) { setLoading(false); return; }

    Promise.all([
      api.agents.get(agentId),
      api.agents.stats(agentId),
    ]).then(([agent, stats]) => {
      setRows([{ agent, stats }]);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-sm text-gray-400 mt-1">Performance overview for your team</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {loading && <p className="text-sm text-gray-400 p-6">Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-gray-400 p-6">No agents found.</p>
        )}
        {rows.map(({ agent, stats }) => (
          <Link key={agent.id} href={`/agents/${agent.id}`}
            className="flex items-center justify-between p-5 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-sm">
                {agent.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium">{agent.name}</p>
                <p className="text-xs text-gray-400">{agent.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-sm">
              <div className="flex items-center gap-2 text-gray-500">
                <Phone size={14} />
                <span>{stats?.total_calls ?? 0} calls</span>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <TrendingUp size={14} />
                <span>{stats?.average_score != null ? `${stats.average_score}/100` : "—"}</span>
              </div>
              <span className="text-gray-300">›</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
