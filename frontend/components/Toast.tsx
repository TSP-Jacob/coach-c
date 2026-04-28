"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle, XCircle, X } from "lucide-react";
import { clsx } from "clsx";

type ToastType = "success" | "error";
interface ToastItem { id: number; message: string; type: ToastType; }
interface ToastCtx { toast: (msg: string, type?: ToastType) => void; }

const Ctx = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++counter.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map(t => (
          <div key={t.id} className={clsx(
            "flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium min-w-64 animate-in slide-in-from-right",
            t.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white"
          )}>
            {t.type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
