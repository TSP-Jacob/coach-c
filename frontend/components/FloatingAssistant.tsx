"use client";
import { useEffect, useRef, useState } from "react";
import { api, ChatMessage } from "@/lib/api";
import { MessageSquare, X, Send, Loader2, Minus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { clsx } from "clsx";

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0, match: RegExpExecArray | null, key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[0].startsWith("**")) parts.push(<strong key={key++}>{match[2]}</strong>);
    else parts.push(<em key={key++}>{match[3]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;
  const flush = () => {
    if (!bullets.length) return;
    nodes.push(<ul key={key++} className="list-disc list-inside space-y-0.5 my-1">{bullets.map((b, i) => <li key={i}>{renderInline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of lines) {
    const bm = line.match(/^[-*]\s+(.*)/);
    if (bm) { bullets.push(bm[1]); }
    else { flush(); nodes.push(line.trim() === "" ? <br key={key++} /> : <p key={key++} className="my-0">{renderInline(line)}</p>); }
  }
  flush();
  return <>{nodes}</>;
}

export default function FloatingAssistant() {
  const { agentId } = useAuth();
  const [open,        setOpen]        = useState(false);
  const [minimised,   setMinimised]   = useState(false);
  const [messages,    setMessages]    = useState<ChatMessage[]>([]);
  const [input,       setInput]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [convId,      setConvId]      = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  /* create / reuse a "Quick Chat" conversation */
  useEffect(() => {
    if (!open || !agentId || convId) return;
    api.conversations.list(agentId).then(async list => {
      const quick = list.find(c => c.title === "Quick Chat");
      if (quick) {
        setConvId(quick.id);
        api.chat.history(agentId, quick.id).then(setMessages);
      } else {
        const conv = await api.conversations.create(agentId, "Quick Chat");
        setConvId(conv.id);
      }
    });
  }, [open, agentId, convId]);

  /* scroll to bottom on new messages */
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  /* focus input when opened */
  useEffect(() => { if (open && !minimised) setTimeout(() => inputRef.current?.focus(), 100); }, [open, minimised]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !agentId || !convId) return;
    setInput("");
    setMessages(m => [...m, { role: "user", content: text, created_at: new Date().toISOString() }]);
    setLoading(true);
    try {
      const { reply } = await api.chat.send(agentId, text, convId);
      setMessages(m => [...m, { role: "assistant", content: reply, created_at: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Floating panel ── */}
      {open && (
        <div className={clsx(
          "fixed bottom-20 right-6 z-50 w-[360px] bg-white border border-warm-border shadow-2xl flex flex-col transition-all duration-200",
          minimised ? "h-12" : "h-[500px]"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm-border bg-cream shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-brand" />
              <span className="text-sm font-medium text-charcoal">Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimised(v => !v)}
                className="p-1 text-muted hover:text-charcoal transition-colors"
                title={minimised ? "Expand" : "Minimise"}
              >
                <Minus size={13} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-muted hover:text-charcoal transition-colors"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {!minimised && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                {messages.length === 0 && (
                  <div className="text-center text-muted text-xs mt-8 space-y-1">
                    <p className="text-lg">👋</p>
                    <p className="font-medium text-charcoal text-sm">Hi, I'm your Assistant.</p>
                    <p>Ask me about your clients, leads, calls, or next steps.</p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={clsx(
                      "max-w-[85%] px-3 py-2 text-xs leading-relaxed",
                      m.role === "user"
                        ? "bg-brand text-white rounded-2xl rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm"
                    )}>
                      {m.role === "assistant" ? renderMarkdown(m.content) : m.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-2 text-gray-400 text-xs">
                      <Loader2 size={11} className="animate-spin" /> Thinking…
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="border-t border-warm-border p-3 flex gap-2 items-end shrink-0">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Ask anything…"
                  rows={1}
                  className="flex-1 resize-none bg-gray-50 border border-warm-border px-3 py-2 text-xs focus:outline-none focus:border-brand transition-colors"
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  className="bg-brand text-white p-2 hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
                >
                  <Send size={13} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Bubble trigger ── */}
      <button
        onClick={() => { setOpen(v => !v); setMinimised(false); }}
        className={clsx(
          "fixed bottom-6 right-6 z-50 w-13 h-13 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95",
          open ? "bg-charcoal text-white" : "bg-brand text-white"
        )}
        style={{ width: 52, height: 52 }}
        title="Open Assistant"
      >
        {open ? <X size={20} /> : <MessageSquare size={20} />}
      </button>
    </>
  );
}
