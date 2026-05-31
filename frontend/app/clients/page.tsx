"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, Call, Client, Agent, Consent } from "@/lib/api";
import Link from "next/link";
import { Phone, Mail, MapPin, Search, ChevronDown, ChevronUp, PhoneCall, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";

const TYPE_LABEL: Record<string, string> = {
  buyer:  "Buyer",
  seller: "Seller",
  both:   "Buyer & Seller",
};

const CLIENT_STATUSES = [
  "Lead",
  "Engaged",
  "Follow-Up Needed",
  "Negotiating",
  "Converted",
];

const CLIENT_STATUS_STYLE: Record<string, string> = {
  "Lead":             "text-blue-700 bg-blue-50 border-blue-200",
  "Engaged":          "text-green-700 bg-green-50 border-green-200",
  "Follow-Up Needed": "text-amber-700 bg-amber-50 border-amber-200",
  "Negotiating":      "text-purple-700 bg-purple-50 border-purple-200",
  "Converted":        "text-charcoal bg-cream border-warm-border",
};

const CALL_TYPE_LABEL: Record<string, string> = {
  prospecting:          "Prospecting",
  buyer_consultation:   "Buyer Consult",
  seller_listing:       "Seller Listing",
  followup:             "Follow-Up",
  negotiation:          "Negotiation",
  post_closing:         "Post-Closing",
  unknown:              "Call",
};

function scoreStyle(score: number) {
  if (score >= 80) return "text-green-700 border-green-200 bg-green-50";
  if (score >= 60) return "text-amber-600 border-amber-200 bg-amber-50";
  if (score >= 40) return "text-orange-600 border-orange-200 bg-orange-50";
  return "text-brand border-brand/20 bg-brand-light";
}

function formatDuration(secs?: number) {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m${s > 0 ? ` ${s}s` : ""}` : `${s}s`;
}

interface ClientRow extends Client {
  clientCalls: Call[];
  avgScore:    number | null;
}

export default function ClientsPage() {
  const { agentId: AGENT_ID } = useAuth();
  const searchParams = useSearchParams();
  const [clients,    setClients]    = useState<Client[]>([]);
  const [calls,      setCalls]      = useState<Call[]>([]);
  const [agents,     setAgents]     = useState<Agent[]>([]);
  const [search,     setSearch]     = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(searchParams.get("open"));
  const [consentsMap, setConsentsMap] = useState<Record<string, Consent[]>>({});

  useEffect(() => {
    if (!AGENT_ID) return;
    api.agents.listClients(AGENT_ID).then(setClients);
    api.calls.list(AGENT_ID).then(setCalls);
    api.agents.list().then(setAgents);
  }, [AGENT_ID]);

  // Load consents when a client row is expanded
  useEffect(() => {
    if (!expandedId || consentsMap[expandedId]) return;
    api.consents.list(expandedId).then(data => {
      setConsentsMap(prev => ({ ...prev, [expandedId]: data }));
    }).catch(() => {
      setConsentsMap(prev => ({ ...prev, [expandedId]: [] }));
    });
  }, [expandedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the auto-opened client row into view
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId) return;
    setExpandedId(openId);
    setTimeout(() => {
      document.getElementById(`client-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }, [searchParams]);

  const rows: ClientRow[] = useMemo(() => {
    return clients.map(client => {
      const clientCalls = calls
        .filter(c => c.client_id === client.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const completedCalls = clientCalls.filter(c => c.status === "complete" && c.overall_score != null);
      const avgScore = completedCalls.length
        ? Math.round(completedCalls.reduce((s, c) => s + c.overall_score!, 0) / completedCalls.length)
        : null;
      return { ...client, clientCalls, avgScore };
    });
  }, [clients, calls]);

  const filtered = useMemo(() =>
    rows.filter(r =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      (r.phone ?? "").includes(search) ||
      (r.email ?? "").toLowerCase().includes(search.toLowerCase())
    ), [rows, search]);

  async function handleStatusChange(clientId: string, newStatus: string) {
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, client_status: newStatus } : c));
    await api.agents.updateClient(clientId, { client_status: newStatus });
  }

  async function handleLocationSave(clientId: string, location: string) {
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, location } : c));
    await api.agents.updateClient(clientId, { location });
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Clients</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          {clients.length} profile{clients.length !== 1 ? "s" : ""}
        </p>
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

      {/* Table */}
      <div className="bg-white border border-warm-border">
        <div className="grid grid-cols-[2.5fr_1fr_1.5fr_1fr_0.5fr] gap-4 px-6 py-3 border-b border-warm-border">
          {["Client", "Status", "Contact", "Calls · Score", ""].map((h, i) => (
            <p key={i} className="text-[10px] tracking-widest uppercase text-muted">{h}</p>
          ))}
        </div>

        <div className="divide-y divide-warm-border">
          {filtered.length === 0 && (
            <p className="text-muted text-sm px-6 py-8 italic font-serif">
              {clients.length === 0
                ? "No clients yet. Clients are created automatically when calls are analyzed."
                : "No clients match your search."}
            </p>
          )}

          {filtered.map(row => {
            const isOpen = expandedId === row.id;
            const latestCall = row.clientCalls[0] ?? null;
            const latestSummary = latestCall?.coaching_report?.summary ?? null;
            const assignedAgent = agents.find(a => a.id === row.agent_id);
            const statusLabel = row.client_status || "Lead";
            const statusStyle = CLIENT_STATUS_STYLE[statusLabel] ?? "text-muted border-warm-border bg-white";

            return (
              <div key={row.id} id={`client-${row.id}`}>
                {/* Summary row — click to expand */}
                <div
                  onClick={() => setExpandedId(isOpen ? null : row.id)}
                  className="grid grid-cols-[2.5fr_1fr_1.5fr_1fr_0.5fr] gap-4 px-6 py-5 hover:bg-cream transition-colors items-center cursor-pointer select-none"
                >
                  {/* Name */}
                  <div>
                    <p className="text-sm font-medium text-charcoal">{row.name}</p>
                    {latestSummary && !isOpen && (
                      <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-1">{latestSummary}</p>
                    )}
                    {!latestSummary && row.clientCalls.length === 0 && (
                      <p className="text-xs text-muted mt-1 italic">No calls yet</p>
                    )}
                  </div>

                  {/* Client status badge */}
                  <div>
                    <span className={`text-xs px-2 py-0.5 border whitespace-nowrap ${statusStyle}`}>
                      {statusLabel}
                    </span>
                    <p className="text-xs text-muted mt-1.5">{TYPE_LABEL[row.type] ?? row.type}</p>
                  </div>

                  {/* Contact */}
                  <div className="space-y-1">
                    {row.phone && (
                      <p className="text-xs text-muted flex items-center gap-1.5">
                        <Phone size={11} /> {row.phone}
                      </p>
                    )}
                    {row.email && (
                      <p className="text-xs text-muted flex items-center gap-1.5 truncate">
                        <Mail size={11} /> {row.email}
                      </p>
                    )}
                    {!row.phone && !row.email && <p className="text-xs text-muted italic">—</p>}
                  </div>

                  {/* Calls + score */}
                  <div>
                    <p className="text-sm font-serif font-bold text-charcoal">
                      {row.clientCalls.length}
                      <span className="text-xs font-sans font-normal text-muted ml-1">
                        call{row.clientCalls.length !== 1 ? "s" : ""}
                      </span>
                    </p>
                    {row.avgScore != null && (
                      <p className="text-xs text-muted mt-0.5">
                        avg <span className="font-mono text-charcoal">{row.avgScore}</span>
                      </p>
                    )}
                  </div>

                  {/* Expand chevron */}
                  <div className="flex justify-end">
                    {isOpen
                      ? <ChevronUp size={15} className="text-muted" />
                      : <ChevronDown size={15} className="text-muted" />
                    }
                  </div>
                </div>

                {/* Expanded client file */}
                {isOpen && (
                  <div className="border-t border-warm-border bg-cream px-6 py-6 space-y-6">

                    {/* Top row: Agent + Status + Contact */}
                    <div className="grid grid-cols-3 gap-6">

                      {/* Agent + client status */}
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] tracking-widest uppercase text-muted mb-1.5">Assigned Agent</p>
                          {assignedAgent ? (
                            <Link
                              href={`/agents/${assignedAgent.id}`}
                              className="text-sm font-medium text-brand hover:opacity-75 transition-opacity"
                              onClick={e => e.stopPropagation()}
                            >
                              {assignedAgent.name} →
                            </Link>
                          ) : (
                            <p className="text-sm text-muted italic">Unassigned</p>
                          )}
                        </div>
                        <div onClick={e => e.stopPropagation()}>
                          <p className="text-[10px] tracking-widest uppercase text-muted mb-1.5">Client Status</p>
                          <select
                            value={row.client_status || "Lead"}
                            onChange={e => handleStatusChange(row.id, e.target.value)}
                            className="text-sm border border-warm-border bg-white px-2 py-1.5 focus:outline-none focus:border-brand transition-colors w-full"
                          >
                            {CLIENT_STATUSES.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Contact info */}
                      <div className="space-y-3">
                        <p className="text-[10px] tracking-widest uppercase text-muted">Contact Info</p>
                        {row.phone && (
                          <p className="text-sm text-charcoal flex items-center gap-2">
                            <Phone size={13} className="text-muted shrink-0" /> {row.phone}
                          </p>
                        )}
                        {row.email && (
                          <p className="text-sm text-charcoal flex items-center gap-2">
                            <Mail size={13} className="text-muted shrink-0" /> {row.email}
                          </p>
                        )}
                        <LocationField
                          value={row.location ?? ""}
                          onSave={loc => handleLocationSave(row.id, loc)}
                        />
                      </div>

                      {/* Latest summary */}
                      <div>
                        <p className="text-[10px] tracking-widest uppercase text-muted mb-1.5">Latest Summary</p>
                        {latestSummary ? (
                          <p className="text-sm text-charcoal leading-relaxed">{latestSummary}</p>
                        ) : (
                          <p className="text-sm text-muted italic">No call analysis yet.</p>
                        )}
                      </div>
                    </div>

                    {/* Consent badges */}
                    {(consentsMap[row.id]?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-[10px] tracking-widest uppercase text-muted mb-3">Consent</p>
                        <div className="flex flex-wrap gap-2">
                          {consentsMap[row.id].map(c => (
                            <ConsentBadge key={c.id} consent={c} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Communications list */}
                    <div>
                      <p className="text-[10px] tracking-widest uppercase text-muted mb-3">Communications</p>
                      {row.clientCalls.length === 0 ? (
                        <p className="text-sm text-muted italic">No recorded calls yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {row.clientCalls.map(call => (
                            <Link
                              key={call.id}
                              href={`/calls/${call.id}`}
                              onClick={e => e.stopPropagation()}
                              className="flex items-center justify-between px-4 py-3 bg-white border border-warm-border hover:border-brand/40 hover:bg-white transition-colors group"
                            >
                              <div className="flex items-center gap-3">
                                <PhoneCall size={13} className="text-muted shrink-0" />
                                <div>
                                  <p className="text-sm font-medium text-charcoal group-hover:text-brand transition-colors">
                                    {CALL_TYPE_LABEL[call.call_type ?? ""] ?? "Call"}
                                  </p>
                                  <p className="text-xs text-muted mt-0.5">
                                    {call.call_date
                                      ? new Date(call.call_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                      : new Date(call.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                    }
                                    {call.duration_seconds ? ` · ${formatDuration(call.duration_seconds)}` : ""}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {call.overall_score != null && (
                                  <span className={`text-xs font-mono border px-2 py-0.5 ${scoreStyle(call.overall_score)}`}>
                                    {call.overall_score}
                                  </span>
                                )}
                                <span className="text-muted text-xs group-hover:text-brand transition-colors">→</span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* Consent badge with hover tooltip */
function ConsentBadge({ consent }: { consent: Consent }) {
  const [hovered, setHovered] = useState(false);
  const ts = new Date(consent.created_at).toLocaleString("en-CA", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="relative inline-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Badge chip */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 cursor-default select-none">
        <ShieldCheck size={12} className="text-green-600 shrink-0" />
        <span className="text-xs text-green-700 font-medium">Consent</span>
        <span className="text-[10px] text-green-500 ml-1">{ts}</span>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-96 bg-white border border-warm-border shadow-lg p-4 space-y-3">
          <p className="text-[10px] tracking-widest uppercase text-muted">Consent Record</p>

          <div className="space-y-1">
            <p className="text-xs text-muted">Recorded: <span className="text-charcoal">{ts}</span></p>
            {consent.sent_to_email && (
              <p className="text-xs text-muted flex items-center gap-1">
                <Mail size={10} />
                Log sent to: <span className="text-charcoal ml-1">{consent.sent_to_email}</span>
              </p>
            )}
            {consent.owner_email && (
              <p className="text-xs text-muted flex items-center gap-1">
                <Mail size={10} />
                Homeowner email: <span className="text-charcoal ml-1">{consent.owner_email}</span>
              </p>
            )}
            {consent.owner_phone && (
              <p className="text-xs text-muted flex items-center gap-1">
                <Phone size={10} />
                Homeowner phone: <span className="text-charcoal ml-1">{consent.owner_phone}</span>
              </p>
            )}
          </div>

          <div>
            <p className="text-[10px] tracking-widest uppercase text-muted mb-1">Consent text shown to homeowner</p>
            <p className="text-xs text-charcoal leading-relaxed bg-cream border border-warm-border p-2.5 whitespace-pre-wrap">
              {consent.consent_text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* Inline editable location field */
function LocationField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(draft);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
        <MapPin size={13} className="text-muted shrink-0" />
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
          className="text-sm border border-brand px-2 py-0.5 focus:outline-none flex-1"
          placeholder="Add address…"
        />
      </div>
    );
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setEditing(true); setDraft(value); }}
      className="flex items-center gap-2 text-sm text-left w-full group"
    >
      <MapPin size={13} className="text-muted shrink-0" />
      {value
        ? <span className="text-charcoal group-hover:text-brand transition-colors">{value}</span>
        : <span className="text-muted italic group-hover:text-brand transition-colors">Add address…</span>
      }
    </button>
  );
}
