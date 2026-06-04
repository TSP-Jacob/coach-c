"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CreditCard, ExternalLink, ShieldCheck } from "lucide-react";

export default function BillingPage() {
  const { role, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await api.billing.portal();
      window.location.href = url;
    } catch (e: any) {
      setError(
        "Billing portal isn't available yet. If this persists, the Stripe Customer Portal may need to be activated."
      );
      setLoading(false);
    }
  };

  if (!authLoading && role && role !== "manager" && role !== "admin") {
    return <p className="text-sm text-gray-400">Billing is available to manager accounts.</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-gray-400 mt-1">
          View and pay your invoices, manage your subscription, and update your payment method.
        </p>
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="bg-brand/10 rounded-lg p-2.5">
            <CreditCard size={20} className="text-brand" />
          </div>
          <div>
            <h2 className="font-semibold">Your billing portal</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Everything about your payments in one secure place — outstanding invoices,
              payment history, receipts, and your saved card.
            </p>
          </div>
        </div>

        <button
          onClick={openPortal}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-brand text-white text-sm font-medium py-3 rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors">
          {loading ? "Opening…" : <>Manage Billing &amp; Pay Invoices <ExternalLink size={15} /></>}
        </button>

        <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
          <ShieldCheck size={14} />
          <span>Payments are securely processed by Stripe. We never see or store your card details.</span>
        </div>
      </div>
    </div>
  );
}
