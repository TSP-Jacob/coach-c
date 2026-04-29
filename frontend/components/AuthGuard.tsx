"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, getExtToken } from "@/lib/auth";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const extToken = getExtToken();

  useEffect(() => {
    if (!loading && !SKIP_AUTH && !session && !extToken) {
      router.replace("/login");
    }
  }, [session, loading, router, extToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-cream">
        <div className="h-6 w-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!SKIP_AUTH && !session && !extToken) return null;

  return <>{children}</>;
}
