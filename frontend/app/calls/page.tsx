"use client";
import { useEffect, useMemo, useState } from "react";
import { api, Agent, Call } from "@/lib/api";
import CallUpload from "@/components/CallUpload";
import ScoreBadge from "@/components/ScoreBadge";
import { useToast } from "@/components/Toast";
import Link from "next/link";
import { Trash2, Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth";

const CALL_TYPE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  buyer_consultation: "Buyer Consult",
  seller_listing: "Seller Listing",
  followup: "Follow-Up",
  negotiation: "Negotiation",
  post_closing: "Post-Closing",
  unknown: "Unknown",
};

const DATE_OPTIONS = [
  { label: "All time",    value: "all" },
  { label: "This week",   value: "week" },
  { label: "This month",  value: "month" },
  { label: "Last 3 months", value: "3months" },
];

const SCORE_OPTIONS = [
  { label: "All scores",  value: "all" },
  { label: "High (75+)",  value: "high" },
  { label: "Mid (50–74)", value: "mid" },
  { label: "Low (<50)",   value: "low" },
];

function passesDate(call: Call, filter: string): boolean {
  if (filter === "all") return true;
  const d = new Date(call.call_date ?? call.created_at).getTime();
  const now = Date.now();
  if (filter === "week")   return now - d < 7  * 86_400_000;
  if (filter === "month")  return now - d < 30 * 86_400_000;
  if (filter === "3months") return now - d < 90 * 86_400_000;
  return true;
}

function passesScore(call: Call, filter: string): boolean {
  if (filter === "all") return true;
  const s = call.overall_score;
  if (s == null) return false;
  if (filter === "high") return s >= 75;
  if (filter === "mid")  return s >= 50 && s < 75;
  if (filter === "low")  return s < 50;
  return true;
}

export default function CallsPage() {
  const { agentId: AGENT_ID } = useAuth();
  const [calls, setCalls]           = useState<Call[]>([]);
  const [agent, setAgent]           = useState<Agent | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [scoreFilter, setScoreFilter] = useState("all");
  const { toast } = useToast();

  const load = () => api.calls.list(AGENT_ID ?? undefined).then(setCalls);
  useEffect(() => {
    load();
    if (AGENT_ID) api.agents.get(AGENT_ID).then(setAgent);
  }, [AGENT_ID]);

  const remove = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    await api.calls.delete(id);
    toast("Call deleted");
    load();
  };

  const clearFilters = () => {
    setSearch(""); setTypeFilter("all"); setDateFilter("all"); setScoreFilter("all");
  };

  const hasActiveFilter = search || typeFilter !== "all" || dateFilter !== "all" || scoreFilter !== "all";

  const filtered = useMemo(() => calls.filter(c => {
    const matchesSearch = !search ||
      (c.clients?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.call_type ?? "").includes(search.toLowerCase());
    return matchesSearch &&
      (typeFilter === "all" || c.call_type === typeFilter) &&
      passesDate(c, dateFilter) &&
      passesScore(c, scoreFilter);
  }), [calls, search, typeFilter, dateFilter, scoreFilter]);

  const types = useMemo(() => {
    const found = [...new Set(calls.map(c => c.call_type).filter(Boolean))];
    return found as string[];
  }, [calls]);

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between border-b border-warm-border pb-5">
        <div>
          <h1 className="text-4xl font-serif font-bold text-charcoal">Calls</h1>
          <p className="text-xs text-muted mt-1 tracking-widest uppercase">
            {filtered.length !== calls.length
              ? `${filtered.length} of ${calls.length} recording${calls.length !== 1 ? "s" : ""}`
              : `${calls.length} recording${calls.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowUpload(v => !v)}
          className="bg-brand text-white text-sm px-5 py-2.5 hover:bg-brand-dark transition-colors tracking-wide">
          + Upload Call
        </button>
      </div>

      {showUpload && (
        <CallUpload agentId={AGENT_ID ?? ""} onSuccess={() => {
          setShowUpload(false);
          load();
          toast("Call uploaded — analysis started");
        }} />
      )}

      {/* Filters */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name or call type…"
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-warm-border bg-white focus:outline-none focus:border-brand transition-colors" />
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap gap-2 items-center">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-warm-border bg-white focus:outline-none focus:border-brand appearance-none transition-colors">
            <option value="all">All types</option>
            {types.map(t => <option key={t} value={t}>{CALL_TYPE_LABELS[t] ?? t}</option>)}
          </select>

          <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-warm-border bg-white focus:outline-none focus:border-brand appearance-none transition-colors">
            {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-warm-border bg-white focus:outline-none focus:border-brand appearance-none transition-colors">
            {SCORE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {hasActiveFilter && (
            <button onClick={clearFilters}
              className="flex items-center gap-1.5 text-xs text-brand hover:text-brand-dark transition-colors px-2 py-2">
              <X size={11} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Calls list */}
      <div className="bg-white border border-warm-border divide-y divide-warm-border">
        {filtered.length === 0 && (
          <p className="text-muted text-sm px-6 py-8 italic font-serif">
            {calls.length === 0 ? "No calls yet. Upload your first recording." : "No calls match your filters."}
          </p>
        )}
        {filtered.map(call => {
          const dateStr = call.call_date ?? call.created_at;
          return (
            <div key={call.id} className="flex items-center justify-between px-6 py-4 hover:bg-cream group transition-colors">
              {/* Left: client name (→ client file) + call meta (→ call detail) */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {call.client_id ? (
                    <Link
                      href={`/clients?open=${call.client_id}`}
                      className="text-sm font-medium text-charcoal hover:text-brand transition-colors truncate"
                      onClick={e => e.stopPropagation()}
                    >
                      {call.clients?.name ?? "Unknown client"}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-muted italic">No client linked</span>
                  )}
                  {agent && (
                    <Link
                      href={`/agents/${call.agent_id}`}
                      className="text-[10px] text-muted hover:text-brand transition-colors tracking-wide"
                      onClick={e => e.stopPropagation()}
                    >
                      {agent.name}
                    </Link>
                  )}
                </div>
                <Link href={`/calls/${call.id}`} className="block">
                  <p className="text-xs text-muted mt-0.5">
                    {CALL_TYPE_LABELS[call.call_type ?? ""] ?? "Unclassified"} ·{" "}
                    {call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min` : "—"} ·{" "}
                    {new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </Link>
              </div>
              <div className="flex items-center gap-4 shrink-0 ml-4">
                <Link href={`/calls/${call.id}`}>
                  <ScoreBadge score={call.overall_score} status={call.status} />
                </Link>
                <button onClick={e => remove(call.id, e)}
                  className="text-warm-border hover:text-brand opacity-0 group-hover:opacity-100 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
