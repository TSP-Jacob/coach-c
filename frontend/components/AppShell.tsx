"use client";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import AuthGuard from "./AuthGuard";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Login / auth pages: bare full-screen — no sidebar, no auth guard
  if (pathname === "/login" || pathname === "/auth") {
    return <>{children}</>;
  }

  return (
    <AuthGuard>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8 pt-16 md:pt-8">
        {children}
      </main>
    </AuthGuard>
  );
}
