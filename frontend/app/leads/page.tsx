"use client";
import { useEffect, useState } from "react";
import { api, Lead } from "@/lib/api";
import { Phone, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";

const STATUS_OPTIONS = ["new", "contacted", "converted", "lost"] as const;
const STATUS_LABEL: Record<string, string> = {
  new:       "New",
  contacted: "Contacted",
  converted: "Converted",
  lost:      "Lost",
};

function SourceBadge({ source }: { source: Lead["source"] }) {
  if (source === "call") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700">
        Call
      </span>
    );
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border border-green-200 bg-green-50 text-green-700">
      Home Value
    </span>
  );
}

export default function LeadsPage() {
  const { agentId } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    api.leads.list(agentId, sourceFilter || undefined, statusFilter || undefined)
      .then(setLeads);
  }, [agentId, sourceFilter, statusFilter]);

  async function handleStatusChange(id: string, status: string) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status: status as Lead["status"] } : l));
    try {
      await api.leads.update(id, { status });
    } catch {
      api.leads.list(agentId!, sourceFilter || undefined, statusFilter || undefined).then(setLeads);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Leads</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          {leads.length} lead{leads.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
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
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-warm-border">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-3 border-b border-warm-border">
          {["Name", "Source", "Contact", "Status", "Date"].map(h => (
            <p key={h} className="text-[10px] tracking-widest uppercase text-muted">{h}</p>
          ))}
        </div>

        <div className="divide-y divide-warm-border">
          {leads.length === 0 && (
            <p className="text-muted text-sm px-6 py-8 italic font-serif">
              No leads yet. Leads are created automatically from new callers and Home Value submissions.
            </p>
          )}

          {leads.map(lead => {
            const isExpanded = expandedId === lead.id;
            const hasPropertyDetail = lead.source === "home_value" && (lead.address || lead.estimated_value);
            return (
              <div key={lead.id}>
                <div
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-6 py-5 hover:bg-cream transition-colors items-start cursor-pointer"
                  onClick={() => hasPropertyDetail ? setExpandedId(isExpanded ? null : lead.id) : undefined}
                >
                  {/* Name */}
                  <div>
                    <p className="text-sm font-medium text-charcoal">{lead.name}</p>
                    {hasPropertyDetail && (
                      <p className="text-[10px] text-brand mt-1 tracking-wide">
                        {isExpanded ? "Hide details ↑" : "View details ↓"}
                      </p>
                    )}
                  </div>

                  {/* Source */}
                  <div>
                    <SourceBadge source={lead.source} />
                  </div>

                  {/* Contact */}
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

                  {/* Status */}
                  <div onClick={e => e.stopPropagation()}>
                    <select
                      value={lead.status}
                      onChange={e => handleStatusChange(lead.id, e.target.value)}
                      className="text-xs border border-warm-border bg-white px-2 py-1 focus:outline-none focus:border-brand transition-colors"
                    >
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  </div>

                  {/* Date */}
                  <div>
                    <p className="text-xs text-charcoal">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Expandable Home Value detail */}
                {isExpanded && hasPropertyDetail && (
                  <div className="px-6 pb-5 bg-cream border-t border-warm-border grid grid-cols-2 gap-4 pt-4">
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
                        <p className="text-sm font-medium text-charcoal">
                          ${lead.estimated_value.toLocaleString()}
                        </p>
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
