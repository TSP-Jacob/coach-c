"use client";
import { useState } from "react";

interface Point { date: string; score: number; }
interface Props { data: Point[]; height?: number; }

function scoreColor(score: number) {
  if (score >= 75) return "#16a34a"; // green
  if (score >= 50) return "#d97706"; // amber
  return "#c0392b";                  // red (brand)
}

export default function ScoreTrend({ data, height = 120 }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length < 2) return (
    <p className="text-xs text-muted text-center py-6 italic font-serif">Not enough data yet — upload more calls to see your trend.</p>
  );

  const W = 600;
  const padL = 36;  // left axis
  const padR = 12;
  const padT = 20;
  const padB = 8;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;

  const scores = data.map(d => d.score);
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const yMin = Math.max(0,   Math.floor((rawMin - 10) / 10) * 10);
  const yMax = Math.min(100, Math.ceil((rawMax  + 10) / 10) * 10);
  const yRange = yMax - yMin || 1;

  const xOf = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const yOf = (s: number) => padT + (1 - (s - yMin) / yRange) * innerH;

  const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.score), score: d.score, date: d.date }));

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${padT + innerH} L ${padL} ${padT + innerH} Z`;

  // Y-axis grid lines
  const gridValues: number[] = [];
  for (let v = yMin; v <= yMax; v += 25) gridValues.push(v);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        style={{ overflow: "visible" }}
        onMouseLeave={() => setHovered(null)}>

        <defs>
          <linearGradient id="trendGrad2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c0392b" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#c0392b" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines + Y labels */}
        {gridValues.map(v => {
          const y = yOf(v);
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y}
                stroke="#e8e0d8" strokeWidth="1" strokeDasharray="3 3" />
              <text x={padL - 6} y={y + 4} textAnchor="end"
                className="fill-muted" style={{ fontSize: 9, fontFamily: "inherit" }}>
                {v}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#trendGrad2)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#c0392b" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots + hover targets */}
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHovered(i)} style={{ cursor: "default" }}>
            {/* invisible fat hit area */}
            <rect x={p.x - 16} y={padT} width={32} height={innerH} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={hovered === i ? 5 : 3.5}
              fill={scoreColor(p.score)}
              stroke="white" strokeWidth="1.5"
              style={{ transition: "r 0.1s" }} />
            {/* score label above dot */}
            {hovered === i && (
              <text x={p.x} y={p.y - 10} textAnchor="middle"
                style={{ fontSize: 10, fontWeight: 600, fontFamily: "inherit", fill: scoreColor(p.score) }}>
                {p.score}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hovered !== null && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-charcoal text-white text-[11px] rounded px-2.5 py-1.5 whitespace-nowrap shadow-lg">
            <span className="font-semibold" style={{ color: scoreColor(pts[hovered].score) }}>
              {pts[hovered].score}/100
            </span>
            <span className="text-white/60 ml-2">
              {new Date(pts[hovered].date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
