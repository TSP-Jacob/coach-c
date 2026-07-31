"use client";
import useSWR from "swr";
import { api, Call } from "@/lib/api";
import { pollWhileProcessing } from "@/lib/swr";
import ScoreBadge from "@/components/ScoreBadge";
import ScoreTrend from "@/components/ScoreTrend";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { TrendingUp, TrendingDown, Minus, AlertCircle, Star, Sparkles } from "lucide-react";

const CALL_TYPE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  buyer_consultation: "Buyer Consult",
  seller_listing: "Seller Listing",
  followup: "Follow-Up",
  negotiation: "Negotiation",
  post_closing: "Post-Closing",
  unknown: "Unknown",
};

// Literal class names (not interpolated) so Tailwind's content scanner picks them up.
const STATS_GRID_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

function StatCard({ label, value, delta, href }: { label: string; value: string; delta?: string; href?: string }) {
  const content = (
    <>
      <p className="text-[10px] tracking-widest uppercase text-muted mb-3">{label}</p>
      <p className="text-4xl font-serif font-bold text-charcoal leading-none">{value}</p>
      {delta && <p className="text-xs text-muted mt-2">{delta}</p>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="bg-white border border-warm-border p-6 block hover:bg-cream transition-colors">
        {content}
      </Link>
    );
  }
  return <div className="bg-white border border-warm-border p-6">{content}</div>;
}

function OverviewCard({ text, loading }: { text?: string; loading: boolean }) {
  return (
    <div className="bg-white border border-warm-border p-6 flex flex-col justify-center">
      <div className="flex items-center gap-1.5 mb-3">
        <Sparkles size={11} className="text-brand" />
        <p className="text-[10px] tracking-widest uppercase text-muted">AI Overview</p>
      </div>
      {loading
        ? <p className="text-sm text-muted italic">Thinking…</p>
        : <p className="text-sm text-charcoal leading-relaxed">{text}</p>
      }
    </div>
  );
}

export default function Dashboard() {
  const { agentId: AGENT_ID, features } = useAuth();
  const coaching = features.call_coaching;
  const showLeads = features.leads !== false;
  const showFollowUps = features.follow_ups !== false;
  // Cached via SWR — revisiting the dashboard shows data instantly, then revalidates.
  const { data: calls = [] } = useSWR<Call[]>(
    AGENT_ID ? ["calls", AGENT_ID] : null,
    () => api.calls.list(AGENT_ID!),
    { refreshInterval: pollWhileProcessing },
  );
  // While a call is still being analyzed server-side, keep the derived stats
  // and insights live too (they change when a call completes).
  const busy = pollWhileProcessing(calls) > 0;
  const { data: insights = null } = useSWR(AGENT_ID ? ["insights", AGENT_ID] : null, () => api.calls.insights().catch(() => null), { refreshInterval: busy ? 5000 : 0 });
  const { data: overview } = useSWR(
    AGENT_ID ? ["dashboard-overview", AGENT_ID] : null,
    () => api.dashboard.overview(),
    { refreshInterval: 5 * 60_000 },
  );

  const recentCalls = calls.slice(0, 8);

  const trendData = [...calls]
    .filter(c => c.overall_score != null && c.status === "complete")
    .sort((a, b) => new Date(a.call_date ?? a.created_at).getTime() - new Date(b.call_date ?? b.created_at).getTime())
    .slice(-20)
    .map(c => ({ date: c.call_date ?? c.created_at, score: c.overall_score! }));

  const needsAttention = calls.filter(
    c => c.status === "complete" && c.overall_score != null && c.overall_score < 70
  ).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="border-b border-warm-border pb-6">
        <h1 className="text-4xl font-serif font-bold text-charcoal leading-tight">
          {greeting}.{" "}
          {coaching && needsAttention > 0 && (
            <span className="italic text-brand">
              {needsAttention} call{needsAttention > 1 ? "s" : ""} need{needsAttention === 1 ? "s" : ""} your attention.
            </span>
          )}
        </h1>
        <p className="text-xs text-muted mt-2 tracking-widest uppercase">Coach-C · AI Sales Coach for Realtors</p>
      </div>

      {/* Stats grid */}
      <div className={`grid grid-cols-2 ${STATS_GRID_COLS[1 + (showLeads ? 1 : 0) + (showFollowUps ? 1 : 0)]} gap-px bg-warm-border border border-warm-border`}>
        {showLeads && (
          <StatCard
            label="New Leads"
            value={overview ? String(overview.new_leads_count) : "—"}
            delta="awaiting response"
            href="/leads"
          />
        )}
        {showFollowUps && (
          <StatCard
            label="Follow Ups"
            value={overview ? String(overview.follow_ups_count) : "—"}
            delta={overview && overview.overdue_follow_ups_count > 0 ? `${overview.overdue_follow_ups_count} overdue` : "scheduled"}
            href="/follow-ups"
          />
        )}
        <OverviewCard text={overview?.overview} loading={!overview} />
      </div>

      {/* Coaching insights panel */}
      {coaching && insights && insights.total_complete > 0 && (
        <div className="bg-white border border-warm-border p-6">
          <p className="text-[10px] tracking-widest uppercase text-muted mb-4">Coaching Insights</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            {/* Needs review */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted">
                <AlertCircle size={13} className={insights.needs_review_count > 0 ? "text-brand" : "text-muted"} />
                <span className="text-[10px] tracking-widest uppercase">Needs Review</span>
              </div>
              {insights.needs_review_count > 0 ? (
                <Link href="/calls" className="text-sm font-medium text-brand hover:opacity-75 transition-opacity">
                  {insights.needs_review_count} call{insights.needs_review_count > 1 ? "s" : ""} scored below 70
                </Link>
              ) : (
                <p className="text-sm text-charcoal">All clear ✓</p>
              )}
            </div>

            {/* Recent trend */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted">
                {insights.recent_trend === "up"
                  ? <TrendingUp size={13} className="text-green-600" />
                  : insights.recent_trend === "down"
                  ? <TrendingDown size={13} className="text-brand" />
                  : <Minus size={13} />}
                <span className="text-[10px] tracking-widest uppercase">Recent Trend</span>
              </div>
              <p className={`text-sm font-medium ${
                insights.recent_trend === "up" ? "text-green-700" :
                insights.recent_trend === "down" ? "text-brand" : "text-charcoal"
              }`}>
                {insights.recent_trend === "up" ? "Improving" :
                 insights.recent_trend === "down" ? "Declining" : "Steady"}
              </p>
            </div>

            {/* Top strength */}
            {insights.top_strength && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-muted">
                  <Star size={13} className="text-amber-500" />
                  <span className="text-[10px] tracking-widest uppercase">Top Strength</span>
                </div>
                <p className="text-sm text-charcoal font-medium">{insights.top_strength}</p>
              </div>
            )}

            {/* Top improvement area */}
            {insights.top_improvement && insights.top_improvement !== insights.top_strength && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-muted">
                  <TrendingUp size={13} />
                  <span className="text-[10px] tracking-widest uppercase">Focus Area</span>
                </div>
                <p className="text-sm text-charcoal font-medium">{insights.top_improvement}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Score trend */}
      {coaching && trendData.length >= 2 && (
        <div className="bg-white border border-warm-border p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-[10px] tracking-widest uppercase text-muted">Score Trend</p>
            <span className="text-xs text-muted">Last {trendData.length} calls</span>
          </div>
          <ScoreTrend data={trendData} height={120} />
          <div className="flex justify-between text-xs text-muted mt-2">
            <span>{new Date(trendData[0].date).toLocaleDateString()}</span>
            <span>{new Date(trendData[trendData.length - 1].date).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      {/* Recent calls */}
      <div className="bg-white border border-warm-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-warm-border">
          <p className="text-[10px] tracking-widest uppercase text-muted">Recent Calls</p>
          <Link href="/calls" className="text-xs text-brand hover:text-brand-dark transition-colors">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-warm-border">
          {recentCalls.length === 0 && (
            <p className="text-muted text-sm px-6 py-8 italic font-serif">
              No calls yet. Upload your first recording to get started.
            </p>
          )}
          {recentCalls.map(call => (
            <Link key={call.id} href={`/calls/${call.id}`}
              className="flex items-center justify-between px-6 py-4 hover:bg-cream transition-colors">
              <div>
                <p className="text-sm font-medium text-charcoal">{call.clients?.name ?? "Unknown client"}</p>
                <p className="text-xs text-muted mt-0.5">
                  {CALL_TYPE_LABELS[call.call_type ?? ""] ?? "Unclassified"} ·{" "}
                  {call.duration_seconds ? `${Math.round(call.duration_seconds / 60)} min` : "—"}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {coaching && <ScoreBadge score={call.overall_score} status={call.status} />}
                <span className="text-xs text-muted">{new Date(call.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
