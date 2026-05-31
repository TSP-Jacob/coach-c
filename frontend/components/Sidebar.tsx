"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Phone, MessageSquare, Users, BookOpen, Menu, X, Contact, LogOut, UserPlus, NotebookPen, Building2 } from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const nav = [
  { href: "/",             label: "Dashboard",    icon: LayoutDashboard },
  { href: "/leads",        label: "Leads",        icon: UserPlus },
  { href: "/calls",        label: "Calls",        icon: Phone },
  { href: "/clients",      label: "Clients",      icon: Contact },
  { href: "/chat",         label: "Assistant",    icon: MessageSquare },
  { href: "/agents",       label: "Agents",       icon: Users },
  { href: "/notes",        label: "Notes",        icon: NotebookPen },
  { href: "/organization", label: "Organization", icon: Building2 },
  { href: "/guidelines",   label: "Guidelines",   icon: BookOpen },
];

function NavLinks({ onNav }: { onNav?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex-1 px-4 py-6 space-y-0.5">
      {nav.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} onClick={onNav}
          className={clsx(
            "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors rounded",
            path === href
              ? "text-brand font-semibold"
              : "text-muted hover:text-charcoal"
          )}>
          <Icon size={15} strokeWidth={1.5} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const { signOut, session } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-52 bg-sidebar border-r border-warm-border flex-col shrink-0">
        <div className="px-6 py-6 border-b border-warm-border">
          <span className="text-xl font-serif font-bold text-charcoal">Coach-C</span>
          <span className="text-[10px] text-muted block mt-0.5 tracking-widest uppercase">by Propria Systems</span>
        </div>
        <NavLinks />
        <div className="px-6 py-4 border-t border-warm-border space-y-2">
          {!SKIP_AUTH && session && (
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-xs text-muted hover:text-brand transition-colors w-full"
            >
              <LogOut size={13} strokeWidth={1.5} /> Sign out
            </button>
          )}
          <p className="text-xs text-muted">Propria Systems © 2025</p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-cream border-b border-warm-border flex items-center justify-between px-4 py-3">
        <span className="text-base font-serif font-bold text-charcoal">Coach-C</span>
        <button onClick={() => setOpen(true)}>
          <Menu size={20} className="text-muted" />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="relative w-64 bg-cream flex flex-col h-full shadow-xl">
            <div className="px-6 py-5 border-b border-warm-border flex items-center justify-between">
              <span className="text-lg font-serif font-bold text-charcoal">Coach-C</span>
              <button onClick={() => setOpen(false)}>
                <X size={18} className="text-muted" />
              </button>
            </div>
            <NavLinks onNav={() => setOpen(false)} />
            <div className="px-6 py-4 border-t border-warm-border">
              <p className="text-xs text-muted">Propria Systems © 2025</p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
