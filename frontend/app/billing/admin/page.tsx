"use client";
import { useEffect, useState } from "react";
import { api, BillableManager, ManagerBillingConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Save, Users } from "lucide-react";

export default function BillingAdminPage() {
  const { role, loading: authLoading } = useAuth();
  const [managers, setManagers] = useState<BillableManager[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [config, setConfig] = useState<ManagerBillingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable form state
  const [singleAmount, setSingleAmount] = useState("");
  const [singleDesc, setSingleDesc] = useState("");
  const [singleDue, setSingleDue] = useState("");
  const [recurringAmount, setRecurringAmount] = useState("");
  const [recurringDesc, setRecurringDesc] = useState("");

  useEffect(() => {
    if (authLoading) return;
    api.billing.listManagers()
      .then(setManagers)
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [authLoading]);

  const selectManager = async (agentId: string) => {
    setSelected(agentId);
    setSaved(false);
    setConfig(null);
    try {
      const cfg = await api.billing.getManager(agentId);
      setConfig(cfg);
      setSingleAmount(cfg.single.amount != null ? String(cfg.single.amount) : "");
      setSingleDesc(cfg.single.description ?? "");
      setSingleDue(cfg.single.due_date ?? "");
      setRecurringAmount(cfg.recurring.amount != null ? String(cfg.recurring.amount) : "");
      setRecurringDesc(cfg.recurring.description ?? "");
    } catch (e: any) {
      setError(String(e.message || e));
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api.billing.configure(selected, {
        single: {
          amount: singleAmount.trim() === "" ? null : Number(singleAmount),
          description: singleDesc.trim() || null,
          due_date: singleDue || null,
        },
        recurring: {
          amount: recurringAmount.trim() === "" ? null : Number(recurringAmount),
          description: recurringDesc.trim() || null,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Refresh manager list to reflect new amounts
      api.billing.listManagers().then(setManagers).catch(() => {});
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  if (!authLoading && role && role !== "admin") {
    return <p className="text-sm text-gray-400">Admin access required.</p>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing — Admin</h1>
        <p className="text-sm text-gray-400 mt-1">
          Set the single-payment and recurring-monthly amounts for each manager. Amounts left blank appear empty on the manager&apos;s billing page.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="grid md:grid-cols-[260px_1fr] gap-5">
        {/* Manager list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-gray-500">
            <Users size={15} />
            <span className="text-xs font-semibold uppercase tracking-wide">Managers</span>
          </div>
          {loading ? (
            <p className="px-4 py-4 text-sm text-gray-400">Loading…</p>
          ) : managers.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-400">No manager accounts found.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {managers.map(m => (
                <li key={m.agent_id}>
                  <button onClick={() => selectManager(m.agent_id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selected === m.agent_id ? "bg-brand/5" : ""}`}>
                    <p className="text-sm font-medium">{m.name || m.email || "Unnamed"}</p>
                    <p className="text-xs text-gray-400">
                      {m.recurring_amount != null ? `$${m.recurring_amount}/mo · ${m.recurring_status}` : "No recurring set"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Config form */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          {!selected ? (
            <p className="text-sm text-gray-400">Select a manager to configure their invoices.</p>
          ) : !config ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-6">
              {/* Single payment */}
              <div className="space-y-3">
                <h2 className="font-semibold">Single Payment (one-time)</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="text-gray-500 text-xs">Amount (CAD)</span>
                    <input type="number" min={0} step="0.01" value={singleAmount}
                      onChange={e => setSingleAmount(e.target.value)} placeholder="Leave blank to clear"
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
                  </label>
                  <label className="text-sm">
                    <span className="text-gray-500 text-xs">Due date</span>
                    <input type="date" value={singleDue}
                      onChange={e => setSingleDue(e.target.value)}
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
                  </label>
                </div>
                <label className="text-sm block">
                  <span className="text-gray-500 text-xs">Description</span>
                  <input type="text" value={singleDesc}
                    onChange={e => setSingleDesc(e.target.value)} placeholder="e.g. Setup & onboarding fee"
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
                </label>
              </div>

              <div className="border-t border-gray-100" />

              {/* Recurring payment */}
              <div className="space-y-3">
                <h2 className="font-semibold">Recurring Payment (monthly)</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="text-gray-500 text-xs">Amount (CAD / month)</span>
                    <input type="number" min={0} step="0.01" value={recurringAmount}
                      onChange={e => setRecurringAmount(e.target.value)} placeholder="Leave blank to clear"
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
                  </label>
                  <div className="text-sm flex items-end">
                    <p className="text-xs text-gray-400 pb-2">
                      Status: <span className="font-medium">{config.recurring.status}</span>
                    </p>
                  </div>
                </div>
                <label className="text-sm block">
                  <span className="text-gray-500 text-xs">Description</span>
                  <input type="text" value={recurringDesc}
                    onChange={e => setRecurringDesc(e.target.value)} placeholder="e.g. Coach-C monthly subscription"
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
                </label>
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={save} disabled={saving}
                  className="flex items-center gap-2 bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors">
                  <Save size={14} />
                  {saved ? "Saved ✓" : saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
