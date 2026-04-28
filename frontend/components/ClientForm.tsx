"use client";
import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  agentId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ClientForm({ agentId, onSuccess, onCancel }: Props) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", type: "buyer", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      await api.agents.createClient({ ...form, agent_id: agentId });
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold">New Client</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">Full Name *</label>
          <input value={form.name} onChange={e => set("name", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Phone</label>
          <input value={form.phone} onChange={e => set("phone", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Email</label>
          <input value={form.email} onChange={e => set("email", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand" />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Type</label>
          <select value={form.type} onChange={e => set("type", e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand bg-white">
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
            <option value="both">Both</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 block mb-1">
            File Notes{" "}
            <span className="text-gray-400 font-normal">(used by Coach-C for context in calls and chat)</span>
          </label>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={4}
            placeholder="E.g. Looking for a 3-bed detached in the West Island. Pre-approved for $650k. Motivated — lease ends June 30. Wife prefers open concept. Has seen 4 homes already, liked 22 Maple but thought it was overpriced..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand resize-none" />
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="bg-brand text-white text-sm px-5 py-2 rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors">
          {saving ? "Saving…" : "Save Client"}
        </button>
      </div>
    </div>
  );
}
