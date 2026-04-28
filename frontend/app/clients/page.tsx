"use client";
import { useEffect, useMemo, useState } from "react";
import { api, Call, Client, Agent } from "@/lib/api";
import Link from "next/link";
import { Phone, Mail, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";

const TYPE_LABEL: Record<string, string> = {
  buyer:  "Buyer",
  seller: "Seller",
  both:   "Buyer & Seller",
};

const STATUS_ORDER = ["error", "complete", "analyzing", "transcribing", "uploaded"];

function statusLabel(status: string) {
  if (status === "complete")    return { label: "Complete",     cls: "text-green-700 bg-green-50 border-green-200" };
  if (status === "analyzing")   return { label: "Analyzing…",   cls: "text-amber-700 bg-amber-50 border-amber-200" };
  if (status === "transcribing")return { label: "Transcribing…",cls: "text-amber-700 bg-amber-50 border-amber-200" };
  if (status === "uploaded")    return { label: "Processing…",  cls: "text-amber-700 bg-amber-50 border-amber-200" };
  if (status === "error")       return { label: "Error",        cls: "text-brand bg-brand-light border-brand/20" };
  return { label: status, cls: "text-muted bg-white border-warm-border" };
}

interface ClientRow extends Client {
  callCount:    number;
  avgScore:     number | null;
  lastCallDate: string | null;
  lastCallType: string | null;
  lastStatus:   string | null;
  lastSummary:  string | null;
  agentName:    string;
}

export default function ClientsPage() {
  const { agentId: AGENT_ID } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [calls,   setCalls]   = useState<Call[]>([]);
  const [agent,   setAgent]   = useState<Agent | null>(null);
  const [search,  setSearch]  = useState("");

  useEffect(() => {
    if (!AGENT_ID) return;
    api.agents.listClients(AGENT_ID).then(setClients);
    api.calls.list(AGENT_ID).then(setCalls);
    api.agents.get(AGENT_ID).then(setAgent);
  }, [AGENT_ID]);

  const rows: ClientRow[] = useMemo(() => {
    return clients.map(client => {
      const clientCalls = calls
        .filter(c => c.client_id === client.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const completedCalls = clientCalls.filter(c => c.status === "complete" && c.overall_score != null);
      const avgScore = completedCalls.length
        ? Math.round(completedCalls.reduce((s, c) => s + c.overall_score!, 0) / completedCalls.length)
        : null;

      const latest = clientCalls[0] ?? null;

      return {
        ...client,
        callCount:    clientCalls.length,
        avgScore,
        lastCallDate: latest?.created_at ?? null,
        lastCallType: latest?.call_type ?? null,
        lastStatus:   latest?.status ?? null,
        lastSummary:  latest?.coaching_report?.summary ?? null,
        agentName:    agent?.name ?? "—",
      };
    });
  }, [clients, calls, agent]);

  const filtered = useMemo(() =>
    rows.filter(r =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.phone ?? "").includes(search) ||
      (r.email ?? "").toLowerCase().includes(search.toLowerCase())
    ), [rows, search]);

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-5 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-serif font-bold text-charcoal">Clients</h1>
          <p className="text-xs text-muted mt-1 tracking-widest uppercase">
            {clients.length} profile{clients.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, or email…"
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-warm-border bg-white focus:outline-none focus:border-brand transition-colors"
        />
      </div>

      {/* Table header */}
      <div className="bg-white border border-warm-border">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-3 border-b border-warm-border">
          {["Client", "Type · Agent", "Contact", "Calls · Score", "Last Activity"].map(h => (
            <p key={h} className="text-[10px] tracking-widest uppercase text-muted">{h}</p>
          ))}
        </div>

        <div className="divide-y divide-warm-border">
          {filtered.length === 0 && (
            <p className="text-muted text-sm px-6 py-8 italic font-serif">
              {clients.length === 0 ? "No clients yet. Clients are created automatically when calls are analyzed." : "No clients match your search."}
            </p>
          )}

          {filtered.map(row => {
            const st = row.lastStatus ? statusLabel(row.lastStatus) : null;
            return (
              <div key={row.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-5 hover:bg-cream transition-colors items-start">

                {/* Name + last summary */}
                <div>
                  <p className="text-sm font-medium text-charcoal">{row.name}</p>
                  {row.lastSummary && (
                    <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">
                      {row.lastSummary}
                    </p>
                  )}
                  {!row.lastSummary && row.callCount === 0 && (
                    <p className="text-xs text-muted mt-1 italic">No calls yet</p>
                  )}
                </div>

                {/* Type + agent */}
                <div>
                  <span className="text-xs border border-warm-border px-2 py-0.5 text-muted">
                    {TYPE_LABEL[row.type] ?? row.type}
                  </span>
                  <p className="text-xs text-muted mt-2">{row.agentName}</p>
                </div>

                {/* Contact */}
                <div className="space-y-1.5">
                  {row.phone && (
                    <p className="text-xs text-muted flex items-center gap-1.5">
                      <Phone size={11} /> {row.phone}
                    </p>
                  )}
                  {row.email && (
                    <p className="text-xs text-muted flex items-center gap-1.5">
                      <Mail size={11} /> {row.email}
                    </p>
                  )}
                  {!row.phone && !row.email && (
                    <p className="text-xs text-muted italic">—</p>
                  )}
                </div>

                {/* Call count + score */}
                <div>
                  <p className="text-sm font-serif font-bold text-charcoal">
                    {row.callCount}
                    <span className="text-xs font-sans font-normal text-muted ml-1">call{row.callCount !== 1 ? "s" : ""}</span>
                  </p>
                  {row.avgScore != null && (
                    <p className="text-xs text-muted mt-1">avg score <span className="font-mono text-charcoal">{row.avgScore}</span></p>
                  )}
                  {st && (
                    <span className={`inline-block mt-1.5 text-[10px] border px-2 py-0.5 ${st.cls}`}>
                      {st.label}
                    </span>
                  )}
                </div>

                {/* Last activity */}
                <div>
                  {row.lastCallDate && (
                    <>
                      <p className="text-xs text-charcoal">
                        {new Date(row.lastCallDate).toLocaleDateString()}
                      </p>
                      {row.lastCallType && (
                        <p className="text-xs text-muted mt-0.5 capitalize">
                          {row.lastCallType.replace(/_/g, " ")}
                        </p>
                      )}
                    </>
                  )}
                  {!row.lastCallDate && <p className="text-xs text-muted italic">—</p>}
                  {row.callCount > 0 && (
                    <Link
                      href={`/calls?client=${row.id}`}
                      className="text-[10px] text-brand hover:text-brand-dark mt-2 block tracking-wide transition-colors">
                      View calls →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
