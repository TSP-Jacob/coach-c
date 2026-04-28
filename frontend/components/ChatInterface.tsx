"use client";
import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/lib/api";
import { Send, Loader2 } from "lucide-react";
import { clsx } from "clsx";

/** Render a single line with **bold** and *italic* inline markers. */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Split on **...** or *...*
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0, match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[0].startsWith("**")) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else {
      parts.push(<em key={key++}>{match[3]}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Convert a markdown string into React nodes (bold, italic, bullet lists, paragraphs). */
function renderMarkdown(content: string): React.ReactNode {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    nodes.push(
      <ul key={key++} className="list-disc list-inside space-y-0.5 my-1">
        {bulletBuffer.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[1]);
    } else {
      flushBullets();
      if (line.trim() === "") {
        nodes.push(<br key={key++} />);
      } else {
        nodes.push(<p key={key++} className="my-0">{renderInline(line)}</p>);
      }
    }
  }
  flushBullets();
  return <>{nodes}</>;
}

interface Props { messages: ChatMessage[]; onSend: (msg: string) => void; loading: boolean; }

export default function ChatInterface({ messages, onSend, loading }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSend(text);
  };

  return (
    <div className="flex flex-col flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-10 space-y-2">
            <p className="text-2xl">👋</p>
            <p className="font-medium text-gray-600">Hi, I'm Coach-C.</p>
            <p>Ask me anything about your calls, clients, or how to improve your next conversation.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={clsx(
              "max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed",
              m.role === "user" ? "bg-brand text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm"
            )}>
              {m.role === "assistant" ? renderMarkdown(m.content) : m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2 text-gray-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Coach-C is thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-gray-100 p-4 flex gap-3 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Ask Coach-C anything…"
          rows={1}
          className="flex-1 resize-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand transition-colors"
        />
        <button onClick={submit} disabled={!input.trim() || loading}
          className="bg-brand text-white p-2.5 rounded-xl hover:bg-brand-dark disabled:opacity-40 transition-colors">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
