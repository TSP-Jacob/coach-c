"use client";
import { useEffect, useState } from "react";
import { Mic, X, Minus } from "lucide-react";
import VoiceAssistant from "./VoiceAssistant";
import { clsx } from "clsx";
import { onOpenVoiceAssistant } from "@/lib/assistantBus";

export default function FloatingAssistant() {
  const [open,      setOpen]      = useState(false);
  const [minimised, setMinimised] = useState(false);
  // Remount the voice session each time the panel opens (fresh conversation).
  const [sessionKey, setSessionKey] = useState(0);

  const openPanel = () => {
    setOpen((v) => {
      const next = !v;
      if (next) setSessionKey((k) => k + 1);
      return next;
    });
    setMinimised(false);
  };

  // Let other pages (e.g. Tasks' "Create with Voice") open this panel.
  useEffect(() => onOpenVoiceAssistant(() => {
    setOpen(true);
    setMinimised(false);
    setSessionKey((k) => k + 1);
  }), []);

  return (
    <>
      {/* ── Floating panel ── */}
      {open && (
        <div className={clsx(
          "fixed bottom-20 right-6 z-50 w-[360px] bg-white border border-warm-border shadow-2xl rounded-lg flex flex-col transition-all duration-200",
          minimised ? "h-12" : "h-[520px]",
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm-border bg-cream shrink-0 rounded-t-lg">
            <div className="flex items-center gap-2">
              <Mic size={14} className="text-brand" />
              <span className="text-sm font-medium text-charcoal">Voice Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimised((v) => !v)}
                className="p-1 text-muted hover:text-charcoal transition-colors"
                title={minimised ? "Expand" : "Minimise"}
              >
                <Minus size={13} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-muted hover:text-charcoal transition-colors"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Body — voice-first assistant (only mounted while expanded so the
              mic is released when minimised). */}
          {!minimised && <VoiceAssistant key={sessionKey} compact />}
        </div>
      )}

      {/* ── Bubble trigger ── */}
      <button
        onClick={openPanel}
        className={clsx(
          "fixed bottom-6 right-6 z-50 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95",
          open ? "bg-charcoal text-white" : "bg-brand text-white",
        )}
        style={{ width: 52, height: 52 }}
        title="Open Voice Assistant"
      >
        {open ? <X size={20} /> : <Mic size={20} />}
      </button>
    </>
  );
}
