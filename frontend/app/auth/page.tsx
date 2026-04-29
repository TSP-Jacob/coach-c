"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// This page receives ?token=... from the main Chardin Systems website,
// stores the token in sessionStorage, then redirects into the app.
export default function AuthPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      sessionStorage.setItem("ext_token", token);
    }
    router.replace("/");
  }, []);

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-cream">
      <div className="h-6 w-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
    </div>
  );
}
