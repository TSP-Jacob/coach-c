"use client";
import { useEffect, useRef, useState } from "react";
import { api, ChatMessage, Conversation } from "@/lib/api";
import ChatInterface from "@/components/ChatInterface";
import { useAuth } from "@/lib/auth";
import { ChevronLeft, ChevronRight, Plus, Trash2, Pencil, Check, X } from "lucide-react";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ChatPage() {
  const { agentId } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId,      setActiveId]      = useState<string | null>(null);
  const [messages,      setMessages]      = useState<ChatMessage[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [panelOpen,     setPanelOpen]     = useState(true);
  const [editingId,     setEditingId]     = useState<string | null>(null);
  const [editTitle,     setEditTitle]     = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  /* ── Load conversations on mount ── */
  useEffect(() => {
    if (!agentId) return;
    api.conversations.list(agentId).then(async (list) => {
      if (list.length === 0) {
        // Auto-create first conversation
        const conv = await api.conversations.create(agentId, "New conversation");
        setConversations([conv]);
        setActiveId(conv.id);
      } else {
        setConversations(list);
        setActiveId(list[0].id);
      }
    });
  }, [agentId]);

  /* ── Load messages when active conversation changes ── */
  useEffect(() => {
    if (!agentId || !activeId) return;
    api.chat.history(agentId, activeId).then(setMessages);
  }, [agentId, activeId]);

  /* ── Send message ── */
  const send = async (text: string) => {
    if (!agentId || !activeId) return;
    const userMsg: ChatMessage = { role: "user", content: text, created_at: new Date().toISOString() };
    setMessages(m => [...m, userMsg]);
    setLoading(true);

    // Auto-title the conversation from the first message
    const conv = conversations.find(c => c.id === activeId);
    if (conv && conv.title === "New conversation" && messages.length === 0) {
      const title = text.slice(0, 48) + (text.length > 48 ? "…" : "");
      api.conversations.rename(activeId, title);
      setConversations(prev => prev.map(c => c.id === activeId ? { ...c, title } : c));
    }

    try {
      const { reply } = await api.chat.send(agentId, text, activeId);
      setMessages(m => [...m, { role: "assistant", content: reply, created_at: new Date().toISOString() }]);
      // Bump to top of list
      setConversations(prev => {
        const updated = prev.map(c => c.id === activeId ? { ...c, updated_at: new Date().toISOString() } : c);
        return [...updated].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      });
    } finally {
      setLoading(false);
    }
  };

  /* ── New conversation ── */
  const newConversation = async () => {
    if (!agentId) return;
    const conv = await api.conversations.create(agentId, "New conversation");
    setConversations(prev => [conv, ...prev]);
    setActiveId(conv.id);
    setMessages([]);
  };

  /* ── Delete conversation ── */
  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.conversations.delete(id);
    const remaining = conversations.filter(c => c.id !== id);
    setConversations(remaining);
    if (activeId === id) {
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
      } else {
        // Create a fresh one if last was deleted
        const conv = await api.conversations.create(agentId!, "New conversation");
        setConversations([conv]);
        setActiveId(conv.id);
        setMessages([]);
      }
    }
  };

  /* ── Rename conversation ── */
  const startEdit = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const commitEdit = async () => {
    if (!editingId || !editTitle.trim()) { setEditingId(null); return; }
    await api.conversations.rename(editingId, editTitle.trim());
    setConversations(prev => prev.map(c => c.id === editingId ? { ...c, title: editTitle.trim() } : c));
    setEditingId(null);
  };

  /* ── Clear active conversation messages ── */
  const clearMessages = async () => {
    if (!agentId || !activeId) return;
    await api.chat.clear(agentId, activeId);
    setMessages([]);
  };

  return (
    <div className="flex h-full -mx-8 -my-6">

      {/* ── Conversation panel ── */}
      <div className={`flex flex-col border-r border-warm-border bg-sidebar transition-all duration-200 shrink-0 ${panelOpen ? "w-56" : "w-10"}`}>
        {panelOpen ? (
          <>
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-3 border-b border-warm-border">
              <p className="text-[10px] tracking-widest uppercase text-muted font-medium">Conversations</p>
              <button onClick={() => setPanelOpen(false)} className="text-muted hover:text-charcoal transition-colors">
                <ChevronLeft size={14} />
              </button>
            </div>

            {/* New conversation button */}
            <button
              onClick={newConversation}
              className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted hover:text-charcoal hover:bg-cream transition-colors border-b border-warm-border"
            >
              <Plus size={13} /> New conversation
            </button>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-1">
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => { setActiveId(conv.id); setMessages([]); }}
                  className={`group flex items-start gap-1 px-3 py-2.5 cursor-pointer transition-colors ${
                    conv.id === activeId ? "bg-cream text-charcoal" : "text-muted hover:bg-cream hover:text-charcoal"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {editingId === conv.id ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          ref={editRef}
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                          className="text-xs w-full border border-brand px-1 py-0.5 focus:outline-none bg-white"
                        />
                        <button onClick={commitEdit} className="text-brand shrink-0"><Check size={11} /></button>
                        <button onClick={() => setEditingId(null)} className="text-muted shrink-0"><X size={11} /></button>
                      </div>
                    ) : (
                      <p className="text-xs leading-snug truncate">{conv.title}</p>
                    )}
                    <p className="text-[10px] text-muted mt-0.5">{timeAgo(conv.updated_at)}</p>
                  </div>
                  {editingId !== conv.id && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                      <button onClick={e => startEdit(conv, e)} className="hover:text-brand transition-colors"><Pencil size={11} /></button>
                      <button onClick={e => deleteConversation(conv.id, e)} className="hover:text-brand transition-colors"><Trash2 size={11} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Collapsed state — just a toggle button */
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center justify-center w-full py-3 text-muted hover:text-charcoal transition-colors border-b border-warm-border"
            title="Show conversations"
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* ── Chat area ── */}
      <div className="flex flex-col flex-1 min-w-0 px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-charcoal">
              {conversations.find(c => c.id === activeId)?.title ?? "Assistant"}
            </h1>
            <p className="text-xs text-muted mt-0.5">Your AI real estate assistant</p>
          </div>
          {messages.length > 0 && (
            <button onClick={clearMessages} className="text-xs text-muted hover:text-brand transition-colors">
              Clear conversation
            </button>
          )}
        </div>
        <ChatInterface messages={messages} onSend={send} loading={loading} />
      </div>
    </div>
  );
}
