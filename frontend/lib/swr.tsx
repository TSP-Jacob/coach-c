"use client";
import { SWRConfig } from "swr";

/**
 * App-wide SWR defaults. The key win: cached data is shown instantly when you
 * navigate back to a section, then revalidated in the background — no more
 * empty-then-fill flash on every visit.
 */
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,   // don't refetch every time the tab regains focus
        dedupingInterval: 30_000,   // collapse duplicate requests within 30s
        keepPreviousData: true,     // show the last data while the new key loads
      }}
    >
      {children}
    </SWRConfig>
  );
}
