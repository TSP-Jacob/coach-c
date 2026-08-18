"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { api, getAuthToken, wsBase, LiveCall } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LiveCallClient, LiveCallState } from "@/lib/liveCallClient";
import { Radio, Phone, Headphones, Mic, PhoneOff, X, Loader2, AlertCircle } from "lucide-react";
import { clsx } from "clsx";

const STATUS_LABEL: Record<LiveCallState, string> = {
  idle: "Starting…",
  connecting: "Connecting…",
  listening: "Listening",
  takeover_active: "You're live — talking to the caller",
  error: "Something went wrong",
  ended: "Call ended",
  closed: "Disconnected",
};

function relativeStart(iso: string): string {
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return "";
  const mins = Math.max(0, Math.round((Date.now() - started) / 60000));
  if (mins < 1) return "just started";
  if (mins === 1) return "1 min ago";
  return `${mins} min ago`;
}

function ActiveSession({ call, onClose }: { call: LiveCall; onClose: () => void }) {
  const [state, setState] = useState<LiveCallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const clientRef = useRef<LiveCallClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (cancelled) return;
      const url = `${wsBase()}/api/live-calls/${call.callSid}/stream`;
      const c = new LiveCallClient(url, token, {
        onState: setState,
        onError: (m) => setError(m),
        onTakeoverDenied: (r) => setDenied(r),
      });
      clientRef.current = c;
      await c.start();
    })();
    return () => {
      cancelled = true;
      clientRef.current?.stop();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callSid]);

  const takeoverActive = state === "takeover_active";

  return (
    <div className="bg-white border border-warm-border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] tracking-widest uppercase text-muted">Live session</p>
          <p className="text-sm font-medium text-charcoal mt-0.5">
            {call.callerFrom || "Unknown caller"}
          </p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-brand transition-colors" title="Close">
          <X size={18} />
        </button>
      </div>

      <div className={clsx(
        "flex items-center gap-2 text-sm px-3 py-2.5 border",
        takeoverActive ? "border-brand/30 bg-brand-light text-brand" : "border-warm-border text-muted"
      )}>
        {(state === "connecting" || state === "idle") && <Loader2 size={14} className="animate-spin" />}
        {takeoverActive && <Mic size={14} />}
        {state === "listening" && <Headphones size={14} />}
        {STATUS_LABEL[state]}
      </div>

      {error && (
        <p className="text-xs text-brand bg-brand-light border border-brand/20 px-3 py-2 flex items-center gap-2">
          <AlertCircle size={13} /> {error}
        </p>
      )}
      {denied && (
        <p className="text-xs text-brand bg-brand-light border border-brand/20 px-3 py-2 flex items-center gap-2">
          <AlertCircle size={13} /> {denied}
        </p>
      )}

      <div className="flex gap-3">
        {state === "listening" && (
          <button
            onClick={() => clientRef.current?.startTakeover()}
            className="bg-charcoal text-white text-sm px-4 py-2.5 hover:bg-brand transition-colors flex items-center gap-2"
          >
            <Mic size={14} /> Take over
          </button>
        )}
        {takeoverActive && (
          <button
            onClick={() => clientRef.current?.endCall()}
            className="bg-brand text-white text-sm px-4 py-2.5 hover:opacity-90 transition-colors flex items-center gap-2"
          >
            <PhoneOff size={14} /> End call
          </button>
        )}
      </div>

      {takeoverActive && (
        <p className="text-[11px] text-muted italic">
          Francis has stopped responding on this call — you&apos;re talking directly to the caller. This can&apos;t be undone for this call; end it when you&apos;re done.
        </p>
      )}
    </div>
  );
}

export default function LiveCallsPage() {
  const { role, loading: authLoading } = useAuth();
  const canAccess = role === "admin" || role === "manager";

  const { data, error } = useSWR(
    canAccess ? "live-calls" : null,
    () => api.liveCalls.list(),
    { refreshInterval: 4000 },
  );

  const [selected, setSelected] = useState<LiveCall | null>(null);

  if (!authLoading && !canAccess) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted italic font-serif">This page is available to admins and managers only.</p>
      </div>
    );
  }

  const calls = data?.calls ?? [];
  const configured = data?.configured ?? true;

  return (
    <div className="max-w-4xl space-y-8">
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Live Calls</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          Listen in on calls in progress, and take over if something goes wrong
        </p>
      </div>

      {error && (
        <p className="text-xs text-brand bg-brand-light border border-brand/20 px-3 py-2">
          {String((error as any)?.message || error)}
        </p>
      )}

      {selected && <ActiveSession call={selected} onClose={() => setSelected(null)} />}

      <div className="bg-white border border-warm-border">
        <div className="px-6 py-4 border-b border-warm-border">
          <p className="text-[10px] tracking-widest uppercase text-muted">In progress</p>
        </div>
        <div className="divide-y divide-warm-border">
          {!data && !error && (
            <p className="text-sm text-muted px-6 py-8 italic font-serif">Loading…</p>
          )}
          {data && !configured && (
            <p className="text-sm text-muted px-6 py-8 italic font-serif">
              Live calls aren&apos;t configured for this organization yet — no phone agent deployment is registered (set one up under Organization).
            </p>
          )}
          {data && configured && calls.length === 0 && (
            <p className="text-sm text-muted px-6 py-8 italic font-serif">
              No calls in progress right now.
            </p>
          )}
          {calls.map((c) => (
            <div key={c.callSid} className="flex items-center justify-between px-6 py-4 hover:bg-cream transition-colors">
              <div className="flex items-center gap-3">
                <Phone size={15} className="text-muted shrink-0" />
                <div>
                  <p className="text-sm font-medium text-charcoal">{c.callerFrom || "Unknown caller"}</p>
                  <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                    {relativeStart(c.startedAt)}
                    {c.takeoverActive && (
                      <span className="inline-flex items-center gap-1 text-brand">
                        <Radio size={11} /> being handled by an admin
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelected(c)}
                className="border border-warm-border text-sm px-4 py-2 text-charcoal hover:border-brand hover:text-brand transition-colors flex items-center gap-2"
              >
                <Headphones size={14} /> Listen
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
