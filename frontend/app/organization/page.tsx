"use client";
import { useEffect, useState } from "react";
import { api, OrgProfile } from "@/lib/api";
import { Building2, Save, ChevronDown, ChevronUp, Pencil } from "lucide-react";

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

  const isAdmin   = profile?.agent_role === "admin";
  const canEdit   = profile?.agent_role === "admin" || profile?.agent_role === "manager";
  // "employee" is the default role — view only

  useEffect(() => {
    api.organization.get()
      .then(data => {
        setProfile(data);
        setDraft({ name: data.name, primary_contact: data.primary_contact ?? "", industry: data.industry ?? "", email: data.email ?? "" });
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
        <Field label="Industry" value={draft.industry ?? ""} onChange={v => setDraft(d => ({ ...d, industry: v }))} disabled={!canEdit} />
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
                    setAdminDraft({ name: org.name, primary_contact: org.primary_contact ?? "", industry: org.industry ?? "", email: org.email ?? "" });
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
                    <Field label="Industry"         value={adminDraft.industry ?? ""}          onChange={v => setAdminDraft(d => ({ ...d, industry: v }))} />
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
