"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Smartphone, Download, AlertTriangle } from "lucide-react";

function DownloadButton({ app, label }: { app: "recorder" | "dashboard"; label: string }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const { url } = await api.app.androidDownload(app);
      window.location.href = url;
    } catch {
      setError("Couldn't get the download link. Try again in a moment.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="flex items-center gap-2 bg-brand text-white px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        <Download size={15} />
        {downloading ? "Getting link…" : label}
      </button>
      {error && <p className="text-sm text-brand">{error}</p>}
    </div>
  );
}

export default function GetAppPage() {
  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Get the App</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          Two Android apps, for two different jobs
        </p>
      </div>

      {/* Coach-C Dashboard */}
      <div className="bg-white border border-warm-border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-muted" />
          <p className="text-[10px] tracking-widest uppercase text-muted">Coach-C Dashboard</p>
        </div>
        <p className="text-sm text-charcoal leading-relaxed">
          Everything you use on the web — Dashboard, Leads, Calls, Clients, Follow-Ups, Tasks, and
          the AI Assistant — in a native app on your phone. Sign in once and it stays signed in.
          No call-recording permissions needed; this is just the same Coach-C, on your phone.
        </p>
        <DownloadButton app="dashboard" label="Download Dashboard App" />
      </div>

      {/* Coach-C Call Recorder */}
      <div className="bg-white border border-warm-border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-muted" />
          <p className="text-[10px] tracking-widest uppercase text-muted">Coach-C Call Recorder</p>
        </div>
        <p className="text-sm text-charcoal leading-relaxed">
          Install this on your phone and it records both sides of the call — incoming calls you
          answer yourself, and outgoing calls you place — uploading each one straight to your
          Coach-C account. It also screens incoming calls, letting you answer or decline; calls
          you don&apos;t answer are handled by your carrier&apos;s call forwarding (set up
          separately) so they can still reach your AI phone agent instead of voicemail. Any
          contact on your do-not-record list is skipped in both directions.
        </p>
        <DownloadButton app="recorder" label="Download Call Recorder" />
      </div>

      {/* Install steps */}
      <div className="bg-white border border-warm-border p-6 space-y-4">
        <p className="text-[10px] tracking-widest uppercase text-muted">Installing either one</p>
        <ol className="space-y-3 text-sm text-charcoal leading-relaxed list-decimal list-inside">
          <li>Tap the download button above, on the phone itself.</li>
          <li>
            Android will warn that it doesn&apos;t recognize this app — that&apos;s expected for
            anything installed outside the Play Store. Tap <span className="font-medium">Settings</span>,
            then allow installs from this source (you&apos;ll only need to do this once).
          </li>
          <li>Open the app and sign in with your Coach-C email and password.</li>
          <li>
            Grant the permissions it asks for — the Dashboard app only needs microphone +
            notifications for its voice assistant shortcut; the Call Recorder additionally needs
            call screening, phone, and call log access to do its job.
          </li>
        </ol>

        <div className="flex items-start gap-2.5 bg-cream border border-warm-border px-4 py-3 mt-2">
          <AlertTriangle size={14} className="text-brand shrink-0 mt-0.5" />
          <p className="text-xs text-charcoal leading-relaxed">
            <span className="font-medium">Already have an older version installed?</span> You&apos;ll
            need to uninstall it first if it was signed differently — Android won&apos;t install
            over a mismatched signature. Every update after your first install of each app
            installs normally over the previous version.
          </p>
        </div>
      </div>
    </div>
  );
}
