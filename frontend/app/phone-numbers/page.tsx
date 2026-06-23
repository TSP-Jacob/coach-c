"use client";
import { useEffect, useState } from "react";
import { api, PhoneNumber, OrgProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Phone, Trash2, Plus, Building2, Loader2 } from "lucide-react";

export default function PhoneNumbersPage() {
  const { role, loading: authLoading } = useAuth();
  const isAdmin = role === "admin";

  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [orgs, setOrgs] = useState<OrgProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-number form
  const [number, setNumber] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [label, setLabel] = useState("");
  const [orgId, setOrgId] = useState("");
  const [saving, setSaving] = useState(false);

  // Create-org inline
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([api.phoneNumbers.list(), api.organization.listAll()])
      .then(([nums, os]) => { setNumbers(nums); setOrgs(os); })
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (!authLoading && isAdmin) load(); /* eslint-disable-next-line */ }, [authLoading, isAdmin]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!number.trim() || !orgId) { setError("Number and organization are required"); return; }
    setSaving(true); setError(null);
    try {
      await api.phoneNumbers.create({
        number: number.trim(),
        brokerage_id: orgId,
        label: label.trim() || undefined,
        forward_to: forwardTo.trim() || undefined,
      });
      setNumber(""); setForwardTo(""); setLabel("");
      load();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setCreatingOrg(true); setError(null);
    try {
      const org = await api.organization.create(newOrgName.trim());
      setNewOrgName("");
      const os = await api.organization.listAll();
      setOrgs(os);
      setOrgId(org.id); // auto-select the new org
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setCreatingOrg(false);
    }
  }

  async function handleDelete(id: string) {
    const prev = numbers;
    setNumbers(n => n.filter(x => x.id !== id));
    try { await api.phoneNumbers.remove(id); }
    catch (e: any) { setNumbers(prev); setError(String(e.message || e)); }
  }

  if (!authLoading && !isAdmin) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted italic font-serif">This page is available to admins only.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Phone Numbers</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          Map a number to an organization · inbound calls become that org&apos;s leads &amp; clients
        </p>
      </div>

      {error && (
        <p className="text-xs text-brand bg-brand-light border border-brand/20 px-3 py-2">{error}</p>
      )}

      {/* Add number */}
      <form onSubmit={handleAdd} className="bg-white border border-warm-border p-6 space-y-4">
        <p className="text-[10px] tracking-widest uppercase text-muted">Associate a number</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Phone number (the Twilio DID)</label>
            <input value={number} onChange={e => setNumber(e.target.value)} placeholder="+1 514 555 0123"
              className="w-full border border-warm-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Forward to (real line — optional)</label>
            <input value={forwardTo} onChange={e => setForwardTo(e.target.value)} placeholder="+1 514 555 9876"
              className="w-full border border-warm-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-brand" />
            <p className="text-[10px] text-muted mt-1">Set this to bridge + record a two-way call. Leave empty to record a message.</p>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Organization</label>
            <select value={orgId} onChange={e => setOrgId(e.target.value)}
              className="w-full border border-warm-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-brand">
              <option value="">Select organization…</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1.5 tracking-wide uppercase">Label (optional)</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Main HVAC line"
              className="w-full border border-warm-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-brand" />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="bg-charcoal text-white text-sm px-4 py-2.5 hover:bg-brand transition-colors disabled:opacity-50 flex items-center gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Associate number
        </button>
      </form>

      {/* Create org */}
      <div className="bg-white border border-warm-border p-6 space-y-3">
        <p className="text-[10px] tracking-widest uppercase text-muted flex items-center gap-1.5">
          <Building2 size={12} /> New organization
        </p>
        <div className="flex gap-3">
          <input value={newOrgName} onChange={e => setNewOrgName(e.target.value)} placeholder="e.g. Air Santé Air Care"
            className="flex-1 border border-warm-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-brand" />
          <button onClick={handleCreateOrg} disabled={creatingOrg || !newOrgName.trim()}
            className="border border-warm-border text-sm px-4 py-2.5 text-charcoal hover:border-brand hover:text-brand transition-colors disabled:opacity-50 flex items-center gap-2">
            {creatingOrg ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-warm-border">
        <div className="px-6 py-4 border-b border-warm-border">
          <p className="text-[10px] tracking-widest uppercase text-muted">Associated numbers</p>
        </div>
        <div className="divide-y divide-warm-border">
          {loading && <p className="text-sm text-muted px-6 py-8 italic font-serif">Loading…</p>}
          {!loading && numbers.length === 0 && (
            <p className="text-sm text-muted px-6 py-8 italic font-serif">
              No numbers yet. Associate a number above to start routing its calls to an organization.
            </p>
          )}
          {numbers.map(n => (
            <div key={n.id} className="flex items-center justify-between px-6 py-4 hover:bg-cream transition-colors">
              <div className="flex items-center gap-3">
                <Phone size={15} className="text-muted shrink-0" />
                <div>
                  <p className="text-sm font-medium text-charcoal">{n.number}{n.label ? ` · ${n.label}` : ""}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {n.brokerages?.name ?? "—"}
                    {n.forward_to ? ` · forwards to ${n.forward_to}` : " · records a message"}
                  </p>
                </div>
              </div>
              <button onClick={() => handleDelete(n.id)} className="text-muted hover:text-brand transition-colors" title="Remove">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
