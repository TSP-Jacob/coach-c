"use client";
import { useEffect, useState } from "react";
import { api, BillableManager } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ExternalLink, Users, Info } from "lucide-react";

const STRIPE_DASHBOARD = "https://dashboard.stripe.com/invoices";

export default function BillingAdminPage() {
  const { role, loading: authLoading } = useAuth();
  const [managers, setManagers] = useState<BillableManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    api.billing.listManagers()
      .then(setManagers)
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [authLoading]);

  const syncCustomers = async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const { synced, total } = await api.billing.syncCustomers();
      setSyncMsg(`Synced ${synced} of ${total} managers to Stripe. They're now ready to invoice in the Dashboard.`);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setSyncing(false);
    }
  };

  if (!authLoading && role && role !== "admin") {
    return <p className="text-sm text-gray-400">Admin access required.</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing — Admin</h1>
        <p className="text-sm text-gray-400 mt-1">
          Invoices and subscriptions are issued and tracked in Stripe. Use the reference
          list below to find each manager, then create their invoice in the Stripe Dashboard.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {/* How-to */}
      <div className="bg-brand/5 border border-brand/20 rounded-xl px-5 py-4 flex items-start gap-3">
        <Info size={18} className="text-brand shrink-0 mt-0.5" />
        <div className="text-sm text-gray-600 space-y-1">
          <p className="font-medium text-charcoal">How to bill a manager</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Open the Stripe Dashboard.</li>
            <li>Create an <strong>Invoice</strong> (one-time) or a <strong>Subscription</strong> (monthly), matching the manager by their email below.</li>
            <li>Stripe emails them a hosted payment page and tracks everything — they can also pay from their Coach-C <em>Billing</em> page.</li>
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a href={STRIPE_DASHBOARD} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-brand text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-brand-dark transition-colors">
          Open Stripe Dashboard <ExternalLink size={15} />
        </a>
        <button onClick={syncCustomers} disabled={syncing}
          className="inline-flex items-center gap-2 border border-gray-300 text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {syncing ? "Syncing…" : "Sync managers to Stripe"}
        </button>
      </div>

      {syncMsg && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">{syncMsg}</div>
      )}

      {/* Manager reference list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 text-gray-500">
          <Users size={15} />
          <span className="text-xs font-semibold uppercase tracking-wide">Managers</span>
        </div>
        {loading ? (
          <p className="px-5 py-5 text-sm text-gray-400">Loading…</p>
        ) : managers.length === 0 ? (
          <p className="px-5 py-5 text-sm text-gray-400">No manager accounts found.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {managers.map(m => (
              <li key={m.agent_id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{m.name || "Unnamed"}</p>
                  <p className="text-xs text-gray-400">{m.email || "—"}</p>
                </div>
                {m.email && (
                  <a
                    href={`https://dashboard.stripe.com/customers?email=${encodeURIComponent(m.email)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                    Find in Stripe <ExternalLink size={12} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
