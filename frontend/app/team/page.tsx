"use client";
import { useEffect, useState } from "react";
import { api, AdminAgent, OrgProfile } from "@/lib/api";
import { useAuth, FEATURE_DEFAULTS } from "@/lib/auth";
import { Users, Shield, Plus } from "lucide-react";

const ROLES: AdminAgent["role"][] = ["admin", "manager", "employee"];

const roleBadge: Record<string, string> = {
  admin:    "bg-brand/10 text-brand",
  manager:  "bg-blue-50 text-blue-600",
  employee: "bg-gray-100 text-gray-500",
};

// Per-user toggleable features (must match the backend FEATURE_DEFAULTS keys).
const FEATURES: { key: string; label: string; hint: string }[] = [
  { key: "call_coaching",   label: "Call Coaching",   hint: "AI scoring & coaching reports on calls" },
  { key: "leads",           label: "Leads",           hint: "Leads inbox in the sidebar" },
  { key: "voice_assistant", label: "Voice Assistant", hint: "AI assistant (chat + voice)" },
  { key: "notes",           label: "Notes",           hint: "Client notes section" },
  { key: "follow_ups",      label: "Follow-Ups",      hint: "Follow-up reminders section" },
  { key: "tasks",           label: "Tasks",           hint: "Manager-assigned tasks section" },
];

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-brand" : "bg-gray-200"
      }`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        on ? "translate-x-4" : "translate-x-0.5"
      }`} />
    </button>
  );
}

export default function TeamPage() {
  const { role, agentId, loading: authLoading } = useAuth();
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [orgs, setOrgs] = useState<OrgProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);
  const [savingFeat, setSavingFeat] = useState<string | null>(null);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);

  const load = () => {
    api.agents.listAll()
      .then(setAgents)
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
    api.organization.listAll().then(setOrgs).catch(() => {});
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

  const changeOrganization = async (id: string, brokerageId: string) => {
    setSavingOrgId(id);
    setError(null);
    const prev = agents;
    const org = orgs.find(o => o.id === brokerageId);
    setAgents(a => a.map(x => x.id === id
      ? { ...x, brokerage_id: brokerageId, brokerages: org ? { name: org.name } : x.brokerages }
      : x));
    try {
      await api.agents.updateOrganization(id, brokerageId);
    } catch (e: any) {
      setAgents(prev); // revert on failure
      setError(String(e.message || e));
    } finally {
      setSavingOrgId(null);
    }
  };

  const createOrganization = async () => {
    const name = newOrgName.trim();
    if (!name) return;
    setCreatingOrg(true);
    setError(null);
    try {
      const org = await api.organization.create(name);
      setOrgs(prev => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
      setNewOrgName("");
      setShowNewOrg(false);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setCreatingOrg(false);
    }
  };

  const featureOn = (a: AdminAgent, key: string) =>
    a.feature_flags?.[key] ?? FEATURE_DEFAULTS[key] ?? false;

  const toggleFeature = async (id: string, key: string, enabled: boolean) => {
    setSavingFeat(`${id}:${key}`);
    setError(null);
    const prev = agents;
    setAgents(a => a.map(x => x.id === id
      ? { ...x, feature_flags: { ...(x.feature_flags || {}), [key]: enabled } }
      : x));
    try {
      const res = await api.agents.updateFeature(id, key, enabled);
      // Sync with the server's merged view.
      setAgents(a => a.map(x => x.id === id ? { ...x, feature_flags: res.features } : x));
    } catch (e: any) {
      setAgents(prev); // revert on failure
      setError(String(e.message || e));
    } finally {
      setSavingFeat(null);
    }
  };

  if (!authLoading && role && role !== "admin") {
    return <p className="text-sm text-gray-400">Admin access required.</p>;
  }

  const grouped = ROLES.map(r => ({ role: r, list: agents.filter(a => a.role === r) }));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="text-sm text-gray-400 mt-1">
            All accounts across every organization. Set each person&apos;s role, organization, and which Coach-C features they can use.
          </p>
        </div>
        {!showNewOrg ? (
          <button
            onClick={() => setShowNewOrg(true)}
            className="flex items-center gap-1.5 text-sm text-brand border border-brand/30 rounded-lg px-3 py-2 hover:bg-brand-light transition-colors shrink-0">
            <Plus size={14} /> New Organization
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <input
              autoFocus
              value={newOrgName}
              onChange={e => setNewOrgName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") createOrganization();
                if (e.key === "Escape") { setShowNewOrg(false); setNewOrgName(""); }
              }}
              placeholder="Organization name…"
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand w-48"
            />
            <button
              onClick={createOrganization}
              disabled={creatingOrg || !newOrgName.trim()}
              className="text-sm bg-brand text-white rounded-lg px-3 py-2 hover:opacity-90 disabled:opacity-50 transition-opacity">
              {creatingOrg ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => { setShowNewOrg(false); setNewOrgName(""); }}
              className="text-sm text-gray-400 hover:text-gray-600 px-1">
              Cancel
            </button>
          </div>
        )}
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
                  <div key={a.id} className="p-4 space-y-4">
                    {/* Identity + role + organization */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-brand-light flex items-center justify-center text-brand font-bold text-xs shrink-0">
                          {(a.name || a.email).split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium flex items-center gap-2">
                            {a.name || "Unnamed"}
                            {a.id === agentId && <span className="text-[10px] text-gray-400">(you)</span>}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${roleBadge[a.role]}`}>{a.role}</span>
                          </p>
                          <p className="text-xs text-gray-400 truncate">{a.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap pl-12 sm:pl-0">
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-1">Role</label>
                          <select
                            value={a.role}
                            disabled={savingId === a.id}
                            onChange={e => changeRole(a.id, e.target.value)}
                            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-brand disabled:opacity-50">
                            {ROLES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-1">Organization</label>
                          <select
                            value={a.brokerage_id ?? ""}
                            disabled={savingOrgId === a.id}
                            onChange={e => changeOrganization(a.id, e.target.value)}
                            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-brand disabled:opacity-50 max-w-[180px]">
                            {a.brokerages?.name && !orgs.some(o => o.id === a.brokerage_id) && (
                              <option value={a.brokerage_id}>{a.brokerages.name}</option>
                            )}
                            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Feature toggles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 pl-12">
                      {FEATURES.map(f => {
                        const on = featureOn(a, f.key);
                        return (
                          <div key={f.key} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700">{f.label}</p>
                              <p className="text-[11px] text-gray-400 leading-tight">{f.hint}</p>
                            </div>
                            <Toggle
                              on={on}
                              disabled={savingFeat === `${a.id}:${f.key}`}
                              onClick={() => toggleFeature(a.id, f.key, !on)}
                            />
                          </div>
                        );
                      })}
                    </div>
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
