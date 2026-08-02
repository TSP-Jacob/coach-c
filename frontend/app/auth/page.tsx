"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// This page receives ?token=&refresh_token=... from the main Chardin Systems
// website (or the admin "view as" flow) and hands off into the app.
//
// When refresh_token is present, this establishes a REAL Supabase session
// via setSession() — the client library then persists it in localStorage
// and refreshes it automatically forever, exactly like a direct email/
// password login. That's what makes staying signed in "until I explicitly
// sign out" (rather than getting logged out whenever the tab/browser
// closes) actually work: the old behavior stored just the raw access
// token in sessionStorage, which (a) is wiped on browser close by design,
// and (b) was never refreshed, so it also died within an hour regardless.
//
// Falls back to the old sessionStorage ext_token behavior if a caller
// hasn't been updated to send refresh_token yet.
export default function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    const refreshToken = params.get("refresh_token");

    (async () => {
      if (token && refreshToken) {
        await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken });
      } else if (token) {
        sessionStorage.setItem("ext_token", token);
      }
      router.replace("/");
    })();
  }, []);

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-cream">
      <div className="h-6 w-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
    </div>
  );
}
