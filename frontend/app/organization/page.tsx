"use client";
import { useEffect, useState } from "react";
import { api, OrgProfile, OrgSetupStatus, PhoneAgentDeployment, Agent } from "@/lib/api";
import { IndustryMode, INDUSTRY_MODES, INDUSTRY_LABELS, DEFAULT_MODE } from "@/lib/industry";
import { Building2, Save, ChevronDown, ChevronUp, Pencil, CheckCircle2, XCircle, HelpCircle, RefreshCw, Trash2, Plus, Radio } from "lucide-react";

export default function OrganizationPage() {
  const [profile, setProfile]     = useState<OrgProfile | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving,  setSaving]      = useState(false);
  const [saved,   setSaved]       = useState(false);
  const [error,   setError]       = useState<string | null>(null);
  const [draft,   setDraft]       = useState<Partial<OrgProfile>>({});

  // Admin: list of all orgs + which one is being edited
  const [allOrgs,      setAllOrgs]      = useState<OrgProfile[]>([]);
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [adminDraft,   setAdminDraft]   = useState<Partial<OrgProfile>>({});
  const [adminSaving,  setAdminSaving]  = useState<string | null>(null);

  // Setup & Call Routing checklist — loaded lazily per org, cached by org id.
  const [statusByOrg,  setStatusByOrg]  = useState<Record<string, OrgSetupStatus>>({});
  const [statusLoading, setStatusLoading] = useState<string | null>(null);
  const [orgAgents,    setOrgAgents]    = useState<Record<string, Agent[]>>({});
  const [newAgent,     setNewAgent]     = useState<{ name: string; base_url: string; agent_id: string }>({ name: "", base_url: "", agent_id: "" });
  const [addingAgent,  setAddingAgent]  = useState(false);
  const [removingAgentId, setRemovingAgentId] = useState<string | null>(null);

  async function loadStatus(orgId: string) {
    setStatusLoading(orgId);
    try {
      const [status, agents] = await Promise.all([
        api.organization.setupStatus(orgId),
        orgAgents[orgId] ? Promise.resolve(orgAgents[orgId]) : api.agents.list(orgId),
      ]);
      setStatusByOrg(prev => ({ ...prev, [orgId]: status }));
      setOrgAgents(prev => ({ ...prev, [orgId]: agents }));
    } catch {
      setError("Failed to load setup status.");
    } finally {
      setStatusLoading(null);
    }
  }

  async function handleAddPhoneAgent(orgId: string) {
    if (!newAgent.name.trim() || !newAgent.base_url.trim() || !newAgent.agent_id) return;
    setAddingAgent(true);
    try {
      await api.organization.createPhoneAgent(orgId, {
        agent_id: newAgent.agent_id,
        name: newAgent.name.trim(),
        base_url: newAgent.base_url.trim(),
      });
      setNewAgent({ name: "", base_url: "", agent_id: "" });
      await loadStatus(orgId);
    } catch {
      setError("Failed to add phone agent.");
    } finally {
      setAddingAgent(false);
    }
  }

  async function handleRemovePhoneAgent(orgId: string, deploymentId: string) {
    setRemovingAgentId(deploymentId);
    try {
      await api.organization.deletePhoneAgent(orgId, deploymentId);
      await loadStatus(orgId);
    } catch {
      setError("Failed to remove phone agent.");
    } finally {
      setRemovingAgentId(null);
    }
  }

  const isAdmin   = profile?.agent_role === "admin";
  const canEdit   = profile?.agent_role === "admin" || profile?.agent_role === "manager";
  // "employee" is the default role — view only

  useEffect(() => {
    api.organization.get()
      .then(data => {
        setProfile(data);
        setDraft({ name: data.name, primary_contact: data.primary_contact ?? "", industry_mode: data.industry_mode ?? DEFAULT_MODE, email: data.email ?? "" });
      })
      .catch(() => setError("Failed to load organization profile."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    api.organization.listAll().then(setAllOrgs).catch(() => {});
  }, [isAdmin]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.organization.update(draft);
      setProfile(prev => prev ? { ...prev, ...updated } : updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAdminSave(orgId: string) {
    setAdminSaving(orgId);
    try {
      const updated = await api.organization.updateById(orgId, adminDraft);
      setAllOrgs(prev => prev.map(o => o.id === orgId ? { ...o, ...updated } : o));
      setEditingOrgId(null);
    } catch {
      setError("Failed to save changes.");
    } finally {
      setAdminSaving(null);
    }
  }

  if (loading) return <div className="text-muted text-sm italic">Loading…</div>;

  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Organization Profile</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          {isAdmin ? "Admin — manage all organizations" : canEdit ? "Manager — edit your organization" : "Employee — view only"}
        </p>
      </div>

      {error && (
        <p className="text-sm text-brand border border-brand/20 bg-brand-light px-4 py-2">{error}</p>
      )}

      {/* My Organization */}
      <div className="bg-white border border-warm-border p-6 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <Building2 size={16} className="text-muted" />
          <p className="text-[10px] tracking-widest uppercase text-muted">Your Organization</p>
        </div>

        <Field label="Company Name" value={draft.name ?? ""} onChange={v => setDraft(d => ({ ...d, name: v }))} disabled={!canEdit} />
        <Field label="Primary Contact" value={draft.primary_contact ?? ""} onChange={v => setDraft(d => ({ ...d, primary_contact: v }))} disabled={!canEdit} />
        <SelectField label="Industry" value={draft.industry_mode ?? DEFAULT_MODE} onChange={v => setDraft(d => ({ ...d, industry_mode: v }))} disabled={!canEdit}
          hint="Sets the terminology used across the app (e.g. Buyer/Seller vs. Residential/Commercial)" />
        <Field label="Organization Email" value={draft.email ?? ""} onChange={v => setDraft(d => ({ ...d, email: v }))} disabled={!canEdit}
          hint="Consent logs from Home Value will be sent to this address" />

        {canEdit && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-brand text-white px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
          </button>
        )}
      </div>

      {/* Admin: All Organizations */}
      {isAdmin && allOrgs.length > 0 && (
        <div className="space-y-4">
          <p className="text-[10px] tracking-widest uppercase text-muted">All Organizations</p>
          {allOrgs.map(org => {
            const isEditing = editingOrgId === org.id;
            return (
              <div key={org.id} className="bg-white border border-warm-border">
                {/* Org header row */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-cream transition-colors"
                  onClick={() => {
                    if (isEditing) { setEditingOrgId(null); return; }
                    setEditingOrgId(org.id);
                    setAdminDraft({ name: org.name, primary_contact: org.primary_contact ?? "", industry_mode: org.industry_mode ?? DEFAULT_MODE, email: org.email ?? "" });
                    if (!statusByOrg[org.id]) loadStatus(org.id);
                  }}
                >
                  <div>
                    <p className="text-sm font-medium text-charcoal">{org.name}</p>
                    {org.email && <p className="text-xs text-muted mt-0.5">{org.email}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Pencil size={12} className="text-muted" />
                    {isEditing ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
                  </div>
                </div>

                {/* Editable form */}
                {isEditing && (
                  <div className="border-t border-warm-border px-5 py-5 space-y-4">
                    <Field label="Company Name"     value={adminDraft.name ?? ""}            onChange={v => setAdminDraft(d => ({ ...d, name: v }))} />
                    <Field label="Primary Contact"  value={adminDraft.primary_contact ?? ""}  onChange={v => setAdminDraft(d => ({ ...d, primary_contact: v }))} />
                    <SelectField label="Industry"   value={adminDraft.industry_mode ?? DEFAULT_MODE} onChange={v => setAdminDraft(d => ({ ...d, industry_mode: v }))} />
                    <Field label="Organization Email" value={adminDraft.email ?? ""}           onChange={v => setAdminDraft(d => ({ ...d, email: v }))} />
                    <button
                      onClick={() => handleAdminSave(org.id)}
                      disabled={adminSaving === org.id}
                      className="flex items-center gap-2 bg-brand text-white px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      <Save size={14} />
                      {adminSaving === org.id ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                )}

                {/* Setup & Call Routing checklist */}
                {isEditing && (
                  <SetupChecklist
                    orgId={org.id}
                    status={statusByOrg[org.id]}
                    loading={statusLoading === org.id}
                    agents={orgAgents[org.id] ?? []}
                    newAgent={newAgent}
                    setNewAgent={setNewAgent}
                    addingAgent={addingAgent}
                    removingAgentId={removingAgentId}
                    onRefresh={() => loadStatus(org.id)}
                    onAdd={() => handleAddPhoneAgent(org.id)}
                    onRemove={(id) => handleRemovePhoneAgent(org.id, id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, disabled, hint }: {
  label: string; value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] tracking-widest uppercase text-muted mb-1.5">{label}</label>
      <input
        value={value}
        onChange={e => onChange?.(e.target.value)}
        disabled={disabled}
        className="w-full border border-warm-border bg-white px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-brand transition-colors disabled:bg-cream disabled:text-muted"
        placeholder={disabled ? "—" : `Enter ${label.toLowerCase()}…`}
      />
      {hint && <p className="text-[10px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

function StatusIcon({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) return <CheckCircle2 size={14} className="text-green-600 shrink-0" />;
  if (ok === false) return <XCircle size={14} className="text-brand shrink-0" />;
  return <HelpCircle size={14} className="text-muted shrink-0" />;
}

function SetupChecklist({
  orgId, status, loading, agents, newAgent, setNewAgent, addingAgent, removingAgentId,
  onRefresh, onAdd, onRemove,
}: {
  orgId: string;
  status?: OrgSetupStatus;
  loading: boolean;
  agents: Agent[];
  newAgent: { name: string; base_url: string; agent_id: string };
  setNewAgent: (v: { name: string; base_url: string; agent_id: string }) => void;
  addingAgent: boolean;
  removingAgentId: string | null;
  onRefresh: () => void;
  onAdd: () => void;
  onRemove: (deploymentId: string) => void;
}) {
  return (
    <div className="border-t border-warm-border px-5 py-5 space-y-5 bg-cream">
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-widest uppercase text-muted">Setup &amp; Call Routing</p>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-brand transition-colors disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {!status ? (
        <p className="text-xs text-muted italic">{loading ? "Checking…" : "—"}</p>
      ) : (
        <>
          {/* Org basics */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <StatusIcon ok={status.team.ok} />
              <span className="text-xs text-charcoal">
                {status.team.admin_or_manager_count} admin/manager{status.team.admin_or_manager_count === 1 ? "" : "s"} on the team ({status.team.total_agents} total)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatusIcon ok={status.brokerage.industry_mode_set} />
              <span className="text-xs text-charcoal">Industry set</span>
            </div>
          </div>

          {/* Human-forward call pipeline */}
          <div>
            <p className="text-[10px] tracking-widest uppercase text-muted mb-2">Phone Numbers (Human-Answered)</p>
            {status.phone_numbers.length === 0 ? (
              <p className="text-xs text-muted italic">No phone numbers registered.</p>
            ) : (
              <div className="space-y-2">
                {status.phone_numbers.map(p => (
                  <div key={p.id} className="bg-white border border-warm-border px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusIcon ok={p.twilio_checked ? p.twilio_matches : null} />
                      <span className="text-xs font-medium text-charcoal">{p.number}</span>
                      {p.label && <span className="text-xs text-muted">· {p.label}</span>}
                      {!p.active && <span className="text-[10px] text-muted border border-warm-border px-1.5">inactive</span>}
                    </div>
                    <p className="text-[11px] text-muted mt-1 pl-[22px]">
                      {!p.twilio_checked
                        ? p.twilio_error || "Not checked"
                        : !p.twilio_found
                        ? "Not found in Twilio — check the number is correct"
                        : p.twilio_matches
                        ? "Twilio Voice webhook correctly points at Coach-C"
                        : `Twilio Voice webhook is "${p.twilio_voice_url || "(empty)"}" — expected "${p.expected_webhook}"`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI phone agent deployments */}
          <div>
            <p className="text-[10px] tracking-widest uppercase text-muted mb-2">AI Phone Agents</p>
            {status.phone_agents.length === 0 ? (
              <p className="text-xs text-muted italic mb-2">No AI phone agent registered.</p>
            ) : (
              <div className="space-y-2 mb-2">
                {status.phone_agents.map(d => (
                  <div key={d.id} className="bg-white border border-warm-border px-3 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusIcon ok={d.reachable} />
                        <span className="text-xs font-medium text-charcoal truncate">{d.name}</span>
                      </div>
                      <p className="text-[11px] text-muted mt-1 pl-[22px] truncate">{d.base_url}</p>
                      <p className="text-[11px] text-muted pl-[22px] flex items-center gap-1.5">
                        <Radio size={10} />
                        {d.agents?.name ?? "Unknown agent"}
                        {!d.agent_valid && <span className="text-brand">(agent not in this org)</span>}
                      </p>
                      {d.reachable === false && (
                        <p className="text-[11px] text-brand pl-[22px]">{d.health_error || "Not reachable"}</p>
                      )}
                    </div>
                    <button
                      onClick={() => onRemove(d.id)}
                      disabled={removingAgentId === d.id}
                      className="text-muted hover:text-brand transition-colors p-1 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new */}
            <div className="bg-white border border-warm-border px-3 py-3 space-y-2">
              <input
                value={newAgent.name}
                onChange={e => setNewAgent({ ...newAgent, name: e.target.value })}
                placeholder="Name (e.g. Francis — Gemini)"
                className="w-full text-xs border border-warm-border px-2.5 py-1.5 focus:outline-none focus:border-brand"
              />
              <input
                value={newAgent.base_url}
                onChange={e => setNewAgent({ ...newAgent, base_url: e.target.value })}
                placeholder="https://…-production.up.railway.app"
                className="w-full text-xs border border-warm-border px-2.5 py-1.5 focus:outline-none focus:border-brand"
              />
              <select
                value={newAgent.agent_id}
                onChange={e => setNewAgent({ ...newAgent, agent_id: e.target.value })}
                className="w-full text-xs border border-warm-border px-2.5 py-1.5 focus:outline-none focus:border-brand"
              >
                <option value="">Attribute calls to…</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button
                onClick={onAdd}
                disabled={addingAgent || !newAgent.name.trim() || !newAgent.base_url.trim() || !newAgent.agent_id}
                className="w-full flex items-center justify-center gap-1.5 text-xs bg-brand text-white py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Plus size={12} /> {addingAgent ? "Adding…" : "Add AI Phone Agent"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, disabled, hint }: {
  label: string; value: string;
  onChange?: (v: IndustryMode) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] tracking-widest uppercase text-muted mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => onChange?.(e.target.value as IndustryMode)}
        disabled={disabled}
        className="w-full border border-warm-border bg-white px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-brand transition-colors disabled:bg-cream disabled:text-muted"
      >
        {INDUSTRY_MODES.map(m => (
          <option key={m} value={m}>{INDUSTRY_LABELS[m]}</option>
        ))}
      </select>
      {hint && <p className="text-[10px] text-muted mt-1">{hint}</p>}
    </div>
  );
}
