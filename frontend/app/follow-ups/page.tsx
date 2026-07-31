"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { api, Client } from "@/lib/api";
import { Phone, Mail, CalendarClock, Check, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth";

/** Parse a YYYY-MM-DD string as a local calendar date (avoids UTC day-shift). */
function parseDateOnly(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay()); // back up to Sunday
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtRange(start: Date): string {
  const end = addDays(start, 6);
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

type Group = { key: string; label: string; sub?: string; clients: Client[] };

export default function FollowUpsPage() {
  const { agentId, role } = useAuth();
  const canManage = role === "admin" || role === "manager";
  const { data: clients = [], mutate } = useSWR<Client[]>(
    agentId ? ["follow-ups", canManage ? "org" : agentId] : null,
    () => api.followUps.list(canManage ? undefined : agentId!),
    { refreshInterval: 30_000 },
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState("");

  function patch(id: string, updates: Partial<Client>) {
    mutate(prev => (prev ?? []).map(c => c.id === id ? { ...c, ...updates } : c), false);
  }

  function remove(id: string) {
    mutate(prev => (prev ?? []).filter(c => c.id !== id), false);
  }

  async function handleComplete(id: string) {
    remove(id);
    try {
      await api.followUps.complete(id);
    } catch {
      mutate();
    }
  }

  async function handleReschedule(id: string, date: string) {
    if (!date) return;
    patch(id, { follow_up_date: date });
    setEditingId(null);
    try {
      await api.followUps.set(id, date);
    } catch {
      mutate();
    }
  }

  const groups: Group[] = useMemo(() => {
    const today = new Date();
    const thisWeekStart = startOfWeek(today);
    const nextWeekStart = addDays(thisWeekStart, 7);
    const afterNextStart = addDays(thisWeekStart, 14);

    const overdue: Client[] = [];
    const thisWeek: Client[] = [];
    const nextWeek: Client[] = [];
    const later: Client[] = [];

    for (const c of clients) {
      if (!c.follow_up_date) continue;
      const d = parseDateOnly(c.follow_up_date);
      if (d < thisWeekStart) overdue.push(c);
      else if (d < nextWeekStart) thisWeek.push(c);
      else if (d < afterNextStart) nextWeek.push(c);
      else later.push(c);
    }

    const byDate = (a: Client, b: Client) => a.follow_up_date!.localeCompare(b.follow_up_date!);
    [overdue, thisWeek, nextWeek, later].forEach(g => g.sort(byDate));

    const out: Group[] = [];
    if (overdue.length)  out.push({ key: "overdue",   label: "Overdue",   clients: overdue });
    if (thisWeek.length) out.push({ key: "this_week", label: "This Week", sub: fmtRange(thisWeekStart), clients: thisWeek });
    if (nextWeek.length) out.push({ key: "next_week", label: "Next Week", sub: fmtRange(nextWeekStart), clients: nextWeek });
    if (later.length)    out.push({ key: "later",     label: "Later",     clients: later });
    return out;
  }, [clients]);

  const total = clients.filter(c => c.follow_up_date).length;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Follow-Ups</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          {total} scheduled
        </p>
      </div>

      {groups.length === 0 && (
        <div className="bg-white border border-warm-border px-6 py-8">
          <p className="text-muted text-sm italic font-serif">
            No follow-ups scheduled. Set a follow-up date from a client&apos;s profile in Clients, or ask the assistant to schedule one.
          </p>
        </div>
      )}

      {groups.map(group => (
        <div key={group.key} className="space-y-3">
          <div className="flex items-baseline gap-2">
            <h2 className={`text-xs tracking-widest uppercase ${group.key === "overdue" ? "text-brand" : "text-muted"}`}>
              {group.label}
            </h2>
            {group.sub && <span className="text-[10px] text-muted">{group.sub}</span>}
            <span className="text-[10px] text-muted">· {group.clients.length}</span>
          </div>

          <div className="bg-white border border-warm-border divide-y divide-warm-border">
            {group.clients.map(c => {
              const isOverdue = group.key === "overdue";
              const isEditing = editingId === c.id;
              return (
                <div key={c.id} className="grid grid-cols-1 md:grid-cols-[2fr_1.5fr_1fr_auto] gap-3 md:gap-4 px-4 md:px-6 py-4 md:items-center">
                  {/* Client */}
                  <div>
                    <Link href={`/clients?open=${c.id}`} className="text-sm font-medium text-charcoal hover:text-brand transition-colors">
                      {c.name}
                    </Link>
                    {c.follow_up_note && (
                      <p className="text-xs text-muted mt-1 leading-relaxed line-clamp-2">{c.follow_up_note}</p>
                    )}
                  </div>

                  {/* Contact */}
                  <div className="space-y-1">
                    {c.phone && (
                      <p className="text-xs text-muted flex items-center gap-1.5">
                        <Phone size={11} /> {c.phone}
                      </p>
                    )}
                    {c.email && (
                      <p className="text-xs text-muted flex items-center gap-1.5 truncate">
                        <Mail size={11} /> {c.email}
                      </p>
                    )}
                    {!c.phone && !c.email && <p className="text-xs text-muted italic">—</p>}
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1.5">
                    <CalendarClock size={13} className={isOverdue ? "text-brand" : "text-muted"} />
                    <span className={`text-sm ${isOverdue ? "text-brand font-medium" : "text-charcoal"}`}>
                      {c.follow_up_date ? fmtDate(parseDateOnly(c.follow_up_date)) : "—"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 justify-start md:justify-end">
                    {isEditing ? (
                      <input
                        type="date"
                        autoFocus
                        value={draftDate}
                        onChange={e => setDraftDate(e.target.value)}
                        onBlur={() => handleReschedule(c.id, draftDate)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleReschedule(c.id, draftDate);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="text-xs border border-brand px-2 py-1.5 focus:outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => { setEditingId(c.id); setDraftDate(c.follow_up_date ?? ""); }}
                        className="text-xs px-2.5 py-1.5 border border-warm-border text-muted hover:text-charcoal hover:bg-cream transition-colors flex items-center gap-1.5"
                      >
                        <Pencil size={11} /> Reschedule
                      </button>
                    )}
                    <button
                      onClick={() => handleComplete(c.id)}
                      className="text-xs px-2.5 py-1.5 bg-brand text-white hover:opacity-90 transition-opacity flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Check size={11} /> Mark Complete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
