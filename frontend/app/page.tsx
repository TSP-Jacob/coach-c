"use client";
import { useEffect, useState } from "react";
import { api, AgentStats, Call, CoachingInsights } from "@/lib/api";
import ScoreBadge from "@/components/ScoreBadge";
import ScoreTrend from "@/components/ScoreTrend";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { TrendingUp, TrendingDown, Minus, AlertCircle, Star } from "lucide-react";

const CALL_TYPE_LABELS: Record<string, string> = {
  prospecting: "Prospecting",
  buyer_consultation: "Buyer Consult",
  seller_listing: "Seller Listing",
  followup: "Follow-Up",
  negotiation: "Negotiation",
  post_closing: "Post-Closing",
  unknown: "Unknown",
};

function StatCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="bg-white border border-warm-border p-6">
      <p className="text-[10px] tracking-widest uppercase text-muted mb-3">{label}</p>
      <p className="text-4xl font-serif font-bold text-charcoal leading-none">{value}</p>
      {delta && <p className="text-xs text-muted mt-2">{delta}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { agentId: AGENT_ID } = useAuth();
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [insights, setInsights] = useState<CoachingInsights | null>(null);

  useEffect(() => {
    if (!AGENT_ID) return;
    api.agents.stats(AGENT_ID).then(setStats);
    api.calls.list(AGENT_ID).then(setCalls);
    api.calls.insights().then(setInsights).catch(() => {});
  }, []);

  const recentCalls = calls.slice(0, 8);

  const trendData = [...calls]
    .filter(c => c.overall_score != null && c.status === "complete")
    .sort((a, b) => new Date(a.call_date ?? a.created_at).getTime() - new Date(b.call_date ?? b.created_at).getTime())
    .slice(-20)
    .map(c => ({ date: c.call_date ?? c.created_at, score: c.overall_score! }));

  const thisWeek = calls.filter(c =>
    (Date.now() - new Date(c.created_at).getTime()) < 7 * 86_400_000
  ).length;

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
          {needsAttention > 0 && (
            <span className="italic text-brand">
              {needsAttention} call{needsAttention > 1 ? "s" : ""} need{needsAttention === 1 ? "s" : ""} your attention.
            </span>
          )}
        </h1>
        <p className="text-xs text-muted mt-2 tracking-widest uppercase">Coach-C · AI Sales Coach for Realtors</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-warm-border border border-warm-border">
        <StatCard label="Total Calls" value={String(stats?.total_calls ?? "—")} delta={thisWeek > 0 ? `${thisWeek} this week` : undefined} />
        <StatCard label="Avg Score"   value={stats?.average_score != null ? `${stats.average_score}` : "—"} delta="out of 100" />
        <StatCard label="Call Types"  value={String(Object.keys(stats?.by_type ?? {}).length)} delta="categories tracked" />
        <StatCard label="This Week"   value={String(thisWeek)} delta="calls recorded" />
      </div>

      {/* Coaching insights panel */}
      {insights && insights.total_complete > 0 && (
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
      {trendData.length >= 2 && (
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
                <ScoreBadge score={call.overall_score} status={call.status} />
                <span className="text-xs text-muted">{new Date(call.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
