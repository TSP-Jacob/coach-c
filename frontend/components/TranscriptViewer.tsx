import { Utterance } from "@/lib/api";
import { clsx } from "clsx";

interface Props { utterances: Utterance[]; realtorSpeaker?: string | null; }

function ms(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function TranscriptViewer({ utterances, realtorSpeaker }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex gap-4 text-xs text-gray-400 pb-2 border-b border-gray-100">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand inline-block" /> Realtor</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Client</span>
      </div>
      {utterances.map((u, i) => {
        const isRealtor = u.speaker === realtorSpeaker;
        return (
          <div key={i} className={clsx("flex gap-3", isRealtor ? "flex-row" : "flex-row-reverse")}>
            <div className={clsx("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5", isRealtor ? "bg-brand text-white" : "bg-gray-200 text-gray-600")}>
              {isRealtor ? "R" : "C"}
            </div>
            <div className={clsx("max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed", isRealtor ? "bg-brand-light text-gray-800 rounded-tl-sm" : "bg-gray-100 text-gray-700 rounded-tr-sm")}>
              {u.text}
              <span className="block text-xs text-gray-400 mt-1">{ms(u.start_ms)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
