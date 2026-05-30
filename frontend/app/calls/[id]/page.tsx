"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, Call } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import CoachingReport from "@/components/CoachingReport";
import TranscriptViewer from "@/components/TranscriptViewer";
import AudioPlayer from "@/components/AudioPlayer";
import { useToast } from "@/components/Toast";
import Link from "next/link";
import { Loader2 } from "lucide-react";

const CALL_TYPE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  buyer_consultation: "Buyer Consult",
  seller_listing: "Seller Listing",
  followup: "Follow-Up",
  negotiation: "Negotiation",
  post_closing: "Post-Closing",
  unknown: "Unknown",
};

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : "#c0392b";
  const label = score >= 75 ? "Strong" : score >= 50 ? "Fair" : "Needs work";
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
  const [call, setCall] = useState<Call | null>(null);
  const [tab, setTab] = useState<"report" | "transcript">("report");
  const { toast } = useToast();

  useEffect(() => {
    api.calls.get(id).then(setCall);

    const channel = supabase
      .channel(`call-${id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "calls",
        filter: `id=eq.${id}`,
      }, (payload) => {
        const updated = payload.new as Call;
        setCall(updated);
        if (updated.status === "complete") toast("Call analysis complete ✓");
        if (updated.status === "error")    toast("Processing failed — check error message", "error");
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  if (!call) return (
    <div className="flex items-center gap-2 text-muted p-8">
      <Loader2 size={16} className="animate-spin" /> Loading…
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
      <div className="border-b border-warm-border pb-6 flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] tracking-widest uppercase text-muted mb-1">
            {CALL_TYPE_LABELS[call.call_type ?? ""] ?? "Unclassified call"}
          </p>
          {call.client_id ? (
            <Link href={`/clients?open=${call.client_id}`}>
              <h1 className="text-3xl font-serif font-bold text-charcoal leading-tight truncate hover:text-brand transition-colors">
                {call.clients?.name ?? "Unknown client"}
              </h1>
            </Link>
          ) : (
            <h1 className="text-3xl font-serif font-bold text-charcoal leading-tight truncate">
              {call.clients?.name ?? "Unknown client"}
            </h1>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
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
        {call.overall_score != null && <ScoreRing score={call.overall_score} />}
        {call.overall_score == null && isProcessing && (
          <div className="shrink-0 flex flex-col items-center gap-1">
            <Loader2 size={28} className="animate-spin text-brand" />
            <p className="text-[10px] uppercase tracking-widest text-muted">Analyzing</p>
          </div>
        )}
      </div>

      {call.audio_url && <AudioPlayer url={call.audio_url} />}

      {/* Processing state */}
      {isProcessing && (
        <div className="border border-warm-border bg-white px-5 py-4 flex items-center gap-3 text-sm text-muted">
          <Loader2 size={14} className="animate-spin text-brand" />
          {call.status === "transcribing" ? "Transcribing audio…"
            : call.status === "analyzing"  ? "Analyzing call against guidelines…"
            : "Uploading…"}
        </div>
      )}

      {/* Error state */}
      {call.status === "error" && (
        <div className="border-l-4 border-brand bg-brand/5 px-5 py-4 text-sm text-brand">
          <p className="font-semibold mb-1">Processing failed</p>
          <p className="text-brand/70">{(call as any).error_message}</p>
        </div>
      )}

      {/* Complete state */}
      {call.status === "complete" && (
        <>
          <div className="flex gap-0 border-b border-warm-border">
            {(["report", "transcript"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`pb-3 px-1 mr-6 text-sm transition-colors capitalize border-b-2 ${
                  tab === t
                    ? "border-charcoal text-charcoal font-medium"
                    : "border-transparent text-muted hover:text-charcoal"
                }`}>
                {t === "report" ? "Coaching Report" : "Transcript"}
              </button>
            ))}
          </div>
          {tab === "report"     && call.coaching_report && <CoachingReport report={call.coaching_report} />}
          {tab === "transcript" && call.transcript      && (
            <TranscriptViewer utterances={call.transcript.utterances} realtorSpeaker={call.realtor_speaker} />
          )}
        </>
      )}
    </div>
  );
}
