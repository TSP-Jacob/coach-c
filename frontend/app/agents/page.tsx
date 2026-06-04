"use client";
import { useEffect, useState } from "react";
import { api, TeamMember } from "@/lib/api";
import { TrendingUp, Phone } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

const roleBadge: Record<string, string> = {
  admin:    "bg-brand/10 text-brand",
  manager:  "bg-blue-50 text-blue-600",
  employee: "bg-gray-100 text-gray-500",
};

export default function AgentsPage() {
  const { agentId, loading: authLoading } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    api.agents.team()
      .then(setTeam)
      .catch(() => setTeam([]))
      .finally(() => setLoading(false));
  }, [authLoading]);

  // Org-wide roll-up
  const totalCalls = team.reduce((s, m) => s + m.total_calls, 0);
  const scored = team.filter(m => m.average_score != null);
  const orgAvg = scored.length
    ? Math.round(scored.reduce((s, m) => s + (m.average_score ?? 0), 0) / scored.length)
    : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agents</h1>
        <p className="text-sm text-gray-400 mt-1">Performance overview for your team</p>
      </div>

      {/* Org roll-up */}
      {!loading && team.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Team Members" value={String(team.length)} />
          <Stat label="Total Calls" value={String(totalCalls)} />
          <Stat label="Avg Score" value={orgAvg != null ? `${orgAvg}/100` : "—"} />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {loading && <p className="text-sm text-gray-400 p-6">Loading…</p>}
        {!loading && team.length === 0 && (
          <p className="text-sm text-gray-400 p-6">No agents found.</p>
        )}
        {team.map(m => (
          <Link key={m.id} href={`/agents/${m.id}`}
            className="flex items-center justify-between p-5 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-sm">
                {(m.name || m.email).split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-medium flex items-center gap-2">
                  {m.name || "Unnamed"}
                  {m.id === agentId && <span className="text-[10px] text-gray-400">(you)</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${roleBadge[m.role]}`}>{m.role}</span>
                </p>
                <p className="text-xs text-gray-400">{m.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-8 text-sm">
              <div className="flex items-center gap-2 text-gray-500">
                <Phone size={14} />
                <span>{m.total_calls} calls</span>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <TrendingUp size={14} />
                <span>{m.average_score != null ? `${m.average_score}/100` : "—"}</span>
              </div>
              <span className="text-gray-300">›</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
