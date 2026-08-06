"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, Lead } from "@/lib/api";
import { Phone, Mail, PhoneCall, MessageSquare, AtSign, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { SECTION_LABELS } from "@/lib/industry";

const CONTACT_METHODS = [
  { value: "call",      label: "Phone Call",   icon: PhoneCall },
  { value: "text",      label: "Text Message", icon: MessageSquare },
  { value: "email",     label: "Email",        icon: AtSign },
  { value: "in_person", label: "In-Person",    icon: Users },
] as const;

const METHOD_LABEL: Record<string, string> = {
  call: "Phone Call", text: "Text", email: "Email", in_person: "In-Person",
};

function SourceBadge({ source }: { source: Lead["source"] }) {
  if (source === "call") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 whitespace-nowrap">
        Call
      </span>
    );
  }
  if (source === "assistant") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700 whitespace-nowrap">
        Assistant
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border border-green-200 bg-green-50 text-green-700 whitespace-nowrap">
      Home Value
    </span>
  );
}

function StatusBadge({ status, method }: { status: Lead["status"]; method?: string }) {
  if (status === "contacted") {
    return (
      <span className="text-xs px-2 py-0.5 border border-amber-200 bg-amber-50 text-amber-700 whitespace-nowrap">
        Contacted · {method ? METHOD_LABEL[method] : ""}
      </span>
    );
  }
  if (status === "converted") {
    return (
      <span className="text-xs px-2 py-0.5 border border-green-200 bg-green-50 text-green-700 whitespace-nowrap">
        Converted
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span className="text-xs px-2 py-0.5 border border-warm-border bg-white text-muted whitespace-nowrap">
        Lost
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 border border-brand/30 bg-brand-light text-brand whitespace-nowrap">
      New
    </span>
  );
}

function RespondPopover({ onSelect }: { onSelect: (method: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="text-xs px-3 py-1.5 bg-brand text-white hover:opacity-90 transition-opacity whitespace-nowrap"
      >
        Log Response
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-warm-border shadow-lg min-w-[160px]">
          <p className="text-[10px] tracking-widest uppercase text-muted px-3 pt-3 pb-1">How did you reach out?</p>
          {CONTACT_METHODS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={e => { e.stopPropagation(); onSelect(value); setOpen(false); }}
              className="flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm text-charcoal hover:bg-cream transition-colors"
            >
              <Icon size={13} className="text-muted shrink-0" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  const { agentId, role, industryMode } = useAuth();
  const labels = SECTION_LABELS[industryMode];
  const canManage = role === "admin" || role === "manager";
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [orgFilter, setOrgFilter]       = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isAdmin = role === "admin";

  // Leads arrive server-side via webhooks, so poll every 30s (on top of the
  // global focus-revalidate) to surface new leads without a manual refresh.
  // Managers/admins get all org leads (agent_id omitted); employees are scoped.
  const { data: leads = [], mutate: mutateLeads } = useSWR<Lead[]>(
    agentId ? ["leads", canManage ? "org" : agentId, sourceFilter, statusFilter, orgFilter] : null,
    () => api.leads.list(canManage ? undefined : agentId!, sourceFilter || undefined, statusFilter || undefined, orgFilter || undefined),
    { refreshInterval: 30_000 },
  );
  const { data: agents = [] } = useSWR(agentId && canManage ? ["agents-all"] : null, () => api.agents.list());
  const { data: orgs = [] } = useSWR(agentId && isAdmin ? ["orgs-all"] : null, () => api.organization.listAll());

  function patchLead(id: string, updates: Partial<Lead>) {
    mutateLeads(prev => (prev ?? []).map(l => l.id === id ? { ...l, ...updates } : l), false);
  }

  async function handleAssign(id: string, newAgentId: string) {
    patchLead(id, { agent_id: newAgentId || null });
    try {
      await api.leads.update(id, { agent_id: newAgentId || undefined });
    } catch {
      mutateLeads();
    }
  }

  async function handleRespond(id: string, method: string) {
    patchLead(id, { status: "contacted", contact_method: method as Lead["contact_method"], contacted_at: new Date().toISOString() });
    try {
      await api.leads.update(id, { contact_method: method });
    } catch {
      mutateLeads();
    }
  }

  async function handleStatusChange(id: string, status: string) {
    patchLead(id, { status: status as Lead["status"] });
    try {
      await api.leads.update(id, { status });
    } catch {
      mutateLeads();
    }
  }

  const newCount = leads.filter(l => l.status === "new").length;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">{labels.leads}</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          {leads.length} total · {newCount} awaiting response
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="text-sm border border-warm-border bg-white px-3 py-2 focus:outline-none focus:border-brand transition-colors"
        >
          <option value="">All sources</option>
          <option value="call">Call</option>
          <option value="home_value">Home Value</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-warm-border bg-white px-3 py-2 focus:outline-none focus:border-brand transition-colors"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="converted">Converted</option>
          <option value="lost">Lost</option>
        </select>
        {isAdmin && (
          <select
            value={orgFilter}
            onChange={e => setOrgFilter(e.target.value)}
            className="text-sm border border-warm-border bg-white px-3 py-2 focus:outline-none focus:border-brand transition-colors"
          >
            <option value="">All organizations</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-warm-border">
        {/* Column headers — desktop only; on mobile each lead stacks into a card */}
        <div className={`hidden md:grid ${canManage ? "md:grid-cols-[2fr_1fr_1.5fr_2fr_1.5fr]" : "md:grid-cols-[2fr_1fr_1.5fr_1.5fr]"} gap-4 px-6 py-3 border-b border-warm-border`}>
          {[
            "Lead", "Source", "Contact",
            ...(canManage ? ["Assigned Agent"] : []),
            "Action"
          ].map(h => (
            <p key={h} className="text-[10px] tracking-widest uppercase text-muted">{h}</p>
          ))}
        </div>

        <div className="divide-y divide-warm-border">
          {leads.length === 0 && (
            <p className="text-muted text-sm px-6 py-8 italic font-serif">
              {labels.leadsEmpty}
            </p>
          )}

          {leads.map(lead => {
            const assignedAgent = agents.find(a => a.id === lead.agent_id);
            const hasPropertyDetail = lead.source === "home_value" && (lead.address || lead.estimated_value);
            const isExpanded = expandedId === lead.id;
            const isResponded = lead.status === "contacted" || lead.status === "converted" || lead.status === "lost";

            return (
              <div key={lead.id} className={isResponded ? "opacity-70" : ""}>
                <div className={`grid grid-cols-1 ${canManage ? "md:grid-cols-[2fr_1fr_1.5fr_2fr_1.5fr]" : "md:grid-cols-[2fr_1fr_1.5fr_1.5fr]"} gap-3 md:gap-4 px-4 md:px-6 py-4 md:py-5 hover:bg-cream transition-colors md:items-center`}>

                  {/* Name + date + expand */}
                  <div>
                    <p className="text-sm font-medium text-charcoal">{lead.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </p>
                    {lead.job_description && (
                      <p className="text-xs text-muted mt-1 italic">{lead.job_description}</p>
                    )}
                    {lead.job_date && (
                      <p className="text-[10px] text-brand mt-1 tracking-wide">
                        Wanted {new Date(lead.job_date + "T00:00:00").toLocaleDateString()}
                      </p>
                    )}
                    {hasPropertyDetail && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                        className="text-[10px] text-brand mt-1 tracking-wide hover:opacity-75 transition-opacity"
                      >
                        {isExpanded ? "Hide details ↑" : "View property ↓"}
                      </button>
                    )}
                  </div>

                  {/* Source */}
                  <div><SourceBadge source={lead.source} /></div>

                  {/* Contact info */}
                  <div className="space-y-1.5">
                    {lead.phone && (
                      <p className="text-xs text-muted flex items-center gap-1.5">
                        <Phone size={11} /> {lead.phone}
                      </p>
                    )}
                    {lead.email && (
                      <p className="text-xs text-muted flex items-center gap-1.5">
                        <Mail size={11} /> {lead.email}
                      </p>
                    )}
                    {!lead.phone && !lead.email && (
                      <p className="text-xs text-muted italic">—</p>
                    )}
                  </div>

                  {/* Assign agent — managers/admins only */}
                  {canManage && (
                    <div onClick={e => e.stopPropagation()}>
                      <select
                        value={lead.agent_id ?? ""}
                        onChange={e => handleAssign(lead.id, e.target.value)}
                        className="text-xs border border-warm-border bg-white px-2 py-1.5 w-full focus:outline-none focus:border-brand transition-colors"
                      >
                        <option value="">Unassigned</option>
                        {agents.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      {assignedAgent && (
                        <p className="text-[10px] text-muted mt-1">{assignedAgent.email}</p>
                      )}
                    </div>
                  )}

                  {/* Action */}
                  <div className="flex flex-col gap-2 items-start" onClick={e => e.stopPropagation()}>
                    {!isResponded ? (
                      <RespondPopover onSelect={method => handleRespond(lead.id, method)} />
                    ) : (
                      <StatusBadge status={lead.status} method={lead.contact_method} />
                    )}
                    {/* Allow marking converted/lost after contacted */}
                    {lead.status === "contacted" && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleStatusChange(lead.id, "converted")}
                          className="text-[10px] text-green-700 border border-green-200 px-2 py-0.5 hover:bg-green-50 transition-colors"
                        >
                          Converted
                        </button>
                        <button
                          onClick={() => handleStatusChange(lead.id, "lost")}
                          className="text-[10px] text-muted border border-warm-border px-2 py-0.5 hover:bg-cream transition-colors"
                        >
                          Lost
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Expandable Home Value property detail */}
                {isExpanded && hasPropertyDetail && (
                  <div className="px-4 md:px-6 pb-5 bg-cream border-t border-warm-border grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 pt-4">
                    {lead.address && (
                      <div>
                        <p className="text-[10px] tracking-widest uppercase text-muted mb-1">Address</p>
                        <p className="text-sm text-charcoal">
                          {lead.address}{lead.city ? `, ${lead.city}` : ""}{lead.province ? `, ${lead.province}` : ""}
                        </p>
                      </div>
                    )}
                    {lead.property_type && (
                      <div>
                        <p className="text-[10px] tracking-widest uppercase text-muted mb-1">Property Type</p>
                        <p className="text-sm text-charcoal capitalize">{lead.property_type}</p>
                      </div>
                    )}
                    {lead.estimated_value != null && (
                      <div>
                        <p className="text-[10px] tracking-widest uppercase text-muted mb-1">Estimated Value</p>
                        <p className="text-sm font-medium text-charcoal">${lead.estimated_value.toLocaleString()}</p>
                      </div>
                    )}
                    {lead.timeline_to_sell && (
                      <div>
                        <p className="text-[10px] tracking-widest uppercase text-muted mb-1">Timeline to Sell</p>
                        <p className="text-sm text-charcoal">{lead.timeline_to_sell}</p>
                      </div>
                    )}
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
