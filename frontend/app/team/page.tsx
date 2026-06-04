"use client";
import { useEffect, useState } from "react";
import { api, AdminAgent } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Users, Shield } from "lucide-react";

const ROLES: AdminAgent["role"][] = ["admin", "manager", "employee"];

const roleBadge: Record<string, string> = {
  admin:    "bg-brand/10 text-brand",
  manager:  "bg-blue-50 text-blue-600",
  employee: "bg-gray-100 text-gray-500",
};

export default function TeamPage() {
  const { role, agentId, loading: authLoading } = useAuth();
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = () => {
    api.agents.listAll()
      .then(setAgents)
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (!authLoading) load(); /* eslint-disable-next-line */ }, [authLoading]);

  const changeRole = async (id: string, newRole: string) => {
    setSavingId(id);
    setError(null);
    const prev = agents;
    setAgents(a => a.map(x => x.id === id ? { ...x, role: newRole as AdminAgent["role"] } : x));
    try {
      await api.agents.updateRole(id, newRole);
    } catch (e: any) {
      setAgents(prev); // revert on failure
      setError(String(e.message || e));
    } finally {
      setSavingId(null);
    }
  };

  if (!authLoading && role && role !== "admin") {
    return <p className="text-sm text-gray-400">Admin access required.</p>;
  }

  const grouped = ROLES.map(r => ({ role: r, list: agents.filter(a => a.role === r) }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-sm text-gray-400 mt-1">
          All accounts in your organization. Change a role to control what each person can access.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-gray-400">No accounts found.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ role: r, list }) => list.length === 0 ? null : (
            <div key={r}>
              <div className="flex items-center gap-2 mb-2 text-gray-500">
                {r === "admin" ? <Shield size={14} /> : <Users size={14} />}
                <span className="text-xs font-semibold uppercase tracking-wide">{r}s ({list.length})</span>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
                {list.map(a => (
                  <div key={a.id} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-xs">
                        {(a.name || a.email).split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium flex items-center gap-2">
                          {a.name || "Unnamed"}
                          {a.id === agentId && <span className="text-[10px] text-gray-400">(you)</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${roleBadge[a.role]}`}>{a.role}</span>
                        </p>
                        <p className="text-xs text-gray-400">{a.email}{a.brokerages?.name ? ` · ${a.brokerages.name}` : ""}</p>
                      </div>
                    </div>
                    <select
                      value={a.role}
                      disabled={savingId === a.id}
                      onChange={e => changeRole(a.id, e.target.value)}
                      className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-brand disabled:opacity-50">
                      {ROLES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
