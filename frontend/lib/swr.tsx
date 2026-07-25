"use client";
import { SWRConfig } from "swr";

/**
 * App-wide SWR defaults, tuned freshness-first: cached data still renders
 * instantly (keepPreviousData), but we revalidate whenever you return to the
 * tab or navigate, and only briefly dedupe — so information is never more than
 * a few seconds stale, even when it changes server-side.
 */
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,   // refetch when the tab regains focus / on navigation
        dedupingInterval: 5_000,   // collapse duplicate requests within 5s
        keepPreviousData: true,    // show cached data instantly while revalidating
      }}
    >
      {children}
    </SWRConfig>
  );
}

/**
 * SWR `refreshInterval` helper for call lists: poll every 5s while any call is
 * still being processed server-side (transcribing/analyzing), then stop. So a
 * freshly uploaded call flips to its score on its own, without a manual refresh.
 */
export function pollWhileProcessing(calls?: { status?: string }[]): number {
  const busy = (calls ?? []).some(c => c.status !== "complete" && c.status !== "error");
  return busy ? 5000 : 0;
}
