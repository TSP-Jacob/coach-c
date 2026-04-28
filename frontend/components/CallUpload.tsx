"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { Upload, Loader2, CheckCircle2, XCircle, X } from "lucide-react";

interface Props { agentId: string; onSuccess: () => void; }

type FileStatus = "pending" | "uploading" | "done" | "error";
interface QueueItem { file: File; status: FileStatus; error?: string; }

export default function CallUpload({ agentId, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue]     = useState<QueueItem[]>([]);
  const [phone, setPhone]     = useState("");
  const [callDate, setCallDate] = useState("");
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const newItems: QueueItem[] = Array.from(incoming).map(file => ({ file, status: "pending" }));
    setQueue(q => [...q, ...newItems]);
  };

  const removeItem = (index: number) =>
    setQueue(q => q.filter((_, i) => i !== index));

  const setItemStatus = (index: number, status: FileStatus, error?: string) =>
    setQueue(q => q.map((item, i) => i === index ? { ...item, status, error } : item));

  const upload = async () => {
    const pending = queue.map((item, i) => ({ item, i })).filter(({ item }) => item.status === "pending");
    if (pending.length === 0) return;
    setRunning(true);
    setGlobalError("");

    for (const { item, i } of pending) {
      setItemStatus(i, "uploading");
      try {
        const form = new FormData();
        form.append("agent_id", agentId);
        form.append("file", item.file);
        if (phone.trim()) form.append("phone_number", phone.trim());
        if (callDate) {
          form.append("call_date", new Date(callDate).toISOString());
        } else {
          form.append("file_modified_at", new Date(item.file.lastModified).toISOString());
        }
        await api.calls.upload(form);
        setItemStatus(i, "done");
      } catch (e: unknown) {
        setItemStatus(i, "error", e instanceof Error ? e.message : "Upload failed");
      }
    }

    setRunning(false);
    const updated = queue.map((item, i) => {
      const match = pending.find(p => p.i === i);
      return match ? { ...item } : item;
    });
    const allDone = updated.every(item => item.status === "done" || item.status === "error");
    if (allDone) {
      onSuccess();
    }
  };

  const pendingCount = queue.filter(q => q.status === "pending").length;
  const doneCount    = queue.filter(q => q.status === "done").length;

  return (
    <div className="bg-white border border-warm-border p-6 space-y-5">
      <p className="text-[10px] tracking-widest uppercase text-muted">Upload Call Recordings</p>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        className="border-2 border-dashed border-warm-border p-8 text-center cursor-pointer hover:border-brand transition-colors">
        <Upload size={22} className="mx-auto text-muted mb-3" />
        <p className="text-sm text-muted">
          {queue.length === 0
            ? "Click or drag & drop MP3, M4A, or WAV files"
            : "Click or drop more files to add to queue"}
        </p>
        <input ref={inputRef} type="file" accept=".mp3,.m4a,.wav,.ogg" multiple className="hidden"
          onChange={e => addFiles(e.target.files)} />
      </div>

      {/* File queue */}
      {queue.length > 0 && (
        <div className="border border-warm-border divide-y divide-warm-border">
          {queue.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-charcoal truncate">{item.file.name}</p>
                {item.error && <p className="text-xs text-brand mt-0.5">{item.error}</p>}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {item.status === "pending"   && <span className="text-[10px] text-muted uppercase tracking-widest">Queued</span>}
                {item.status === "uploading" && <Loader2 size={13} className="animate-spin text-brand" />}
                {item.status === "done"      && <CheckCircle2 size={15} className="text-green-600" />}
                {item.status === "error"     && <XCircle size={15} className="text-brand" />}
                {(item.status === "pending" || item.status === "error") && (
                  <button onClick={() => removeItem(i)} className="text-muted hover:text-brand transition-colors">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Optional fields */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] tracking-widest uppercase text-muted mb-2">
            Client phone <span className="normal-case tracking-normal text-muted/60">(optional)</span>
          </label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            className="w-full border border-warm-border px-3 py-2.5 text-sm focus:outline-none focus:border-brand transition-colors bg-white" />
        </div>
        <div>
          <label className="block text-[10px] tracking-widest uppercase text-muted mb-2">
            Call date &amp; time <span className="normal-case tracking-normal text-muted/60">(optional)</span>
          </label>
          <input type="datetime-local" value={callDate} onChange={e => setCallDate(e.target.value)}
            className="w-full border border-warm-border px-3 py-2.5 text-sm focus:outline-none focus:border-brand transition-colors bg-white text-charcoal" />
        </div>
      </div>

      {globalError && <p className="text-sm text-brand">{globalError}</p>}

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted">
          {doneCount > 0 ? `${doneCount} of ${queue.length} uploaded` : queue.length > 0 ? `${queue.length} file${queue.length > 1 ? "s" : ""} queued` : ""}
        </p>
        <div className="flex gap-3">
          <button onClick={onSuccess} className="text-sm text-muted hover:text-charcoal px-4 py-2 transition-colors">
            Cancel
          </button>
          <button onClick={upload} disabled={pendingCount === 0 || running}
            className="bg-brand text-white text-sm px-6 py-2.5 hover:bg-brand-dark disabled:opacity-40 flex items-center gap-2 transition-colors">
            {running && <Loader2 size={13} className="animate-spin" />}
            {running
              ? "Uploading…"
              : pendingCount > 1
                ? `Upload & Analyze ${pendingCount} Calls`
                : "Upload & Analyze"}
          </button>
        </div>
      </div>
    </div>
  );
}
