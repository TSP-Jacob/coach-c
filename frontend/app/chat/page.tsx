"use client";
import { useEffect, useState } from "react";
import { api, ChatMessage } from "@/lib/api";
import ChatInterface from "@/components/ChatInterface";
import VoiceAssistant from "@/components/VoiceAssistant";
import { useAuth } from "@/lib/auth";
import { Mic, Keyboard } from "lucide-react";

export default function ChatPage() {
  const { agentId } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [mode,     setMode]     = useState<"voice" | "text">("voice");

  /* ── Load the shared rolling history (also refreshes when entering text mode,
        so it picks up anything said via voice). ── */
  useEffect(() => {
    if (!agentId || mode !== "text") return;
    api.chat.history(agentId).then(setMessages).catch(() => {});
  }, [agentId, mode]);

  /* ── Send a text message ── */
  const send = async (text: string) => {
    if (!agentId) return;
    setMessages(m => [...m, { role: "user", content: text, created_at: new Date().toISOString() }]);
    setLoading(true);
    try {
      const { reply } = await api.chat.send(agentId, text);
      setMessages(m => [...m, { role: "assistant", content: reply, created_at: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  /* ── Clear the whole rolling history ── */
  const clearMessages = async () => {
    if (!agentId) return;
    await api.chat.clear(agentId);
    setMessages([]);
  };

  return (
    <div className="flex h-full -mx-8 -my-6">
      <div className="flex flex-col flex-1 min-w-0 px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-charcoal">
              {mode === "voice" ? "Voice Assistant" : "Assistant"}
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {mode === "voice"
                ? "Talk to your assistant — grounded in your calls & clients"
                : "Your AI real estate assistant"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {mode === "text" && messages.length > 0 && (
              <button onClick={clearMessages} className="text-xs text-muted hover:text-brand transition-colors">
                Clear conversation
              </button>
            )}
            {/* Voice / Text mode toggle */}
            <div className="flex items-center bg-gray-100 rounded-full p-0.5 text-xs">
              <button
                onClick={() => setMode("voice")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${mode === "voice" ? "bg-white text-charcoal shadow-sm" : "text-muted hover:text-charcoal"}`}
              >
                <Mic size={13} /> Voice
              </button>
              <button
                onClick={() => setMode("text")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${mode === "text" ? "bg-white text-charcoal shadow-sm" : "text-muted hover:text-charcoal"}`}
              >
                <Keyboard size={13} /> Text
              </button>
            </div>
          </div>
        </div>
        {mode === "voice"
          ? <VoiceAssistant />
          : <ChatInterface messages={messages} onSend={send} loading={loading} />}
      </div>
    </div>
  );
}
