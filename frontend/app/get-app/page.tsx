"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Smartphone, Download, AlertTriangle } from "lucide-react";

export default function GetAppPage() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const { url } = await api.app.androidDownload();
      window.location.href = url;
    } catch {
      setError("Couldn't get the download link. Try again in a moment.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Get the App</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          Android call recorder for Coach-C
        </p>
      </div>

      {/* What it does */}
      <div className="bg-white border border-warm-border p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-muted" />
          <p className="text-[10px] tracking-widest uppercase text-muted">What this app does</p>
        </div>
        <p className="text-sm text-charcoal leading-relaxed">
          Install this on your phone and it can screen incoming calls, letting you choose to
          answer yourself, hand off to your AI phone agent, or decline. When you answer a call
          yourself, it records and uploads it straight to your Coach-C account.
        </p>
      </div>

      {/* Download */}
      <div className="bg-white border border-warm-border p-6 space-y-4">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-2 bg-brand text-white px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Download size={15} />
          {downloading ? "Getting link…" : "Download for Android"}
        </button>
        {error && <p className="text-sm text-brand">{error}</p>}
        <p className="text-xs text-muted">
          This isn&apos;t on the Google Play Store yet, so it installs directly from this file —
          see the steps below.
        </p>
      </div>

      {/* Install steps */}
      <div className="bg-white border border-warm-border p-6 space-y-4">
        <p className="text-[10px] tracking-widest uppercase text-muted">Installing it</p>
        <ol className="space-y-3 text-sm text-charcoal leading-relaxed list-decimal list-inside">
          <li>Tap <span className="font-medium">Download for Android</span> above, on the phone itself.</li>
          <li>
            Android will warn that it doesn&apos;t recognize this app — that&apos;s expected for
            anything installed outside the Play Store. Tap <span className="font-medium">Settings</span>,
            then allow installs from this source (you&apos;ll only need to do this once).
          </li>
          <li>Open the app and sign in with your Coach-C email and password.</li>
          <li>
            Grant the permissions it asks for (call screening, microphone, phone) — it can&apos;t
            record or hand off calls without them.
          </li>
        </ol>

        <div className="flex items-start gap-2.5 bg-cream border border-warm-border px-4 py-3 mt-2">
          <AlertTriangle size={14} className="text-brand shrink-0 mt-0.5" />
          <p className="text-xs text-charcoal leading-relaxed">
            <span className="font-medium">Already have an older version installed?</span> You&apos;ll
            need to uninstall it first — this build is signed differently, and Android won&apos;t
            install over a mismatched signature. Every update after this one will install
            normally over the previous version.
          </p>
        </div>
      </div>
    </div>
  );
}
