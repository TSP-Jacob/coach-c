"use client";
import { useState } from "react";
import { CoachingReport as Report } from "@/lib/api";
import { CheckCircle, ChevronDown, ChevronUp, Target } from "lucide-react";

interface Props { report: Report; }

function scoreColor(score: number) {
  if (score >= 7.5) return { bar: "bg-green-500",  text: "text-green-700",  label: "Strong" };
  if (score >= 5)   return { bar: "bg-amber-400",  text: "text-amber-700",  label: "Fair"   };
  return               { bar: "bg-brand",          text: "text-brand",      label: "Needs work" };
}

function ExpandableImprovement({ imp }: { imp: { principle: string; observation: string; suggestion: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(v => !v)}
      className="w-full text-left border-l-2 border-brand/30 pl-5 py-1 hover:border-brand transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest group-hover:text-charcoal transition-colors">
          {imp.principle.replace(/_/g, " ")}
        </p>
        {open
          ? <ChevronUp size={13} className="text-muted shrink-0 mt-0.5" />
          : <ChevronDown size={13} className="text-muted shrink-0 mt-0.5" />}
      </div>
      {!open && (
        <p className="text-sm text-charcoal leading-relaxed mt-1 line-clamp-1">{imp.observation}</p>
      )}
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-charcoal leading-relaxed">{imp.observation}</p>
          <p className="text-sm text-brand leading-relaxed font-medium">→ {imp.suggestion}</p>
        </div>
      )}
    </button>
  );
}

export default function CoachingReport({ report }: Props) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-white border border-warm-border p-6">
        <p className="text-[10px] tracking-widest uppercase text-muted mb-3">Call Summary</p>
        <p className="text-sm text-charcoal leading-relaxed">{report.summary}</p>
      </div>

      {/* Priority focus */}
      <div className="bg-amber-50 border-l-4 border-amber-500 px-6 py-5 flex gap-4">
        <Target size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] tracking-widest uppercase text-amber-700 mb-1">Priority Focus</p>
          <p className="text-sm text-amber-800 leading-relaxed">{report.priority_focus}</p>
        </div>
      </div>

      {/* Strengths */}
      {report.strengths.length > 0 && (
        <div className="bg-white border border-warm-border p-6">
          <p className="text-[10px] tracking-widest uppercase text-muted mb-4 flex items-center gap-2">
            <CheckCircle size={12} className="text-green-600" /> Strengths
          </p>
          <ul className="space-y-2.5">
            {report.strengths.map((s, i) => (
              <li key={i} className="text-sm text-charcoal leading-relaxed flex gap-3">
                <span className="text-green-500 mt-0.5 shrink-0">—</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Areas to improve — expandable */}
      {report.improvements.length > 0 && (
        <div className="bg-white border border-warm-border p-6">
          <p className="text-[10px] tracking-widest uppercase text-muted mb-5">
            Areas to Improve
            <span className="normal-case tracking-normal text-muted/60 ml-1">— click to expand</span>
          </p>
          <div className="space-y-4">
            {report.improvements.map((imp, i) => (
              <ExpandableImprovement key={i} imp={imp} />
            ))}
          </div>
        </div>
      )}

      {/* Principle scores — color-coded bars */}
      {Object.keys(report.principle_scores).length > 0 && (
        <div className="bg-white border border-warm-border p-6">
          <p className="text-[10px] tracking-widest uppercase text-muted mb-5">Principle Scores</p>
          <div className="space-y-5">
            {Object.entries(report.principle_scores)
              .sort(([, a], [, b]) => b.score - a.score)
              .map(([key, val]) => {
                const c = scoreColor(val.score);
                return (
                  <div key={key}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-sm text-charcoal capitalize">{key.replace(/_/g, " ")}</span>
                      <span className={`text-xs font-semibold font-mono ${c.text}`}>
                        {val.score}/10
                        <span className="text-muted font-normal ml-1.5 tracking-wide text-[10px] uppercase">{c.label}</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-warm-border overflow-hidden rounded-full">
                      <div
                        className={`h-full ${c.bar} rounded-full transition-all duration-500`}
                        style={{ width: `${val.score * 10}%` }}
                      />
                    </div>
                    {val.comment && (
                      <p className="text-xs text-muted mt-1.5 leading-relaxed">{val.comment}</p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
