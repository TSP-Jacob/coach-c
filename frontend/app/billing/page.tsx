"use client";
import { useEffect, useState } from "react";
import { api, MyBilling } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CreditCard, CalendarClock, CheckCircle2, RefreshCw } from "lucide-react";

function fmtMoney(amount: number | null, currency: string) {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: (currency || "cad").toUpperCase() }).format(amount);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function BillingPage() {
  const { role, loading: authLoading } = useAuth();
  const [data, setData] = useState<MyBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingSingle, setPayingSingle] = useState(false);
  const [payingRecurring, setPayingRecurring] = useState(false);

  const load = () => {
    setLoading(true);
    api.billing.me()
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (!authLoading) load(); /* eslint-disable-next-line */ }, [authLoading]);

  if (!authLoading && role && role !== "manager" && role !== "admin") {
    return <p className="text-sm text-gray-400">Billing is available to manager accounts.</p>;
  }

  const paySingle = async () => {
    if (!data?.single.invoice_id) return;
    setPayingSingle(true);
    try {
      const { url } = await api.billing.checkoutSingle(data.single.invoice_id);
      window.location.href = url;
    } catch (e: any) {
      setError("Payment isn't available yet. Please try again shortly.");
      setPayingSingle(false);
    }
  };

  const paySubscribe = async () => {
    setPayingRecurring(true);
    try {
      const { url } = await api.billing.checkoutRecurring();
      window.location.href = url;
    } catch (e: any) {
      setError("Subscription checkout isn't available yet. Please try again shortly.");
      setPayingRecurring(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-gray-400 mt-1">Your invoices and payment history.</p>
        </div>
        <button onClick={load} className="text-gray-400 hover:text-brand transition-colors" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      {loading && <p className="text-sm text-gray-400">Loading…</p>}

      {!loading && data && (
        <>
          {/* Upcoming payment banner */}
          {data.upcoming && (
            <div className="bg-brand/5 border border-brand/20 rounded-xl px-5 py-4 flex items-center gap-3">
              <CalendarClock size={18} className="text-brand shrink-0" />
              <div className="text-sm">
                <span className="font-semibold">Upcoming payment: </span>
                {fmtMoney(data.upcoming.amount, data.upcoming.currency) ?? "—"}
                {data.upcoming.due_date && <> · due {fmtDate(data.upcoming.due_date)}</>}
                {data.upcoming.description && <span className="text-gray-500"> · {data.upcoming.description}</span>}
              </div>
            </div>
          )}

          {/* Two invoice categories */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Single payment */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <div className="flex items-center gap-2 text-gray-500">
                <CreditCard size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Single Payment</span>
              </div>
              <p className="text-3xl font-bold">
                {fmtMoney(data.single.amount, data.single.currency) ?? <span className="text-gray-300">—</span>}
              </p>
              {data.single.description && <p className="text-sm text-gray-500">{data.single.description}</p>}
              <p className="text-xs text-gray-400">
                {data.single.configured
                  ? data.single.due_date ? `Due ${fmtDate(data.single.due_date)}` : "One-time charge"
                  : "Amount not set yet."}
              </p>
              <button
                onClick={paySingle}
                disabled={!data.single.configured || payingSingle}
                className="w-full bg-brand text-white text-sm py-2.5 rounded-lg hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {payingSingle ? "Redirecting…" : "Pay now"}
              </button>
            </div>

            {/* Recurring payment */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <div className="flex items-center gap-2 text-gray-500">
                <RefreshCw size={16} />
                <span className="text-xs font-semibold uppercase tracking-wide">Recurring (Monthly)</span>
              </div>
              <p className="text-3xl font-bold">
                {fmtMoney(data.recurring.amount, data.recurring.currency)
                  ? <>{fmtMoney(data.recurring.amount, data.recurring.currency)}<span className="text-base font-normal text-gray-400">/mo</span></>
                  : <span className="text-gray-300">—</span>}
              </p>
              {data.recurring.description && <p className="text-sm text-gray-500">{data.recurring.description}</p>}
              <p className="text-xs text-gray-400">
                {data.recurring.status === "active"
                  ? `Active · renews ${fmtDate(data.recurring.current_period_end)}`
                  : data.recurring.configured ? "Not subscribed yet." : "Amount not set yet."}
              </p>
              <button
                onClick={paySubscribe}
                disabled={!data.recurring.configured || data.recurring.status === "active" || payingRecurring}
                className="w-full bg-brand text-white text-sm py-2.5 rounded-lg hover:bg-brand-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {data.recurring.status === "active" ? "Subscribed" : payingRecurring ? "Redirecting…" : "Subscribe"}
              </button>
            </div>
          </div>

          {/* Paid history */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold">Payment history</h2>
            </div>
            {data.history.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-400">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.history.map(h => (
                  <li key={h.id} className="px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">
                          {h.type === "recurring" ? "Monthly subscription" : "Single payment"}
                          {h.description ? ` · ${h.description}` : ""}
                        </p>
                        <p className="text-xs text-gray-400">{fmtDate(h.paid_at)}</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold">{fmtMoney(h.amount, h.currency) ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
