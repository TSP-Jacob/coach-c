import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex items-center justify-center h-full gap-2 text-gray-400">
      <Loader2 size={20} className="animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
