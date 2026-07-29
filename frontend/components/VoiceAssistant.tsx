"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getAuthToken, wsBase } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { VoiceSession, VoiceState, TranscriptEntry } from "@/lib/voiceClient";
import { Mic, MicOff, Keyboard, Send, RotateCcw, Loader2, AudioLines, AlertCircle } from "lucide-react";
import { clsx } from "clsx";

const STATUS: Record<VoiceState, string> = {
  idle: "Starting…",
  connecting: "Connecting…",
  listening: "Listening — just start talking",
  speaking: "Speaking…",
  error: "Something went wrong",
  closed: "Conversation ended",
};

export default function VoiceAssistant({ compact = false }: { compact?: boolean }) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [state, setState]     = useState<VoiceState>("idle");
  const [level, setLevel]     = useState(0);
  const [muted, setMuted]     = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [text, setText]       = useState("");

  const { agentId } = useAuth();
  const sessionRef = useRef<VoiceSession | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);

  const connect = useCallback(async (history: TranscriptEntry[] = []) => {
    setError(null);
    const token = await getAuthToken();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const url = `${wsBase()}/api/voice/live?tz=${encodeURIComponent(tz)}`;
    const s = new VoiceSession(url, token, {
      onState: setState,
      onTranscript: setEntries,
      onLevel: setLevel,
      onError: (m) => setError(m),
    }, history);
    sessionRef.current = s;
    await s.start();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Seed the view with recent history so the user sees what was discussed last.
      let history: TranscriptEntry[] = [];
      if (agentId) {
        try {
          const rows = await api.chat.history(agentId);
          history = rows.map((m) => ({ role: m.role, text: m.content }));
        } catch { /* start empty if history can't be loaded */ }
      }
      if (cancelled) return;
      setEntries(history);
      await connect(history);
    })();
    return () => { cancelled = true; sessionRef.current?.stop(); sessionRef.current = null; };
  }, [agentId, connect]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [entries]);

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    sessionRef.current?.setMuted(m);
  };

  const restart = async () => {
    try { sessionRef.current?.stop(); } catch { /* already torn down */ }
    sessionRef.current = null;
    setEntries([]);
    setMuted(false);
    setError(null);
    setState("idle");
    try {
      await connect();
    } catch {
      // Don't leave the user stuck on a dead panel — surface a recovery path.
      setError("Couldn't restart the session. Please reload the page and try again.");
      setState("error");
    }
  };

  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    sessionRef.current?.resume();
    sessionRef.current?.sendText(t);
    setText("");
  };

  const active = state === "listening" || state === "speaking";
  const dead   = state === "closed" || state === "error";

  return (
    <div className="flex flex-col h-full min-h-0" onPointerDown={() => sessionRef.current?.resume()}>
      {/* ── Transcript ── */}
      <div className={clsx("flex-1 overflow-y-auto min-h-0", compact ? "px-4 py-3 space-y-3" : "px-1 py-4 space-y-4")}>
        {entries.length === 0 && !error && (
          <div className={clsx("text-center text-muted mt-8 space-y-2", compact ? "text-xs" : "text-sm")}>
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center">
                <AudioLines className="text-brand" size={compact ? 22 : 28} />
              </div>
            </div>
            <p className="font-medium text-charcoal">Talk to your assistant</p>
            <p>Ask things like “What did I offer the Tremblays?” or “Which client did I speak with around June 3rd?” — I’ll pull it from your records.</p>
          </div>
        )}

        {entries.map((m, i) => (
          <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={clsx(
              "max-w-[85%] px-3 py-2 leading-relaxed whitespace-pre-wrap",
              compact ? "text-xs" : "text-sm",
              m.role === "user"
                ? "bg-brand text-white rounded-2xl rounded-br-sm"
                : "bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm",
            )}>
              {m.text || <span className="opacity-40">…</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-3 mb-2 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Status + level ── */}
      <div className="px-4 pt-1 flex items-center gap-2 justify-center text-[11px] text-muted">
        {state === "connecting" || state === "idle" ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <span className={clsx("w-2 h-2 rounded-full", active ? "bg-green-500" : "bg-gray-300")} />
        )}
        <span>{muted ? "Muted" : STATUS[state]}</span>
      </div>

      {/* ── Mic level meter ── */}
      <div className="px-6 py-2 flex items-center justify-center gap-[3px] h-8">
        {Array.from({ length: 9 }).map((_, i) => {
          const center = Math.abs(i - 4);
          const threshold = center / 5;
          const on = !muted && active && level > threshold;
          return (
            <span
              key={i}
              className={clsx(
                "w-1 rounded-full transition-all duration-100",
                on ? "bg-brand" : "bg-gray-200",
              )}
              style={{ height: on ? 8 + (1 - threshold) * 20 : 6 }}
            />
          );
        })}
      </div>

      {/* ── Text fallback ── */}
      {showText && (
        <div className="border-t border-warm-border p-2.5 flex gap-2 items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitText(); } }}
            placeholder="Type instead…"
            rows={1}
            className="flex-1 resize-none bg-gray-50 border border-warm-border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-brand"
          />
          <button onClick={submitText} disabled={!text.trim()}
            className="bg-brand text-white p-2 rounded-lg hover:opacity-90 disabled:opacity-40">
            <Send size={14} />
          </button>
        </div>
      )}

      {/* ── Controls ── */}
      <div className="border-t border-warm-border px-4 py-3 flex items-center justify-center gap-3">
        {dead ? (
          <button onClick={restart}
            className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-full text-sm hover:opacity-90">
            <RotateCcw size={15} /> Start again
          </button>
        ) : (
          <>
            <button
              onClick={toggleMute}
              title={muted ? "Unmute microphone" : "Mute microphone"}
              className={clsx(
                "w-11 h-11 rounded-full flex items-center justify-center transition-colors",
                muted ? "bg-gray-200 text-charcoal" : "bg-brand text-white hover:opacity-90",
              )}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              onClick={() => setShowText((v) => !v)}
              title="Type instead"
              className={clsx(
                "w-9 h-9 rounded-full flex items-center justify-center transition-colors",
                showText ? "bg-charcoal text-white" : "bg-gray-100 text-muted hover:text-charcoal",
              )}
            >
              <Keyboard size={16} />
            </button>
            <button
              onClick={restart}
              title="Restart conversation"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-100 text-muted hover:text-charcoal transition-colors"
            >
              <RotateCcw size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
