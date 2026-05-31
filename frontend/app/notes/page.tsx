"use client";
import { useEffect, useRef, useState } from "react";
import { api, Client, Note } from "@/lib/api";
import { Mic, MicOff, Trash2, NotebookPen } from "lucide-react";
import { useAuth } from "@/lib/auth";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function NotesPage() {
  const { agentId } = useAuth();
  const [notes,   setNotes]   = useState<Note[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [content,  setContent]  = useState("");
  const [saving,   setSaving]   = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!agentId) return;
    api.notes.list(agentId).then(setNotes);
    api.agents.listClients(agentId).then(setClients);
  }, [agentId]);

  /* ── Voice transcription ── */
  function startListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition is not supported in this browser. Try Chrome or Edge."); return; }
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = content;
    recognition.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      setContent(finalTranscript + interim);
    };
    recognition.onend = () => {
      setContent(finalTranscript.trim());
      setListening(false);
    };
    recognition.start();
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  /* ── Save note ── */
  async function handleSave() {
    if (!agentId || !content.trim()) return;
    setSaving(true);
    try {
      const note = await api.notes.create(agentId, {
        content: content.trim(),
        client_id: clientId || undefined,
      });
      // Attach client name locally so it shows immediately
      const linkedClient = clients.find(c => c.id === clientId);
      setNotes(prev => [{ ...note, clients: linkedClient ? { name: linkedClient.name } : undefined }, ...prev]);
      setContent("");
      setClientId("");
      textareaRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId: string) {
    await api.notes.delete(noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div className="border-b border-warm-border pb-5">
        <h1 className="text-4xl font-serif font-bold text-charcoal">Notes</h1>
        <p className="text-xs text-muted mt-1 tracking-widest uppercase">
          {notes.length} note{notes.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* New note form */}
      <div className="bg-white border border-warm-border">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm-border">
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="text-xs border border-warm-border bg-white px-2 py-1.5 focus:outline-none focus:border-brand transition-colors max-w-[200px]"
          >
            <option value="">No client linked</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <button
            onClick={listening ? stopListening : startListening}
            title={listening ? "Stop recording" : "Dictate note"}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border transition-colors ${
              listening
                ? "border-brand text-brand bg-brand-light animate-pulse"
                : "border-warm-border text-muted hover:border-brand hover:text-brand"
            }`}
          >
            {listening ? <MicOff size={13} /> : <Mic size={13} />}
            {listening ? "Stop" : "Dictate"}
          </button>
        </div>

        {/* Text area */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={listening ? "Listening… speak now" : "Type your note here…"}
          rows={5}
          className="w-full px-4 py-3 text-sm text-charcoal placeholder:text-muted resize-none focus:outline-none"
        />

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-warm-border">
          <p className="text-[10px] text-muted">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            {" · "}{new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </p>
          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            className="bg-brand text-white text-xs px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save Note"}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <NotebookPen size={28} className="text-muted" strokeWidth={1.5} />
          <p className="text-muted text-sm italic font-serif">No notes yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map(note => (
            <div key={note.id} className="bg-white border border-warm-border px-5 py-4 group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    {note.clients?.name && (
                      <span className="text-xs border border-warm-border px-2 py-0.5 text-muted">
                        {note.clients.name}
                      </span>
                    )}
                    <span className="text-[10px] text-muted">{formatDateTime(note.created_at)}</span>
                  </div>
                  <p className="text-sm text-charcoal leading-relaxed whitespace-pre-wrap">{note.content}</p>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="text-warm-border hover:text-brand opacity-0 group-hover:opacity-100 transition-all shrink-0 mt-0.5"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
