"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Phone, MessageSquare, Users, BookOpen, Menu, X, Contact, LogOut, UserPlus, NotebookPen, Building2, CreditCard, ShieldCheck, PhoneCall, CalendarClock, ListChecks, Smartphone, Radio } from "lucide-react";
import { clsx } from "clsx";
import { useAuth } from "@/lib/auth";
import { SECTION_LABELS } from "@/lib/industry";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; roles?: string[]; feature?: string };

const nav: NavItem[] = [
  { href: "/",             label: "Dashboard",    icon: LayoutDashboard },
  { href: "/leads",        label: "Leads",        icon: UserPlus,      feature: "leads" },
  { href: "/calls",        label: "Calls",        icon: Phone },
  { href: "/live-calls",   label: "Live Calls",   icon: Radio,         roles: ["admin", "manager"] },
  { href: "/clients",      label: "Clients",      icon: Contact },
  { href: "/follow-ups",   label: "Follow-Ups",   icon: CalendarClock, feature: "follow_ups" },
  { href: "/tasks",        label: "Tasks",        icon: ListChecks,    feature: "tasks" },
  { href: "/chat",         label: "Assistant",    icon: MessageSquare, feature: "voice_assistant" },
  { href: "/agents",       label: "Agents",       icon: Users },
  { href: "/notes",        label: "Notes",        icon: NotebookPen,   feature: "notes" },
  { href: "/organization", label: "Organization", icon: Building2 },
  { href: "/guidelines",   label: "Guidelines",   icon: BookOpen },
  { href: "/get-app",      label: "Get the App",  icon: Smartphone,    feature: "mobile_app" },
  // Admin-only team management
  { href: "/team",          label: "Team",            icon: ShieldCheck, roles: ["admin"] },
  { href: "/phone-numbers", label: "Phone Numbers",   icon: PhoneCall,   roles: ["admin"] },
  // Billing — managers see their own; admins see the configuration view
  { href: "/billing",       label: "Billing",         icon: CreditCard, roles: ["manager"] },
  { href: "/billing/admin", label: "Billing (Admin)", icon: CreditCard, roles: ["admin"] },
];

function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useAuth();
  return (
    <div className={clsx("flex items-center border border-warm-border text-[10px] font-medium tracking-wide overflow-hidden shrink-0", className)}>
      <button
        onClick={() => setLanguage("en")}
        className={clsx("px-2 py-1 transition-colors", language === "en" ? "bg-brand text-white" : "text-muted hover:text-charcoal")}
      >
        EN
      </button>
      <button
        onClick={() => setLanguage("fr")}
        className={clsx("px-2 py-1 transition-colors", language === "fr" ? "bg-brand text-white" : "text-muted hover:text-charcoal")}
      >
        FR
      </button>
    </div>
  );
}

function NavLinks({ onNav }: { onNav?: () => void }) {
  const path = usePathname();
  const { role, features, industryMode, t } = useAuth();
  const sectionLabels = SECTION_LABELS[industryMode];
  const visible = nav.filter(item =>
    (!item.roles || (role != null && item.roles.includes(role))) &&
    (!item.feature || features[item.feature] !== false)
  );
  return (
    <nav className="flex-1 px-4 py-6 space-y-0.5">
      {visible.map(({ href, label, icon: Icon }) => {
        const displayLabel = href === "/leads" ? t(sectionLabels.leads)
          : href === "/agents" ? t(sectionLabels.agents)
          : t(label);
        return (
          <Link key={href} href={href} onClick={onNav}
            className={clsx(
              "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors rounded",
              path === href
                ? "text-brand font-semibold"
                : "text-muted hover:text-charcoal"
            )}>
            <Icon size={15} strokeWidth={1.5} />
            {displayLabel}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const { signOut, session, agentId, t } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    const alreadyNavigated = await signOut();
    if (!alreadyNavigated) router.replace("/login");
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-52 bg-sidebar border-r border-warm-border flex-col shrink-0">
        <div className="px-6 py-6 border-b border-warm-border flex items-start justify-between gap-2">
          <div>
            <span className="text-xl font-serif font-bold text-charcoal">Coach-C</span>
            <span className="text-[10px] text-muted block mt-0.5 tracking-widest uppercase">by Chardin Systems</span>
          </div>
          <LanguageToggle className="mt-0.5" />
        </div>
        <NavLinks />
        <div className="px-6 py-4 border-t border-warm-border space-y-2">
          {!SKIP_AUTH && (session || agentId) && (
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-xs text-muted hover:text-brand transition-colors w-full"
            >
              <LogOut size={13} strokeWidth={1.5} /> {t("Sign out")}
            </button>
          )}
          <p className="text-xs text-muted">Chardin Systems © 2025</p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-cream border-b border-warm-border flex items-center justify-between px-4 py-3 gap-2">
        <span className="text-base font-serif font-bold text-charcoal">Coach-C</span>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <button onClick={() => setOpen(true)}>
            <Menu size={20} className="text-muted" />
          </button>
        </div>
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
            <div className="px-6 py-4 border-t border-warm-border space-y-2">
              {!SKIP_AUTH && (session || agentId) && (
                <button
                  onClick={() => { setOpen(false); handleSignOut(); }}
                  className="flex items-center gap-2 text-xs text-muted hover:text-brand transition-colors w-full"
                >
                  <LogOut size={13} strokeWidth={1.5} /> {t("Sign out")}
                </button>
              )}
              <p className="text-xs text-muted">Chardin Systems © 2025</p>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
