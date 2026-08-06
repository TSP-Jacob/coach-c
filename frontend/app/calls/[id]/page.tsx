"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, Agent, Call, Client } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import CoachingReport from "@/components/CoachingReport";
import TranscriptViewer from "@/components/TranscriptViewer";
import AudioPlayer from "@/components/AudioPlayer";
import { useToast } from "@/components/Toast";
import Link from "next/link";
import { Loader2, PhoneIncoming, PhoneOutgoing } from "lucide-react";

const CALL_TYPE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  buyer_consultation: "Buyer Consult",
  seller_listing: "Seller Listing",
  followup: "Follow-Up",
  negotiation: "Negotiation",
  post_closing: "Post-Closing",
  unknown: "Unknown",
};

const CLIENT_STATUSES = ["Lead", "Engaged", "Follow-Up Needed", "Negotiating", "Converted"];

function ScoreRing({ score }: { score: number }) {
  const { t } = useAuth();
  const r = 28;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : "#c0392b";
  const label = t(score >= 75 ? "Strong" : score >= 50 ? "Fair" : "Needs work");
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#e8e0d8" strokeWidth="6" />
        <circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)" />
        <text x="36" y="39" textAnchor="middle"
          style={{ fontSize: 14, fontWeight: 700, fill: color, fontFamily: "inherit" }}>
          {score}
        </text>
      </svg>
      <p className="text-[10px] uppercase tracking-widest" style={{ color }}>{label}</p>
    </div>
  );
}

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { features, t } = useAuth();
  const [call,    setCall]    = useState<Call | null>(null);
  const [client,  setClient]  = useState<Client | null>(null);
  const [agents,  setAgents]  = useState<Agent[]>([]);
  const [tab,     setTab]     = useState<"report" | "transcript">("report");
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setLoadError(null);
    api.calls.get(id)
      .then(c => {
        setCall(c);
        if (c.client_id) api.agents.getClient(c.client_id).then(setClient).catch(() => {});
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : "Failed to load this call."));
    api.agents.list().then(setAgents).catch(() => {});

    const channel = supabase
      .channel(`call-${id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as Call;
        setCall(updated);
        if (updated.status === "complete") toast(t("Call analysis complete ✓"));
        if (updated.status === "error")    toast(t("Processing failed — check error message"), "error");
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  async function handleClientStatusChange(status: string) {
    if (!client) return;
    setClient(prev => prev ? { ...prev, client_status: status } : prev);
    await api.agents.updateClient(client.id, { client_status: status });
    toast(t("Status updated"));
  }

  async function handleAgentChange(agentId: string) {
    if (!client) return;
    setClient(prev => prev ? { ...prev, agent_id: agentId } : prev);
    await api.agents.updateClient(client.id, { agent_id: agentId });
    toast(t("Agent assigned"));
  }

  if (loadError) return (
    <div className="border-l-4 border-brand bg-brand/5 px-5 py-4 text-sm text-brand max-w-lg">
      <p className="font-semibold mb-1">{t("Couldn't load this call")}</p>
      <p className="text-brand/70">{loadError}</p>
    </div>
  );

  if (!call) return (
    <div className="flex items-center gap-2 text-muted p-8">
      <Loader2 size={16} className="animate-spin" /> {t("Loading…")}
    </div>
  );

  const isProcessing = ["uploaded", "transcribing", "analyzing"].includes(call.status);
  const dateStr = call.call_date ?? call.created_at;
  const dateFormatted = new Date(dateStr).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const timeFormatted = call.call_date
    ? new Date(call.call_date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-widest uppercase text-muted mb-1">
              {t(CALL_TYPE_LABELS[call.call_type ?? ""] ?? "Unclassified call")}
            </p>
            {call.client_id ? (
              <Link href={`/clients?open=${call.client_id}`}>
                <h1 className="text-3xl font-serif font-bold text-charcoal leading-tight truncate hover:text-brand transition-colors">
                  {call.clients?.name ?? t("Unknown client")}
                </h1>
              </Link>
            ) : (
              <h1 className="text-3xl font-serif font-bold text-charcoal leading-tight truncate">
                {call.clients?.name ?? t("Unknown client")}
              </h1>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {call.direction === "inbound" && (
                <p className="text-xs text-muted flex items-center gap-1"><PhoneIncoming size={12} /> {t("Inbound")}</p>
              )}
              {call.direction === "outbound" && (
                <p className="text-xs text-muted flex items-center gap-1"><PhoneOutgoing size={12} /> {t("Outbound")}</p>
              )}
              <p className="text-xs text-muted">{dateFormatted}{timeFormatted ? ` · ${timeFormatted}` : ""}</p>
              {call.duration_seconds && (
                <p className="text-xs text-muted">
                  {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s
                </p>
              )}
              {call.agents?.name && (
                <Link href={`/agents/${call.agent_id}`} className="text-xs text-muted hover:text-brand transition-colors">
                  {call.agents.name} →
                </Link>
              )}
            </div>
          </div>
          {features.call_coaching && call.overall_score != null && <ScoreRing score={call.overall_score} />}
          {features.call_coaching && call.overall_score == null && isProcessing && (
            <div className="shrink-0 flex flex-col items-center gap-1">
              <Loader2 size={28} className="animate-spin text-brand" />
              <p className="text-[10px] uppercase tracking-widest text-muted">{t("Analyzing")}</p>
            </div>
          )}
        </div>

        {/* Client status + agent dropdowns — shown when a client is linked */}
        {client && (
          <div className="flex flex-wrap gap-3 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-widest uppercase text-muted">{t("Status")}</span>
              <select
                value={client.client_status || "Lead"}
                onChange={e => handleClientStatusChange(e.target.value)}
                className="text-xs border border-warm-border bg-white px-2 py-1.5 focus:outline-none focus:border-brand transition-colors"
              >
                {CLIENT_STATUSES.map(s => <option key={s} value={s}>{t(s)}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-widest uppercase text-muted">{t("Agent")}</span>
              <select
                value={client.agent_id ?? ""}
                onChange={e => handleAgentChange(e.target.value)}
                className="text-xs border border-warm-border bg-white px-2 py-1.5 focus:outline-none focus:border-brand transition-colors"
              >
                <option value="">{t("Unassigned")}</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {call.audio_url && <AudioPlayer url={call.audio_url} />}

      {call.status === "missed" && (
        <div className="border border-warm-border bg-white px-5 py-4 text-sm text-muted">
          {call.direction === "inbound"
            ? t("This call rang and was never answered — nothing was recorded.")
            : t("This call was placed but never picked up — nothing was recorded.")}
        </div>
      )}

      {isProcessing && (
        <div className="border border-warm-border bg-white px-5 py-4 flex items-center gap-3 text-sm text-muted">
          <Loader2 size={14} className="animate-spin text-brand" />
          {call.status === "transcribing" ? t("Transcribing audio…")
            : call.status === "analyzing"  ? t("Analyzing call against guidelines…")
            : t("Uploading…")}
        </div>
      )}

      {call.status === "error" && (
        <div className="border-l-4 border-brand bg-brand/5 px-5 py-4 text-sm text-brand">
          <p className="font-semibold mb-1">{t("Processing failed")}</p>
          <p className="text-brand/70">{(call as any).error_message}</p>
        </div>
      )}

      {call.status === "complete" && call.coaching_report?.summary && (
        <div className="bg-white border border-warm-border px-5 py-4">
          <p className="text-[10px] tracking-widest uppercase text-muted mb-2">{t("Call Summary")}</p>
          <p className="text-sm text-charcoal leading-relaxed">{call.coaching_report.summary}</p>
        </div>
      )}

      {call.status === "complete" && (
        features.call_coaching ? (
          <>
            <div className="flex gap-0 border-b border-warm-border">
              {(["report", "transcript"] as const).map(tabKey => (
                <button key={tabKey} onClick={() => setTab(tabKey)}
                  className={`pb-3 px-1 mr-6 text-sm transition-colors capitalize border-b-2 ${
                    tab === tabKey
                      ? "border-charcoal text-charcoal font-medium"
                      : "border-transparent text-muted hover:text-charcoal"
                  }`}>
                  {tabKey === "report" ? t("Coaching Report") : t("Transcript")}
                </button>
              ))}
            </div>
            {tab === "report"     && call.coaching_report && <CoachingReport report={call.coaching_report} />}
            {tab === "transcript" && call.transcript      && (
              <TranscriptViewer utterances={call.transcript.utterances} realtorSpeaker={call.realtor_speaker} />
            )}
          </>
        ) : (
          // Coaching disabled for this user — show the transcript only.
          call.transcript && (
            <TranscriptViewer utterances={call.transcript.utterances} realtorSpeaker={call.realtor_speaker} />
          )
        )
      )}
    </div>
  );
}
