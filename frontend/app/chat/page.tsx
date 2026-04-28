"use client";
import { useEffect, useRef, useState } from "react";
import { api, ChatMessage } from "@/lib/api";
import ChatInterface from "@/components/ChatInterface";
import { useAuth } from "@/lib/auth";

export default function ChatPage() {
  const { agentId: AGENT_ID } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (AGENT_ID) api.chat.history(AGENT_ID).then(setMessages);
  }, [AGENT_ID]);

  const send = async (text: string) => {
    const userMsg: ChatMessage = { role: "user", content: text, created_at: new Date().toISOString() };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    try {
      const { reply } = await api.chat.send(AGENT_ID, text, undefined, Intl.DateTimeFormat().resolvedOptions().timeZone);
      setMessages((m) => [...m, { role: "assistant", content: reply, created_at: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    await api.chat.clear(AGENT_ID);
    setMessages([]);
  };

  return (
    <div className="max-w-3xl flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Coach-C</h1>
          <p className="text-sm text-gray-400">Your AI sales mentor</p>
        </div>
        {messages.length > 0 && (
          <button onClick={clear} className="text-xs text-gray-400 hover:text-red-400">Clear history</button>
        )}
      </div>
      <ChatInterface messages={messages} onSend={send} loading={loading} />
    </div>
  );
}
