"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Save, ChevronDown, ChevronUp } from "lucide-react";

const BROKERAGE_ID = "00000000-0000-0000-0000-000000000001";

const CALL_TYPES = [
  { key: "prospecting",         label: "Prospecting" },
  { key: "buyer_consultation",  label: "Buyer Consultation" },
  { key: "seller_listing",      label: "Seller Listing" },
  { key: "followup",            label: "Follow-Up" },
  { key: "negotiation",         label: "Negotiation" },
  { key: "post_closing",        label: "Post-Closing" },
];

interface Principle {
  description: string;
  weight: number;
}

interface Guideline {
  call_type: string;
  description: string;
  principles: Record<string, Principle>;
}

function PrincipleEditor({
  name, principle, onChange,
}: {
  name: string;
  principle: Principle;
  onChange: (p: Principle) => void;
}) {
  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm capitalize">{name.replace(/_/g, " ")}</p>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Weight</label>
          <input type="number" min={1} max={30} value={principle.weight}
            onChange={e => onChange({ ...principle, weight: Number(e.target.value) })}
            className="w-14 text-xs border border-gray-200 rounded px-2 py-1 text-center" />
        </div>
      </div>
      <textarea value={principle.description} rows={2}
        onChange={e => onChange({ ...principle, description: e.target.value })}
        className="w-full text-sm text-gray-600 border border-gray-100 rounded px-3 py-2 resize-none focus:outline-none focus:border-brand" />
    </div>
  );
}

function GuidelineSection({ callTypeKey, label }: { callTypeKey: string; label: string }) {
  const [guideline, setGuideline] = useState<Guideline | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || guideline) return;
    // Load default from bundled JSON
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/guidelines/?brokerage_id=${BROKERAGE_ID}`)
      .then(r => r.json())
      .then((list: { call_type: string; content: Guideline }[]) => {
        const match = list.find(g => g.call_type === callTypeKey);
        if (match) setGuideline(match.content);
      });
  }, [open, callTypeKey, guideline]);

  const save = async () => {
    if (!guideline) return;
    setSaving(true);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/guidelines/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerage_id: BROKERAGE_ID, call_type: callTypeKey, content: guideline }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updatePrinciple = (key: string, p: Principle) => {
    if (!guideline) return;
    setGuideline({ ...guideline, principles: { ...guideline.principles, [key]: p } });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors">
        <div className="text-left">
          <p className="font-semibold">{label}</p>
          {guideline && (
            <p className="text-xs text-gray-400 mt-0.5">{Object.keys(guideline.principles).length} principles</p>
          )}
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 space-y-4">
          {!guideline && <p className="text-sm text-gray-400">Loading…</p>}
          {guideline && (
            <>
              <textarea value={guideline.description} rows={2}
                onChange={e => setGuideline({ ...guideline, description: e.target.value })}
                className="w-full text-sm text-gray-600 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand" />

              <div className="space-y-3">
                {Object.entries(guideline.principles).map(([key, principle]) => (
                  <PrincipleEditor key={key} name={key} principle={principle}
                    onChange={p => updatePrinciple(key, p)} />
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={save} disabled={saving}
                  className="flex items-center gap-2 bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors">
                  <Save size={14} />
                  {saved ? "Saved ✓" : saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function GuidelinesPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Coaching Guidelines</h1>
        <p className="text-sm text-gray-400 mt-1">
          Edit the principles Coach-C uses to score each call type. Changes apply to all future analyses.
        </p>
      </div>
      <div className="space-y-3">
        {CALL_TYPES.map(({ key, label }) => (
          <GuidelineSection key={key} callTypeKey={key} label={label} />
        ))}
      </div>
    </div>
  );
}
