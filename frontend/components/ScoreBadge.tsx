import { clsx } from "clsx";
import { Loader2 } from "lucide-react";

interface Props { score?: number | null; status?: string; size?: "sm" | "lg"; }

export default function ScoreBadge({ score, status, size = "sm" }: Props) {
  const processing = status && ["uploaded", "transcribing", "analyzing"].includes(status);

  if (processing) return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <Loader2 size={11} className="animate-spin" />
      {status}
    </span>
  );

  if (score == null) return <span className="text-xs text-muted">—</span>;

  const color = score >= 80
    ? "text-green-700 bg-green-50 border-green-200"
    : score >= 60
    ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-brand bg-brand-light border-brand/20";

  const textSize = size === "lg"
    ? "text-3xl font-serif font-bold px-5 py-2.5"
    : "text-xs font-semibold px-2.5 py-1";

  return (
    <span className={clsx("border font-mono", color, textSize)}>
      {score}
    </span>
  );
}
